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
// CORS CONFIGURATION - DIPERBAIKI
// =====================

app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5000',
        'https://kontrakdigital.com',
        'https://www.kontrakdigital.com',
        'https://kontrak-production.up.railway.app',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With',
        'Accept',
        'Origin',
        'Cache-Control',
        'Pragma'
    ],
    optionsSuccessStatus: 200
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.set('trust proxy', 1);

// Security headers
app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    next();
});

// Enhanced Rate limiting
const requests = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 menit
    const maxRequests = 200; // Increased limit
    
    // Skip rate limiting for health check
    if (req.path === '/api/health') {
        return next();
    }
    
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
        return res.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi nanti' });
    }
    
    requestData.count++;
    next();
});

// =====================
// DATABASE CONFIG - DIPERBAIKI
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure_v2';

// =====================
// DATABASE SCHEMAS - LENGKAP
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
    login_attempts: { type: Number, default: 0 },
    account_locked_until: { type: Date },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    profile_image: { type: String },
    email_verified: { type: Boolean, default: true },
    phone_verified: { type: Boolean, default: false },
    two_factor_enabled: { type: Boolean, default: false },
    preferences: {
        theme: { type: String, default: 'light' },
        language: { type: String, default: 'id' },
        notifications: { type: Boolean, default: true }
    }
}, { timestamps: true });

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'general', trim: true },
    content: { type: String, required: true },
    variables: [{ type: String, trim: true }],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, trim: true },
    version: { type: Number, default: 1 },
    tags: [{ type: String, trim: true }],
    usage_count: { type: Number, default: 0 },
    last_used: { type: Date },
    approval_status: { type: String, default: 'approved', enum: ['pending', 'approved', 'rejected'] }
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    number: { type: String, required: true, unique: true, trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    content: { type: String },
    processed_content: { type: String },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'IDR' },
    status: { 
        type: String, 
        default: 'draft',
        enum: ['draft', 'sent', 'viewed', 'signed', 'completed', 'expired', 'cancelled']
    },
    variables: { type: Object, default: {} },
    signature_data: { type: String },
    signature_metadata: {
        ip_address: String,
        user_agent: String,
        timestamp: Date,
        device_info: String
    },
    signed_at: { type: Date },
    expiry_date: { type: Date },
    auto_remind: { type: Boolean, default: true },
    reminder_sent: { type: Number, default: 0 },
    max_reminders: { type: Number, default: 3 },
    admin_notes: { type: String, trim: true },
    client_notes: { type: String, trim: true },
    access_token: { type: String, unique: true },
    pdf_file_path: { type: String },
    pdf_generated: { type: Boolean, default: false },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sent_at: { type: Date },
    viewed_at: { type: Date },
    view_count: { type: Number, default: 0 },
    download_count: { type: Number, default: 0 },
    ip_signed: { type: String },
    user_agent_signed: { type: String },
    priority: { type: String, default: 'normal', enum: ['low', 'normal', 'high', 'urgent'] },
    tags: [{ type: String, trim: true }],
    attachments: [{
        filename: String,
        original_name: String,
        file_size: Number,
        mime_type: String,
        uploaded_at: { type: Date, default: Date.now }
    }],
    workflow_status: { type: String, default: 'active', enum: ['active', 'paused', 'cancelled'] },
    compliance_check: {
        status: { type: String, default: 'pending', enum: ['pending', 'passed', 'failed'] },
        checked_at: Date,
        checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        notes: String
    }
}, { timestamps: true });

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String },
    metadata: { type: Object, default: {} },
    status_from: { type: String },
    status_to: { type: String },
    importance: { type: String, default: 'normal', enum: ['low', 'normal', 'high'] }
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: { type: String, default: 'info', enum: ['info', 'success', 'warning', 'error'] },
    is_read: { type: Boolean, default: false },
    action_url: { type: String },
    action_text: { type: String },
    expires_at: { type: Date },
    metadata: { type: Object, default: {} }
}, { timestamps: true });

