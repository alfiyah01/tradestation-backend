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
const FIXED_PASSWORD = 'kontrakdigital2025'; // Password tetap untuk semua user

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:8080',
    'https://kontrak-production.up.railway.app',
    'https://kontrakdigital.com',
    process.env.FRONTEND_URL
].filter(Boolean);

let dbConnected = false;

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
// PDF GENERATION
// =====================

async function generateContractPDF(contract) {
    return new Promise((resolve, reject) => {
        try {
            console.log('📄 Generating PDF for contract:', contract.number);
            
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4',
                info: {
                    Title: `Kontrak ${contract.number}`,
                    Author: 'TradeStation Digital',
                    Subject: contract.title
                }
            });
            
            const buffers = [];
            
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                console.log('✅ PDF generated, size:', pdfData.length);
                resolve(pdfData);
            });
            doc.on('error', reject);

            // Header
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .fillColor('#0066CC')
               .text('TradeStation Digital', { align: 'center' });
            
            doc.fontSize(14)
               .fillColor('black')
               .text('Sistem Kontrak Digital', { align: 'center' });
            
            doc.moveDown(2);
            
            // Contract Info Box
            const infoY = doc.y;
            doc.rect(50, infoY, 500, 120).stroke();
            
            doc.fontSize(12)
               .font('Helvetica-Bold')
               .text('INFORMASI KONTRAK', 60, infoY + 10);
            
            doc.fontSize(10)
               .font('Helvetica')
               .text(`Nomor: ${contract.number}`, 60, infoY + 30)
               .text(`Judul: ${contract.title}`, 60, infoY + 45)
               .text(`Klien: ${contract.client_name}`, 60, infoY + 60)
               .text(`Email: ${contract.client_email}`, 60, infoY + 75)
               .text(`Nilai: ${formatCurrency(contract.amount)}`, 300, infoY + 30)
               .text(`Status: ${contract.status.toUpperCase()}`, 300, infoY + 45)
               .text(`Dibuat: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, 300, infoY + 60);
            
            if (contract.signed_at) {
                doc.text(`Ditandatangani: ${new Date(contract.signed_at).toLocaleDateString('id-ID')}`, 300, infoY + 75);
            }
            
            doc.y = infoY + 130;
            doc.moveDown(1);

            // Process content
            let content = contract.content || getDefaultContractTemplate();
            
            // Replace variables
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

            // Replace variables
            Object.keys(replacements).forEach(key => {
                const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
                content = content.replace(regex, replacements[key]);
            });

            // Process content line by line
            const lines = content.split('\n');
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                if (doc.y > 750) {
                    doc.addPage();
                }
                
                if (!trimmedLine) {
                    doc.moveDown(0.3);
                    continue;
                }
                
                if (trimmedLine.startsWith('# ')) {
                    doc.fontSize(14)
                       .font('Helvetica-Bold')
                       .text(trimmedLine.substring(2), { align: 'center' });
                    doc.moveDown(0.5);
                } else if (trimmedLine.startsWith('## ')) {
                    doc.fontSize(12)
                       .font('Helvetica-Bold')
                       .fillColor('#0066CC')
                       .text(trimmedLine.substring(3));
                    doc.fillColor('black');
                    doc.moveDown(0.3);
                } else if (trimmedLine.startsWith('### ')) {
                    doc.fontSize(11)
                       .font('Helvetica-Bold')
                       .text(trimmedLine.substring(4));
                    doc.moveDown(0.3);
                } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                    const text = trimmedLine.replace(/\*\*/g, '');
                    doc.fontSize(10)
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
                    doc.fontSize(10)
                       .font('Helvetica')
                       .text(trimmedLine, { align: 'justify' });
                    doc.moveDown(0.2);
                }
            }

            // Signature section
            if (contract.signature_data && contract.signed_at) {
                doc.addPage();
                
                doc.fontSize(16)
                   .font('Helvetica-Bold')
                   .fillColor('#008000')
                   .text('✓ KONTRAK TELAH DITANDATANGANI', { align: 'center' });
                
                doc.fillColor('black');
                doc.moveDown(2);
                
                doc.fontSize(12)
                   .text(`Ditandatangani oleh: ${contract.client_name}`, { align: 'center' });
                doc.text(`Pada tanggal: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, { align: 'center' });
                
                doc.moveDown(2);
                doc.text('Tanda Tangan Digital Tersimpan dalam Sistem', { align: 'center' });
            }

            // Footer
            const totalPages = doc.bufferedPageRange().count;
            for (let i = 0; i < totalPages; i++) {
                doc.switchToPage(i);
                doc.fontSize(8)
                   .text(`Halaman ${i + 1} dari ${totalPages} - TradeStation Digital - ${new Date().toLocaleString('id-ID')}`,
                         50, 780, { align: 'center' });
            }

            doc.end();

        } catch (error) {
            console.error('❌ PDF generation error:', error);
            reject(error);
        }
    });
}

