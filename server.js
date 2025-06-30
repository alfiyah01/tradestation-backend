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
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure_enhanced';

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:8080',
    'http://localhost:3001',
    'https://kontrak-production.up.railway.app',
    'https://kontrakdigital.com',
    'https://www.kontrakdigital.com',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3001',
    process.env.FRONTEND_URL
].filter(Boolean);

// Enhanced connection options
const mongoOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    writeConcern: { w: 'majority' }
};

// Database connection status
let dbConnected = false;

console.log('🔧 Allowed CORS origins:', allowedOrigins);

// =====================
// DATABASE SCHEMAS
// =====================

const userSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'Nama harus diisi'], 
        trim: true,
        minlength: [2, 'Nama minimal 2 karakter'],
        maxlength: [100, 'Nama maksimal 100 karakter']
    },
    email: { 
        type: String, 
        required: [true, 'Email harus diisi'], 
        unique: true, 
        lowercase: true, 
        trim: true,
        validate: [validator.isEmail, 'Format email tidak valid']
    },
    username: { 
        type: String, 
        unique: true, 
        sparse: true, 
        trim: true,
        minlength: [3, 'Username minimal 3 karakter'],
        maxlength: [30, 'Username maksimal 30 karakter']
    },
    password: { 
        type: String, 
        required: [true, 'Password harus diisi'], 
        minlength: [6, 'Password minimal 6 karakter']
    },
    phone: { 
        type: String, 
        trim: true,
        validate: {
            validator: function(v) {
                return !v || validator.isMobilePhone(v, 'any');
            },
            message: 'Format nomor telepon tidak valid'
        }
    },
    role: { 
        type: String, 
        default: 'user', 
        enum: {
            values: ['user', 'admin'],
            message: 'Role harus user atau admin'
        }
    },
    trading_account: { 
        type: String, 
        trim: true,
        unique: true,
        sparse: true
    },
    balance: { 
        type: Number, 
        default: 0, 
        min: [0, 'Balance tidak boleh negatif']
    },
    is_active: { 
        type: Boolean, 
        default: true 
    },
    last_login: { 
        type: Date 
    },
    created_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    profile_image: { 
        type: String 
    },
    email_verified: {
        type: Boolean,
        default: false
    },
    login_attempts: {
        type: Number,
        default: 0
    },
    locked_until: {
        type: Date
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const templateSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'Nama template harus diisi'], 
        trim: true,
        maxlength: [200, 'Nama template maksimal 200 karakter']
    },
    category: { 
        type: String, 
        default: 'general', 
        trim: true,
        enum: {
            values: ['general', 'investment', 'trading', 'consulting', 'partnership'],
            message: 'Kategori tidak valid'
        }
    },
    content: { 
        type: String, 
        required: [true, 'Konten template harus diisi'],
        maxlength: [50000, 'Konten template terlalu panjang']
    },
    variables: [{ 
        type: String, 
        trim: true 
    }],
    is_active: { 
        type: Boolean, 
        default: true 
    },
    created_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    description: { 
        type: String, 
        trim: true,
        maxlength: [500, 'Deskripsi maksimal 500 karakter']
    },
    version: { 
        type: Number, 
        default: 1 
    },
    usage_count: {
        type: Number,
        default: 0
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const contractSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: [true, 'Judul kontrak harus diisi'], 
        trim: true,
        maxlength: [200, 'Judul kontrak maksimal 200 karakter']
    },
    number: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    },
    user_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: [true, 'User ID harus diisi']
    },
    template_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Template' 
    },
    content: { 
        type: String,
        maxlength: [100000, 'Konten kontrak terlalu panjang']
    },
    amount: { 
        type: Number, 
        default: 0, 
        min: [0, 'Jumlah tidak boleh negatif'],
        max: [999999999999, 'Jumlah terlalu besar']
    },
    status: { 
        type: String, 
        default: 'draft',
        enum: {
            values: ['draft', 'sent', 'viewed', 'signed', 'completed', 'expired', 'cancelled'],
            message: 'Status kontrak tidak valid'
        }
    },
    variables: { 
        type: Object, 
        default: {} 
    },
    signature_data: { 
        type: String 
    },
    signed_at: { 
        type: Date 
    },
    expiry_date: { 
        type: Date,
        validate: {
            validator: function(v) {
                return !v || v > new Date();
            },
            message: 'Tanggal kedaluwarsa harus di masa depan'
        }
    },
    admin_notes: { 
        type: String, 
        trim: true,
        maxlength: [1000, 'Catatan admin maksimal 1000 karakter']
    },
    access_token: { 
        type: String, 
        unique: true,
        required: true
    },
    pdf_file_path: { 
        type: String 
    },
    created_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    sent_at: { 
        type: Date 
    },
    viewed_at: { 
        type: Date 
    },
    reminder_sent: { 
        type: Number, 
        default: 0,
        max: [10, 'Maksimal 10 reminder']
    },
    ip_signed: { 
        type: String 
    },
    user_agent_signed: { 
        type: String 
    },
    metadata: {
        type: Object,
        default: {}
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const contractHistorySchema = new mongoose.Schema({
    contract_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Contract', 
        required: true 
    },
    action: { 
        type: String, 
        required: true, 
        trim: true,
        enum: ['created', 'sent', 'viewed', 'signed', 'completed', 'expired', 'cancelled', 'downloaded', 'reminded']
    },
    description: { 
        type: String, 
        trim: true,
        maxlength: [500, 'Deskripsi maksimal 500 karakter']
    },
    performed_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    ip_address: { 
        type: String 
    },
    user_agent: { 
        type: String 
    },
    metadata: { 
        type: Object, 
        default: {} 
    }
}, { 
    timestamps: true 
});

// Add indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ trading_account: 1 });
userSchema.index({ role: 1, is_active: 1 });

templateSchema.index({ name: 1, category: 1 });
templateSchema.index({ created_by: 1, is_active: 1 });

contractSchema.index({ user_id: 1, status: 1 });
contractSchema.index({ access_token: 1 });
contractSchema.index({ number: 1 });
contractSchema.index({ created_by: 1 });
contractSchema.index({ expiry_date: 1 });

contractHistorySchema.index({ contract_id: 1, createdAt: -1 });

// =====================
// CREATE MODELS
// =====================

const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Contract = mongoose.model('Contract', contractSchema);
const ContractHistory = mongoose.model('ContractHistory', contractHistorySchema);

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

function validateInput(data, rules) {
    const errors = {};
    
    for (const field in rules) {
        const rule = rules[field];
        const value = data[field];
        
        if (rule.required && (!value || (typeof value === 'string' && !value.trim()))) {
            errors[field] = `${field} harus diisi`;
            continue;
        }
        
        if (value) {
            if (rule.type === 'email' && !validator.isEmail(value)) {
                errors[field] = 'Format email tidak valid';
            }
            
            if (rule.type === 'phone' && !validator.isMobilePhone(value, 'any')) {
                errors[field] = 'Format nomor telepon tidak valid';
            }
            
            if (rule.minLength && value.length < rule.minLength) {
                errors[field] = `${field} minimal ${rule.minLength} karakter`;
            }
            
            if (rule.maxLength && value.length > rule.maxLength) {
                errors[field] = `${field} maksimal ${rule.maxLength} karakter`;
            }
            
            if (rule.min && parseFloat(value) < rule.min) {
                errors[field] = `${field} minimal ${rule.min}`;
            }
            
            if (rule.max && parseFloat(value) > rule.max) {
                errors[field] = `${field} maksimal ${rule.max}`;
            }
        }
    }
    
    return Object.keys(errors).length > 0 ? errors : null;
}

function sanitizeInput(obj) {
    const sanitized = {};
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            sanitized[key] = validator.escape(obj[key].trim());
        } else {
            sanitized[key] = obj[key];
        }
    }
    return sanitized;
}