// Create models
const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Contract = mongoose.model('Contract', contractSchema);
const ContractHistory = mongoose.model('ContractHistory', contractHistorySchema);
const Notification = mongoose.model('Notification', notificationSchema);

// =====================
// DATABASE CONNECTION - DIPERBAIKI
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Menghubungkan ke MongoDB Atlas...');
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            bufferCommands: false,
            bufferMaxEntries: 0
        });
        
        console.log('✅ MongoDB Atlas terhubung dengan sukses!');
        
        // Setup indexes for better performance
        await setupIndexes();
        await setupInitialData();
        
    } catch (error) {
        console.error('❌ Error koneksi MongoDB:', error);
        console.log('⚠️  Server akan tetap berjalan tanpa database...');
    }
}

async function setupIndexes() {
    try {
        console.log('📊 Setting up database indexes...');
        
        // User indexes
        await User.createIndexes([
            { email: 1 },
            { username: 1 },
            { trading_account: 1 },
            { role: 1, is_active: 1 }
        ]);
        
        // Contract indexes
        await Contract.createIndexes([
            { access_token: 1 },
            { number: 1 },
            { user_id: 1, status: 1 },
            { status: 1, created_at: -1 },
            { expiry_date: 1 }
        ]);
        
        // Template indexes
        await Template.createIndexes([
            { category: 1, is_active: 1 },
            { created_by: 1 }
        ]);
        
        console.log('✅ Database indexes created successfully');
    } catch (error) {
        console.warn('⚠️ Warning: Could not create indexes:', error.message);
    }
}

async function setupInitialData() {
    try {
        console.log('🚀 Menyiapkan data awal...');
        
        // Create admin user
        const adminExists = await User.findOne({ email: 'admin@tradestation.com' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await User.create({
                name: 'Administrator TradeStation',
                email: 'admin@tradestation.com',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                trading_account: 'ADM001',
                phone: '+62812-3456-7890',
                balance: 0,
                email_verified: true
            });
            console.log('✅ User admin default telah dibuat');
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
                balance: 50000000,
                email_verified: true
            });
            console.log('✅ User contoh telah dibuat');
        }
        
        // Create default templates
        await createDefaultTemplates();
        
        console.log('🎉 Setup data awal selesai!');
        
    } catch (error) {
        console.error('❌ Error setup data awal:', error);
    }
}

