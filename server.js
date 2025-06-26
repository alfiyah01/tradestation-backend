const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://kontrakdigital.netlify.app', 'https://kontrakdigital.com', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

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
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
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
    access_token: { type: String, unique: true }
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
                balance: 50000000
            });
            console.log('✅ Sample user created');
        }
        
        // Create default template
        const templateExists = await Template.findOne({ name: 'Kontrak Investasi Trading' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Kontrak Investasi Trading',
                    category: 'investment',
                    content: `# KONTRAK INVESTASI TRADING
# TRADESTATION DIGITAL

**Nomor Kontrak:** {{CONTRACT_NUMBER}}
**Tanggal:** {{CONTRACT_DATE}}

## PARA PIHAK

**PIHAK PERTAMA (TradeStation):**
- Nama: TradeStation Digital
- Alamat: Jakarta, Indonesia
- Email: admin@tradestation.com

**PIHAK KEDUA (Investor):**
- Nama: {{USER_NAME}}
- Email: {{USER_EMAIL}}
- Trading ID: {{TRADING_ID}}
- Telepon: {{USER_PHONE}}

## KETENTUAN INVESTASI

### Pasal 1 - Modal Investasi
Pihak Kedua menyetorkan modal investasi sebesar **{{AMOUNT}}** untuk kegiatan trading di platform TradeStation.

### Pasal 2 - Periode Investasi
Investasi berlaku untuk periode **{{INVESTMENT_PERIOD}}** terhitung sejak kontrak ini ditandatangani.

### Pasal 3 - Pembagian Hasil
- Profit sharing: **{{PROFIT_SHARE}}%** untuk investor
- Management fee: **{{MANAGEMENT_FEE}}%** untuk TradeStation
- Target return: **{{TARGET_RETURN}}%** per tahun

### Pasal 4 - Risiko
Pihak Kedua memahami bahwa trading mengandung risiko dan tidak ada jaminan keuntungan.

### Pasal 5 - Penutupan
Kontrak ini berlaku sejak ditandatangani hingga berakhirnya periode investasi.

**Tempat & Tanggal:** Jakarta, {{CONTRACT_DATE}}

**Pihak Kedua (Investor)**


{{USER_NAME}}
Trading ID: {{TRADING_ID}}`,
                    variables: ['USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'TRADING_ID', 'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'INVESTMENT_PERIOD', 'PROFIT_SHARE', 'MANAGEMENT_FEE', 'TARGET_RETURN'],
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
            .populate('user_id', 'password');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        const validPassword = await bcrypt.compare(password, contract.user_id.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        if (contract.status === 'signed' || contract.status === 'completed') {
            return res.status(400).json({ error: 'Contract already signed' });
        }

        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: new Date()
        });

        await ContractHistory.create({
            contract_id: contract._id,
            action: 'signed',
            description: 'Contract signed by user',
            performed_by: contract.user_id._id
        });

        res.json({ message: 'Contract signed successfully' });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
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

app.get('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const templates = await Template.find()
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });
            
        const formattedTemplates = templates.map(template => ({
            ...template.toObject(),
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
        const { name, category, content } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }
        
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.create({
            name,
            category: category || 'general',
            content,
            variables,
            created_by: req.user._id
        });
        
        res.json({
            message: 'Template created successfully',
            data: template
        });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

app.put('/api/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, content } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }
        
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.findByIdAndUpdate(
            req.params.id,
            { name, category, content, variables },
            { new: true }
        );
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({
            message: 'Template updated successfully',
            data: template
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
                    contract_count: { $size: '$contracts' }
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
// STATIC ROUTES
// =====================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
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
