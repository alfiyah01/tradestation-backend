const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// MIDDLEWARE
// =====================

// CORS Configuration - Permissive untuk semua origin
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Simple rate limiting
const requests = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 100;
    
    if (!requests.has(ip)) {
        requests.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    const requestData = requests.get(ip);
    if (now > requestData.resetTime) {
        requests.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    if (requestData.count >= maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    requestData.count++;
    next();
});

// =====================
// DATABASE CONFIG
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';

// =====================
// SCHEMAS
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
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    profile_image: { type: String }
}, { timestamps: true });

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'general', trim: true },
    content: { type: String, required: true },
    variables: [{ type: String, trim: true }],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, trim: true },
    version: { type: Number, default: 1 }
}, { timestamps: true });

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
        enum: ['draft', 'sent', 'viewed', 'signed', 'completed', 'expired', 'cancelled']
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
    viewed_at: { type: Date },
    reminder_sent: { type: Number, default: 0 },
    ip_signed: { type: String },
    user_agent_signed: { type: String }
}, { timestamps: true });

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String },
    metadata: { type: Object, default: {} }
}, { timestamps: true });

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
        
        // Create template
        const templateExists = await Template.findOne({ name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi',
                    category: 'investment',
                    description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia',
                    content: `# PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI

**Nomor Kontrak:** {{CONTRACT_NUMBER}}  
**Tanggal Kontrak:** {{CONTRACT_DATE}}

---

## PIHAK PERTAMA (KLIEN)

**Nama Lengkap:** {{USER_NAME}}  
**Email:** {{USER_EMAIL}}  
**Nomor Telepon:** {{USER_PHONE}}  
**Trading Account ID:** {{TRADING_ID}}  
**Alamat:** {{USER_ADDRESS}}

---

## PIHAK KEDUA (PENYEDIA LAYANAN)

**Nama Perusahaan:** PT. Konsultasi Profesional Indonesia  
**Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950  
**Kontak Person:** Prof. Bima Agung Rachel  
**Telepon:** +62 852 - 5852 - 8771  

---

## PASAL 1: DEFINISI DAN RUANG LINGKUP

**1.1. Nilai Investasi**  
Pihak Pertama setuju untuk melakukan investasi sebesar **{{AMOUNT}}** sebagai modal dasar untuk layanan konsultasi investasi.

**1.2. Biaya Konsultasi**  
Biaya konsultasi layanan sebesar **{{CONSULTATION_FEE}}** yang mencakup analisis pasar, rekomendasi investasi, dan laporan berkala.

**1.3. Biaya Transaksi**  
Biaya transaksi sebesar **{{TRANSACTION_FEE}}** per transaksi yang dilakukan atas rekomendasi Pihak Kedua.

**1.4. Periode Kontrak**  
Kontrak ini berlaku untuk periode **{{CONTRACT_PERIOD}}** terhitung sejak tanggal penandatanganan.

---

## PASAL 2: LAYANAN YANG DISEDIAKAN

**2.1. Analisis Pasar**  
Pihak Kedua menyediakan analisis pasar harian, mingguan, dan bulanan sesuai dengan profil risiko Pihak Pertama.

**2.2. Rekomendasi Investasi**  
Pihak Kedua memberikan rekomendasi investasi yang disesuaikan dengan tujuan finansial dan toleransi risiko Pihak Pertama.

**2.3. Laporan Kinerja**  
Pihak Kedua menyediakan laporan kinerja investasi secara berkala setiap **{{REPORTING_FREQUENCY}}**.

**2.4. Konsultasi Personal**  
Pihak Pertama berhak mendapat konsultasi personal maksimal **{{CONSULTATION_HOURS}}** jam per bulan.

---

## PASAL 3: PEMBAYARAN DAN PENYELESAIAN

**3.1. Metode Pembayaran**  
Pembayaran dilakukan melalui **{{PAYMENT_METHOD}}** dalam mata uang Rupiah.

**3.2. Jadwal Pembayaran**  
- Pembayaran konsultasi: **{{PAYMENT_SCHEDULE}}**
- Pembayaran dilakukan paling lambat **{{PAYMENT_TERMS}}** hari setelah invoice diterbitkan

**3.3. Denda Keterlambatan**  
Keterlambatan pembayaran dikenakan denda sebesar **{{LATE_FEE_RATE}}** per hari dari jumlah yang tertunggak.

---

## PASAL 4: HAK DAN KEWAJIBAN PIHAK PERTAMA

**4.1. Hak Pihak Pertama:**
- Menerima layanan konsultasi sesuai perjanjian
- Mendapat akses ke platform analisis dan laporan
- Meminta klarifikasi atas rekomendasi yang diberikan
- Mengunduh dan menyimpan semua laporan

**4.2. Kewajiban Pihak Pertama:**
- Melakukan pembayaran tepat waktu
- Memberikan informasi yang akurat dan lengkap
- Mengikuti prosedur yang telah ditetapkan
- Menjaga kerahasiaan informasi yang diterima
- Tidak menyebarluaskan strategi investasi kepada pihak lain

---

## PASAL 5: HAK DAN KEWAJIBAN PIHAK KEDUA

**5.1. Hak Pihak Kedua:**
- Menerima pembayaran sesuai perjanjian
- Mendapat informasi lengkap dari Pihak Pertama
- Menghentikan layanan jika terjadi wanprestasi
- Meminta kompensasi atas kerugian yang ditimbulkan

**5.2. Kewajiban Pihak Kedua:**
- Memberikan layanan konsultasi sesuai standar profesional
- Menjaga kerahasiaan informasi klien
- Memberikan analisis yang objektif dan independen
- Merespons pertanyaan dalam waktu **{{RESPONSE_TIME}}** jam kerja
- Memberikan peringatan dini jika terjadi perubahan kondisi pasar

---

## PASAL 6: DISCLAIMER DAN RISIKO

**6.1. Risiko Investasi**  
Pihak Pertama memahami bahwa investasi mengandung risiko dan Pihak Kedua tidak menjamin keuntungan.

**6.2. Tanggung Jawab Terbatas**  
Pihak Kedua bertanggung jawab terbatas pada kualitas analisis dan tidak bertanggung jawab atas kerugian investasi.

**6.3. Force Majeure**  
Kedua pihak tidak bertanggung jawab atas kegagalan pelaksanaan kontrak akibat force majeure.

---

## PASAL 7: KERAHASIAAN

**7.1. Informasi Rahasia**  
Kedua pihak berkomitmen menjaga kerahasiaan semua informasi yang diperoleh selama kerjasama.

**7.2. Non-Disclosure**  
Informasi rahasia tidak boleh dibagikan kepada pihak ketiga tanpa persetujuan tertulis.

**7.3. Jangka Waktu**  
Kewajiban menjaga kerahasiaan berlaku selama **{{CONFIDENTIALITY_PERIOD}}** tahun setelah kontrak berakhir.

---

## PASAL 8: PENYELESAIAN SENGKETA

**8.1. Negosiasi**  
Sengketa diselesaikan melalui negosiasi dalam waktu **{{NEGOTIATION_PERIOD}}** hari.

**8.2. Mediasi**  
Jika negosiasi gagal, sengketa diselesaikan melalui mediasi di **{{MEDIATION_LOCATION}}**.

**8.3. Arbitrase**  
Sengketa terakhir diselesaikan melalui arbitrase sesuai hukum Indonesia.

---

## PASAL 9: KETENTUAN PENUTUP

**9.1. Perubahan Kontrak**  
Perubahan kontrak harus dilakukan secara tertulis dan disetujui kedua pihak.

**9.2. Pengakhiran Kontrak**  
Kontrak dapat diakhiri dengan pemberitahuan **{{TERMINATION_NOTICE}}** hari sebelumnya.

**9.3. Hukum yang Berlaku**  
Kontrak ini tunduk pada hukum Republik Indonesia.

---

**PENUTUP**

Kontrak ini dibuat dalam 2 (dua) rangkap yang sama kekuatan hukumnya, masing-masing pihak menerima 1 (satu) rangkap.

**Ditandatangani di Jakarta pada tanggal {{CONTRACT_DATE}}**

**PIHAK KEDUA**  
PT. Konsultasi Profesional Indonesia  

**Koh Seng Seng**  
*Direktur*

---

**PIHAK PERTAMA**  

**{{USER_NAME}}**  
*Trading ID: {{TRADING_ID}}*

*Tanda tangan digital telah diverifikasi pada {{SIGNED_DATE}}*`,
                    variables: [
                        'USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'USER_ADDRESS', 'TRADING_ID', 
                        'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'CONSULTATION_FEE', 
                        'TRANSACTION_FEE', 'CONTRACT_PERIOD', 'REPORTING_FREQUENCY', 
                        'CONSULTATION_HOURS', 'PAYMENT_METHOD', 'PAYMENT_SCHEDULE', 
                        'PAYMENT_TERMS', 'LATE_FEE_RATE', 'RESPONSE_TIME', 
                        'CONFIDENTIALITY_PERIOD', 'NEGOTIATION_PERIOD', 'MEDIATION_LOCATION', 
                        'TERMINATION_NOTICE', 'SIGNED_DATE'
                    ],
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

function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

// Enhanced PDF Generation
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
            doc.on('error', reject);

            // Header dengan logo dan info perusahaan
            doc.fontSize(20).font('Helvetica-Bold').text('TRADESTATION', 50, 50, { align: 'center' });
            doc.fontSize(14).font('Helvetica').text('KONTRAK DIGITAL INVESTASI', { align: 'center' });
            doc.moveDown(0.5);
            
            // Info kontrak
            doc.fontSize(12).font('Helvetica-Bold').text(`Nomor Kontrak: ${contract.number}`, { align: 'center' });
            doc.fontSize(10).font('Helvetica').text(`Dibuat pada: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, { align: 'center' });
            doc.text(`Nilai Kontrak: ${formatCurrency(contract.amount)}`, { align: 'center' });
            
            if (contract.signed_at) {
                doc.text(`Ditandatangani pada: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, { align: 'center' });
            }
            
            doc.moveDown(1);
            
            // Line separator
            doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(1);

            // Content processing
            let content = contract.content || '';
            
            // Replace system variables
            const replacements = {
                '{{USER_NAME}}': user.name || '',
                '{{USER_EMAIL}}': user.email || '',
                '{{USER_PHONE}}': user.phone || '',
                '{{TRADING_ID}}': user.trading_account || '',
                '{{CONTRACT_NUMBER}}': contract.number,
                '{{CONTRACT_DATE}}': new Date(contract.createdAt).toLocaleDateString('id-ID'),
                '{{AMOUNT}}': formatCurrency(contract.amount),
                '{{SIGNED_DATE}}': contract.signed_at ? new Date(contract.signed_at).toLocaleString('id-ID') : ''
            };

            // Replace system variables
            Object.keys(replacements).forEach(key => {
                const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                content = content.replace(regex, replacements[key]);
            });

            // Replace custom variables
            Object.keys(contract.variables || {}).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                content = content.replace(regex, contract.variables[key] || `[${key} - Tidak Diisi]`);
            });

            // Process content line by line
            const lines = content.split('\n');
            
            lines.forEach(line => {
                line = line.trim();
                if (line) {
                    // Check if we need a new page
                    if (doc.y > 720) {
                        doc.addPage();
                    }
                    
                    if (line.startsWith('# ')) {
                        doc.fontSize(16).font('Helvetica-Bold').text(line.substring(2), { align: 'center' });
                        doc.moveDown(0.5);
                    } else if (line.startsWith('## ')) {
                        doc.fontSize(14).font('Helvetica-Bold').text(line.substring(3));
                        doc.moveDown(0.3);
                    } else if (line.startsWith('**') && line.endsWith('**')) {
                        const text = line.replace(/\*\*/g, '');
                        doc.fontSize(11).font('Helvetica-Bold').text(text);
                        doc.moveDown(0.2);
                    } else if (line.startsWith('---')) {
                        doc.moveDown(0.3);
                        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
                        doc.moveDown(0.3);
                    } else {
                        const processedLine = line.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(10).font('Helvetica').text(processedLine, { 
                            align: 'justify',
                            lineGap: 2
                        });
                        doc.moveDown(0.2);
                    }
                }
            });

            // Signature section
            doc.addPage();
            doc.fontSize(16).font('Helvetica-Bold').text('TANDA TANGAN DIGITAL', { align: 'center' });
            doc.moveDown(1);
            
            if (signatureData && contract.signed_at) {
                doc.fontSize(12).font('Helvetica-Bold').text('✅ KONTRAK TELAH DITANDATANGANI SECARA SAH', { align: 'center' });
                doc.moveDown(0.5);
                
                // Signature info box
                doc.rect(100, doc.y, 350, 120).stroke();
                const signatureY = doc.y + 10;
                
                doc.fontSize(11).font('Helvetica-Bold').text('INFORMASI PENANDATANGANAN:', 110, signatureY);
                doc.fontSize(10).font('Helvetica');
                doc.text(`Nama: ${user.name}`, 110, signatureY + 20);
                doc.text(`Email: ${user.email}`, 110, signatureY + 35);
                doc.text(`Trading ID: ${user.trading_account}`, 110, signatureY + 50);
                doc.text(`Tanggal: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, 110, signatureY + 65);
                doc.text(`IP Address: ${contract.ip_signed || 'N/A'}`, 110, signatureY + 80);
                doc.text(`Metode: Tanda Tangan Digital`, 110, signatureY + 95);
                
                doc.moveDown(8);
                
                // Digital signature verification
                doc.fontSize(10).font('Helvetica-Italic').text(
                    'Dokumen ini telah ditandatangani secara digital dan terverifikasi oleh sistem TradeStation. ' +
                    'Tanda tangan digital memiliki kekuatan hukum yang sama dengan tanda tangan basah ' +
                    'sesuai UU No. 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik.',
                    { align: 'justify' }
                );
            } else {
                doc.fontSize(12).font('Helvetica').text('⏳ MENUNGGU TANDA TANGAN DIGITAL', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(10).text('Kontrak ini belum ditandatangani oleh pihak yang bersangkutan', { align: 'center' });
            }

            // Footer
            doc.fontSize(8).font('Helvetica-Italic').text(
                `Dokumen ini dibuat secara otomatis oleh TradeStation pada ${new Date().toLocaleString('id-ID')}`,
                50, 750, { align: 'center' }
            );

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// =====================
// MIDDLEWARE AUTH
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

// Helper function untuk logging contract activity
async function logContractActivity(contractId, action, description, userId = null, req = null) {
    try {
        await ContractHistory.create({
            contract_id: contractId,
            action,
            description,
            performed_by: userId,
            ip_address: req ? req.ip : null,
            user_agent: req ? req.get('User-Agent') : null,
            metadata: {
                timestamp: new Date(),
                source: 'system'
            }
        });
    } catch (error) {
        console.error('Failed to log contract activity:', error);
    }
}

// =====================
// ROUTES
// =====================

// Health Check
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
            version: '2.0.0',
            features: [
                'Complete Digital Contract System',
                'Advanced PDF Generation',
                'Digital Signature Support',
                'Template Management',
                'User Management',
                'Audit Trail',
                'Real-time Statistics'
            ]
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

// Auth Routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

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

// Contract Access Routes (Public)
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

        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            await logContractActivity(contract._id, 'expired', 'Contract expired due to expiry date', null, req);
            return res.status(410).json({ error: 'Contract has expired' });
        }

        // Update viewed status if first time
        if (contract.status === 'sent') {
            await Contract.findByIdAndUpdate(contract._id, { 
                status: 'viewed',
                viewed_at: new Date()
            });
            await logContractActivity(contract._id, 'viewed', 'Contract viewed by client', contract.user_id._id, req);
        }

        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Replace system variables
        const replacements = {
            '{{USER_NAME}}': contract.user_id.name,
            '{{USER_EMAIL}}': contract.user_id.email || '',
            '{{USER_PHONE}}': contract.user_id.phone || '',
            '{{TRADING_ID}}': contract.user_id.trading_account || '',
            '{{CONTRACT_NUMBER}}': contract.number,
            '{{CONTRACT_DATE}}': new Date(contract.createdAt).toLocaleDateString('id-ID'),
            '{{AMOUNT}}': formatCurrency(contract.amount),
            '{{SIGNED_DATE}}': contract.signed_at ? new Date(contract.signed_at).toLocaleString('id-ID') : ''
        };

        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
            content = content.replace(regex, replacements[key]);
        });

        // Replace custom variables
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(regex, variables[key] || `[${key} - Belum Diisi]`);
        });

        res.json({
            data: {
                ...contract.toObject(),
                content,
                canSign: contract.status === 'viewed' || contract.status === 'sent',
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

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, variables, clientName, clientEmail } = req.body;

        if (!signatureData) {
            return res.status(400).json({ error: 'Signature data required' });
        }

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

        if (!['sent', 'viewed'].includes(contract.status)) {
            return res.status(400).json({ error: 'Contract is not ready for signing' });
        }

        // Validate client information if provided
        if (clientName && clientName.toLowerCase() !== contract.user_id.name.toLowerCase()) {
            return res.status(400).json({ error: 'Client name does not match contract' });
        }

        if (clientEmail && clientEmail.toLowerCase() !== contract.user_id.email.toLowerCase()) {
            return res.status(400).json({ error: 'Client email does not match contract' });
        }

        const finalVariables = variables ? { ...contract.variables, ...variables } : contract.variables;
        const signedAt = new Date();
        
        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: signedAt,
            variables: finalVariables,
            ip_signed: req.ip,
            user_agent_signed: req.get('User-Agent')
        });

        await logContractActivity(
            contract._id, 
            'signed', 
            'Contract signed with digital signature', 
            contract.user_id._id, 
            req
        );

        res.json({ 
            message: 'Contract signed successfully',
            pdfDownloadUrl: `/api/contracts/download/${contract._id}`,
            signedAt: signedAt.toISOString(),
            contractNumber: contract.number
        });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
    }
});

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

        if (!['signed', 'completed'].includes(contract.status)) {
            return res.status(400).json({ error: 'Contract is not signed yet' });
        }

        const pdfBuffer = await generateContractPDF(contract, contract.user_id, contract.signature_data);

        await logContractActivity(
            contract._id,
            'downloaded',
            'Contract PDF downloaded',
            null,
            req
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Kontrak_${contract.number}_${contract.user_id.name.replace(/\s+/g, '_')}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Download contract error:', error);
        res.status(500).json({ error: 'Failed to download contract' });
    }
});

// Admin Contract Management Routes
app.get('/api/contracts', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, user_id } = req.query;
        
        let query = {};
        if (req.user.role !== 'admin') {
            query.user_id = req.user._id;
        } else {
            if (status) query.status = status;
            if (user_id) query.user_id = user_id;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const contracts = await Contract.find(query)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Contract.countDocuments(query);
        
        const formattedContracts = contracts.map(contract => ({
            ...contract.toObject(),
            user_name: contract.user_id?.name,
            user_email: contract.user_id?.email,
            trading_account: contract.user_id?.trading_account,
            template_name: contract.template_id?.name,
            created_by_name: contract.created_by?.name
        }));
        
        res.json({ 
            data: formattedContracts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
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
            variables, 
            sendImmediately, 
            expiryDate, 
            adminNotes 
        } = req.body;

        if (!title || !templateId || !userId || amount === undefined) {
            return res.status(400).json({ error: 'Missing required fields: title, templateId, userId, amount' });
        }

        // Validate user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Validate template exists
        const template = await Template.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
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
            access_token: accessToken,
            created_by: req.user._id,
            sent_at: sendImmediately ? new Date() : null,
            expiry_date: expiryDate ? new Date(expiryDate) : null,
            admin_notes: adminNotes?.trim()
        });

        await logContractActivity(
            contract._id,
            'created',
            `Contract created by admin ${req.user.name}`,
            req.user._id,
            req
        );

        if (sendImmediately) {
            await logContractActivity(
                contract._id,
                'sent',
                'Contract immediately sent to client',
                req.user._id,
                req
            );
        }

        res.json({
            message: 'Contract created successfully',
            data: contract,
            accessLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?token=${accessToken}`
        });
    } catch (error) {
        console.error('Create contract error:', error);
        res.status(500).json({ error: 'Failed to create contract' });
    }
});