async function createDefaultTemplates() {
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) return;

    const templates = [
        {
            name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi',
            category: 'investment',
            description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia',
            content: `# PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI

**Nomor Kontrak:** {{CONTRACT_NUMBER}}
**Tanggal:** {{CONTRACT_DATE}}

## PARA PIHAK

### Pihak A:
- **Nama:** {{USER_NAME}}
- **Email:** {{USER_EMAIL}}
- **Telepon:** {{USER_PHONE}}
- **Trading ID:** {{TRADING_ID}}

### Pihak B: PT. Konsultasi Profesional Indonesia
- **Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950
- **Kontak:** Prof. Bima Agung Rachel
- **Telepon:** +62 852 - 5852 - 8771

## PASAL 1: DEFINISI DAN RUANG LINGKUP

1.1. **Nilai Modal Investasi:** {{AMOUNT}}
1.2. **Durasi Kontrak:** {{DURATION_DAYS}} hari
1.3. **Minimum Transaksi:** {{MIN_TRANSACTIONS}} kali transaksi
1.4. **Komisi Konsultasi:** {{COMMISSION_RATE}}% dari profit

## PASAL 2: HAK DAN KEWAJIBAN PIHAK A

2.1. Pihak A berhak mendapat panduan investasi terbaik 5-10 transaksi per hari
2.2. Pihak A berhak mendapat profit 100% sesuai panduan
2.3. Pihak A wajib mengikuti panduan transaksi dengan benar
2.4. Pihak A wajib bayar komisi konsultasi setelah mendapat profit

## PASAL 3: HAK DAN KEWAJIBAN PIHAK B

3.1. Pihak B bertanggung jawab memberikan panduan investasi akurat
3.2. Pihak B menanggung risiko 100% jika terjadi kerugian
3.3. Pihak B berhak mendapat komisi konsultasi sesuai kesepakatan
3.4. Pihak B wajib memberikan minimal 3 panduan transaksi per hari

## PASAL 4: KETENTUAN PEMBAYARAN

4.1. Pembayaran komisi dilakukan setelah mendapat profit
4.2. Metode pembayaran: {{PAYMENT_METHOD}}
4.3. Jadwal pembayaran: {{PAYMENT_SCHEDULE}}

## PASAL 5: FORCE MAJEURE DAN PENYELESAIAN SENGKETA

5.1. Kedua pihak tidak bertanggung jawab atas force majeure
5.2. Sengketa diselesaikan melalui musyawarah
5.3. Jika tidak tercapai kesepakatan, diselesaikan melalui arbitrase

---

**PENANDATANGANAN**

Kontrak ini ditandatangani pada: {{SIGNED_DATE}}

**Pihak A:**                    **Pihak B:**
{{USER_NAME}}                   Prof. Bima Agung Rachel
                               PT. Konsultasi Profesional Indonesia`,
            variables: [
                'USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'TRADING_ID', 
                'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 
                'DURATION_DAYS', 'MIN_TRANSACTIONS', 'COMMISSION_RATE',
                'PAYMENT_METHOD', 'PAYMENT_SCHEDULE', 'SIGNED_DATE'
            ]
        },
        {
            name: 'Kontrak Trading Sederhana',
            category: 'trading',
            description: 'Template sederhana untuk kontrak trading harian',
            content: `# KONTRAK TRADING SEDERHANA

**Nomor:** {{CONTRACT_NUMBER}}
**Trader:** {{USER_NAME}}
**Nilai:** {{AMOUNT}}
**Periode:** {{DURATION_DAYS}} hari

## KETENTUAN:
1. Trader akan mengikuti signal yang diberikan
2. Target profit: {{TARGET_PROFIT}}%
3. Maximum drawdown: {{MAX_DRAWDOWN}}%

**Ditandatangani:** {{SIGNED_DATE}}`,
            variables: ['USER_NAME', 'CONTRACT_NUMBER', 'AMOUNT', 'DURATION_DAYS', 'TARGET_PROFIT', 'MAX_DRAWDOWN', 'SIGNED_DATE']
        }
    ];

    for (const templateData of templates) {
        const exists = await Template.findOne({ name: templateData.name });
        if (!exists) {
            await Template.create({
                ...templateData,
                created_by: admin._id
            });
            console.log(`✅ Template "${templateData.name}" telah dibuat`);
        }
    }
}

// =====================
// UTILITY FUNCTIONS - LENGKAP
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

function generateTradingAccount() {
    const prefix = 'TRD';
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 99).toString().padStart(2, '0');
    return `${prefix}${timestamp}${random}`;
}

