// CORS Fix Alternatif - v3.2.2
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
require('dotenv').config();

// =====================
// APP INITIALIZATION
// =====================

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// CONSTANTS & CONFIG
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';
const FIXED_PASSWORD = process.env.FIXED_PASSWORD || 'kontrakdigital2025';

let dbConnected = false;

// =====================
// CORS SETUP - PALING AGRESIF
// =====================

// Disable semua security yang bisa interfere dengan CORS
app.use((req, res, next) => {
    // Log semua request untuk debugging
    console.log(`🌐 ${req.method} ${req.path} from: ${req.headers.origin || 'no-origin'}`);
    
    // Set CORS headers paling permisif
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Expose-Headers', '*');
    res.header('Access-Control-Max-Age', '86400');
    
    // Tambahan headers untuk debugging
    res.header('X-Custom-CORS', 'enabled');
    res.header('X-Debug-Origin', req.headers.origin || 'none');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        console.log('✅ Handling OPTIONS preflight for:', req.path);
        return res.status(200).json({ message: 'CORS OK' });
    }
    
    next();
});

// CORS middleware tambahan dengan cors library
app.use(cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['*'],
    exposedHeaders: ['*'],
    maxAge: 86400,
    optionsSuccessStatus: 200
}));

// Minimal helmet untuk menghindari conflict
app.use(helmet({ 
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting yang sangat permisif
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Very high limit for testing
    message: { error: 'Terlalu banyak permintaan, coba lagi nanti.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => false // Don't skip any requests
});
app.use('/api/', limiter);

// =====================
// DATABASE SCHEMAS
// =====================

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'admin' }
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true },
    number: { type: String, required: true, unique: true },
    client_name: { type: String, required: true },
    client_email: { type: String, required: true },
    client_phone: { type: String },
    client_address: { type: String },
    amount: { type: Number, default: 0 },
    content: { type: String, required: true },
    status: { 
        type: String, 
        default: 'draft',
        enum: ['draft', 'active', 'signed', 'completed']
    },
    signature_data: { type: String },
    signed_at: { type: Date },
    variables: { type: Object, default: {} },
    access_link: { type: String, unique: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    admin_notes: { type: String }
}, { timestamps: true });

// Indexes
contractSchema.index({ number: 1 });
contractSchema.index({ access_link: 1 });
contractSchema.index({ status: 1 });

const Admin = mongoose.model('Admin', adminSchema);
const Contract = mongoose.model('Contract', contractSchema);

// =====================
// UTILITY FUNCTIONS
// =====================

function generateContractNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `KTR${year}${month}${day}${random}`;
}

function generateAccessLink() {
    return crypto.randomBytes(32).toString('hex');
}

function formatCurrency(amount) {
    try {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    } catch (error) {
        return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
    }
}

function getDefaultContractTemplate() {
    return `# PERJANJIAN LAYANAN KONSULTASI INVESTASI

**Nomor Kontrak:** {{CONTRACT_NUMBER}}
**Tanggal:** {{CONTRACT_DATE}}

## PIHAK PERTAMA
**Nama:** {{CLIENT_NAME}}
**Email:** {{CLIENT_EMAIL}}
**Telepon:** {{CLIENT_PHONE}}
**Alamat:** {{CLIENT_ADDRESS}}

## PIHAK KEDUA
**PT. Konsultasi Profesional Indonesia**
**Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950
**Kontak:** Prof. Bima Agung Rachel
**Telepon:** +62 852 - 5852 - 8771

---

## KETENTUAN KONTRAK

**Pihak Pertama** setuju untuk menggunakan layanan konsultasi investasi yang disediakan oleh **Pihak Kedua**. 

### Pasal 1: Layanan
1.1. Pihak Kedua menyediakan layanan analisis pasar dan konsultasi investasi.
1.2. Layanan meliputi analisis data, laporan riset pasar, dan rekomendasi investasi.

### Pasal 2: Nilai Kontrak
2.1. Nilai total kontrak adalah **{{AMOUNT}}**
2.2. Pembayaran dilakukan sesuai kesepakatan yang telah ditentukan.

### Pasal 3: Kewajiban dan Hak
3.1. Pihak Kedua wajib memberikan layanan sesuai standar profesional.
3.2. Pihak Pertama wajib memberikan informasi yang diperlukan untuk analisis.
3.3. Semua informasi bersifat rahasia dan tidak boleh disebarkan.

### Pasal 4: Berlaku
4.1. Kontrak ini berlaku sejak ditandatangani kedua belah pihak.
4.2. Kontrak dapat diperpanjang atas kesepakatan bersama.

---

**TANDA TANGAN**

**Pihak Kedua:**                           **Pihak Pertama:**
Prof. Bima Agung Rachel                    {{CLIENT_NAME}}

**Tanggal:** {{SIGNED_DATE}}`;
}

