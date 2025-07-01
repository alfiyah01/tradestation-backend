// Minimal Working Server - v3.3.0
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database config
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';
const FIXED_PASSWORD = process.env.FIXED_PASSWORD || 'kontrakdigital2025';

let dbConnected = false;

// CORS - Universal Allow
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} from: ${req.headers.origin || 'direct'}`);
    
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).json({ message: 'CORS OK' });
    }
    next();
});

// Backup CORS
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['*']
}));

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Database Schemas
const adminSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'admin' }
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    title: String,
    number: { type: String, unique: true },
    client_name: String,
    client_email: String,
    client_phone: String,
    client_address: String,
    amount: { type: Number, default: 0 },
    content: String,
    status: { type: String, default: 'draft' },
    signature_data: String,
    signed_at: Date,
    access_link: String,
    created_by: mongoose.Schema.Types.ObjectId,
    admin_notes: String
}, { timestamps: true });

const Admin = mongoose.model('Admin', adminSchema);
const Contract = mongoose.model('Contract', contractSchema);

// Utility functions
function generateContractNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `KTR${year}${month}${day}${random}`;
}

function formatCurrency(amount) {
    return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

// Auth middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Token required' });
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const admin = await Admin.findById(decoded.adminId);
        if (!admin) return res.status(401).json({ error: 'Invalid token' });
        
        req.admin = admin;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

// Database connection
async function connectDatabase() {
    try {
        await mongoose.connect(MONGODB_URI);
        dbConnected = true;
        console.log('✅ MongoDB connected');
        
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
        console.error('❌ Database error:', error);
        dbConnected = false;
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        message: '🚀 TradeStation Backend v3.3.0 - Minimal Working',
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'Connected' : 'Disconnected',
        cors: 'Enabled for All Origins'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'connected' : 'disconnected',
        version: '3.3.0-minimal',
        cors: {
            enabled: true,
            policy: 'Allow All Origins',
            origin: req.headers.origin || 'none'
        }
    });
});

app.get('/api/test', (req, res) => {
    console.log('🧪 Test endpoint from:', req.headers.origin);
    res.json({
        message: 'API Test Berhasil! 🎉',
        timestamp: new Date().toISOString(),
        origin: req.headers.origin || 'none',
        cors: 'SUCCESS'
    });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        console.log('🔐 Admin login attempt');
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

        console.log('✅ Admin login success');
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
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Login gagal' });
    }
});

// User login
app.post('/api/user/login', async (req, res) => {
    try {
        const { contractNumber, password } = req.body;

        if (!contractNumber || !password) {
            return res.status(400).json({ error: 'Nomor kontrak dan password harus diisi' });
        }

        if (password !== FIXED_PASSWORD) {
            return res.status(401).json({ error: 'Password salah' });
        }

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
                status: contract.status
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login gagal' });
    }
});

// Get contracts
app.get('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const contracts = await Contract.find().sort({ createdAt: -1 });
        res.json({
            data: contracts.map(contract => ({
                ...contract.toObject(),
                formatted_amount: formatCurrency(contract.amount)
            }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Gagal memuat kontrak' });
    }
});

// Create contract
app.post('/api/admin/contracts', authenticateAdmin, async (req, res) => {
    try {
        const { title, client_name, client_email, amount } = req.body;

        if (!title || !client_name || !client_email) {
            return res.status(400).json({ error: 'Data wajib harus diisi' });
        }

        const contractNumber = generateContractNumber();

        const contract = await Contract.create({
            title: title.trim(),
            number: contractNumber,
            client_name: client_name.trim(),
            client_email: client_email.toLowerCase().trim(),
            amount: parseFloat(amount) || 0,
            content: 'Template kontrak default',
            access_link: crypto.randomBytes(16).toString('hex'),
            created_by: req.admin._id,
            status: 'draft'
        });

        res.json({
            message: 'Kontrak berhasil dibuat',
            data: contract,
            userLoginInfo: {
                contractNumber: contractNumber,
                password: FIXED_PASSWORD
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Gagal membuat kontrak' });
    }
});

// Activate contract
app.post('/api/admin/contracts/:id/activate', authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findByIdAndUpdate(
            req.params.id, 
            { status: 'active' }, 
            { new: true }
        );
        
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

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

// Delete contract
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

// Stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const [total, draft, active, signed] = await Promise.all([
            Contract.countDocuments(),
            Contract.countDocuments({ status: 'draft' }),
            Contract.countDocuments({ status: 'active' }),
            Contract.countDocuments({ status: 'signed' })
        ]);

        const totalValueResult = await Contract.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            data: {
                totalContracts: total,
                draftContracts: draft,
                activeContracts: active,
                signedContracts: signed,
                totalValue: totalValueResult[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Gagal memuat statistik' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint tidak ditemukan',
        path: req.path 
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        await connectDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation v3.3.0 - Minimal Working Version`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`💾 Database: ${dbConnected ? 'Connected ✅' : 'Disconnected ❌'}`);
            console.log(`🔒 CORS: Enabled for All Origins ✅`);
            console.log(`👤 Admin: admin@kontrakdigital.com / admin123`);
            console.log(`📝 User Password: ${FIXED_PASSWORD}`);
            console.log(`✅ Ready to serve!`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