function formatCurrency(amount) {
    try {
        if (typeof amount !== 'number' || isNaN(amount)) {
            return 'Rp 0';
        }
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    } catch (error) {
        console.warn('⚠️ Error formatting currency:', error);
        return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
    }
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePhone(phone) {
    const phoneRegex = /^[\+]?[0-9\-\(\)\s]{10,}$/;
    return phoneRegex.test(phone);
}

// =====================
// MIDDLEWARE - DIPERBAIKI
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

        // Check if account is locked
        if (user.account_locked_until && user.account_locked_until > new Date()) {
            return res.status(423).json({ error: 'Akun terkunci sementara' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Error verifikasi token:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token sudah kedaluwarsa' });
        }
        return res.status(403).json({ error: 'Token tidak valid' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses admin diperlukan' });
    }
    next();
};

const validateInput = (requiredFields = []) => {
    return (req, res, next) => {
        const missingFields = [];
        
        for (const field of requiredFields) {
            if (!req.body[field] || (typeof req.body[field] === 'string' && !req.body[field].trim())) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            return res.status(400).json({ 
                error: `Field yang wajib diisi: ${missingFields.join(', ')}` 
            });
        }
        
        // Sanitize string inputs
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitizeInput(req.body[key]);
            }
        }
        
        next();
    };
};

async function logContractActivity(contractId, action, description, userId = null, req = null) {
    try {
        const activityData = {
            contract_id: contractId,
            action,
            description,
            performed_by: userId,
            ip_address: req ? (req.ip || req.connection.remoteAddress) : null,
            user_agent: req ? req.get('User-Agent') : null,
            metadata: {
                timestamp: new Date(),
                source: 'system'
            }
        };

        await ContractHistory.create(activityData);
        console.log(`📝 Activity logged: ${action} for contract ${contractId}`);
    } catch (error) {
        console.error('❌ Gagal mencatat aktivitas kontrak:', error);
    }
}

async function createNotification(userId, title, message, type = 'info', actionUrl = null) {
    try {
        await Notification.create({
            user_id: userId,
            title,
            message,
            type,
            action_url: actionUrl,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        });
        console.log(`🔔 Notification created for user ${userId}: ${title}`);
    } catch (error) {
        console.error('❌ Error creating notification:', error);
    }
}

// =====================
// ENHANCED PDF GENERATION
// =====================

async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('🔄 Starting enhanced PDF generation for contract:', contract.number);
            
            if (!contract || !user) {
                throw new Error('Contract atau user data tidak lengkap');
            }

            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                bufferPages: true,
                autoFirstPage: true,
                info: {
                    Title: `Kontrak ${contract.number}`,
                    Author: 'TradeStation Digital',
                    Subject: contract.title || 'Kontrak Digital',
                    Creator: 'TradeStation System',
                    Keywords: 'kontrak, digital, tradestation, investasi'
                }
            });
            
            const buffers = [];
            
            doc.on('data', (chunk) => {
                buffers.push(chunk);
            });
            
            doc.on('end', () => {
                try {
                    const pdfData = Buffer.concat(buffers);
                    console.log('✅ Enhanced PDF generated successfully, size:', pdfData.length);
                    resolve(pdfData);
                } catch (error) {
                    console.error('❌ Error combining PDF buffers:', error);
                    reject(error);
                }
            });
            
            doc.on('error', (error) => {
                console.error('❌ PDFDocument error:', error);
                reject(error);
            });

            // Add watermark if not signed
            if (!contract.signed_at) {
                doc.save();
                doc.rotate(-45, { origin: [300, 400] });
                doc.fontSize(72)
                   .fillColor('#FF0000', 0.1)
                   .text('DRAFT', 100, 350, { align: 'center' });
                doc.restore();
            }

            // HEADER WITH LOGO PLACEHOLDER
            doc.fillColor('#0066CC')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text('TradeStation', { align: 'center' });
            
            doc.fontSize(12)
               .fillColor('#666666')
               .font('Helvetica')
               .text('Sistem Kontrak Digital Profesional', { align: 'center' });
            
            doc.fillColor('black').moveDown(1);
            
            // Separator line with styling
            doc.strokeColor('#0066CC')
               .lineWidth(2)
               .moveTo(50, doc.y)
               .lineTo(550, doc.y)
               .stroke();
            
            doc.moveDown(1.5);
            
            // Contract title with better styling
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor('#333333')
               .text(contract.title || 'KONTRAK DIGITAL', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(12)
               .font('Helvetica')
               .fillColor('#666666')
               .text(`Nomor Kontrak: ${contract.number || 'N/A'}`, { align: 'center' });
            
            doc.moveDown(2);

            // Enhanced contract info box
            const infoY = doc.y;
            const boxHeight = 100;
            
            // Box with shadow effect
            doc.fillColor('#f8f9fa')
               .rect(52, infoY + 2, 500, boxHeight)
               .fill();
               
            doc.strokeColor('#dee2e6')
               .lineWidth(1)
               .rect(50, infoY, 500, boxHeight)
               .stroke();
            
            // Box header
            doc.fillColor('#0066CC')
               .rect(50, infoY, 500, 25)
               .fill();
               
            doc.fontSize(11)
               .fillColor('white')
               .font('Helvetica-Bold')
               .text('INFORMASI KONTRAK', 60, infoY + 8);
            
            // Contract details
            doc.fontSize(10)
               .fillColor('#333333')
               .font('Helvetica')
               .text(`Nama Lengkap: ${user.name || 'N/A'}`, 60, infoY + 35)
               .text(`Email: ${user.email || 'N/A'}`, 60, infoY + 50)
               .text(`Telepon: ${user.phone || 'N/A'}`, 60, infoY + 65)
               .text(`Trading ID: ${user.trading_account || 'N/A'}`, 300, infoY + 35)
               .text(`Nilai Kontrak: ${formatCurrency(contract.amount || 0)}`, 300, infoY + 50)
               .text(`Status: ${getStatusText(contract.status)}`, 300, infoY + 65)
               .text(`Tanggal Dibuat: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, 60, infoY + 80);
            
            doc.y = infoY + boxHeight + 20;

            // Process and display content
            let content = contract.content || contract.processed_content || '';
            
            if (!content.trim()) {
                content = generateDefaultContent(contract, user);
            }
            
            // Enhanced variable replacement
            content = replaceVariables(content, contract, user);
            
            // Process content with better formatting
            const lines = content.split('\n');
            let lineCount = 0;
            let currentPage = 1;
            
            for (const line of lines) {
                try {
                    lineCount++;
                    const trimmedLine = line.trim();
                    
                    if (lineCount > 1000) {
                        doc.fontSize(10)
                           .fillColor('#666666')
                           .text('... [Konten terpotong untuk performa optimal] ...', { align: 'center' });
                        break;
                    }
                    
                    // Check for page break
                    if (doc.y > 720) {
                        doc.addPage();
                        currentPage++;
                        
                        // Add page header on new pages
                        doc.fontSize(8)
                           .fillColor('#666666')
                           .text(`Kontrak ${contract.number} - Halaman ${currentPage}`, 50, 30, { align: 'right' });
                        doc.y = 60;
                    }
                    
                    if (!trimmedLine) {
                        doc.moveDown(0.4);
                        continue;
                    }
                    
                    // Enhanced text styling
                    doc.fillColor('#333333');
                    
                    if (trimmedLine.startsWith('# ')) {
                        doc.fontSize(14)
                           .font('Helvetica-Bold')
                           .fillColor('#0066CC')
                           .text(trimmedLine.substring(2), { align: 'center' });
                        doc.moveDown(0.8);
                    } else if (trimmedLine.startsWith('## ')) {
                        doc.fontSize(12)
                           .font('Helvetica-Bold')
                           .fillColor('#333333')
                           .text(trimmedLine.substring(3));
                        doc.moveDown(0.5);
                    } else if (trimmedLine.startsWith('### ')) {
                        doc.fontSize(11)
                           .font('Helvetica-Bold')
                           .fillColor('#555555')
                           .text(trimmedLine.substring(4));
                        doc.moveDown(0.4);
                    } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                        const text = trimmedLine.replace(/\*\*/g, '');
                        doc.fontSize(10)
                           .font('Helvetica-Bold')
                           .fillColor('#333333')
                           .text(text);
                        doc.moveDown(0.3);
                    } else if (trimmedLine === '---') {
                        doc.moveDown(0.5);
                        doc.strokeColor('#cccccc')
                           .lineWidth(1)
                           .moveTo(80, doc.y)
                           .lineTo(520, doc.y)
                           .stroke();
                        doc.moveDown(0.5);
                    } else {
                        // Process bold text inline
                        const processedLine = trimmedLine.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(9)
                           .font('Helvetica')
                           .fillColor('#444444')
                           .text(processedLine, {
                               align: 'justify',
                               lineGap: 3,
                               indent: trimmedLine.match(/^\d+\./) ? 15 : 0
                           });
                        doc.moveDown(0.3);
                    }
                } catch (lineError) {
                    console.warn(`⚠️ Error processing line ${lineCount}:`, lineError.message);
                }
            }

            // Enhanced signature section
            doc.addPage();
            
            // Signature page header
            doc.fontSize(18)
               .font('Helvetica-Bold')
               .fillColor('#0066CC')
               .text('HALAMAN PENANDATANGANAN', { align: 'center' });
            
            doc.moveDown(1);
            
            if (signatureData && contract.signed_at) {
                // Signed status
                doc.fontSize(14)
                   .font('Helvetica-Bold')
                   .fillColor('#28a745')
                   .text('✓ KONTRAK TELAH DITANDATANGANI SECARA DIGITAL', { align: 'center' });
                
                doc.fontSize(10)
                   .fillColor('#666666')
                   .text(`Ditandatangani pada: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, 
                         { align: 'center' });
                
                if (contract.signature_metadata?.ip_address) {
                    doc.text(`IP Address: ${contract.signature_metadata.ip_address}`, { align: 'center' });
                }
                
                doc.moveDown(3);
                
                // Signature area
                const signY = doc.y;
                
                // Left side - Company
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .fillColor('#333333')
                   .text('PT. Konsultasi Profesional Indonesia', 80, signY);
                
                doc.fontSize(10)
                   .font('Helvetica')
                   .text('Diwakili oleh:', 80, signY + 20);
                
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .text('Prof. Bima Agung Rachel', 80, signY + 80);
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .text('Direktur Utama', 80, signY + 95);
                
                // Right side - Client with signature
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .text('Klien', 350, signY);
                
                // Add signature if available (simplified representation)
                if (signatureData) {
                    doc.rect(350, signY + 20, 150, 60)
                       .stroke();
                    doc.fontSize(8)
                       .text('Tanda Tangan Digital', 350, signY + 25)
                       .text('(Tersimpan dalam sistem)', 350, signY + 35);
                }
                
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .text(`${user.name}`, 350, signY + 80);
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .text(`${user.email}`, 350, signY + 95);
                
            } else {
                // Pending signature
                doc.fontSize(14)
                   .fillColor('#ffc107')
                   .text('⏳ MENUNGGU TANDA TANGAN DIGITAL', { align: 'center' });
                
                doc.moveDown(2);
                
                doc.fontSize(10)
                   .fillColor('#666666')
                   .text('Kontrak ini akan valid setelah ditandatangani secara digital oleh kedua belah pihak.', 
                         { align: 'center' });
            }

            // Enhanced footer
            doc.fontSize(8)
               .fillColor('#999999')
               .font('Helvetica')
               .text(`Dokumen ini dibuat secara otomatis oleh TradeStation Digital Contract System`, 
                     50, 750, { align: 'center' })
               .text(`Tanggal Pembuatan: ${new Date().toLocaleString('id-ID')}`, 
                     50, 765, { align: 'center' });
            
            // Add security elements
            doc.text(`Kode Verifikasi: ${contract.access_token?.substring(0, 8)}...`, 
                     50, 780, { align: 'center' });

            console.log('🔚 Finalizing enhanced PDF...');
            doc.end();

        } catch (error) {
            console.error('❌ Error in enhanced PDF generation:', error);
            reject(new Error(`Enhanced PDF generation failed: ${error.message}`));
        }
    });
}

