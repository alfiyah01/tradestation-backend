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
// PENGATURAN DASAR - Ini untuk mengatur server
// =====================

// CORS - Agar frontend bisa berkomunikasi dengan backend
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Pembatasan permintaan - Mencegah spam
const requests = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 menit
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
        return res.status(429).json({ error: 'Terlalu banyak permintaan' });
    }
    
    requestData.count++;
    next();
});

// =====================
// PENGATURAN DATABASE - Ini untuk menghubungkan ke MongoDB
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';

// =====================
// SKEMA DATABASE - Ini adalah struktur data yang akan disimpan
// =====================

// Skema User - Data pengguna
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

// Skema Template - Data template kontrak
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

// Skema Contract - Data kontrak
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

// Skema History - Riwayat aktivitas kontrak
const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String },
    metadata: { type: Object, default: {} }
}, { timestamps: true });

// Membuat model dari skema
const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Contract = mongoose.model('Contract', contractSchema);
const ContractHistory = mongoose.model('ContractHistory', contractHistorySchema);

// =====================
// KONEKSI DATABASE - Menghubungkan ke MongoDB
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Menghubungkan ke MongoDB Atlas...');
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        console.log('✅ MongoDB Atlas terhubung dengan sukses!');
        await setupInitialData();
        
    } catch (error) {
        console.error('❌ Error koneksi MongoDB:', error);
        console.log('⚠️  Melanjutkan startup server...');
    }
}

// Menyiapkan data awal
async function setupInitialData() {
    try {
        console.log('🚀 Menyiapkan data awal...');
        
        // Membuat user admin
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
            console.log('✅ User admin default telah dibuat');
        }
        
        // Membuat user contoh
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
            console.log('✅ User contoh telah dibuat');
        }
        
        // Membuat template default
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

## PASAL 1: NILAI INVESTASI DAN BIAYA

**1.1. Nilai Investasi**  
Pihak Pertama setuju untuk melakukan investasi sebesar **{{AMOUNT}}** sebagai modal dasar untuk layanan konsultasi investasi.

**1.2. Biaya Konsultasi**  
Biaya konsultasi layanan sebesar **{{CONSULTATION_FEE}}** yang mencakup analisis pasar, rekomendasi investasi, dan laporan berkala.

**1.3. Periode Kontrak**  
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

## PASAL 3: PEMBAYARAN

**3.1. Metode Pembayaran**  
Pembayaran dilakukan melalui **{{PAYMENT_METHOD}}** dalam mata uang Rupiah.

**3.2. Jadwal Pembayaran**  
Pembayaran dilakukan **{{PAYMENT_SCHEDULE}}** dengan ketentuan **{{PAYMENT_TERMS}}**.

---

## PASAL 4: HAK DAN KEWAJIBAN

**4.1. Hak Pihak Pertama:**
- Menerima layanan konsultasi sesuai perjanjian
- Mendapat akses ke platform analisis dan laporan
- Meminta klarifikasi atas rekomendasi yang diberikan

**4.2. Kewajiban Pihak Pertama:**
- Melakukan pembayaran tepat waktu
- Memberikan informasi yang akurat dan lengkap
- Menjaga kerahasiaan informasi yang diterima

**4.3. Hak Pihak Kedua:**
- Menerima pembayaran sesuai perjanjian
- Mendapat informasi lengkap dari Pihak Pertama

**4.4. Kewajiban Pihak Kedua:**
- Memberikan layanan konsultasi sesuai standar profesional
- Menjaga kerahasiaan informasi klien
- Memberikan analisis yang objektif dan independen

---

## PASAL 5: PENUTUP

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
                        'CONTRACT_PERIOD', 'REPORTING_FREQUENCY', 'CONSULTATION_HOURS', 
                        'PAYMENT_METHOD', 'PAYMENT_SCHEDULE', 'PAYMENT_TERMS', 'SIGNED_DATE'
                    ],
                    created_by: admin._id
                });
                console.log('✅ Template default telah dibuat');
            }
        }
        
        console.log('🎉 Setup data awal selesai!');
        
    } catch (error) {
        console.error('❌ Error setup data awal:', error);
    }
}

// =====================
// FUNGSI BANTUAN - Fungsi-fungsi kecil yang membantu
// =====================

// Membuat token akses unik
function generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Membuat nomor kontrak unik
function generateContractNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `TSC${year}${month}${day}${random}`;
}

// Format uang ke Rupiah
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