async function logContractActivity(contractId, action, description, userId = null, req = null) {
    try {
        if (!dbConnected) return;
        
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

function getDefaultContractTemplate() {
    return `# PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI

**Nomor Kontrak:** {{CONTRACT_NUMBER}}

## Pihak A:
**Nama:** {{USER_NAME}}
**Email:** {{USER_EMAIL}}
**Telepon:** {{USER_PHONE}}
**Trading ID:** {{TRADING_ID}}

## Pihak B: PT. Konsultasi Profesional Indonesia
**Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950

**Kontak:** Prof. Bima Agung Rachel

**Telepon:** +62 852 - 5852 - 8771

**Pihak A**, sebagai individu, setuju untuk menggunakan layanan analisis pasar atau layanan konsultasi yang disediakan oleh **Pihak B**, PT. Konsultasi Profesional Indonesia. Pihak B menyediakan layanan seperti analisis pasar, konsultasi investasi, analisis produk, laporan riset pasar, dsb. Untuk memajukan pembangunan dan kerja sama bersama yang saling menguntungkan, dan berdasarkan prinsip kesetaraan dan saling menghormati, kedua belah pihak menyepakati ketentuan-ketentuan berikut untuk kerja sama ini, dan akan secara ketat mematuhinya.

## Pasal 1: Definisi Awal

1.1. Biaya konsultasi layanan merujuk pada nilai profit dari investasi apapun oleh pelanggan. Anda dapat meminta Pihak B untuk melakukan analisis data, laporan, dll.

1.2. Biaya transaksi merujuk pada biaya yang dibebankan oleh Pihak B kepada Pihak A. Biaya ini dihitung berdasarkan jumlah Profit dari transaksi Investasi sebesar 30 % hingga 50 %.

1.3. Nilai modal Investasi Pihak A sebesar {{AMOUNT}} dengan durasi kontrak kerja sama investasi selama {{DURATION_DAYS}} hari atau minimal {{MIN_TRANSACTIONS}} kali transaksi investasi.

## Pasal 2: Konten Layanan dan Standar Tarif

2.1. Pihak B menyediakan analisis dan rekomendasi kepada Pihak A.

2.2. Pihak A menyetujui metode dan jumlah pembayaran komisi konsultasi.

2.3. Jika ada biaya tambahan dalam proses kerja sama, harus disetujui bersama sebelumnya.

2.4. Laporan akhir yang disediakan Pihak B kepada Pihak A mencakup informasi tentang tren industri, analisis pasar, dan opini profesional lainnya.

2.5. Informasi yang disediakan oleh Pihak B harus dijaga kerahasiaannya oleh Pihak A dan tidak boleh disebarkan tanpa izin tertulis.

---

**Tertanda:**

**Perwakilan Pihak B:**                           **Tanda tangan Pihak A:**

Prof. Bima Agung Rachel                           ( {{USER_NAME}} )


**Tanggal Penandatanganan:** {{SIGNED_DATE}}`;
}

// =====================
// MIDDLEWARE FUNCTIONS (DIPINDAHKAN KE SINI)
// =====================

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                error: 'Token akses diperlukan',
                code: 'TOKEN_REQUIRED'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).where('is_active').equals(true);
        
        if (!user) {
            return res.status(401).json({ 
                error: 'Token tidak valid atau user tidak ditemukan',
                code: 'INVALID_TOKEN'
            });
        }

        // Check if account is locked
        if (user.locked_until && user.locked_until > new Date()) {
            return res.status(423).json({ 
                error: 'Akun terkunci sementara karena terlalu banyak percobaan login gagal',
                code: 'ACCOUNT_LOCKED'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Error verifikasi token:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Token sudah kedaluwarsa',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        return res.status(403).json({ 
            error: 'Token tidak valid',
            code: 'INVALID_TOKEN'
        });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ 
            error: 'Akses admin diperlukan',
            code: 'ADMIN_REQUIRED'
        });
    }
    next();
};

const checkDatabaseConnection = (req, res, next) => {
    if (!dbConnected) {
        return res.status(503).json({
            error: 'Database tidak terhubung',
            code: 'DATABASE_DISCONNECTED'
        });
    }
    next();
};

// =====================
// PDF GENERATION
// =====================

async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('🔄 Starting PDF generation for contract:', contract.number);
            
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
                    Creator: 'TradeStation System'
                }
            });
            
            const buffers = [];
            
            doc.on('data', (chunk) => {
                buffers.push(chunk);
            });
            
            doc.on('end', () => {
                try {
                    const pdfData = Buffer.concat(buffers);
                    console.log('✅ PDF generated successfully, size:', pdfData.length);
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

            console.log('📝 Adding content to PDF...');

            // HEADER SECTION
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .text('PT. KONSULTAN PROFESIONAL INDONESIA', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(12)
               .font('Helvetica')
               .text('Partner Of', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .fillColor('#0066CC')
               .text('TradeStation', { align: 'center' });
            
            doc.fillColor('black').moveDown(1);
            
            // Separator line
            doc.moveTo(50, doc.y)
               .lineTo(550, doc.y)
               .stroke();
            
            doc.moveDown(1);
            
            // Contract title
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .text(contract.title || 'KONTRAK DIGITAL', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(11)
               .font('Helvetica')
               .text(`Nomor Kontrak: ${contract.number || 'N/A'}`, { align: 'center' });
            
            doc.moveDown(1.5);

            // Contract info box
            const infoY = doc.y;
            doc.rect(50, infoY, 500, 100).stroke();
            
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .text('INFORMASI KONTRAK', 60, infoY + 10);
            
            doc.fontSize(9)
               .font('Helvetica')
               .text(`Nama: ${user.name || 'N/A'}`, 60, infoY + 25)
               .text(`Email: ${user.email || 'N/A'}`, 60, infoY + 40)
               .text(`Telepon: ${user.phone || 'N/A'}`, 60, infoY + 55)
               .text(`Trading ID: ${user.trading_account || 'N/A'}`, 300, infoY + 25)
               .text(`Nilai: ${formatCurrency(contract.amount || 0)}`, 300, infoY + 40)
               .text(`Status: ${contract.status || 'N/A'}`, 300, infoY + 55)
               .text(`Tanggal: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, 60, infoY + 70);
            
            doc.y = infoY + 110;
            doc.moveDown(1);

            // Contract content processing
            console.log('📋 Processing contract content...');
            
            let content = contract.content || '';
            
            if (!content.trim()) {
                content = getDefaultContractTemplate();
            }
            
            // Replace variables
            const replacements = {
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
                    '[Tanggal TTD]',
                '{{DURATION_DAYS}}': '30',
                '{{MIN_TRANSACTIONS}}': '10'
            };

            // Replace system variables
            Object.keys(replacements).forEach(key => {
                try {
                    const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                    content = content.replace(regex, replacements[key]);
                } catch (error) {
                    console.warn('⚠️ Error replacing variable:', key);
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

            // Process content line by line
            const lines = content.split('\n');
            let lineCount = 0;
            
            for (const line of lines) {
                try {
                    lineCount++;
                    const trimmedLine = line.trim();
                    
                    if (lineCount > 500) {
                        doc.fontSize(10)
                           .text('... [Konten dipotong untuk mencegah error] ...', { align: 'center' });
                        break;
                    }
                    
                    if (doc.y > 750) {
                        doc.addPage();
                    }
                    
                    if (!trimmedLine) {
                        doc.moveDown(0.3);
                        continue;
                    }
                    
                    if (trimmedLine.startsWith('# ')) {
                        doc.fontSize(12)
                           .font('Helvetica-Bold')
                           .text(trimmedLine.substring(2), { align: 'center' });
                        doc.moveDown(0.5);
                    } else if (trimmedLine.startsWith('## ')) {
                        doc.fontSize(11)
                           .font('Helvetica-Bold')
                           .fillColor('#0066CC')
                           .text(trimmedLine.substring(3));
                        doc.fillColor('black');
                        doc.moveDown(0.3);
                    } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                        const text = trimmedLine.replace(/\*\*/g, '');
                        doc.fontSize(9)
                           .font('Helvetica-Bold')
                           .text(text);
                        doc.moveDown(0.2);
                    } else if (trimmedLine === '---') {
                        doc.moveDown(0.3);
                        doc.moveTo(50, doc.y)
                           .lineTo(550, doc.y)
                           .stroke();
                        doc.moveDown(0.3);
                    } else {
                        const processedLine = trimmedLine.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(9)
                           .font('Helvetica')
                           .text(processedLine, {
                               align: 'justify',
                               lineGap: 2
                           });
                        doc.moveDown(0.2);
                    }
                } catch (lineError) {
                    console.warn(`⚠️ Error processing line ${lineCount}:`, lineError.message);
                }
            }

            // Signature section
            doc.addPage();
            
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .text('HALAMAN PENANDATANGANAN', { align: 'center' });
            
            doc.moveDown(2);
            
            if (signatureData && contract.signed_at) {
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .fillColor('#008000')
                   .text('✓ KONTRAK TELAH DITANDATANGANI', { align: 'center' });
                
                doc.fillColor('black');
                doc.moveDown(2);
                
                const signY = doc.y;
                
                doc.fontSize(10)
                   .font('Helvetica-Bold')
                   .text('Perwakilan Pihak B:', 80, signY);
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .text('Prof. Bima Agung Rachel', 80, signY + 60);
                
                doc.fontSize(10)
                   .font('Helvetica-Bold')
                   .text('Pihak A:', 350, signY);
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .text(`${user.name}`, 350, signY + 60);
                
                doc.moveDown(6);
                doc.fontSize(9)
                   .text(`Ditandatangani pada: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, 
                         { align: 'center' });
                
                if (contract.ip_signed) {
                    doc.fontSize(8)
                       .text(`IP Address: ${contract.ip_signed}`, { align: 'center' });
                }
                
            } else {
                doc.fontSize(12)
                   .fillColor('#FF6600')
                   .text('⏳ MENUNGGU TANDA TANGAN', { align: 'center' });
                doc.fillColor('black');
            }

            // Footer
            const pageCount = doc.bufferedPageRange().count;
            for (let i = 0; i < pageCount; i++) {
                doc.switchToPage(i);
                doc.fontSize(8)
                   .font('Helvetica')
                   .text(`Halaman ${i + 1} dari ${pageCount} - Dokumen dibuat otomatis oleh TradeStation pada ${new Date().toLocaleString('id-ID')}`,
                         50, 780, { align: 'center' });
            }

            console.log('🔚 Finalizing PDF...');
            doc.end();

        } catch (error) {
            console.error('❌ Error in PDF generation:', error);
            reject(new Error(`PDF generation failed: ${error.message}`));
        }
    });
}

// =====================
// ENHANCED SECURITY & MIDDLEWARE
// =====================

// Security headers with relaxed CSP for development
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https:", "http:"],
        },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// =====================
