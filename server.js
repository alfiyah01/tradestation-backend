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
    origin: ['https://kontrakdigital.netlify.app', 'https://kontrakdigital.com', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting for API
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';

// =====================
// MONGODB SCHEMAS
// =====================

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    trading_account: { type: String, trim: true },
    balance: { type: Number, default: 0, min: 0 },
    is_active: { type: Boolean, default: true },
    last_login: { type: Date },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'general', trim: true },
    content: { type: String, required: true },
    variables: [{ type: String, trim: true }],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, trim: true }
}, {
    timestamps: true
});

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    number: { type: String, required: true, unique: true, trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    content: { type: String },
    amount: { type: Number, default: 0, min: 0 },
    status: { 
        type: String, 
        default: 'draft',
        enum: ['draft', 'sent', 'signed', 'completed', 'expired', 'cancelled']
    },
    variables: { type: Object, default: {} },
    signature_data: { type: String },
    signed_at: { type: Date },
    expiry_date: { type: Date },
    admin_notes: { type: String, trim: true },
    access_token: { type: String, unique: true },
    pdf_file_path: { type: String },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sent_at: { type: Date },
    reminder_sent: { type: Number, default: 0 }
}, {
    timestamps: true
});

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String }
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
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
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
            const hashedPassword = await bcrypt.hash('admin123', 12);
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
            const hashedPassword = await bcrypt.hash('trader123', 12);
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