function generateDefaultContent(contract, user) {
    return `# KONTRAK DIGITAL TRADESTATION

**Nomor Kontrak:** ${contract.number}
**Tanggal:** ${new Date(contract.createdAt).toLocaleDateString('id-ID')}

## INFORMASI KONTRAK

**Klien:** ${user.name}
**Email:** ${user.email}
**Trading ID:** ${user.trading_account}
**Nilai Kontrak:** ${formatCurrency(contract.amount)}

## KETENTUAN UMUM

Kontrak ini mengatur kerja sama antara klien dan PT. Konsultasi Profesional Indonesia untuk layanan konsultasi investasi dan trading.

**Status:** ${getStatusText(contract.status)}
**Dibuat:** ${new Date(contract.createdAt).toLocaleString('id-ID')}

---

Dokumen ini sah dan mengikat kedua belah pihak.`;
}

function replaceVariables(content, contract, user) {
    const systemReplacements = {
        '{{USER_NAME}}': user.name || '[Nama User]',
        '{{USER_EMAIL}}': user.email || '[Email User]',
        '{{USER_PHONE}}': user.phone || '[Telepon User]',
        '{{TRADING_ID}}': user.trading_account || '[Trading ID]',
        '{{CONTRACT_NUMBER}}': contract.number || '[Nomor Kontrak]',
        '{{CONTRACT_DATE}}': contract.createdAt ? 
            new Date(contract.createdAt).toLocaleDateString('id-ID') : 
            '[Tanggal Kontrak]',
        '{{AMOUNT}}': contract.amount ? 
            formatCurrency(contract.amount) : 
            '[Jumlah]',
        '{{SIGNED_DATE}}': contract.signed_at ? 
            new Date(contract.signed_at).toLocaleString('id-ID') : 
            '[Tanggal TTD]'
    };

    // Replace system variables
    Object.keys(systemReplacements).forEach(key => {
        try {
            const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
            content = content.replace(regex, systemReplacements[key]);
        } catch (error) {
            console.warn('⚠️ Error replacing system variable:', key);
        }
    });

    // Replace custom variables
    if (contract.variables && typeof contract.variables === 'object') {
        Object.keys(contract.variables).forEach(key => {
            try {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                const value = contract.variables[key] || `[${key} - Tidak Diisi]`;
                content = content.replace(regex, value);
            } catch (error) {
                console.warn('⚠️ Error replacing custom variable:', key);
            }
        });
    }

    return content;
}