// =====================
// PDF GENERATION (simplified for space)
// =====================

async function generateContractPDF(contract) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];
            
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            // Simple PDF content
            doc.fontSize(20).text('TradeStation Digital Contract', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Contract Number: ${contract.number}`);
            doc.text(`Client: ${contract.client_name}`);
            doc.text(`Amount: ${formatCurrency(contract.amount)}`);
            doc.text(`Status: ${contract.status}`);
            
            if (contract.signed_at) {
                doc.moveDown();
                doc.fontSize(14).text('✓ DIGITALLY SIGNED', { align: 'center' });
                doc.fontSize(10).text(`Signed on: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, { align: 'center' });
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// Auth middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Token diperlukan' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const admin = await Admin.findById(decoded.adminId);
        
        if (!admin) {
            return res.status(401).json({ error: 'Token tidak valid' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Token tidak valid' });
    }
};

// =====================
// DATABASE CONNECTION
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        dbConnected = true;
        console.log('✅ MongoDB connected successfully');
        
        // Create default admin
        const adminExists = await Admin.findOne({ email: 'admin@kontrakdigital.com' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await Admin.create({
                name: 'Admin Kontrak Digital',
                email: 'admin@kontrakdigital.com',
                password: hashedPassword
            });
            console.log('✅ Default admin created');
        }
        
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        dbConnected = false;
    }
}

// =====================
// ROUTES
// =====================

// Root endpoint dengan debug info
app.get('/', (req, res) => {
    res.json({
        message: '🚀 TradeStation Backend API v3.2.2',
        status: 'Running',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'Connected' : 'Disconnected',
        cors: 'FULLY ENABLED - ALL ORIGINS ALLOWED',
        debug: {
            origin: req.headers.origin || 'none',
            userAgent: req.headers['user-agent']?.substring(0, 50) || 'none',
            method: req.method
        }
    });
});

// Health check dengan extensive CORS info
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'connected' : 'disconnected',
        version: '3.2.2-aggressive-cors',
        cors: {
            enabled: true,
            policy: 'Allow All Origins',
            origin: req.headers.origin || 'none',
            credentials: true,
            methods: 'ALL',
            headers: 'ALL'
        },
        request: {
            method: req.method,
            path: req.path,
            origin: req.headers.origin,
            userAgent: req.headers['user-agent']?.substring(0, 100)
        }
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    console.log('🧪 Test endpoint hit from:', req.headers.origin);
    res.json({
        message: 'CORS Test Berhasil! 🎉',
        timestamp: new Date().toISOString(),
        origin: req.headers.origin || 'none',
        cors: 'SUCCESS',
        debug: {
            method: req.method,
            headers: Object.keys(req.headers),
            allOriginsAllowed: true
        }
    });
});

// Admin login dengan extensive logging
app.post('/api/admin/login', async (req, res) => {
    try {
        console.log('🔐 Admin login attempt from:', req.headers.origin);
        console.log('📧 Login data:', req.body);
        
        const { email, password } = req.body;

        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({ error: 'Email dan password harus diisi' });
        }

        const admin = await Admin.findOne({ email: email.toLowerCase() });
        if (!admin) {
            console.log('❌ Admin not found:', email);
            return res.status(401).json({ error: 'Email atau password admin salah' });
        }

        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ error: 'Email atau password admin salah' });
        }

        const token = jwt.sign({ adminId: admin._id }, JWT_SECRET, { expiresIn: '24h' });

        console.log('✅ Admin login successful:', admin.name);

        res.json({
            message: 'Login admin berhasil',
            token,
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('❌ Admin login error:', error);
        res.status(500).json({ error: 'Login admin gagal. Silakan coba lagi.' });
    }
});