// COMPREHENSIVE CORS CONFIGURATION
// =====================

// Primary CORS Configuration
app.use(cors({
    origin: function (origin, callback) {
        console.log('🌐 Request origin:', origin);
        
        // Allow requests with no origin (mobile apps, postman, etc)
        if (!origin) {
            console.log('✅ No origin - allowing');
            return callback(null, true);
        }
        
        if (allowedOrigins.includes(origin)) {
            console.log('✅ Origin allowed:', origin);
            return callback(null, true);
        }
        
        // For development: Allow all localhost/127.0.0.1 origins
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            console.log('✅ Development origin allowed:', origin);
            return callback(null, true);
        }
        
        console.log('⚠️ Origin not in allowlist but allowing for development:', origin);
        return callback(null, true); // Allow all for now
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With', 
        'Accept',
        'Origin',
        'Cache-Control',
        'X-File-Name',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Methods'
    ],
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 200 // For legacy browser support
}));

// Manual CORS headers for all responses
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    console.log(`🌐 ${req.method} ${req.path} from origin: ${origin || 'no-origin'}`);
    
    // Always set CORS headers
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        console.log('✅ Handling OPTIONS preflight for:', req.path);
        return res.status(200).end();
    }
    
    next();
});

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Enhanced rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Increased limit for development
    message: {
        error: 'Terlalu banyak permintaan dari IP ini, coba lagi nanti.',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/api/health';
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Increased auth attempts for development
    skipSuccessfulRequests: true,
    message: {
        error: 'Terlalu banyak percobaan login, coba lagi dalam 15 menit.',
        code: 'AUTH_RATE_LIMIT'
    }
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Body parsing with size limits
app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const ip = req.ip || req.connection.remoteAddress;
    console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - Origin: ${req.headers.origin || 'none'}`);
    next();
});

// =====================
// DATABASE CONNECTION
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Menghubungkan ke MongoDB Atlas...');
        
        mongoose.set('strictQuery', false);

        await mongoose.connect(MONGODB_URI, mongoOptions);
        
        mongoose.connection.on('connected', () => {
            console.log('✅ MongoDB Atlas terhubung dengan sukses!');
            dbConnected = true;
        });
        
        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
            dbConnected = false;
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB terputus');
            dbConnected = false;
        });
        
        await setupInitialData();
        
    } catch (error) {
        console.error('❌ Error koneksi MongoDB:', error);
        dbConnected = false;
        console.log('⚠️ Melanjutkan startup server...');
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
                name: 'Admin TradeStation',
                email: 'admin@tradestation.com',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                trading_account: 'ADM001',
                phone: '+6281234567890',
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
                phone: '+6281288889999',
                balance: 50000000,
                email_verified: true
            });
            console.log('✅ User contoh telah dibuat');
        }
        
        // Create default template
        const templateExists = await Template.findOne({ name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi',
                    category: 'investment',
                    description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia',
                    content: getDefaultContractTemplate(),
                    variables: [
                        'USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'USER_ADDRESS', 'TRADING_ID', 
                        'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'CONSULTATION_FEE', 
                        'CONTRACT_PERIOD', 'DURATION_DAYS', 'MIN_TRANSACTIONS', 
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
// ROUTES
// =====================

// Enhanced health check with comprehensive CORS debugging
app.get('/api/health', async (req, res) => {
    console.log('🏥 Health check request from:', req.headers.origin || 'no-origin');
    console.log('🏥 Request headers:', JSON.stringify({
        origin: req.headers.origin,
        'user-agent': req.headers['user-agent'],
        'accept': req.headers.accept,
        'access-control-request-method': req.headers['access-control-request-method'],
        'access-control-request-headers': req.headers['access-control-request-headers']
    }, null, 2));
    
    try {
        let dbStatus = 'disconnected';
        let dbDetails = {};
        
        if (dbConnected) {
            try {
                await mongoose.connection.db.admin().ping();
                dbStatus = 'connected';
                dbDetails = {
                    readyState: mongoose.connection.readyState,
                    host: mongoose.connection.host,
                    name: mongoose.connection.name
                };
            } catch (dbError) {
                console.error('Database ping failed:', dbError);
                dbStatus = 'error';
            }
        }
        
        const memoryUsage = process.memoryUsage();
        
        const healthData = {
            status: 'sehat',
            timestamp: new Date().toISOString(),
            database: dbStatus,
            environment: process.env.NODE_ENV || 'development',
            mongodb: 'MongoDB Atlas',
            uptime: Math.floor(process.uptime()),
            version: '2.3.1',
            cors_origin: req.headers.origin,
            allowed_origins: allowedOrigins,
            node_version: process.version,
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
            },
            database_details: dbDetails,
            cors_headers_set: {
                'access-control-allow-origin': res.get('Access-Control-Allow-Origin'),
                'access-control-allow-credentials': res.get('Access-Control-Allow-Credentials'),
                'access-control-allow-methods': res.get('Access-Control-Allow-Methods')
            }
        };
        
        console.log('✅ Health check response being sent');
        console.log('🔧 Response headers will be:', {
            'Access-Control-Allow-Origin': res.get('Access-Control-Allow-Origin'),
            'Access-Control-Allow-Credentials': res.get('Access-Control-Allow-Credentials')
        });
        
        res.status(200).json(healthData);
        
    } catch (error) {
        console.error('❌ Health check error:', error);
        
        const errorData = {
            status: 'tidak sehat',
            timestamp: new Date().toISOString(),
            database: 'error',
            error: error.message,
            uptime: Math.floor(process.uptime()),
            cors_origin: req.headers.origin,
            version: '2.3.1'
        };
        
        res.status(503).json(errorData);
    }
});

// =====================
// AUTH ROUTES
// =====================

app.post('/api/auth/login', async (req, res) => {
    try {
        console.log('🔐 Login attempt:', { email: req.body.email, ip: req.ip });
        
        const { email, password } = req.body;

        // Input validation
        const validationErrors = validateInput({ email, password }, {
            email: { required: true, type: 'email' },
            password: { required: true, minLength: 1 }
        });

        if (validationErrors) {
            console.log('❌ Login validation failed:', validationErrors);
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        const user = await User.findOne({
            $or: [
                { email: email.toLowerCase() }, 
                { username: email.toLowerCase() }
            ],
            is_active: true
        });

        if (!user) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ 
                error: 'Email atau password salah',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Check if account is locked
        if (user.locked_until && user.locked_until > new Date()) {
            const remainingTime = Math.ceil((user.locked_until - new Date()) / 1000 / 60);
            console.log('❌ Account locked:', user.email, 'remaining:', remainingTime, 'minutes');
            return res.status(423).json({ 
                error: `Akun terkunci. Coba lagi dalam ${remainingTime} menit.`,
                code: 'ACCOUNT_LOCKED'
            });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log('❌ Invalid password for:', user.email);
            
            // Increment failed login attempts
            user.login_attempts = (user.login_attempts || 0) + 1;
            
            if (user.login_attempts >= 5) {
                user.locked_until = new Date(Date.now() + 15 * 60 * 1000); // Lock for 15 minutes
                console.log('🔒 Account locked due to multiple failed attempts:', user.email);
            }
            
            await user.save();
            
            return res.status(401).json({ 
                error: 'Email atau password salah',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Reset login attempts on successful login
        await User.findByIdAndUpdate(user._id, {
            last_login: new Date(),
            login_attempts: 0,
            $unset: { locked_until: 1 }
        });

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
        delete userResponse.login_attempts;
        delete userResponse.locked_until;

        console.log('✅ Login successful:', user.email, 'role:', user.role);

        res.json({
            message: 'Login berhasil',
            token,
            user: {
                ...userResponse,
                tradingAccount: user.trading_account
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ 
            error: 'Login gagal',
            code: 'INTERNAL_ERROR'
        });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const userResponse = req.user.toObject();
        delete userResponse.password;
        delete userResponse.login_attempts;
        delete userResponse.locked_until;
        
        res.json({
            user: {
                ...userResponse,
                tradingAccount: req.user.trading_account
            }
        });
    } catch (error) {
        console.error('Error mendapatkan info user:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan info user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// BULK OPERATIONS & ADMIN ROUTES (YANG TERLEWAT)
// =====================

// BULK delete users
app.delete('/api/users/bulk', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { userIds } = req.body;
        
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ 
                error: 'User IDs harus diisi',
                code: 'USER_IDS_REQUIRED'
            });
        }

        // Validate all IDs
        const invalidIds = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({ 
                error: 'Beberapa ID user tidak valid',
                code: 'INVALID_USER_IDS',
                invalidIds
            });
        }

        // Prevent deleting self
        if (userIds.includes(req.user._id.toString())) {
            return res.status(400).json({ 
                error: 'Tidak dapat menghapus akun sendiri',
                code: 'CANNOT_DELETE_SELF'
            });
        }

        const result = await User.deleteMany({ 
            _id: { $in: userIds },
            _id: { $ne: req.user._id } // Extra safety
        });

        console.log('🗑️ Bulk user deletion:', result.deletedCount, 'users deleted by admin:', req.user.name);

        res.json({
            message: `${result.deletedCount} user berhasil dihapus`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error bulk deleting users:', error);
        res.status(500).json({ 
            error: 'Gagal menghapus users',
            code: 'INTERNAL_ERROR'
        });
    }
});

// TOGGLE user status (activate/deactivate)
app.patch('/api/users/:id/toggle-status', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID user tidak valid',
                code: 'INVALID_USER_ID'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        // Prevent admin from deactivating themselves
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ 
                error: 'Tidak dapat menonaktifkan akun sendiri',
                code: 'CANNOT_DEACTIVATE_SELF'
            });
        }

        const newStatus = !user.is_active;
        await User.findByIdAndUpdate(id, { is_active: newStatus });

        console.log('🔄 User status toggled:', user.name, 'to:', newStatus ? 'active' : 'inactive', 'by admin:', req.user.name);

        res.json({
            message: `User berhasil ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}`,
            isActive: newStatus
        });
    } catch (error) {
        console.error('Error toggling user status:', error);
        res.status(500).json({ 
            error: 'Gagal mengubah status user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// SEARCH & FILTER ENDPOINTS
// =====================

// Advanced search for contracts
app.get('/api/contracts/search', authenticateToken, checkDatabaseConnection, async (req, res) => {
    try {
        const { 
            q, 
            status, 
            dateFrom, 
            dateTo, 
            minAmount, 
            maxAmount, 
            userId,
            templateId,
            page = 1, 
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        let query = {};
        
        // Role-based filtering
        if (req.user.role !== 'admin') {
            query.user_id = req.user._id;
        } else {
            if (userId) query.user_id = userId;
        }

        // Text search
        if (q) {
            query.$or = [
                { title: { $regex: q, $options: 'i' } },
                { number: { $regex: q, $options: 'i' } },
                { admin_notes: { $regex: q, $options: 'i' } }
            ];
        }

        // Status filter
        if (status) {
            if (Array.isArray(status)) {
                query.status = { $in: status };
            } else {
                query.status = status;
            }
        }

        // Date range filter
        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        // Amount range filter
        if (minAmount || maxAmount) {
            query.amount = {};
            if (minAmount) query.amount.$gte = parseFloat(minAmount);
            if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
        }

        // Template filter
        if (templateId) query.template_id = templateId;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortDirection = sortOrder === 'desc' ? -1 : 1;

        const [contracts, total] = await Promise.all([
            Contract.find(query)
                .populate('user_id', 'name email phone trading_account')
                .populate('template_id', 'name')
                .populate('created_by', 'name')
                .sort({ [sortBy]: sortDirection })
                .skip(skip)
                .limit(parseInt(limit)),
            Contract.countDocuments(query)
        ]);

        const formattedContracts = contracts.map(contract => ({
            ...contract.toObject(),
            user_name: contract.user_id?.name,
            user_email: contract.user_id?.email,
            trading_account: contract.user_id?.trading_account,
            template_name: contract.template_id?.name,
            created_by_name: contract.created_by?.name,
            formatted_amount: formatCurrency(contract.amount),
            can_download: ['signed', 'completed'].includes(contract.status)
        }));

        res.json({
            data: formattedContracts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            },
            filters: {
                q, status, dateFrom, dateTo, minAmount, maxAmount, userId, templateId
            }
        });
    } catch (error) {
        console.error('Error searching contracts:', error);
        res.status(500).json({ 
            error: 'Gagal mencari kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// REPORTING ENDPOINTS
// =====================

// Detailed analytics
app.get('/api/reports/analytics', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        
        let dateRange = {};
        const now = new Date();
        
        switch (period) {
            case '7d':
                dateRange = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };
                break;
            case '30d':
                dateRange = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
                break;
            case '90d':
                dateRange = { $gte: new Date(now - 90 * 24 * 60 * 60 * 1000) };
                break;
            case '1y':
                dateRange = { $gte: new Date(now - 365 * 24 * 60 * 60 * 1000) };
                break;
            default:
                dateRange = { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
        }

        const [
            contractStats,
            statusDistribution,
            dailySignings,
            topTemplates,
            userActivity,
            amountDistribution
        ] = await Promise.all([
            // Basic contract statistics
            Contract.aggregate([
                { $match: { createdAt: dateRange } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        avgAmount: { $avg: '$amount' },
                        signed: {
                            $sum: { $cond: [{ $in: ['$status', ['signed', 'completed']] }, 1, 0] }
                        }
                    }
                }
            ]),
            
            // Status distribution
            Contract.aggregate([
                { $match: { createdAt: dateRange } },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]),
            
            // Daily signing trend
            Contract.aggregate([
                { $match: { signed_at: dateRange } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$signed_at' } },
                        count: { $sum: 1 },
                        amount: { $sum: '$amount' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            
            // Top performing templates
            Contract.aggregate([
                { $match: { createdAt: dateRange, template_id: { $exists: true } } },
                {
                    $group: {
                        _id: '$template_id',
                        count: { $sum: 1 },
                        signedCount: {
                            $sum: { $cond: [{ $in: ['$status', ['signed', 'completed']] }, 1, 0] }
                        },
                        totalAmount: { $sum: '$amount' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'templates',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'template'
                    }
                }
            ]),
            
            // User activity
            Contract.aggregate([
                { $match: { createdAt: dateRange } },
                {
                    $group: {
                        _id: '$user_id',
                        contractCount: { $sum: 1 },
                        signedCount: {
                            $sum: { $cond: [{ $in: ['$status', ['signed', 'completed']] }, 1, 0] }
                        },
                        totalAmount: { $sum: '$amount' }
                    }
                },
                { $sort: { contractCount: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                }
            ]),
            
            // Amount distribution
            Contract.aggregate([
                { $match: { createdAt: dateRange } },
                {
                    $bucket: {
                        groupBy: '$amount',
                        boundaries: [0, 1000000, 5000000, 10000000, 50000000, 100000000, Infinity],
                        default: 'Other',
                        output: { count: { $sum: 1 } }
                    }
                }
            ])
        ]);

        res.json({
            data: {
                period,
                summary: contractStats[0] || {
                    total: 0,
                    totalAmount: 0,
                    avgAmount: 0,
                    signed: 0
                },
                statusDistribution: statusDistribution.reduce((acc, item) => {
                    acc[item._id] = { count: item.count, totalAmount: item.totalAmount };
                    return acc;
                }, {}),
                dailyTrend: dailySignings,
                topTemplates: topTemplates.map(item => ({
                    templateId: item._id,
                    templateName: item.template[0]?.name || 'Unknown',
                    count: item.count,
                    signedCount: item.signedCount,
                    conversionRate: item.count > 0 ? Math.round((item.signedCount / item.count) * 100) : 0,
                    totalAmount: item.totalAmount
                })),
                topUsers: userActivity.map(item => ({
                    userId: item._id,
                    userName: item.user[0]?.name || 'Unknown',
                    userEmail: item.user[0]?.email || 'Unknown',
                    contractCount: item.contractCount,
                    signedCount: item.signedCount,
                    conversionRate: item.contractCount > 0 ? Math.round((item.signedCount / item.contractCount) * 100) : 0,
                    totalAmount: item.totalAmount
                })),
                amountDistribution
            }
        });
    } catch (error) {
        console.error('Error getting analytics:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan analytics',
            code: 'INTERNAL_ERROR'
        });
    }
});

// Export contracts to CSV
app.get('/api/contracts/export', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { format = 'csv', status, dateFrom, dateTo } = req.query;
        
        let query = {};
        if (status) query.status = status;
        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        const contracts = await Contract.find(query)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });

        if (format === 'csv') {
            const csvData = contracts.map(contract => [
                contract.number,
                contract.title,
                contract.user_id?.name || '',
                contract.user_id?.email || '',
                contract.user_id?.trading_account || '',
                contract.amount || 0,
                contract.status,
                new Date(contract.createdAt).toISOString(),
                contract.signed_at ? new Date(contract.signed_at).toISOString() : '',
                contract.template_id?.name || '',
                contract.created_by?.name || ''
            ]);

            const headers = [
                'Nomor Kontrak',
                'Judul',
                'Nama Klien',
                'Email Klien',
                'Trading ID',
                'Nilai',
                'Status',
                'Tanggal Dibuat',
                'Tanggal Ditandatangani',
                'Template',
                'Dibuat Oleh'
            ];

            const csv = [headers, ...csvData]
                .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
                .join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="contracts_export.csv"');
            res.send(csv);
        } else {
            // JSON export
            const jsonData = contracts.map(contract => ({
                number: contract.number,
                title: contract.title,
                client_name: contract.user_id?.name || '',
                client_email: contract.user_id?.email || '',
                trading_account: contract.user_id?.trading_account || '',
                amount: contract.amount || 0,
                status: contract.status,
                created_at: contract.createdAt,
                signed_at: contract.signed_at,
                template_name: contract.template_id?.name || '',
                created_by: contract.created_by?.name || '',
                variables: contract.variables
            }));

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="contracts_export.json"');
            res.json(jsonData);
        }

        console.log('📊 Data exported:', contracts.length, 'contracts in', format, 'format by admin:', req.user.name);
    } catch (error) {
        console.error('Error exporting contracts:', error);
        res.status(500).json({ 
            error: 'Gagal mengekspor data',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// SYSTEM SETTINGS & PREFERENCES
// =====================

// Get system settings
app.get('/api/settings', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const settings = {
            system: {
                version: '2.3.1',
                environment: process.env.NODE_ENV || 'development',
                uptime: Math.floor(process.uptime()),
                database_status: dbConnected ? 'connected' : 'disconnected'
            },
            features: {
                email_notifications: false,
                auto_reminder: false,
                pdf_generation: true,
                digital_signature: true,
                bulk_operations: true
            },
            limits: {
                max_contracts_per_user: 100,
                max_template_size: 50000,
                max_file_upload: 10485760, // 10MB
                session_timeout: 7 * 24 * 60 * 60 // 7 days
            },
            security: {
                require_email_verification: false,
                max_login_attempts: 5,
                lockout_duration: 15, // minutes
                password_min_length: 6
            }
        };

        res.json({ data: settings });
    } catch (error) {
        console.error('Error getting system settings:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan pengaturan sistem',
            code: 'INTERNAL_ERROR'
        });
    }
});

// GET single user
app.get('/api/users/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID user tidak valid',
                code: 'INVALID_USER_ID'
            });
        }

        const user = await User.findById(id)
            .select('-password -login_attempts -locked_until');

        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        // Get user statistics
        const contractCount = await Contract.countDocuments({ user_id: user._id });
        const signedCount = await Contract.countDocuments({ 
            user_id: user._id, 
            status: { $in: ['signed', 'completed'] } 
        });

        res.json({
            data: {
                ...user.toObject(),
                contract_count: contractCount,
                signed_count: signedCount,
                completion_rate: contractCount > 0 ? Math.round((signedCount / contractCount) * 100) : 0
            }
        });
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// UPDATE user endpoint
app.put('/api/users/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, tradingAccount, role, balance, isActive } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID user tidak valid',
                code: 'INVALID_USER_ID'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        // Prevent admin from changing their own role to user
        if (user._id.toString() === req.user._id.toString() && role === 'user') {
            return res.status(400).json({ 
                error: 'Tidak dapat mengubah role admin sendiri',
                code: 'CANNOT_CHANGE_OWN_ROLE'
            });
        }

        const validationErrors = validateInput(req.body, {
            name: { minLength: 2, maxLength: 100 },
            email: { type: 'email' },
            phone: { type: 'phone' }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        // Check if email already exists (if changing email)
        if (email && email !== user.email) {
            const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
            if (existingUser) {
                return res.status(400).json({ 
                    error: 'Email sudah digunakan',
                    code: 'EMAIL_EXISTS'
                });
            }
        }

        // Check if trading account already exists (if changing trading account)
        if (tradingAccount && tradingAccount !== user.trading_account) {
            const existingTradingAccount = await User.findOne({ trading_account: tradingAccount, _id: { $ne: id } });
            if (existingTradingAccount) {
                return res.status(400).json({ 
                    error: 'Trading account sudah digunakan',
                    code: 'TRADING_ACCOUNT_EXISTS'
                });
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (email !== undefined) updateData.email = email.toLowerCase().trim();
        if (phone !== undefined) updateData.phone = phone.trim();
        if (tradingAccount !== undefined) updateData.trading_account = tradingAccount.trim();
        if (role !== undefined && ['user', 'admin'].includes(role)) updateData.role = role;
        if (balance !== undefined) updateData.balance = parseFloat(balance);
        if (isActive !== undefined) updateData.is_active = Boolean(isActive);

        const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true })
            .select('-password -login_attempts -locked_until');

        console.log('👤 User updated:', updatedUser.name, updatedUser.email, 'by admin:', req.user.name);

        res.json({
            message: 'User berhasil diperbarui',
            data: updatedUser.toObject()
        });
    } catch (error) {
        console.error('Error updating user:', error);
        if (error.code === 11000) {
            return res.status(400).json({ 
                error: 'Data user sudah ada (email atau trading account duplikat)',
                code: 'DUPLICATE_USER'
            });
        }
        res.status(500).json({ 
            error: 'Gagal memperbarui user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// GET single template
app.get('/api/templates/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID template tidak valid',
                code: 'INVALID_TEMPLATE_ID'
            });
        }

        const template = await Template.findById(id)
            .populate('created_by', 'name');

        if (!template) {
            return res.status(404).json({ 
                error: 'Template tidak ditemukan',
                code: 'TEMPLATE_NOT_FOUND'
            });
        }

        res.json({
            data: {
                ...template.toObject(),
                id: template._id.toString(),
                created_by_name: template.created_by?.name,
                variable_count: template.variables ? template.variables.length : 0,
                content_length: template.content ? template.content.length : 0
            }
        });
    } catch (error) {
        console.error('Error getting template:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan template',
            code: 'INTERNAL_ERROR'
        });
    }
});

// UPDATE template endpoint
app.put('/api/templates/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, content, description } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID template tidak valid',
                code: 'INVALID_TEMPLATE_ID'
            });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ 
                error: 'Template tidak ditemukan',
                code: 'TEMPLATE_NOT_FOUND'
            });
        }

        const validationErrors = validateInput(req.body, {
            name: { maxLength: 200 },
            content: { maxLength: 50000 }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        // Extract variables from content
        const variableMatches = (content || template.content).match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (category !== undefined) updateData.category = category.trim();
        if (content !== undefined) updateData.content = content.trim();
        if (description !== undefined) updateData.description = description?.trim();
        updateData.variables = variables;
        updateData.version = template.version + 1;

        const updatedTemplate = await Template.findByIdAndUpdate(id, updateData, { new: true })
            .populate('created_by', 'name');

        console.log('📄 Template updated:', name || template.name, 'by admin:', req.user.name);

        res.json({
            message: 'Template berhasil diperbarui',
            data: {
                ...updatedTemplate.toObject(),
                id: updatedTemplate._id.toString(),
                created_by_name: updatedTemplate.created_by?.name,
                variable_count: updatedTemplate.variables ? updatedTemplate.variables.length : 0,
                content_length: updatedTemplate.content ? updatedTemplate.content.length : 0
            }
        });
    } catch (error) {
        console.error('Error updating template:', error);
        if (error.code === 11000) {
            return res.status(400).json({ 
                error: 'Template dengan nama tersebut sudah ada',
                code: 'DUPLICATE_TEMPLATE'
            });
        }
        res.status(500).json({ 
            error: 'Gagal memperbarui template',
            code: 'INTERNAL_ERROR'
        });
    }
});

// GET single contract
app.get('/api/contracts/:id', authenticateToken, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(id)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name');

        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        // Check access rights
        if (req.user.role !== 'admin' && contract.user_id._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                error: 'Akses ditolak',
                code: 'ACCESS_DENIED'
            });
        }

        res.json({
            data: {
                ...contract.toObject(),
                user_name: contract.user_id?.name,
                user_email: contract.user_id?.email,
                trading_account: contract.user_id?.trading_account,
                template_name: contract.template_id?.name,
                created_by_name: contract.created_by?.name,
                formatted_amount: formatCurrency(contract.amount),
                can_download: ['signed', 'completed'].includes(contract.status)
            }
        });
    } catch (error) {
        console.error('Error getting contract:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// UPDATE contract endpoint
app.put('/api/contracts/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, amount, status, variables, adminNotes, expiryDate } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        // Validation
        const validationErrors = validateInput(req.body, {
            title: { maxLength: 200 },
            amount: { min: 0 }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        // Update fields
        const updateData = {};
        if (title !== undefined) updateData.title = title.trim();
        if (amount !== undefined) updateData.amount = parseFloat(amount);
        if (status !== undefined) updateData.status = status;
        if (variables !== undefined) updateData.variables = variables;
        if (adminNotes !== undefined) updateData.admin_notes = adminNotes?.trim();
        if (expiryDate !== undefined) updateData.expiry_date = expiryDate ? new Date(expiryDate) : null;

        const updatedContract = await Contract.findByIdAndUpdate(id, updateData, { new: true })
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name');

        await logContractActivity(
            contract._id,
            'updated',
            `Kontrak diperbarui oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        console.log('📝 Contract updated:', contract.number, 'by admin:', req.user.name);

        res.json({
            message: 'Kontrak berhasil diperbarui',
            data: {
                ...updatedContract.toObject(),
                user_name: updatedContract.user_id?.name,
                user_email: updatedContract.user_id?.email,
                trading_account: updatedContract.user_id?.trading_account,
                template_name: updatedContract.template_id?.name,
                created_by_name: updatedContract.created_by?.name,
                formatted_amount: formatCurrency(updatedContract.amount),
                can_download: ['signed', 'completed'].includes(updatedContract.status)
            }
        });
    } catch (error) {
        console.error('Error updating contract:', error);
        res.status(500).json({ 
            error: 'Gagal memperbarui kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// SEND/RESEND contract
app.post('/api/contracts/:id/send', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(id).populate('user_id', 'name email');
        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        if (['signed', 'completed'].includes(contract.status)) {
            return res.status(400).json({ 
                error: 'Kontrak sudah ditandatangani',
                code: 'ALREADY_SIGNED'
            });
        }

        await Contract.findByIdAndUpdate(id, {
            status: 'sent',
            sent_at: new Date()
        });

        await logContractActivity(
            contract._id,
            'sent',
            `Kontrak dikirim ulang oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        console.log('📤 Contract sent:', contract.number, 'to:', contract.user_id.name);

        res.json({
            message: 'Kontrak berhasil dikirim',
            accessLink: `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${contract.access_token}`
        });
    } catch (error) {
        console.error('Error sending contract:', error);
        res.status(500).json({ 
            error: 'Gagal mengirim kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// CONTRACT ACCESS ROUTES
// =====================

app.get('/api/contracts/access/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 Contract access request for token:', token.substring(0, 8) + '...');

        if (!token || token.length < 32) {
            return res.status(400).json({ 
                error: 'Token akses tidak valid',
                code: 'INVALID_TOKEN'
            });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account is_active')
            .populate('template_id', 'name content variables');

        if (!contract || !contract.user_id || !contract.user_id.is_active) {
            console.log('❌ Contract not found or user inactive for token:', token.substring(0, 8) + '...');
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan atau akses ditolak',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        // Check expiry
        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            await logContractActivity(contract._id, 'expired', 'Kontrak kedaluwarsa karena tanggal habis', null, req);
            return res.status(410).json({ 
                error: 'Kontrak sudah kedaluwarsa',
                code: 'CONTRACT_EXPIRED'
            });
        }

        // Update status to viewed if first time
        if (contract.status === 'sent') {
            await Contract.findByIdAndUpdate(contract._id, { 
                status: 'viewed',
                viewed_at: new Date()
            });
            await logContractActivity(contract._id, 'viewed', 'Kontrak dilihat oleh klien', contract.user_id._id, req);
            console.log('✅ Contract status updated to viewed:', contract.number);
        }

        // Process content
        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        const replacements = {
            '{{USER_NAME}}': contract.user_id.name,
            '{{USER_EMAIL}}': contract.user_id.email || '',
            '{{USER_PHONE}}': contract.user_id.phone || '',
            '{{TRADING_ID}}': contract.user_id.trading_account || '',
            '{{CONTRACT_NUMBER}}': contract.number,
            '{{CONTRACT_DATE}}': new Date(contract.createdAt).toLocaleDateString('id-ID'),
            '{{AMOUNT}}': formatCurrency(contract.amount),
            '{{SIGNED_DATE}}': contract.signed_at ? new Date(contract.signed_at).toLocaleString('id-ID') : '',
            '{{DURATION_DAYS}}': '30',
            '{{MIN_TRANSACTIONS}}': '10'
        };

        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
            content = content.replace(regex, replacements[key]);
        });

        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(regex, variables[key] || `[${key} - Belum Diisi]`);
        });

        console.log('✅ Contract access successful:', contract.number, 'for user:', contract.user_id.name);

        res.json({
            data: {
                ...contract.toObject(),
                content,
                canSign: ['viewed', 'sent'].includes(contract.status),
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
        console.error('❌ Error accessing contract:', error);
        res.status(500).json({ 
            error: 'Gagal mengakses kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, variables, clientName, clientEmail } = req.body;
        
        console.log('✍️ Contract signing attempt for token:', token.substring(0, 8) + '...');

        // Validation
        if (!signatureData) {
            return res.status(400).json({ 
                error: 'Data tanda tangan diperlukan',
                code: 'SIGNATURE_REQUIRED'
            });
        }

        if (!signatureData.startsWith('data:image/')) {
            return res.status(400).json({ 
                error: 'Format tanda tangan tidak valid',
                code: 'INVALID_SIGNATURE_FORMAT'
            });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        if (['signed', 'completed'].includes(contract.status)) {
            return res.status(400).json({ 
                error: 'Kontrak sudah ditandatangani',
                code: 'ALREADY_SIGNED'
            });
        }

        if (!['sent', 'viewed'].includes(contract.status)) {
            return res.status(400).json({ 
                error: 'Kontrak belum siap untuk ditandatangani',
                code: 'NOT_READY_FOR_SIGNING'
            });
        }

        // Verify client identity
        if (clientName && clientName.toLowerCase() !== contract.user_id.name.toLowerCase()) {
            return res.status(400).json({ 
                error: 'Nama klien tidak cocok dengan kontrak',
                code: 'NAME_MISMATCH'
            });
        }

        if (clientEmail && clientEmail.toLowerCase() !== contract.user_id.email.toLowerCase()) {
            return res.status(400).json({ 
                error: 'Email klien tidak cocok dengan kontrak',
                code: 'EMAIL_MISMATCH'
            });
        }

        const finalVariables = variables ? { ...contract.variables, ...variables } : contract.variables;
        const signedAt = new Date();
        
        // Update contract
        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: signedAt,
            variables: finalVariables,
            ip_signed: req.ip,
            user_agent_signed: req.get('User-Agent')
        });

        // Update template usage count
        if (contract.template_id) {
            await Template.findByIdAndUpdate(contract.template_id, {
                $inc: { usage_count: 1 }
            });
        }

        await logContractActivity(
            contract._id, 
            'signed', 
            'Kontrak ditandatangani dengan tanda tangan digital', 
            contract.user_id._id, 
            req
        );

        console.log('✅ Contract signed successfully:', contract.number, 'by:', contract.user_id.name);

        res.json({ 
            message: 'Kontrak berhasil ditandatangani',
            data: {
                contractNumber: contract.number,
                signedAt: signedAt.toISOString(),
                status: 'signed',
                pdfDownloadUrl: `/api/contracts/download/${contract._id}`
            }
        });
    } catch (error) {
        console.error('❌ Error signing contract:', error);
        res.status(500).json({ 
            error: 'Gagal menandatangani kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// DOWNLOAD PDF ENDPOINT
// =====================

app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;
        
        console.log('📥 Download request for contract:', contractId);

        if (!contractId || !mongoose.Types.ObjectId.isValid(contractId)) {
            console.log('❌ Invalid contract ID:', contractId);
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account')
            .lean();

        if (!contract) {
            console.log('❌ Contract not found:', contractId);
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        if (!contract.user_id) {
            console.log('❌ Contract user not found:', contractId);
            return res.status(404).json({ 
                error: 'Data user kontrak tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        console.log('✅ Contract found:', {
            id: contractId,
            number: contract.number,
            status: contract.status,
            user: contract.user_id.name,
            amount: contract.amount
        });

        console.log('🔄 Starting PDF generation...');
        
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF generation timeout')), 45000)
        );
        
        const pdfPromise = generateContractPDF(contract, contract.user_id, contract.signature_data);
        
        const pdfBuffer = await Promise.race([pdfPromise, timeoutPromise]);

        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new Error('File PDF kosong atau tidak valid');
        }

        console.log('✅ PDF generated successfully, size:', pdfBuffer.length);

        // Log activity asynchronously
        logContractActivity(
            contract._id,
            'downloaded',
            'PDF kontrak diunduh',
            null,
            req
        ).catch(err => console.warn('⚠️ Failed to log activity:', err.message));

        const safeName = (contract.user_id.name || 'User')
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
        
        const filename = `Kontrak_${contract.number}_${safeName}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        console.log('📤 Sending PDF to client...');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Download error:', {
            contractId: req.params.contractId,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });

        if (res.headersSent) {
            return res.end();
        }

        res.status(500).json({ 
            error: 'Gagal mendownload kontrak',
            code: 'PDF_GENERATION_FAILED',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// =====================
// ADMIN ROUTES - CONTRACTS
// =====================

app.get('/api/contracts', authenticateToken, checkDatabaseConnection, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, user_id, search } = req.query;
        
        let query = {};
        if (req.user.role !== 'admin') {
            query.user_id = req.user._id;
        } else {
            if (status) query.status = status;
            if (user_id) query.user_id = user_id;
        }

        // Add search functionality
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { number: { $regex: search, $options: 'i' } }
            ];
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
            created_by_name: contract.created_by?.name,
            formatted_amount: formatCurrency(contract.amount),
            can_download: ['signed', 'completed'].includes(contract.status)
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
        res.status(500).json({ 
            error: 'Gagal mendapatkan kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

app.post('/api/contracts', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
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

        console.log('📝 Creating new contract by admin:', req.user.name);

        // Enhanced validation
        const validationErrors = validateInput(req.body, {
            title: { required: true, maxLength: 200 },
            templateId: { required: true },
            userId: { required: true },
            amount: { required: true, min: 0 }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        const template = await Template.findById(templateId);
        if (!template) {
            return res.status(404).json({ 
                error: 'Template tidak ditemukan',
                code: 'TEMPLATE_NOT_FOUND'
            });
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
            admin_notes: adminNotes?.trim(),
            content: template.content
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

        console.log('✅ Contract created successfully:', contractNumber, 'for user:', user.name);

        res.json({
            message: 'Kontrak berhasil dibuat',
            data: contract,
            accessLink: `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${accessToken}`
        });
    } catch (error) {
        console.error('❌ Error creating contract:', error);
        res.status(500).json({ 
            error: 'Gagal membuat kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// DELETE contract endpoint
app.delete('/api/contracts/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        // Log activity before deletion
        await logContractActivity(
            contract._id,
            'cancelled',
            `Kontrak dihapus oleh admin ${req.user.name}`,
            req.user._id,
            req
        );

        await Contract.findByIdAndDelete(id);

        console.log('🗑️ Contract deleted:', contract.number, 'by admin:', req.user.name);

        res.json({
            message: 'Kontrak berhasil dihapus'
        });
    } catch (error) {
        console.error('Error menghapus kontrak:', error);
        res.status(500).json({ 
            error: 'Gagal menghapus kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// TEMPLATE MANAGEMENT
// =====================

app.get('/api/templates', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { category, search, page = 1, limit = 50 } = req.query;
        let query = { is_active: true };
        
        if (category) query.category = category;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const templates = await Template.find(query)
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Template.countDocuments(query);
            
        const formattedTemplates = templates.map(template => ({
            ...template.toObject(),
            id: template._id.toString(),
            created_by_name: template.created_by?.name,
            variable_count: template.variables ? template.variables.length : 0,
            content_length: template.content ? template.content.length : 0
        }));
        
        res.json({ 
            data: formattedTemplates,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error mendapatkan template:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan template',
            code: 'INTERNAL_ERROR'
        });
    }
});

app.post('/api/templates', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        const validationErrors = validateInput(req.body, {
            name: { required: true, maxLength: 200 },
            content: { required: true, maxLength: 50000 }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }
        
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

        console.log('📄 Template created:', name, 'by admin:', req.user.name);
        
        res.json({
            message: 'Template berhasil dibuat',
            data: templateResponse
        });
    } catch (error) {
        console.error('Error membuat template:', error);
        if (error.code === 11000) {
            return res.status(400).json({ 
                error: 'Template dengan nama tersebut sudah ada',
                code: 'DUPLICATE_TEMPLATE'
            });
        }
        res.status(500).json({ 
            error: 'Gagal membuat template',
            code: 'INTERNAL_ERROR'
        });
    }
});

// DELETE template endpoint
app.delete('/api/templates/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID template tidak valid',
                code: 'INVALID_TEMPLATE_ID'
            });
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ 
                error: 'Template tidak ditemukan',
                code: 'TEMPLATE_NOT_FOUND'
            });
        }

        await Template.findByIdAndDelete(id);

        console.log('🗑️ Template deleted:', template.name, 'by admin:', req.user.name);

        res.json({
            message: 'Template berhasil dihapus'
        });
    } catch (error) {
        console.error('Error menghapus template:', error);
        res.status(500).json({ 
            error: 'Gagal menghapus template',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// USER MANAGEMENT
// =====================

app.get('/api/users', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
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
            .select('-password -login_attempts -locked_until')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const usersWithStats = await Promise.all(users.map(async (user) => {
            const contractCount = await Contract.countDocuments({ user_id: user._id });
            const signedCount = await Contract.countDocuments({ 
                user_id: user._id, 
                status: { $in: ['signed', 'completed'] } 
            });
            return {
                ...user.toObject(),
                contract_count: contractCount,
                signed_count: signedCount,
                completion_rate: contractCount > 0 ? Math.round((signedCount / contractCount) * 100) : 0
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
        res.status(500).json({ 
            error: 'Gagal mendapatkan user',
            code: 'INTERNAL_ERROR'
        });
    }
});

app.post('/api/users', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { name, email, phone, tradingAccount, role = 'user' } = req.body;

        const validationErrors = validateInput(req.body, {
            name: { required: true, minLength: 2, maxLength: 100 },
            email: { required: true, type: 'email' },
            phone: { required: true, type: 'phone' }
        });

        if (validationErrors) {
            return res.status(400).json({ 
                error: 'Data input tidak valid',
                details: validationErrors
            });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ 
                error: 'Email sudah digunakan',
                code: 'EMAIL_EXISTS'
            });
        }

        let finalTradingAccount = tradingAccount;
        if (!finalTradingAccount) {
            let isUnique = false;
            while (!isUnique) {
                finalTradingAccount = `TRD${Date.now().toString().slice(-6)}`;
                const existing = await User.findOne({ trading_account: finalTradingAccount });
                if (!existing) isUnique = true;
            }
        } else {
            // Check if trading account exists
            const existingTradingAccount = await User.findOne({ trading_account: finalTradingAccount });
            if (existingTradingAccount) {
                return res.status(400).json({ 
                    error: 'Trading account sudah digunakan',
                    code: 'TRADING_ACCOUNT_EXISTS'
                });
            }
        }

        const defaultPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);

        const user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            password: hashedPassword,
            role: ['user', 'admin'].includes(role) ? role : 'user',
            trading_account: finalTradingAccount,
            balance: 0,
            created_by: req.user._id,
            email_verified: false
        });

        const userResponse = user.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString();

        console.log('👤 User created:', name, email, 'by admin:', req.user.name);

        res.json({
            message: 'User berhasil dibuat',
            data: userResponse,
            defaultPassword,
            note: 'Silakan berikan password default kepada user dan minta mereka untuk mengubahnya'
        });
    } catch (error) {
        console.error('Error membuat user:', error);
        if (error.code === 11000) {
            return res.status(400).json({ 
                error: 'Data user sudah ada (email atau trading account duplikat)',
                code: 'DUPLICATE_USER'
            });
        }
        res.status(500).json({ 
            error: 'Gagal membuat user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// DELETE user endpoint
app.delete('/api/users/:id', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID user tidak valid',
                code: 'INVALID_USER_ID'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        // Prevent deleting own account
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ 
                error: 'Tidak dapat menghapus akun sendiri',
                code: 'CANNOT_DELETE_SELF'
            });
        }

        await User.findByIdAndDelete(id);

        console.log('🗑️ User deleted:', user.name, user.email, 'by admin:', req.user.name);

        res.json({
            message: 'User berhasil dihapus'
        });
    } catch (error) {
        console.error('Error menghapus user:', error);
        res.status(500).json({ 
            error: 'Gagal menghapus user',
            code: 'INTERNAL_ERROR'
        });
    }
});

// Reset password endpoint
app.post('/api/users/:id/reset-password', authenticateToken, authenticateAdmin, checkDatabaseConnection, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID user tidak valid',
                code: 'INVALID_USER_ID'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ 
                error: 'User tidak ditemukan',
                code: 'USER_NOT_FOUND'
            });
        }

        const newPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await User.findByIdAndUpdate(id, {
            password: hashedPassword,
            login_attempts: 0,
            $unset: { locked_until: 1 }
        });

        console.log('🔑 Password reset for user:', user.name, user.email, 'by admin:', req.user.name);

        res.json({
            message: 'Password berhasil direset',
            newPassword,
            note: 'Silakan berikan password baru kepada user'
        });
    } catch (error) {
        console.error('Error reset password:', error);
        res.status(500).json({ 
            error: 'Gagal reset password',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// DASHBOARD STATS
// =====================

app.get('/api/stats/dashboard', authenticateToken, checkDatabaseConnection, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const [
                totalContracts,
                pendingSignatures,
                completedContracts,
                totalValueResult,
                recentActivity,
                statusBreakdown,
                userStats,
                templateStats
            ] = await Promise.all([
                Contract.countDocuments(),
                Contract.countDocuments({ status: { $in: ['sent', 'viewed'] } }),
                Contract.countDocuments({ status: { $in: ['signed', 'completed'] } }),
                Contract.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
                Contract.find().sort({ createdAt: -1 }).limit(10)
                    .populate('user_id', 'name')
                    .select('title status createdAt user_id amount'),
                Contract.aggregate([
                    { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } }
                ]),
                User.aggregate([
                    { $group: { _id: '$role', count: { $sum: 1 } } }
                ]),
                Template.aggregate([
                    { $group: { _id: '$category', count: { $sum: 1 } } }
                ])
            ]);

            // Calculate growth metrics (simplified for now)
            const thisMonth = new Date();
            thisMonth.setDate(1);
            const lastMonth = new Date(thisMonth);
            lastMonth.setMonth(lastMonth.getMonth() - 1);

            const [thisMonthContracts, lastMonthContracts] = await Promise.all([
                Contract.countDocuments({ createdAt: { $gte: thisMonth } }),
                Contract.countDocuments({ 
                    createdAt: { $gte: lastMonth, $lt: thisMonth } 
                })
            ]);

            const growthRate = lastMonthContracts > 0 ? 
                Math.round(((thisMonthContracts - lastMonthContracts) / lastMonthContracts) * 100) : 0;

            res.json({
                data: {
                    totalContracts,
                    pendingSignatures,
                    completedContracts,
                    totalValue: totalValueResult[0]?.total || 0,
                    growthRate,
                    conversionRate: totalContracts > 0 ? 
                        Math.round((completedContracts / totalContracts) * 100) : 0,
                    recentActivity: recentActivity.map(contract => ({
                        title: contract.title,
                        status: contract.status,
                        user_name: contract.user_id?.name,
                        amount: contract.amount,
                        createdAt: contract.createdAt
                    })),
                    statusBreakdown: statusBreakdown.reduce((acc, item) => {
                        acc[item._id] = {
                            count: item.count,
                            totalAmount: item.totalAmount
                        };
                        return acc;
                    }, {}),
                    userStats: userStats.reduce((acc, item) => {
                        acc[item._id] = item.count;
                        return acc;
                    }, {}),
                    templateStats: templateStats.reduce((acc, item) => {
                        acc[item._id] = item.count;
                        return acc;
                    }, {})
                }
            });
        } else {
            // User dashboard stats
            const userId = req.user._id;
            const [
                totalContracts, 
                pendingSignatures, 
                completedContracts,
                totalValue,
                recentContracts
            ] = await Promise.all([
                Contract.countDocuments({ user_id: userId }),
                Contract.countDocuments({ user_id: userId, status: { $in: ['sent', 'viewed'] } }),
                Contract.countDocuments({ user_id: userId, status: { $in: ['signed', 'completed'] } }),
                Contract.aggregate([
                    { $match: { user_id: userId } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]),
                Contract.find({ user_id: userId })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .select('title status amount createdAt')
            ]);

            res.json({
                data: { 
                    totalContracts, 
                    pendingSignatures, 
                    completedContracts, 
                    totalValue: totalValue[0]?.total || 0,
                    completionRate: totalContracts > 0 ? 
                        Math.round((completedContracts / totalContracts) * 100) : 0,
                    recentContracts: recentContracts.map(contract => ({
                        title: contract.title,
                        status: contract.status,
                        amount: contract.amount,
                        createdAt: contract.createdAt
                    }))
                }
            });
        }
    } catch (error) {
        console.error('Error statistik dashboard:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan statistik dashboard',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// ADDITIONAL UTILITY ROUTES
// =====================

// Get contract history
app.get('/api/contracts/:id/history', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                error: 'ID kontrak tidak valid',
                code: 'INVALID_CONTRACT_ID'
            });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ 
                error: 'Kontrak tidak ditemukan',
                code: 'CONTRACT_NOT_FOUND'
            });
        }

        // Check access rights
        if (req.user.role !== 'admin' && contract.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                error: 'Akses ditolak',
                code: 'ACCESS_DENIED'
            });
        }

        const history = await ContractHistory.find({ contract_id: id })
            .populate('performed_by', 'name email')
            .sort({ createdAt: -1 });

        res.json({
            data: history.map(h => ({
                ...h.toObject(),
                performed_by_name: h.performed_by?.name
            }))
        });
    } catch (error) {
        console.error('Error mendapatkan history kontrak:', error);
        res.status(500).json({ 
            error: 'Gagal mendapatkan history kontrak',
            code: 'INTERNAL_ERROR'
        });
    }
});