// Function untuk generate PDF dengan perbaikan
async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ 
                margin: 50,
                info: {
                    Title: `Kontrak ${contract.number}`,
                    Author: 'TradeStation Kontrak Digital',
                    Subject: contract.title,
                    Creator: 'TradeStation System'
                }
            });
            
            let buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });
            doc.on('error', (error) => {
                reject(error);
            });

            // Header dengan styling yang lebih baik
            doc.fontSize(18).font('Helvetica-Bold').text('KONTRAK DIGITAL TRADESTATION', { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(12).font('Helvetica').text(`Nomor Kontrak: ${contract.number}`, { align: 'center' });
            doc.fontSize(10).text(`Dibuat pada: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, { align: 'center' });
            
            // Line separator
            doc.moveDown(1);
            doc.strokeColor('#000000').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.5);

            // Content dengan formatting yang lebih baik
            let content = contract.content || '';
            
            // Replace variables dengan nilai yang sesuai
            content = content.replace(/\{\{USER_NAME\}\}/g, user.name);
            content = content.replace(/\{\{USER_EMAIL\}\}/g, user.email || '');
            content = content.replace(/\{\{USER_PHONE\}\}/g, user.phone || '');
            content = content.replace(/\{\{TRADING_ID\}\}/g, user.trading_account || '');
            content = content.replace(/\{\{CONTRACT_NUMBER\}\}/g, contract.number);
            content = content.replace(/\{\{CONTRACT_DATE\}\}/g, new Date(contract.createdAt).toLocaleDateString('id-ID'));
            content = content.replace(/\{\{AMOUNT\}\}/g, new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(contract.amount));

            // Replace custom variables
            Object.keys(contract.variables || {}).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                content = content.replace(regex, contract.variables[key] || '');
            });

            // Process content line by line
            const lines = content.split('\n');
            
            lines.forEach(line => {
                line = line.trim();
                if (line) {
                    // Check if it's a header
                    if (line.startsWith('# ')) {
                        doc.fontSize(14).font('Helvetica-Bold').text(line.substring(2), { align: 'center' });
                        doc.moveDown(0.5);
                    } else if (line.startsWith('## ')) {
                        doc.fontSize(12).font('Helvetica-Bold').text(line.substring(3));
                        doc.moveDown(0.3);
                    } else if (line.startsWith('### ')) {
                        doc.fontSize(11).font('Helvetica-Bold').text(line.substring(4));
                        doc.moveDown(0.2);
                    } else {
                        // Regular text
                        const processedLine = line.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove markdown bold
                        doc.fontSize(10).font('Helvetica').text(processedLine, { 
                            align: 'justify',
                            lineGap: 2
                        });
                        doc.moveDown(0.2);
                    }
                    
                    // Check if we need a new page
                    if (doc.y > 720) {
                        doc.addPage();
                    }
                }
            });

            // Tanda tangan section
            doc.moveDown(2);
            
            // Line separator before signature
            doc.strokeColor('#000000').lineWidth(0.5).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.5);
            
            doc.fontSize(12).font('Helvetica-Bold').text('TANDA TANGAN DIGITAL', { align: 'center' });
            doc.moveDown(0.5);
            
            if (signatureData && contract.signed_at) {
                // Signature info box
                doc.rect(50, doc.y, 500, 100).stroke();
                doc.moveDown(0.5);
                
                doc.fontSize(10).font('Helvetica-Bold').text('✓ KONTRAK TELAH DITANDATANGANI SECARA DIGITAL', { align: 'center', color: 'green' });
                doc.moveDown(0.3);
                doc.font('Helvetica').fillColor('black').text(`Ditandatangani oleh: ${user.name}`, { align: 'center' });
                doc.text(`Trading ID: ${user.trading_account}`, { align: 'center' });
                doc.text(`Tanggal & Waktu: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, { align: 'center' });
                doc.text(`Token Verifikasi: ${contract.access_token.substring(0, 16)}...`, { align: 'center' });
                
                // Add a simple signature representation
                doc.moveDown(0.5);
                doc.fontSize(8).text('[ Tanda Tangan Digital Terenkripsi ]', { align: 'center', oblique: true });
            } else {
                doc.fontSize(10).font('Helvetica').text('Menunggu tanda tangan digital...', { align: 'center', oblique: true });
            }

            // Footer
            doc.moveDown(2);
            doc.fontSize(8).font('Helvetica').fillColor('gray').text(
                `Dokumen ini dibuat secara digital oleh TradeStation Kontrak Digital System pada ${new Date().toLocaleString('id-ID')}`,
                { align: 'center' }
            );

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
            return res.status(401).json({ error: 'Invalid token or user not found' });
        }

        // Update last login
        await User.findByIdAndUpdate(user._id, { last_login: new Date() });

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Logging middleware untuk audit trail
const logActivity = (action) => {
    return async (req, res, next) => {
        try {
            const originalSend = res.send;
            res.send = function(data) {
                // Log successful operations
                if (res.statusCode < 400 && req.user) {
                    // You can implement activity logging here
                    console.log(`Activity: ${action} by ${req.user.email} at ${new Date().toISOString()}`);
                }
                originalSend.call(this, data);
            };
            next();
        } catch (error) {
            next();
        }
    };
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
            mongodb: 'MongoDB Atlas',
            uptime: process.uptime(),
            memory: process.memoryUsage()
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

        // Input validation
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Rate limiting untuk login attempts
        const user = await User.findOne({
            $or: [
                { email: email.toLowerCase() }, 
                { username: email.toLowerCase() }
            ],
            is_active: true
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await User.findByIdAndUpdate(user._id, { last_login: new Date() });

        const token = jwt.sign(
            { 
                userId: user._id, 
                email: user.email, 
                role: user.role,
                iat: Math.floor(Date.now() / 1000)
            },
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

// Change Admin Password dengan perbaikan
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

        const hashedNewPassword = await bcrypt.hash(newPassword, 12);
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

// Add User dengan validasi yang lebih baik
app.post('/api/users', authenticateToken, authenticateAdmin, logActivity('CREATE_USER'), async (req, res) => {
    try {
        const { name, email, phone, tradingAccount } = req.body;

        // Input validation
        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Generate default password
        const defaultPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);

        // Generate trading account if not provided
        const finalTradingAccount = tradingAccount || `TRD${Date.now().toString().slice(-6)}`;

        const user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            password: hashedPassword,
            role: 'user',
            trading_account: finalTradingAccount,
            balance: 0,
            created_by: req.user._id
        });

        const userResponse = user.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString();

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
// CONTRACT ACCESS ROUTES (PERBAIKAN UTAMA)
// =====================

app.get('/api/contracts/access/:token', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || token.length < 32) {
            return res.status(400).json({ error: 'Invalid access token' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account is_active')
            .populate('template_id', 'name content variables');

        if (!contract || !contract.user_id || !contract.user_id.is_active) {
            return res.status(404).json({ error: 'Contract not found or access denied' });
        }

        // Check if contract is expired
        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            return res.status(410).json({ error: 'Contract has expired' });
        }

        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Replace system variables
        content = content.replace(/\{\{USER_NAME\}\}/g, contract.user_id.name);
        content = content.replace(/\{\{USER_EMAIL\}\}/g, contract.user_id.email || '');
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
            content = content.replace(regex, variables[key] || '');
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
                template: contract.template_id ? {
                    name: contract.template_id.name,
                    variables: contract.template_id.variables
                } : null
            }
        });
    } catch (error) {
        console.error('Contract access error:', error);
        res.status(500).json({ error: 'Failed to access contract' });
    }
});