// User login
app.post('/api/user/login', async (req, res) => {
    try {
        console.log('🔐 User login attempt from:', req.headers.origin);
        const { contractNumber, password } = req.body;

        if (!contractNumber || !password) {
            return res.status(400).json({ error: 'Nomor kontrak dan password harus diisi' });
        }

        if (password !== FIXED_PASSWORD) {
            return res.status(401).json({ error: 'Password salah. Gunakan password yang diberikan admin.' });
        }

        const contract = await Contract.findOne({ number: contractNumber });
        if (!contract) {
            return res.status(404).json({ error: 'Nomor kontrak tidak ditemukan. Pastikan nomor kontrak benar.' });
        }

        if (contract.status !== 'active') {
            return res.status(400).json({ error: 'Kontrak belum diaktifkan atau sudah ditandatangani.' });
        }

        const token = jwt.sign({ 
            contractId: contract._id,
            contractNumber: contract.number 
        }, JWT_SECRET, { expiresIn: '24h' });

        console.log('✅ User login successful:', contract.number);

        res.json({
            message: 'Login berhasil',
            token,
            contract: {
                id: contract._id,
                number: contract.number,
                title: contract.title,
                client_name: contract.client_name,
                status: contract.status,
                canSign: contract.status === 'active' && !contract.signature_data
            }
        });
    } catch (error) {
        console.error('❌ User login error:', error);
        res.status(500).json({ error: 'Login gagal. Silakan coba lagi.' });
    }
});

// Get contract for user
app.get('/api/user/contract', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Token diperlukan' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const contract = await Contract.findById(decoded.contractId);

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        let content = contract.content || getDefaultContractTemplate();
        
        const replacements = {
            '{{CONTRACT_NUMBER}}': contract.number,
            '{{CONTRACT_DATE}}': new Date(contract.createdAt).toLocaleDateString('id-ID'),
            '{{CLIENT_NAME}}': contract.client_name,
            '{{CLIENT_EMAIL}}': contract.client_email,
            '{{CLIENT_PHONE}}': contract.client_phone || '',
            '{{CLIENT_ADDRESS}}': contract.client_address || '',
            '{{AMOUNT}}': formatCurrency(contract.amount),
            '{{SIGNED_DATE}}': contract.signed_at ? 
                new Date(contract.signed_at).toLocaleDateString('id-ID') : 
                '[Belum Ditandatangani]'
        };

        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
            content = content.replace(regex, replacements[key]);
        });

        res.json({
            data: {
                ...contract.toObject(),
                content,
                canSign: contract.status === 'active' && !contract.signature_data
            }
        });
    } catch (error) {
        console.error('❌ Get contract error:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
    }
});

