const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://kontrakdigital.netlify.app', 'https://kontrakdigital.com', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';

// =====================
// MONGODB SCHEMAS
// =====================

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, unique: true, sparse: true },
    password: { type: String, required: true },
    phone: String,
    role: { type: String, default: 'user' },
    trading_account: String,
    balance: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true }
}, {
    timestamps: true
});

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, default: 'general' },
    content: { type: String, required: true },
    variables: [String],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    description: String // Tambahan untuk deskripsi template
}, {
    timestamps: true
});

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true },
    number: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    content: String,
    amount: { type: Number, default: 0 },
    status: { type: String, default: 'draft' },
    variables: { type: Object, default: {} },
    signature_data: String,
    signed_at: Date,
    expiry_date: Date,
    admin_notes: String,
    access_token: { type: String, unique: true },
    pdf_file_path: String // Path untuk file PDF yang sudah ditandatangani
}, {
    timestamps: true
});

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true },
    description: String,
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

// Create Models
const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Contract = mongoose.model('Contract', contractSchema);
const ContractHistory = mongoose.model('ContractHistory', contractHistorySchema);

// =====================
// DATABASE CONNECTION
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Connecting to MongoDB Atlas...');
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        console.log('✅ MongoDB Atlas connected successfully!');
        await setupInitialData();
        
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.log('⚠️  Continuing with server startup...');
    }
}