// PERBAIKAN UTAMA: Endpoint untuk update variabel kontrak
app.put('/api/contracts/access/:token/variables', async (req, res) => {
    try {
        const { token } = req.params;
        const { variables } = req.body;

        if (!token || !variables || typeof variables !== 'object') {
            return res.status(400).json({ error: 'Invalid token or variables' });
        }

        const contract = await Contract.findOne({ access_token: token });
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status !== 'sent') {
            return res.status(400).json({ error: 'Contract cannot be modified' });
        }

        // Merge dengan variabel yang sudah ada
        const updatedVariables = { ...contract.variables, ...variables };

        await Contract.findByIdAndUpdate(contract._id, {
            variables: updatedVariables
        });

        res.json({ 
            message: 'Variables updated successfully',
            variables: updatedVariables
        });
    } catch (error) {
        console.error('Update variables error:', error);
        res.status(500).json({ error: 'Failed to update variables' });
    }
});

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, variables } = req.body;

        if (!signatureData) {
            return res.status(400).json({ error: 'Signature data required' });
        }

        // Validate signature data (basic validation)
        if (!signatureData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Invalid signature format' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'signed' || contract.status === 'completed') {
            return res.status(400).json({ error: 'Contract already signed' });
        }

        if (contract.status !== 'sent') {
            return res.status(400).json({ error: 'Contract is not ready for signing' });
        }

        // Check if contract is expired
        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            return res.status(410).json({ error: 'Contract has expired' });
        }

        // Update variables if provided
        const finalVariables = variables ? { ...contract.variables, ...variables } : contract.variables;

        // Generate PDF
        const updatedContract = { ...contract.toObject(), variables: finalVariables };
        const pdfBuffer = await generateContractPDF(updatedContract, contract.user_id, signatureData);
        const pdfPath = `contracts/${contract.number}_signed.pdf`;

        // Update contract
        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: new Date(),
            pdf_file_path: pdfPath,
            variables: finalVariables
        });

        // Log activity
        await ContractHistory.create({
            contract_id: contract._id,
            action: 'signed',
            description: 'Contract signed by user with digital signature',
            performed_by: contract.user_id._id,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        });

        res.json({ 
            message: 'Contract signed successfully',
            pdfDownloadUrl: `/api/contracts/download/${contract._id}`,
            signedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
    }
});