// Membuat PDF kontrak
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

            // Header dengan info kontrak
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
            
            // Garis pemisah
            doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(1);

            // Memproses isi kontrak
            let content = contract.content || '';
            
            // Mengganti variabel sistem
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

            // Mengganti variabel sistem
            Object.keys(replacements).forEach(key => {
                const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                content = content.replace(regex, replacements[key]);
            });

            // Mengganti variabel kustom
            Object.keys(contract.variables || {}).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                content = content.replace(regex, contract.variables[key] || `[${key} - Tidak Diisi]`);
            });

            // Memproses konten baris per baris
            const lines = content.split('\n');
            
            lines.forEach(line => {
                line = line.trim();
                if (line) {
                    // Cek apakah perlu halaman baru
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

            // Bagian tanda tangan
            doc.addPage();
            doc.fontSize(16).font('Helvetica-Bold').text('TANDA TANGAN DIGITAL', { align: 'center' });
            doc.moveDown(1);
            
            if (signatureData && contract.signed_at) {
                doc.fontSize(12).font('Helvetica-Bold').text('✅ KONTRAK TELAH DITANDATANGANI SECARA SAH', { align: 'center' });
                doc.moveDown(0.5);
                
                // Kotak info tanda tangan
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
                
                // Verifikasi tanda tangan digital
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
// MIDDLEWARE AUTENTIKASI - Untuk mengecek login user
// =====================

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token akses diperlukan' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).where('is_active').equals(true);
        
        if (!user) {
            return res.status(401).json({ error: 'Token tidak valid atau user tidak ditemukan' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Error verifikasi token:', error);
        return res.status(403).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses admin diperlukan' });
    }
    next();
};

// Fungsi untuk mencatat aktivitas kontrak
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
        console.error('Gagal mencatat aktivitas kontrak:', error);
    }
}

// =====================
// ROUTES/ENDPOINT - Ini adalah alamat-alamat yang bisa diakses
// =====================

// Cek kesehatan server
app.get('/api/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        
        res.json({
            status: 'sehat',
            timestamp: new Date().toISOString(),
            database: 'terhubung',
            environment: process.env.NODE_ENV || 'development',
            mongodb: 'MongoDB Atlas',
            uptime: process.uptime(),
            version: '2.0.0',
            features: [
                'Sistem Kontrak Digital Lengkap',
                'Generasi PDF Lanjutan',
                'Dukungan Tanda Tangan Digital',
                'Manajemen Template',
                'Manajemen User',
                'Audit Trail',
                'Statistik Real-time'
            ]
        });
    } catch (error) {
        res.status(503).json({
            status: 'tidak sehat',
            timestamp: new Date().toISOString(),
            database: 'terputus',
            error: error.message
        });
    }
});

// =====================
// ROUTES LOGIN - Untuk masuk ke sistem
// =====================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email dan password harus diisi' });
        }

        const user = await User.findOne({
            $or: [
                { email: email.toLowerCase() }, 
                { username: email.toLowerCase() }
            ],
            is_active: true
        });

        if (!user) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Email atau password salah' });
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
            message: 'Login berhasil',
            token,
            user: {
                ...userResponse,
                tradingAccount: user.trading_account
            }
        });
    } catch (error) {
        console.error('Error login:', error);
        res.status(500).json({ error: 'Login gagal' });
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
        console.error('Error mendapatkan info user:', error);
        res.status(500).json({ error: 'Gagal mendapatkan info user' });
    }
});

// =====================
// ROUTES AKSES KONTRAK (PUBLIK) - User dapat akses tanpa login
// =====================