async function setupInitialData() {
    try {
        console.log('🚀 Setting up initial data...');
        
        // Create admin user
        const adminExists = await User.findOne({ email: 'admin@tradestation.com' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await User.create({
                name: 'Admin TradeStation',
                email: 'admin@tradestation.com',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                trading_account: 'ADM001',
                phone: '+62812-3456-7890',
                balance: 0
            });
            console.log('✅ Default admin user created');
        }
        
        // Create sample user
        const userExists = await User.findOne({ email: 'hermanzal@trader.com' });
        if (!userExists) {
            const hashedPassword = await bcrypt.hash('trader123', 10);
            await User.create({
                name: 'Herman Zaldivar',
                email: 'hermanzal@trader.com',
                username: 'hermanzal',
                password: hashedPassword,
                role: 'user',
                trading_account: 'TRD001',
                phone: '+62812-8888-9999',
                balance: 50000000
            });
            console.log('✅ Sample user created');
        }
        
        // Create template berdasarkan dokumen yang diupload
        const templateExists = await Template.findOne({ name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi',
                    category: 'investment',
                    description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia',
                    content: `# Perjanjian Layanan Kerja Sama Konsultasi Investasi

Nomor Kontrak: {{CONTRACT_NUMBER}}

## Pihak A: {{USER_NAME}}

Alamat: {{USER_ADDRESS}}
Email: {{USER_EMAIL}}
Telepon: {{USER_PHONE}}
Trading ID: {{TRADING_ID}}

## Pihak B: PT. Konsultasi Profesional Indonesia

Alamat: Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3,
RT.1/RW.2, Kuningan, Jakarta Selatan 12950

Kontak: Prof. Bima Agung Rachel
Telepon: +62 852 - 5852 - 8771

**Pihak A**, sebagai individu, setuju untuk menggunakan layanan analisis
pasar atau layanan konsultasi yang disediakan oleh **Pihak B**, PT.
Konsultasi Profesional Indonesia. Pihak B menyediakan layanan seperti
analisis pasar, konsultasi investasi, analisis produk, laporan riset
pasar, dsb. Untuk memajukan pembangunan dan kerja sama bersama yang
saling menguntungkan, dan berdasarkan prinsip kesetaraan dan saling
menghormati, kedua belah pihak menyepakati ketentuan-ketentuan berikut
untuk kerja sama ini, dan akan secara ketat mematuhinya.

## Pasal 1: Definisi Awal

1.1. Biaya konsultasi layanan merujuk pada investasi sebesar **{{AMOUNT}}** oleh
pelanggan. Anda dapat meminta Pihak B untuk melakukan analisis data,
laporan, dll.

1.2. Biaya transaksi merujuk pada biaya yang dibebankan oleh Pihak B.
Biaya ini dihitung berdasarkan jumlah transaksi tunggal sebesar **{{TRANSACTION_FEE}}**.

## Pasal 2: Konten Layanan dan Standar Tarif

2.1. Pihak B menyediakan analisis dan rekomendasi kepada Pihak A.

2.2. Pihak A dan B menyetujui metode dan tingkat pembayaran sebesar **{{PAYMENT_METHOD}}**.

2.3. Jika ada biaya tambahan dalam proses kerja sama, harus disetujui
bersama sebelumnya.

2.4. Laporan akhir yang disediakan Pihak B kepada Pihak A mencakup
informasi tentang tren industri, analisis pasar, dan opini profesional
lainnya.

2.5. Informasi yang disediakan oleh Pihak B harus dijaga kerahasiaannya
oleh Pihak A dan tidak boleh disebarkan tanpa izin tertulis.

## Pasal 3: Metode Penyelesaian

3.1. Pihak A akan menyelesaikan pembayaran untuk layanan dan biaya
transaksi sesuai perjanjian dalam waktu **{{PAYMENT_TERMS}}** hari.

3.2. Jika pembayaran tidak dilakukan tepat waktu, Pihak A akan dikenakan
denda harian sebesar **{{LATE_FEE}}**.

3.3. Jika pembayaran tetap tidak dilakukan dalam 30 hari, maka Pihak B
dapat menangguhkan layanan.

3.4. Pihak A bertanggung jawab atas biaya tambahan akibat kegagalan
pembayaran.

3.5. Jika terjadi pembatalan, biaya layanan yang sudah dibayarkan tidak
dapat dikembalikan kecuali jika disepakati lain.

## Pasal 4: Hak dan Kewajiban Pihak A

4.1. Pihak A berhak meminta, mengunduh, dan mengecek data yang diberikan
oleh Pihak B.

4.2. Pihak A harus mengecek dan mencatat data modal secara harian.

4.3. Jika Pihak A tidak puas terhadap layanan, harus disampaikan dalam
waktu 3 hari.

4.4. Pihak A wajib memberikan data dasar transaksi dengan benar kepada
Pihak B.

4.5. Jika ada perubahan musiman atau lainnya, Pihak A dapat meminta
pengakhiran layanan.

4.6. Pihak A menjamin bahwa dana yang digunakan berasal dari sumber yang
sah.

4.7. Pihak A tidak boleh menggunakan informasi layanan ini untuk
tindakan yang melanggar hukum seperti pencucian uang, perjudian,
penghindaran pajak, dll.

## Pasal 5: Hak dan Kewajiban Pihak B

5.1. Pihak B harus menangani permintaan konsultasi dari Pihak A sesuai
perjanjian.

5.2. Pihak B bertanggung jawab memberikan informasi konsultasi pasar
secara akurat.

5.3. Dalam jam kerja normal, Pihak B akan merespons permintaan dari
Pihak A secara wajar.

5.4. Pihak B berhak untuk meningkatkan layanan dan menyesuaikan konten.

5.5. Pihak B dapat menghentikan layanan jika Pihak A tidak membayar atau
bertindak mencurigakan.

5.6. Pihak B tidak boleh menipu atau berkolusi dengan pihak lain.

5.7. Pihak B tidak bertanggung jawab atas risiko operasional dari
keputusan investasi yang dilakukan Pihak A.

5.8. Pihak B dapat menolak transaksi yang melanggar hukum atau
mencurigakan.

5.9. Sengketa diselesaikan melalui negosiasi damai.

5.10. Jika Pihak B tidak dapat memberikan informasi yang akurat, maka
Pihak A dapat mengajukan keluhan.

5.11. Layanan ini tidak boleh melanggar hukum atau peraturan negara
manapun.

5.12. Pihak B berhak mengakhiri perjanjian jika Pihak A tidak
memberitahukan perubahan penting.

5.13. Jika Pihak A melanggar hukum atau menyebabkan kerugian, Pihak B
dapat menuntut ganti rugi.

## Pasal 6: Klausul Kerahasiaan

6.1. Informasi yang diperoleh oleh kedua belah pihak selama masa kerja
sama harus dijaga kerahasiaannya dan tidak boleh disebarkan kepada pihak
ketiga tanpa izin tertulis.

6.2. Kerahasiaan ini meliputi, namun tidak terbatas pada: Informasi
pelanggan, Data operasional, Informasi strategi bisnis, dan Data
investasi.

6.3. Semua informasi tetap milik pihak yang memberikannya dan tidak
dapat digunakan tanpa izin.

6.4. Klausul ini tetap berlaku meskipun perjanjian berakhir.

---

**Tertanda di Jakarta, pada tanggal: {{CONTRACT_DATE}}**

**Perwakilan Pihak B:**
Koh Seng Seng
(PT. Konsultasi Profesional Indonesia)

**Pihak A:**
{{USER_NAME}}
Trading ID: {{TRADING_ID}}

*Tanda tangan digital telah diverifikasi pada {{SIGNED_DATE}}*`,
                    variables: ['USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'USER_ADDRESS', 'TRADING_ID', 'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'TRANSACTION_FEE', 'PAYMENT_METHOD', 'PAYMENT_TERMS', 'LATE_FEE', 'SIGNED_DATE'],
                    created_by: admin._id
                });
                console.log('✅ Default template created');
            }
        }
        
        console.log('🎉 Initial data setup completed!');
        
    } catch (error) {
        console.error('❌ Setup initial data error:', error);
    }
}