// =====================
// ERROR HANDLING
// =====================

app.use((req, res) => {
    console.log('❌ 404 - Endpoint not found:', req.method, req.path, 'from origin:', req.headers.origin);
    res.status(404).json({ 
        error: 'Endpoint tidak ditemukan',
        code: 'ENDPOINT_NOT_FOUND',
        path: req.path,
        method: req.method 
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    
    // MongoDB errors
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Data tidak valid',
            code: 'VALIDATION_ERROR',
            details: Object.values(error.errors).map(e => e.message)
        });
    }
    
    if (error.code === 11000) {
        return res.status(400).json({
            error: 'Data duplikat',
            code: 'DUPLICATE_ERROR'
        });
    }
    
    res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && { 
            details: error.message,
            stack: error.stack 
        })
    });
});

// =====================
// GRACEFUL SHUTDOWN
// =====================

process.on('SIGTERM', async () => {
    console.log('SIGTERM diterima, mematikan server dengan aman');
    try {
        await mongoose.connection.close();
        console.log('Database connection closed');
    } catch (error) {
        console.error('Error closing database:', error);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT diterima, mematikan server dengan aman');  
    try {
        await mongoose.connection.close();
        console.log('Database connection closed');
    } catch (error) {
        console.error('Error closing database:', error);
    }
    process.exit(0);
});

// =====================
// START SERVER
// =====================

async function startServer() {
    try {
        console.log('🚀 TradeStation Digital Contract Server v2.3.1 Enhanced & Fixed');
        console.log('🔧 Environment:', process.env.NODE_ENV || 'development');
        console.log('🌐 CORS Origins:', allowedOrigins);
        
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`📱 Server berjalan di port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas ${dbConnected ? 'Terhubung ✅' : 'Terputus ❌'}`);
            console.log(`🔒 Security: Enhanced with Helmet & Rate Limiting`);
            console.log(`🌐 CORS: Configured for multiple origins with enhanced debugging`);
            console.log(`✅ Semua fitur berfungsi dengan baik!`);
            console.log(`📖 API Documentation: /api/health untuk status server`);
            console.log(`🎯 Ready to serve requests!`);
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} sudah digunakan`);
                console.log('💡 Coba port lain atau matikan aplikasi yang menggunakan port ini');
                process.exit(1);
            } else {
                console.error('❌ Error server:', error);
            }
        });

        // Handle server shutdown
        server.on('close', () => {
            console.log('🛑 Server ditutup');
        });

        // Set up graceful shutdown with timeout
        const gracefulShutdown = (signal) => {
            console.log(`🔄 ${signal} received, starting graceful shutdown...`);
            server.close(async () => {
                console.log('📡 HTTP server closed');
                try {
                    await mongoose.connection.close();
                    console.log('💾 Database connection closed');
                } catch (error) {
                    console.error('❌ Error closing database:', error);
                }
                process.exit(0);
            });
            
            // Force close after 30 seconds
            setTimeout(() => {
                console.error('⏰ Shutdown timeout, forcing exit');
                process.exit(1);
            }, 30000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error('❌ Gagal memulai server:', error);
        // Still try to start server even if DB connection fails
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server berjalan di port ${PORT} (koneksi DB mungkin gagal)`);
            console.log(`⚠️  Beberapa fitur mungkin tidak berfungsi tanpa database`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
        });
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

startServer();