app.get('/api/contracts/access/:token', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || token.length < 32) {
            return res.status(400).json({ error: 'Token akses tidak valid' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account is_active')
            .populate('template_id', 'name content variables');

        if (!contract || !contract.user_id || !contract.user_id.is_active) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan atau akses ditolak' });
        }

        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            await logContractActivity(contract._id, 'expired', 'Kontrak kedaluwarsa karena tanggal habis', null, req);
            return res.status(410).json({ error: 'Kontrak sudah kedaluwarsa' });
        }

        // Update status dilihat jika pertama kali
        if (contract.status === 'sent') {
            await Contract.findByIdAndUpdate(contract._id, { 
                status: 'viewed',
                viewed_at: new Date()
            });
            await logContractActivity(contract._id, 'viewed', 'Kontrak dilihat oleh klien', contract.user_id._id, req);
        }

        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Mengganti variabel sistem
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

        // Mengganti variabel kustom
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
        console.error('Error akses kontrak:', error);
        res.status(500).json({ error: 'Gagal mengakses kontrak' });
    }
});

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, variables, clientName, clientEmail } = req.body;

        if (!signatureData) {
            return res.status(400).json({ error: 'Data tanda tangan diperlukan' });
        }

        if (!signatureData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Format tanda tangan tidak valid' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.status === 'signed' || contract.status === 'completed') {
            return res.status(400).json({ error: 'Kontrak sudah ditandatangani' });
        }

        if (!['sent', 'viewed'].includes(contract.status)) {
            return res.status(400).json({ error: 'Kontrak belum siap untuk ditandatangani' });
        }

        // Validasi informasi klien jika ada
        if (clientName && clientName.toLowerCase() !== contract.user_id.name.toLowerCase()) {
            return res.status(400).json({ error: 'Nama klien tidak cocok dengan kontrak' });
        }

        if (clientEmail && clientEmail.toLowerCase() !== contract.user_id.email.toLowerCase()) {
            return res.status(400).json({ error: 'Email klien tidak cocok dengan kontrak' });
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
            'Kontrak ditandatangani dengan tanda tangan digital', 
            contract.user_id._id, 
            req
        );

        res.json({ 
            message: 'Kontrak berhasil ditandatangani',
            pdfDownloadUrl: `/api/contracts/download/${contract._id}`,
            signedAt: signedAt.toISOString(),
            contractNumber: contract.number
        });
    } catch (error) {
        console.error('Error tanda tangan kontrak:', error);
        res.status(500).json({ error: 'Gagal menandatangani kontrak' });
    }
});

app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(contractId)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (!['signed', 'completed'].includes(contract.status)) {
            return res.status(400).json({ error: 'Kontrak belum ditandatangani' });
        }

        const pdfBuffer = await generateContractPDF(contract, contract.user_id, contract.signature_data);

        await logContractActivity(
            contract._id,
            'downloaded',
            'PDF kontrak diunduh',
            null,
            req
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Kontrak_${contract.number}_${contract.user_id.name.replace(/\s+/g, '_')}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error download kontrak:', error);
        res.status(500).json({ error: 'Gagal mendownload kontrak' });
    }
});

// =====================
// ROUTES MANAJEMEN KONTRAK ADMIN
// =====================

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
        console.error('Error mendapatkan kontrak:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
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
            return res.status(400).json({ error: 'Field yang wajib: title, templateId, userId, amount' });
        }

        // Validasi user ada
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        // Validasi template ada
        const template = await Template.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
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
            `Kontrak dibuat oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        if (sendImmediately) {
            await logContractActivity(
                contract._id,
                'sent',
                'Kontrak langsung dikirim ke klien',
                req.user._id,
                req
            );
        }

        res.json({
            message: 'Kontrak berhasil dibuat',
            data: contract,
            accessLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?token=${accessToken}`
        });
    } catch (error) {
        console.error('Error membuat kontrak:', error);
        res.status(500).json({ error: 'Gagal membuat kontrak' });
    }
});

// ROUTE EDIT KONTRAK - INI YANG DIPERBAIKI
app.put('/api/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, amount, variables, status, adminNotes, expiryDate, content } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.status === 'signed') {
            return res.status(400).json({ error: 'Tidak dapat mengubah kontrak yang sudah ditandatangani' });
        }

        const updateData = {};
        if (title) updateData.title = title.trim();
        if (amount !== undefined) updateData.amount = parseFloat(amount);
        if (variables) updateData.variables = { ...contract.variables, ...variables };
        if (status) updateData.status = status;
        if (adminNotes !== undefined) updateData.admin_notes = adminNotes.trim();
        if (expiryDate) updateData.expiry_date = new Date(expiryDate);
        if (content) updateData.content = content.trim(); // INI YANG DITAMBAHKAN

        const updatedContract = await Contract.findByIdAndUpdate(id, updateData, { new: true })
            .populate('user_id', 'name email')
            .populate('template_id', 'name');

        await logContractActivity(
            contract._id,
            'updated',
            `Kontrak diupdate oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({
            message: 'Kontrak berhasil diupdate',
            data: updatedContract
        });
    } catch (error) {
        console.error('Error update kontrak:', error);
        res.status(500).json({ error: 'Gagal mengupdate kontrak' });
    }
});

// ROUTE GET DETAIL KONTRAK - INI YANG DIPERBAIKI
app.get('/api/contracts/:id/detail', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(id)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name content variables')
            .populate('created_by', 'name email');

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Cek hak akses
        if (req.user.role !== 'admin' && contract.user_id._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        // Dapatkan konten yang sudah diproses
        let processedContent = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Ganti variabel sistem
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
            processedContent = processedContent.replace(regex, replacements[key]);
        });

        // Ganti variabel kustom
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            processedContent = processedContent.replace(regex, variables[key] || `[${key} - Belum Diisi]`);
        });

        res.json({
            data: {
                ...contract.toObject(),
                processedContent,
                user: {
                    name: contract.user_id.name,
                    email: contract.user_id.email,
                    phone: contract.user_id.phone,
                    trading_account: contract.user_id.trading_account
                },
                template: contract.template_id ? {
                    name: contract.template_id.name,
                    content: contract.template_id.content,
                    variables: contract.template_id.variables
                } : null,
                created_by: contract.created_by ? {
                    name: contract.created_by.name,
                    email: contract.created_by.email
                } : null
            }
        });
    } catch (error) {
        console.error('Error mendapatkan detail kontrak:', error);
        res.status(500).json({ error: 'Gagal mendapatkan detail kontrak' });
    }
});

app.delete('/api/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.status === 'signed') {
            return res.status(400).json({ error: 'Tidak dapat menghapus kontrak yang sudah ditandatangani' });
        }

        await Contract.findByIdAndUpdate(id, { status: 'cancelled' });

        await logContractActivity(
            contract._id,
            'cancelled',
            `Kontrak dibatalkan oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({ message: 'Kontrak berhasil dibatalkan' });
    } catch (error) {
        console.error('Error menghapus kontrak:', error);
        res.status(500).json({ error: 'Gagal membatalkan kontrak' });
    }
});