// =====================
// UTILITY FUNCTIONS
// =====================

function generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateContractNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `TSC${year}${month}${day}${random}`;
}

// Function untuk generate PDF
async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            let buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Header
            doc.fontSize(16).font('Helvetica-Bold').text('KONTRAK DIGITAL TRADESTATION', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica').text(`Nomor Kontrak: ${contract.number}`, { align: 'center' });
            doc.moveDown(1);

            // Content
            const content = contract.content.replace(/#{1,3}\s?/g, '').replace(/\*\*(.*?)\*\*/g, '$1');
            const lines = content.split('\n');
            
            lines.forEach(line => {
                if (line.trim()) {
                    if (line.includes('##') || line.includes('Pasal')) {
                        doc.fontSize(12).font('Helvetica-Bold').text(line.trim());
                        doc.moveDown(0.3);
                    } else {
                        doc.fontSize(10).font('Helvetica').text(line.trim());
                        doc.moveDown(0.2);
                    }
                }
            });

            // Tanda tangan
            doc.moveDown(2);
            doc.fontSize(12).font('Helvetica-Bold').text('Tanda Tangan Digital:', { align: 'left' });
            doc.moveDown(0.5);
            
            if (signatureData) {
                // Signature placeholder (dalam implementasi nyata, decode base64 dan insert image)
                doc.fontSize(10).font('Helvetica').text('[ Tanda Tangan Digital Terverifikasi ]');
                doc.text(`Ditandatangani oleh: ${user.name}`);
                doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`);
                doc.text(`Trading ID: ${user.trading_account}`);
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// =====================
// MIDDLEWARE
// =====================

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).where('is_active').equals(true);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// =====================
// HEALTH CHECK
// =====================

app.get('/api/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            environment: process.env.NODE_ENV || 'development',
            mongodb: 'MongoDB Atlas'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message
        });
    }
});

// =====================
// AUTHENTICATION ROUTES
// =====================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await User.findOne({
            $or: [{ email }, { username: email }],
            is_active: true
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            message: 'Login successful',
            token,
            user: {
                ...userResponse,
                tradingAccount: user.trading_account
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const userResponse = req.user.toObject();
        delete userResponse.password;
        
        res.json({
            user: {
                ...userResponse,
                tradingAccount: req.user.trading_account
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    res.json({ message: 'Logout successful' });
});

// NEW: Change Admin Password
app.post('/api/auth/change-password', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password required' });
        }

        const validPassword = await bcrypt.compare(currentPassword, req.user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(req.user._id, { password: hashedNewPassword });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// =====================
// USER MANAGEMENT ROUTES
// =====================

// NEW: Add User
app.post('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, email, phone, tradingAccount } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Generate default password
        const defaultPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // Generate trading account if not provided
        const finalTradingAccount = tradingAccount || `TRD${Date.now().toString().slice(-6)}`;

        const user = await User.create({
            name,
            email,
            phone,
            password: hashedPassword,
            role: 'user',
            trading_account: finalTradingAccount,
            balance: 0
        });

        const userResponse = user.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString(); // Add id field for frontend compatibility

        res.json({
            message: 'User created successfully',
            data: userResponse,
            defaultPassword
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// =====================
// CONTRACT ACCESS ROUTES
// =====================

app.get('/api/contracts/access/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account is_active')
            .populate('template_id', 'name content');

        if (!contract || !contract.user_id.is_active) {
            return res.status(404).json({ error: 'Contract not found or access denied' });
        }

        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Replace variables
        content = content.replace(/\{\{USER_NAME\}\}/g, contract.user_id.name);
        content = content.replace(/\{\{USER_EMAIL\}\}/g, contract.user_id.email);
        content = content.replace(/\{\{USER_PHONE\}\}/g, contract.user_id.phone || '');
        content = content.replace(/\{\{TRADING_ID\}\}/g, contract.user_id.trading_account || '');
        content = content.replace(/\{\{CONTRACT_NUMBER\}\}/g, contract.number);
        content = content.replace(/\{\{CONTRACT_DATE\}\}/g, new Date(contract.createdAt).toLocaleDateString('id-ID'));
        content = content.replace(/\{\{AMOUNT\}\}/g, new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(contract.amount));

        // Replace custom variables
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(regex, variables[key]);
        });

        res.json({
            data: {
                ...contract.toObject(),
                content,
                user: {
                    name: contract.user_id.name,
                    email: contract.user_id.email,
                    phone: contract.user_id.phone,
                    trading_account: contract.user_id.trading_account
                },
                template: {
                    name: contract.template_id?.name
                }
            }
        });
    } catch (error) {
        console.error('Contract access error:', error);
        res.status(500).json({ error: 'Failed to access contract' });
    }
});

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, password } = req.body;

        if (!signatureData || !password) {
            return res.status(400).json({ error: 'Signature and password required' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'password name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'signed' || contract.status === 'completed') {
            return res.status(400).json({ error: 'Contract already signed' });
        }

        // Generate PDF
        const pdfBuffer = await generateContractPDF(contract, contract.user_id, signatureData);
        const pdfPath = `contracts/${contract.number}_signed.pdf`;

        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: new Date(),
            pdf_file_path: pdfPath
        });

        await ContractHistory.create({
            contract_id: contract._id,
            action: 'signed',
            description: 'Contract signed by user',
            performed_by: contract.user_id._id
        });

        res.json({ 
            message: 'Contract signed successfully',
            pdfDownloadUrl: `/api/contracts/download/${contract._id}`
        });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
    }
});

// NEW: Download PDF Contract
app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account');

        if (!contract || contract.status !== 'signed') {
            return res.status(404).json({ error: 'Signed contract not found' });
        }

        // Generate PDF on demand
        const pdfBuffer = await generateContractPDF(contract, contract.user_id, contract.signature_data);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Kontrak_${contract.number}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Download contract error:', error);
        res.status(500).json({ error: 'Failed to download contract' });
    }
});

// =====================
// ADMIN ROUTES
// =====================

app.get('/api/contracts', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const contracts = await Contract.find()
                .populate('user_id', 'name email phone trading_account')
                .populate('template_id', 'name')
                .sort({ createdAt: -1 });
            
            const formattedContracts = contracts.map(contract => ({
                ...contract.toObject(),
                user_name: contract.user_id?.name,
                user_email: contract.user_id?.email,
                user_phone: contract.user_id?.phone,
                trading_account: contract.user_id?.trading_account,
                template_name: contract.template_id?.name,
                created_at: contract.createdAt,
                updated_at: contract.updatedAt
            }));
            
            res.json({ data: formattedContracts });
        } else {
            const contracts = await Contract.find({ user_id: req.user._id })
                .populate('template_id', 'name content')
                .sort({ createdAt: -1 });
                
            res.json({ data: contracts });
        }
    } catch (error) {
        console.error('Get contracts error:', error);
        res.status(500).json({ error: 'Failed to get contracts' });
    }
});

app.post('/api/contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const {
            title,
            templateId,
            userId,
            amount,
            expiryDate,
            adminNotes,
            variables,
            sendImmediately
        } = req.body;

        if (!title || !templateId || !userId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const contractNumber = generateContractNumber();
        const accessToken = generateAccessToken();
        const status = sendImmediately ? 'sent' : 'draft';

        const contract = await Contract.create({
            title,
            number: contractNumber,
            user_id: userId,
            template_id: templateId,
            amount,
            status,
            variables: variables || {},
            expiry_date: expiryDate,
            admin_notes: adminNotes,
            access_token: accessToken
        });

        await ContractHistory.create({
            contract_id: contract._id,
            action: 'created',
            description: `Contract created by admin${sendImmediately ? ' and sent to user' : ''}`,
            performed_by: req.user._id
        });

        res.json({
            message: 'Contract created successfully',
            data: contract,
            accessLink: `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${accessToken}`
        });
    } catch (error) {
        console.error('Create contract error:', error);
        res.status(500).json({ error: 'Failed to create contract' });
    }
});

// NEW: Generate Contract Link
app.post('/api/contracts/:id/generate-link', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        const accessLink = `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${contract.access_token}`;
        
        res.json({
            message: 'Contract link generated',
            accessLink,
            token: contract.access_token
        });
    } catch (error) {
        console.error('Generate link error:', error);
        res.status(500).json({ error: 'Failed to generate link' });
    }
});

app.get('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const templates = await Template.find()
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });
            
        const formattedTemplates = templates.map(template => {
            const templateObj = template.toObject();
            return {
                ...templateObj,
                id: templateObj._id.toString(), // Add id field for frontend compatibility
                created_by_name: template.created_by?.name
            };
        });
        
        res.json({ data: formattedTemplates });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

app.post('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }
        
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.create({
            name,
            category: category || 'general',
            content,
            description,
            variables,
            created_by: req.user._id
        });
        
        const templateResponse = template.toObject();
        templateResponse.id = templateResponse._id.toString();
        
        res.json({
            message: 'Template created successfully',
            data: templateResponse
        });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

app.put('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }
        
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.findByIdAndUpdate(
            req.params.id,
            { name, category, content, description, variables },
            { new: true }
        );
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const templateResponse = template.toObject();
        templateResponse.id = templateResponse._id.toString();
        
        res.json({
            message: 'Template updated successfully',
            data: templateResponse
        });
    } catch (error) {
        console.error('Update template error:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

app.get('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const users = await User.aggregate([
            { $match: { is_active: true } },
            {
                $lookup: {
                    from: 'contracts',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'contracts'
                }
            },
            {
                $addFields: {
                    contract_count: { $size: '$contracts' },
                    id: { $toString: '$_id' } // Add id field for frontend compatibility
                }
            },
            {
                $project: {
                    password: 0,
                    contracts: 0
                }
            },
            { $sort: { createdAt: -1 } }
        ]);
        
        res.json({ data: users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

app.get('/api/stats/dashboard', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const totalContracts = await Contract.countDocuments();
            const pendingSignatures = await Contract.countDocuments({ status: 'sent' });
            const completedContracts = await Contract.countDocuments({ 
                status: { $in: ['signed', 'completed'] } 
            });
            
            const totalValueResult = await Contract.aggregate([
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalValue = totalValueResult[0]?.total || 0;
            
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthlyContracts = await Contract.countDocuments({
                createdAt: { $gte: startOfMonth }
            });

            res.json({
                data: {
                    totalContracts,
                    pendingSignatures,
                    completedContracts,
                    totalValue,
                    monthlyContracts
                }
            });
        } else {
            const totalContracts = await Contract.countDocuments({ user_id: req.user._id });
            const pendingSignatures = await Contract.countDocuments({ 
                user_id: req.user._id, 
                status: 'sent' 
            });
            const completedContracts = await Contract.countDocuments({ 
                user_id: req.user._id,
                status: { $in: ['signed', 'completed'] } 
            });
            
            const totalValueResult = await Contract.aggregate([
                { $match: { user_id: req.user._id } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalValue = totalValueResult[0]?.total || 0;

            res.json({
                data: {
                    totalContracts,
                    pendingSignatures,
                    completedContracts,
                    totalValue
                }
            });
        }
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

// =====================
// ERROR HANDLING
// =====================

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await mongoose.connection.close();
    process.exit(0);
});

// =====================
// START SERVER
// =====================

async function startServer() {
    try {
        await connectDatabase();
        app.listen(PORT, () => {
            console.log(`🚀 TradeStation Kontrak Digital Server running on port ${PORT}`);
            console.log(`📱 Frontend: ${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}`);
            console.log(`🔗 API Health: https://kontrak-production.up.railway.app/api/health`);
            console.log(`💾 Database: MongoDB Atlas`);
            console.log(`🎯 Ready to handle requests!`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT} (DB connection failed)`);
        });
    }
}

startServer();