app.put('/api/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, amount, variables, status, adminNotes, expiryDate } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'signed') {
            return res.status(400).json({ error: 'Cannot modify signed contract' });
        }

        const updateData = {};
        if (title) updateData.title = title.trim();
        if (amount !== undefined) updateData.amount = parseFloat(amount);
        if (variables) updateData.variables = { ...contract.variables, ...variables };
        if (status) updateData.status = status;
        if (adminNotes !== undefined) updateData.admin_notes = adminNotes.trim();
        if (expiryDate) updateData.expiry_date = new Date(expiryDate);

        const updatedContract = await Contract.findByIdAndUpdate(id, updateData, { new: true })
            .populate('user_id', 'name email')
            .populate('template_id', 'name');

        await logContractActivity(
            contract._id,
            'updated',
            `Contract updated by admin ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({
            message: 'Contract updated successfully',
            data: updatedContract
        });
    } catch (error) {
        console.error('Update contract error:', error);
        res.status(500).json({ error: 'Failed to update contract' });
    }
});

app.delete('/api/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'signed') {
            return res.status(400).json({ error: 'Cannot delete signed contract' });
        }

        await Contract.findByIdAndUpdate(id, { status: 'cancelled' });

        await logContractActivity(
            contract._id,
            'cancelled',
            `Contract cancelled by admin ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({ message: 'Contract cancelled successfully' });
    } catch (error) {
        console.error('Delete contract error:', error);
        res.status(500).json({ error: 'Failed to cancel contract' });
    }
});

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

        if (contract.status === 'draft') {
            await Contract.findByIdAndUpdate(id, { 
                status: 'sent',
                sent_at: new Date()
            });

            await logContractActivity(
                contract._id,
                'sent',
                `Contract link generated and sent by admin ${req.user.name}`,
                req.user._id,
                req
            );
        }

        const accessLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?token=${contract.access_token}`;
        
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

// Template Management Routes
app.get('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { category, search } = req.query;
        let query = { is_active: true };
        
        if (category) query.category = category;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const templates = await Template.find(query)
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });
            
        const formattedTemplates = templates.map(template => ({
            ...template.toObject(),
            id: template._id.toString(),
            created_by_name: template.created_by?.name
        }));
        
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

app.put('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, content, description } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (category) updateData.category = category.trim();
        if (description !== undefined) updateData.description = description.trim();
        
        if (content) {
            updateData.content = content.trim();
            // Re-extract variables
            const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
            updateData.variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
            updateData.version = template.version + 1;
        }

        const updatedTemplate = await Template.findByIdAndUpdate(id, updateData, { new: true });

        res.json({
            message: 'Template updated successfully',
            data: updatedTemplate
        });
    } catch (error) {
        console.error('Update template error:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

app.delete('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Check if template is being used
        const contractsUsingTemplate = await Contract.countDocuments({ 
            template_id: id,
            status: { $nin: ['cancelled'] }
        });

        if (contractsUsingTemplate > 0) {
            return res.status(400).json({ 
                error: `Cannot delete template. It is being used by ${contractsUsingTemplate} contract(s)` 
            });
        }

        await Template.findByIdAndUpdate(id, { is_active: false });

        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Delete template error:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// User Management Routes
app.get('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { role, search, page = 1, limit = 50 } = req.query;
        let query = { is_active: true };
        
        if (role) query.role = role;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { trading_account: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const users = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Get contract count for each user
        const usersWithStats = await Promise.all(users.map(async (user) => {
            const contractCount = await Contract.countDocuments({ user_id: user._id });
            return {
                ...user.toObject(),
                contract_count: contractCount
            };
        }));

        const total = await User.countDocuments(query);
        
        res.json({ 
            data: usersWithStats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

app.post('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, email, phone, tradingAccount, role = 'user' } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const defaultPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        const finalTradingAccount = tradingAccount || `TRD${Date.now().toString().slice(-6)}`;

        const user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            password: hashedPassword,
            role: ['user', 'admin'].includes(role) ? role : 'user',
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

app.put('/api/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, tradingAccount, role, balance, is_active } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (email) {
            const existingUser = await User.findOne({ 
                email: email.toLowerCase(), 
                _id: { $ne: id } 
            });
            if (existingUser) {
                return res.status(400).json({ error: 'Email already exists' });
            }
            updateData.email = email.toLowerCase().trim();
        }
        if (phone) updateData.phone = phone.trim();
        if (tradingAccount) updateData.trading_account = tradingAccount.trim();
        if (role && ['user', 'admin'].includes(role)) updateData.role = role;
        if (balance !== undefined) updateData.balance = parseFloat(balance);
        if (is_active !== undefined) updateData.is_active = is_active;

        const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');

        res.json({
            message: 'User updated successfully',
            data: updatedUser
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

app.post('/api/users/:id/reset-password', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword = 'trader123' } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.findByIdAndUpdate(id, { password: hashedPassword });

        res.json({
            message: 'Password reset successfully',
            newPassword
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Dashboard Statistics
app.get('/api/stats/dashboard', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const [
                totalContracts,
                pendingSignatures,
                completedContracts,
                totalValueResult,
                recentActivity,
                statusBreakdown
            ] = await Promise.all([
                Contract.countDocuments(),
                Contract.countDocuments({ status: { $in: ['sent', 'viewed'] } }),
                Contract.countDocuments({ status: { $in: ['signed', 'completed'] } }),
                Contract.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
                Contract.find().sort({ createdAt: -1 }).limit(5)
                    .populate('user_id', 'name')
                    .select('title status createdAt user_id'),
                Contract.aggregate([
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ])
            ]);

            res.json({
                data: {
                    totalContracts,
                    pendingSignatures,
                    completedContracts,
                    totalValue: totalValueResult[0]?.total || 0,
                    recentActivity: recentActivity.map(contract => ({
                        title: contract.title,
                        status: contract.status,
                        user_name: contract.user_id?.name,
                        createdAt: contract.createdAt
                    })),
                    statusBreakdown: statusBreakdown.reduce((acc, item) => {
                        acc[item._id] = item.count;
                        return acc;
                    }, {})
                }
            });
        } else {
            const [totalContracts, pendingSignatures, completedContracts] = await Promise.all([
                Contract.countDocuments({ user_id: req.user._id }),
                Contract.countDocuments({ user_id: req.user._id, status: { $in: ['sent', 'viewed'] } }),
                Contract.countDocuments({ user_id: req.user._id, status: { $in: ['signed', 'completed'] } })
            ]);

            res.json({
                data: { 
                    totalContracts, 
                    pendingSignatures, 
                    completedContracts, 
                    totalValue: 0 
                }
            });
        }
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

// Contract History/Audit Trail
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

        // Check access rights
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

// Error handling
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.path,
        method: req.method 
    });
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
        })
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');  
    await mongoose.connection.close();
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Digital Contract Server v2.0.0`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas Connected`);
            console.log(`✅ Features: Complete Digital Contract System`);
            console.log(`🎯 Ready to handle requests!`);
        });

        server.on('error', (error) => {
            console.error('Server error:', error);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT} (DB connection failed)`);
        });
    }
}

startServer();