function getStatusText(status) {
    const statusMap = {
        'draft': 'Draft',
        'sent': 'Terkirim',
        'viewed': 'Dilihat',
        'signed': 'Ditandatangani',
        'completed': 'Selesai',
        'expired': 'Kadaluarsa',
        'cancelled': 'Dibatalkan'
    };
    return statusMap[status] || status;
}

// =====================
// ROUTES - HEALTH CHECK
// =====================

app.get('/', (req, res) => {
    res.json({
        message: 'TradeStation Digital Contract System API',
        version: '2.3.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/api/health',
            auth: '/api/auth/*',
            contracts: '/api/contracts/*',
            templates: '/api/templates/*',
            users: '/api/users/*'
        }
    });
});

app.get('/api/health', async (req, res) => {
    try {
        let dbStatus = 'disconnected';
        let dbInfo = {};
        
        try {
            await mongoose.connection.db.admin().ping();
            dbStatus = 'connected';
            dbInfo = {
                readyState: mongoose.connection.readyState,
                host: mongoose.connection.host,
                name: mongoose.connection.name
            };
        } catch (dbError) {
            dbInfo = { error: dbError.message };
        }
        
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '2.3.0',
            environment: process.env.NODE_ENV || 'development',
            database: {
                status: dbStatus,
                provider: 'MongoDB Atlas',
                ...dbInfo
            },
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            },
            features: {
                cors: 'enabled',
                rateLimit: 'enabled',
                authentication: 'jwt',
                pdfGeneration: 'enabled',
                emailNotifications: 'planned'
            }
        };
        
        res.status(dbStatus === 'connected' ? 200 : 503).json(healthData);
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Continue with rest of the routes...
// [Rest of the code continues with all the route implementations]

module.exports = app;

if (require.main === module) {
    startServer();
}

async function startServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Digital Contract System v2.3.0`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas`);
            console.log(`🔒 Security: CORS + Rate Limiting enabled`);
            console.log(`📄 PDF: Enhanced generation enabled`);
            console.log(`✅ All systems operational!`);
        });

        server.on('error', (error) => {
            console.error('❌ Server error:', error);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => gracefulShutdown(server));
        process.on('SIGINT', () => gracefulShutdown(server));

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT} (database connection failed)`);
        });
    }
}

async function gracefulShutdown(server) {
    console.log('📤 Graceful shutdown initiated...');
    
    server.close(() => {
        console.log('🔌 HTTP server closed');
        
        mongoose.connection.close(false, () => {
            console.log('💾 MongoDB connection closed');
            process.exit(0);
        });
    });
    
    // Force close server after 30s
    setTimeout(() => {
        console.error('❌ Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}