// Sign contract
app.post('/api/user/sign', async (req, res) => {
    try {
        const { signatureData } = req.body;
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Token diperlukan' });
        }

        if (!signatureData) {
            return res.status(400).json({ error: 'Data tanda tangan diperlukan' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const contract = await Contract.findById(decoded.contractId);

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.signature_data) {
            return res.status(400).json({ error: 'Kontrak sudah ditandatangani' });
        }

        await Contract.findByIdAndUpdate(contract._id, {
            signature_data: signatureData,
            signed_at: new Date(),
            status: 'signed'
        });

        console.log('✅ Contract signed:', contract.number);

        res.json({ 
            message: 'Kontrak berhasil ditandatangani',
            downloadUrl: `/api/user/download`
        });
    } catch (error) {
        console.error('❌ Sign contract error:', error);
        res.status(500).json({ error: 'Gagal menandatangani kontrak' });
    }
});

// Download PDF for user
app.get('/api/user/download', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Token diperlukan' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const contract = await Contract.findById(decoded.contractId);

        if (!contract || !contract.signature_data) {
            return res.status(400).json({ error: 'Kontrak belum ditandatangani' });
        }

        const pdfBuffer = await generateContractPDF(contract);
        const filename = `Kontrak_${contract.number}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({ error: 'Gagal mengunduh kontrak' });
    }
});

// Admin routes
app.get('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const contracts = await Contract.find().sort({ createdAt: -1 });
        
        res.json({
            data: contracts.map(contract => ({
                ...contract.toObject(),
                formatted_amount: formatCurrency(contract.amount),
                can_download: contract.signature_data ? true : false
            }))
        });
    } catch (error) {
        console.error('❌ Get contracts error:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
    }
});

app.post('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const { title, client_name, client_email, client_phone, client_address, amount, content, admin_notes } = req.body;

        if (!title || !client_name || !client_email) {
            return res.status(400).json({ error: 'Title, nama klien, dan email harus diisi' });
        }

        const contractNumber = generateContractNumber();
        const accessLink = generateAccessLink();

        const contract = await Contract.create({
            title: title.trim(),
            number: contractNumber,
            client_name: client_name.trim(),
            client_email: client_email.toLowerCase().trim(),
            client_phone: client_phone?.trim(),
            client_address: client_address?.trim(),
            amount: parseFloat(amount) || 0,
            content: content?.trim() || getDefaultContractTemplate(),
            access_link: accessLink,
            created_by: req.admin._id,
            admin_notes: admin_notes?.trim(),
            status: 'draft'
        });

        console.log('✅ Contract created:', contractNumber);

        res.json({
            message: 'Kontrak berhasil dibuat',
            data: contract,
            userLoginInfo: {
                contractNumber: contractNumber,
                password: FIXED_PASSWORD
            }
        });
    } catch (error) {
        console.error('❌ Create contract error:', error);
        res.status(500).json({ error: 'Gagal membuat kontrak' });
    }
});

app.post('/api/admin/contracts/:id/activate', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        await Contract.findByIdAndUpdate(id, { status: 'active' });

        res.json({
            message: 'Kontrak berhasil diaktifkan',
            userLoginInfo: {
                contractNumber: contract.number,
                password: FIXED_PASSWORD
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengaktifkan kontrak' });
    }
});

app.get('/api/admin/contracts/:id/download', authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        const pdfBuffer = await generateContractPDF(contract);
        const filename = `Kontrak_${contract.number}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengunduh kontrak' });
    }
});

app.delete('/api/admin/contracts/:id', authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findByIdAndDelete(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        res.json({ message: 'Kontrak berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus kontrak' });
    }
});

app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const [totalContracts, draftContracts, activeContracts, signedContracts, totalValue] = await Promise.all([
            Contract.countDocuments(),
            Contract.countDocuments({ status: 'draft' }),
            Contract.countDocuments({ status: 'active' }),
            Contract.countDocuments({ status: 'signed' }),
            Contract.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
        ]);

        res.json({
            data: {
                totalContracts,
                draftContracts,
                activeContracts,
                signedContracts,
                totalValue: totalValue[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Gagal mendapatkan statistik' });
    }
});

// Catch-all error handler
app.use((req, res) => {
    console.log('❌ 404 - Endpoint not found:', req.method, req.path);
    res.status(404).json({ 
        error: 'Endpoint tidak ditemukan',
        method: req.method,
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// =====================
// START SERVER
// =====================

async function startServer() {
    try {
        await connectDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation v3.2.2 - AGGRESSIVE CORS FIX`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`💾 Database: ${dbConnected ? 'Connected ✅' : 'Disconnected ❌'}`);
            console.log(`🔒 CORS: FULLY DISABLED - ALL ORIGINS ALLOWED ✅`);
            console.log(`👤 Admin: admin@kontrakdigital.com / admin123`);
            console.log(`📝 User Password: ${FIXED_PASSWORD}`);
            console.log(`✅ Ready for kontrakdigital.com!`);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