// Download PDF Contract dengan perbaikan
app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(contractId)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status !== 'signed' && contract.status !== 'completed') {
            return res.status(400).json({ error: 'Contract is not signed yet' });
        }

        // Generate PDF on demand
        const pdfBuffer = await generateContractPDF(contract, contract.user_id, contract.signature_data);

        // Set proper headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Kontrak_${contract.number}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Cache-Control', 'no-cache');
        
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        let query = {};
        let sort = { createdAt: -1 };

        // Filter by user if not admin
        if (req.user.role !== 'admin') {
            query.user_id = req.user._id;
        }

        // Add filters
        if (req.query.status) {
            query.status = req.query.status;
        }
        if (req.query.search) {
            query.$or = [
                { title: { $regex: req.query.search, $options: 'i' } },
                { number: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        const [contracts, total] = await Promise.all([
            Contract.find(query)
                .populate('user_id', 'name email phone trading_account')
                .populate('template_id', 'name')
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Contract.countDocuments(query)
        ]);
        
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
        
        res.json({ 
            data: formattedContracts,
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                count: contracts.length,
                totalRecords: total
            }
        });
    } catch (error) {
        console.error('Get contracts error:', error);
        res.status(500).json({ error: 'Failed to get contracts' });
    }
});

app.post('/api/contracts', authenticateToken, authenticateAdmin, logActivity('CREATE_CONTRACT'), async (req, res) => {
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

        // Input validation
        if (!title || !templateId || !userId || amount === undefined) {
            return res.status(400).json({ error: 'Missing required fields: title, templateId, userId, amount' });
        }

        if (amount < 0) {
            return res.status(400).json({ error: 'Amount cannot be negative' });
        }

        // Validate user exists
        const user = await User.findById(userId).where('is_active').equals(true);
        if (!user) {
            return res.status(400).json({ error: 'User not found or inactive' });
        }

        // Validate template exists
        const template = await Template.findById(templateId).where('is_active').equals(true);
        if (!template) {
            return res.status(400).json({ error: 'Template not found or inactive' });
        }

        const contractNumber = generateContractNumber();
        const accessToken = generateAccessToken();
        const status = sendImmediately ? 'sent' : 'draft';

        const contract = await Contract.create({
            title: title.trim(),
            number: contractNumber,
            user_id: userId,
            template_id: templateId,
            amount: parseFloat(amount),
            status,
            variables: variables || {},
            expiry_date: expiryDate ? new Date(expiryDate) : null,
            admin_notes: adminNotes?.trim(),
            access_token: accessToken,
            created_by: req.user._id,
            sent_at: sendImmediately ? new Date() : null
        });

        // Log activity
        await ContractHistory.create({
            contract_id: contract._id,
            action: 'created',
            description: `Contract created by admin${sendImmediately ? ' and sent to user' : ''}`,
            performed_by: req.user._id,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
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

// Generate Contract Link dengan perbaikan
app.post('/api/contracts/:id/generate-link', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        // Update status to sent if it's draft
        if (contract.status === 'draft') {
            await Contract.findByIdAndUpdate(id, { 
                status: 'sent',
                sent_at: new Date()
            });
        }

        const accessLink = `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${contract.access_token}`;
        
        res.json({
            message: 'Contract link generated successfully',
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
        const templates = await Template.find({ is_active: true })
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });
            
        const formattedTemplates = templates.map(template => {
            const templateObj = template.toObject();
            return {
                ...templateObj,
                id: templateObj._id.toString(),
                created_by_name: template.created_by?.name
            };
        });
        
        res.json({ data: formattedTemplates });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

app.post('/api/templates', authenticateToken, authenticateAdmin, logActivity('CREATE_TEMPLATE'), async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }

        if (name.length < 3) {
            return res.status(400).json({ error: 'Template name must be at least 3 characters' });
        }

        if (content.length < 10) {
            return res.status(400).json({ error: 'Template content must be at least 10 characters' });
        }
        
        // Extract variables from content
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.create({
            name: name.trim(),
            category: (category || 'general').trim(),
            content: content.trim(),
            description: description?.trim(),
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

app.put('/api/templates/:id', authenticateToken, authenticateAdmin, logActivity('UPDATE_TEMPLATE'), async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }
        
        // Extract variables from content
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.findByIdAndUpdate(
            req.params.id,
            { 
                name: name.trim(), 
                category: (category || 'general').trim(), 
                content: content.trim(), 
                description: description?.trim(), 
                variables 
            },
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
                    id: { $toString: '$_id' }
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
            const [
                totalContracts,
                pendingSignatures,
                completedContracts,
                totalValueResult,
                monthlyContracts
            ] = await Promise.all([
                Contract.countDocuments(),
                Contract.countDocuments({ status: 'sent' }),
                Contract.countDocuments({ status: { $in: ['signed', 'completed'] } }),
                Contract.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
                Contract.countDocuments({
                    createdAt: { 
                        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) 
                    }
                })
            ]);

            const totalValue = totalValueResult[0]?.total || 0;

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
            // User stats
            const [
                totalContracts,
                pendingSignatures,
                completedContracts,
                totalValueResult
            ] = await Promise.all([
                Contract.countDocuments({ user_id: req.user._id }),
                Contract.countDocuments({ user_id: req.user._id, status: 'sent' }),
                Contract.countDocuments({ 
                    user_id: req.user._id,
                    status: { $in: ['signed', 'completed'] } 
                }),
                Contract.aggregate([
                    { $match: { user_id: req.user._id } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
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
// ADDITIONAL ENDPOINTS
// =====================

// Get contract history
app.get('/api/contracts/:id/history', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        // Check access permissions
        if (req.user.role !== 'admin' && contract.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const history = await ContractHistory.find({ contract_id: id })
            .populate('performed_by', 'name email')
            .sort({ createdAt: -1 });

        res.json({ data: history });
    } catch (error) {
        console.error('Get contract history error:', error);
        res.status(500).json({ error: 'Failed to get contract history' });
    }
});

// Bulk operations for admin
app.post('/api/contracts/bulk-action', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { contractIds, action } = req.body;

        if (!contractIds || !Array.isArray(contractIds) || contractIds.length === 0) {
            return res.status(400).json({ error: 'Contract IDs array required' });
        }

        if (!action || !['delete', 'send', 'cancel'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        let updateData = {};
        let actionDescription = '';

        switch (action) {
            case 'send':
                updateData = { status: 'sent', sent_at: new Date() };
                actionDescription = 'Bulk sent by admin';
                break;
            case 'cancel':
                updateData = { status: 'cancelled' };
                actionDescription = 'Bulk cancelled by admin';
                break;
            case 'delete':
                await Contract.deleteMany({ _id: { $in: contractIds } });
                return res.json({ message: 'Contracts deleted successfully' });
        }

        const result = await Contract.updateMany(
            { _id: { $in: contractIds } },
            updateData
        );

        // Log bulk action
        const historyEntries = contractIds.map(contractId => ({
            contract_id: contractId,
            action: `bulk_${action}`,
            description: actionDescription,
            performed_by: req.user._id,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        }));

        await ContractHistory.insertMany(historyEntries);

        res.json({ 
            message: `Bulk ${action} completed successfully`,
            affected: result.modifiedCount
        });
    } catch (error) {
        console.error('Bulk action error:', error);
        res.status(500).json({ error: 'Failed to perform bulk action' });
    }
});

// =====================
// ERROR HANDLING
// =====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(500).json({ 
        error: 'Internal server error',
        ...(isDevelopment && { details: error.message, stack: error.stack })
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    try {
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    try {
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// =====================
// START SERVER
// =====================

async function startServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, () => {
            console.log(`🚀 TradeStation Kontrak Digital Server running on port ${PORT}`);
            console.log(`📱 Frontend: ${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}`);
            console.log(`🔗 API Health: https://kontrak-production.up.railway.app/api/health`);
            console.log(`💾 Database: MongoDB Atlas`);
            console.log(`🎯 Ready to handle requests!`);
            console.log(`🔐 Security: Rate limiting enabled`);
            console.log(`📊 Monitoring: Activity logging enabled`);
        });

        // Handle server errors
        server.on('error', (error) => {
            console.error('Server error:', error);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        
        // Start server anyway with degraded functionality
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT} (DB connection failed)`);
            console.log(`⚠️  Some features may not work properly`);
        });
    }
}

startServer();