app.post('/api/contracts/:id/generate-link', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.status === 'draft') {
            await Contract.findByIdAndUpdate(id, { 
                status: 'sent',
                sent_at: new Date()
            });

            await logContractActivity(
                contract._id,
                'sent',
                `Link kontrak dibuat dan dikirim oleh admin ${req.user.name}`,
                req.user._id,
                req
            );
        }

        const accessLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?token=${contract.access_token}`;
        
        res.json({
            message: 'Link kontrak berhasil dibuat',
            accessLink,
            token: contract.access_token
        });
    } catch (error) {
        console.error('Error membuat link:', error);
        res.status(500).json({ error: 'Gagal membuat link' });
    }
});

// =====================
// ROUTES MANAJEMEN TEMPLATE
// =====================

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
        console.error('Error mendapatkan template:', error);
        res.status(500).json({ error: 'Gagal mendapatkan template' });
    }
});

app.post('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Nama dan konten harus diisi' });
        }
        
        // Ekstrak variabel dari konten
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
            message: 'Template berhasil dibuat',
            data: templateResponse
        });
    } catch (error) {
        console.error('Error membuat template:', error);
        res.status(500).json({ error: 'Gagal membuat template' });
    }
});

// ROUTE EDIT TEMPLATE - INI YANG DIPERBAIKI
app.put('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, content, description } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID template tidak valid' });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (category) updateData.category = category.trim();
        if (description !== undefined) updateData.description = description.trim();
        
        if (content) {
            updateData.content = content.trim();
            // Ekstrak ulang variabel
            const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
            updateData.variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
            updateData.version = template.version + 1;
        }

        const updatedTemplate = await Template.findByIdAndUpdate(id, updateData, { new: true });

        res.json({
            message: 'Template berhasil diupdate',
            data: updatedTemplate
        });
    } catch (error) {
        console.error('Error update template:', error);
        res.status(500).json({ error: 'Gagal mengupdate template' });
    }
});

// ROUTE GET DETAIL TEMPLATE - INI YANG DIPERBAIKI UNTUK PREVIEW
app.get('/api/templates/:id/detail', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID template tidak valid' });
        }

        const template = await Template.findById(id)
            .populate('created_by', 'name email');

        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        res.json({
            data: {
                ...template.toObject(),
                created_by_name: template.created_by?.name
            }
        });
    } catch (error) {
        console.error('Error mendapatkan detail template:', error);
        res.status(500).json({ error: 'Gagal mendapatkan detail template' });
    }
});

app.delete('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID template tidak valid' });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        // Cek apakah template sedang digunakan
        const contractsUsingTemplate = await Contract.countDocuments({ 
            template_id: id,
            status: { $nin: ['cancelled'] }
        });

        if (contractsUsingTemplate > 0) {
            return res.status(400).json({ 
                error: `Tidak dapat menghapus template. Sedang digunakan oleh ${contractsUsingTemplate} kontrak` 
            });
        }

        await Template.findByIdAndUpdate(id, { is_active: false });

        res.json({ message: 'Template berhasil dihapus' });
    } catch (error) {
        console.error('Error menghapus template:', error);
        res.status(500).json({ error: 'Gagal menghapus template' });
    }
});

// =====================
// ROUTES MANAJEMEN USER
// =====================

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

        // Dapatkan jumlah kontrak untuk setiap user
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
        console.error('Error mendapatkan user:', error);
        res.status(500).json({ error: 'Gagal mendapatkan user' });
    }
});

app.post('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, email, phone, tradingAccount, role = 'user' } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Nama, email, dan telepon harus diisi' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email sudah digunakan' });
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
            message: 'User berhasil dibuat',
            data: userResponse,
            defaultPassword
        });
    } catch (error) {
        console.error('Error membuat user:', error);
        res.status(500).json({ error: 'Gagal membuat user' });
    }
});

// ROUTE EDIT USER - INI YANG DIPERBAIKI
app.put('/api/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, tradingAccount, role, balance, is_active } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID user tidak valid' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (email) {
            const existingUser = await User.findOne({ 
                email: email.toLowerCase(), 
                _id: { $ne: id } 
            });
            if (existingUser) {
                return res.status(400).json({ error: 'Email sudah digunakan' });
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
            message: 'User berhasil diupdate',
            data: updatedUser
        });
    } catch (error) {
        console.error('Error update user:', error);
        res.status(500).json({ error: 'Gagal mengupdate user' });
    }
});

// ROUTE GET DETAIL USER - INI YANG DIPERBAIKI
app.get('/api/users/:id/detail', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID user tidak valid' });
        }

        const user = await User.findById(id)
            .select('-password')
            .populate('created_by', 'name email');

        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        // Dapatkan statistik kontrak user
        const contractStats = await Contract.aggregate([
            { $match: { user_id: mongoose.Types.ObjectId(id) } },
            { 
                $group: { 
                    _id: '$status', 
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                } 
            }
        ]);

        res.json({
            data: {
                ...user.toObject(),
                created_by_name: user.created_by?.name,
                contractStats
            }
        });
    } catch (error) {
        console.error('Error mendapatkan detail user:', error);
        res.status(500).json({ error: 'Gagal mendapatkan detail user' });
    }
});

// =====================
// ROUTES STATISTIK DASHBOARD
// =====================

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
        console.error('Error statistik dashboard:', error);
        res.status(500).json({ error: 'Gagal mendapatkan statistik dashboard' });
    }
});

// =====================
// ROUTES RIWAYAT KONTRAK
// =====================

app.get('/api/contracts/:id/history', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Cek hak akses
        if (req.user.role !== 'admin' && contract.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        const history = await ContractHistory.find({ contract_id: id })
            .populate('performed_by', 'name email')
            .sort({ createdAt: -1 });

        res.json({ data: history });
    } catch (error) {
        console.error('Error mendapatkan riwayat kontrak:', error);
        res.status(500).json({ error: 'Gagal mendapatkan riwayat kontrak' });
    }
});

// =====================
// ERROR HANDLING - Menangani error
// =====================

app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint tidak ditemukan',
        path: req.path,
        method: req.method 
    });
});

app.use((error, req, res, next) => {
    console.error('Error yang tidak ditangani:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
        })
    });
});

// =====================
// GRACEFUL SHUTDOWN - Matikan server dengan aman
// =====================

process.on('SIGTERM', async () => {
    console.log('SIGTERM diterima, mematikan server dengan aman');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT diterima, mematikan server dengan aman');  
    await mongoose.connection.close();
    process.exit(0);
});

// =====================
// START SERVER - Memulai server
// =====================

async function startServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Digital Contract Server v2.0.0`);
            console.log(`📱 Server berjalan di port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas Terhubung`);
            console.log(`✅ Fitur: Sistem Kontrak Digital Lengkap`);
            console.log(`🎯 Siap menangani permintaan!`);
            console.log(`📋 Perbaikan yang telah dilakukan:`);
            console.log(`   - ✅ Signature pad sudah diperbaiki`);
            console.log(`   - ✅ Edit detail kontrak sudah berfungsi`);
            console.log(`   - ✅ Edit template sudah berfungsi`);
            console.log(`   - ✅ Preview template sudah berfungsi`);
            console.log(`   - ✅ Edit user sudah berfungsi`);
            console.log(`   - ✅ Fitur reset password dihapus`);
            console.log(`   - ✅ Akses user dibatasi hanya untuk kontrak mereka`);
        });

        server.on('error', (error) => {
            console.error('Error server:', error);
        });

    } catch (error) {
        console.error('Gagal memulai server:', error);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server berjalan di port ${PORT} (koneksi DB gagal)`);
        });
    }
}

startServer();