// =====================
// MIDDLEWARE
// =====================

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || 
            (origin && (origin.includes('localhost') || origin.includes('127.0.0.1')))) {
            return callback(null, true);
        }
        return callback(null, true); // Allow all for development
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Terlalu banyak permintaan, coba lagi nanti.' }
});
app.use('/api/', limiter);

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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'connected' : 'disconnected',
        version: '3.0.0'
    });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email dan password harus diisi' });
        }

        const admin = await Admin.findOne({ email: email.toLowerCase() });
        if (!admin) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }

        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }

        const token = jwt.sign({ adminId: admin._id }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            message: 'Login berhasil',
            token,
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Login gagal' });
    }
});

// User login dengan nomor kontrak
app.post('/api/user/login', async (req, res) => {
    try {
        const { contractNumber, password } = req.body;

        if (!contractNumber || !password) {
            return res.status(400).json({ error: 'Nomor kontrak dan password harus diisi' });
        }

        // Check password
        if (password !== FIXED_PASSWORD) {
            return res.status(401).json({ error: 'Password salah' });
        }

        // Find contract
        const contract = await Contract.findOne({ number: contractNumber });
        if (!contract) {
            return res.status(404).json({ error: 'Nomor kontrak tidak ditemukan' });
        }

        if (contract.status !== 'active') {
            return res.status(400).json({ error: 'Kontrak tidak aktif' });
        }

        const token = jwt.sign({ 
            contractId: contract._id,
            contractNumber: contract.number 
        }, JWT_SECRET, { expiresIn: '24h' });

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
        console.error('User login error:', error);
        res.status(500).json({ error: 'Login gagal' });
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

        // Process content
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
        console.error('Get contract error:', error);
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

        // Update contract
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
        console.error('Sign contract error:', error);
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

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (!contract.signature_data) {
            return res.status(400).json({ error: 'Kontrak belum ditandatangani' });
        }

        console.log('📥 Generating PDF for download:', contract.number);
        
        const pdfBuffer = await generateContractPDF(contract);
        const filename = `Kontrak_${contract.number}_${contract.client_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Gagal mengunduh kontrak' });
    }
});

// Admin routes
app.get('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        
        let query = {};
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { number: { $regex: search, $options: 'i' } },
                { client_name: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const contracts = await Contract.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Contract.countDocuments(query);
        
        res.json({
            data: contracts.map(contract => ({
                ...contract.toObject(),
                formatted_amount: formatCurrency(contract.amount),
                can_download: contract.signature_data ? true : false
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get contracts error:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
    }
});

app.post('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const { 
            title, 
            client_name, 
            client_email, 
            client_phone, 
            client_address, 
            amount, 
            content,
            admin_notes 
        } = req.body;

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
                password: FIXED_PASSWORD,
                loginUrl: `${req.protocol}://${req.get('host')}/user-login`
            }
        });
    } catch (error) {
        console.error('Create contract error:', error);
        res.status(500).json({ error: 'Gagal membuat kontrak' });
    }
});

// Activate contract (send to user)
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
                password: FIXED_PASSWORD,
                loginUrl: `${req.protocol}://${req.get('host')}/user-login`
            }
        });
    } catch (error) {
        console.error('Activate contract error:', error);
        res.status(500).json({ error: 'Gagal mengaktifkan kontrak' });
    }
});

// Download PDF for admin
app.get('/api/admin/contracts/:id/download', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        console.log('📥 Admin downloading PDF:', contract.number);
        
        const pdfBuffer = await generateContractPDF(contract);
        const filename = `Kontrak_${contract.number}_${contract.client_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Admin download error:', error);
        res.status(500).json({ error: 'Gagal mengunduh kontrak' });
    }
});

// Delete contract
app.delete('/api/admin/contracts/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        const contract = await Contract.findByIdAndDelete(id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        console.log('🗑️ Contract deleted:', contract.number);
        res.json({ message: 'Kontrak berhasil dihapus' });
    } catch (error) {
        console.error('Delete contract error:', error);
        res.status(500).json({ error: 'Gagal menghapus kontrak' });
    }
});

// Dashboard stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const [
            totalContracts,
            draftContracts,
            activeContracts,
            signedContracts,
            totalValue
        ] = await Promise.all([
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
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Gagal mendapatkan statistik' });
    }
});

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// =====================
// START SERVER
// =====================

async function startServer() {
    try {
        await connectDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Kontrak Digital v3.0`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
            console.log(`👤 Admin: http://localhost:${PORT}/admin`);
            console.log(`📝 User: http://localhost:${PORT}/user-login`);
            console.log(`💾 Database: ${dbConnected ? 'Connected ✅' : 'Disconnected ❌'}`);
            console.log(`✅ Ready to serve!`);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
