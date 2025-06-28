const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// ENHANCED CONFIGURATION
// =====================

app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.set('trust proxy', 1);

// Enhanced Rate limiting
const requests = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 menit
    const maxRequests = 200; // Increased for better performance
    
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
        return res.status(429).json({ 
            error: 'Terlalu banyak permintaan', 
            retryAfter: Math.ceil((requestData.resetTime - now) / 1000)
        });
    }
    
    requestData.count++;
    next();
});

// =====================
// DATABASE CONFIG
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'tradestation_advanced_digital_contract_system_2024_ultra_secure_key';

// =====================
// ENHANCED DATABASE SCHEMAS
// =====================

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 100 },
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
    locked_until: { type: Date },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    profile_image: { type: String },
    preferences: {
        language: { type: String, default: 'id' },
        notifications: { type: Boolean, default: true },
        theme: { type: String, default: 'light' }
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, default: 'general', trim: true },
    content: { type: String, required: true },
    variables: [{ type: String, trim: true }],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, trim: true, maxlength: 500 },
    version: { type: Number, default: 1 },
    usage_count: { type: Number, default: 0 },
    tags: [{ type: String, trim: true }]
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
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
    user_agent_signed: { type: String },
    priority: { type: String, default: 'normal', enum: ['low', 'normal', 'high', 'urgent'] },
    metadata: {
        pdf_generated: { type: Boolean, default: false },
        pdf_size: { type: Number },
        generation_time: { type: Number },
        download_count: { type: Number, default: 0 }
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String },
    metadata: { type: Object, default: {} },
    severity: { type: String, default: 'info', enum: ['info', 'warning', 'error', 'critical'] }
}, { timestamps: true });

// Create models
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
            maxPoolSize: 20,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        
        console.log('✅ MongoDB Atlas connected successfully!');
        await setupInitialData();
        await setupAssets();
        
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.log('⚠️  Continuing server startup...');
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
                name: 'TradeStation Administrator',
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
        
        // Create enhanced default template
        const templateExists = await Template.findOne({ name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi TradeStation' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi TradeStation',
                    category: 'investment',
                    description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia - Partner TradeStation',
                    content: `# PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI

**Nomor Kontrak:** {{CONTRACT_NUMBER}}

## Pihak A:
{{USER_NAME}}

## Pihak B: PT. Konsultasi Profesional Indonesia
**Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950

**Kontak:** Prof. Bima Agung Rachel

**Telepon:** +62 852 - 5852 - 8771

**Pihak A**, sebagai individu, setuju untuk menggunakan layanan analisis pasar atau layanan konsultasi yang disediakan oleh **Pihak B**, PT. Konsultasi Profesional Indonesia. Pihak B menyediakan layanan seperti analisis pasar, konsultasi investasi, analisis produk, laporan riset pasar, dsb. Untuk memajukan pembangunan dan kerja sama bersama yang saling menguntungkan, dan berdasarkan prinsip kesetaraan dan saling menghormati, kedua belah pihak menyepakati ketentuan-ketentuan berikut untuk kerja sama ini, dan akan secara ketat mematuhinya.

## Pasal 1: Definisi Awal

1.1. Biaya konsultasi layanan merujuk pada nilai profit dari investasi apapun oleh pelanggan. Anda dapat meminta Pihak B untuk melakukan analisis data, laporan, dll.

1.2. Biaya transaksi merujuk pada biaya yang dibebankan oleh Pihak B kepada Pihak A. Biaya ini dihitung berdasarkan jumlah Profit dari transaksi Investasi sebesar {{COMMISSION_PERCENTAGE}}% hingga 50%.

1.3. Nilai modal Investasi Pihak A sebesar **{{AMOUNT}}** dengan durasi kontrak kerja sama investasi selama **{{DURATION_DAYS}}** hari atau minimal **{{MIN_TRANSACTIONS}}** kali transaksi investasi.

## Pasal 2: Konten Layanan dan Standar Tarif

2.1. Pihak B menyediakan analisis dan rekomendasi kepada Pihak A.

2.2. Pihak A menyetujui metode dan jumlah pembayaran komisi konsultasi.

2.3. Jika ada biaya tambahan dalam proses kerja sama, harus disetujui bersama sebelumnya.

2.4. Laporan akhir yang disediakan Pihak B kepada Pihak A mencakup informasi tentang tren industri, analisis pasar, dan opini profesional lainnya.

2.5. Informasi yang disediakan oleh Pihak B harus dijaga kerahasiaannya oleh Pihak A dan tidak boleh disebarkan tanpa izin tertulis.

## Pasal 3: Metode Penyelesaian

3.1. Pihak A akan menyelesaikan pembayaran untuk layanan konsultasi / panduan transaksi investasi setelah Pihak A mendapatkan nilai Profit dari Transaksi investasi dan pembayaran komisi konsultasi berlaku selama **{{DURATION_DAYS}}** hari atau minimal **{{MIN_TRANSACTIONS}}** kali transaksi investasi.

3.2. Jika pembayaran tidak dilakukan tepat waktu, Pihak A akan dikenakan denda harian.

3.3. Jika pembayaran tetap tidak dilakukan dalam 48 jam, maka Pihak B dapat menangguhkan layanan.

3.4. Pihak A bertanggung jawab atas biaya tambahan akibat kegagalan pembayaran.

3.5. Jika terjadi pembatalan, biaya layanan yang sudah dibayarkan tidak dapat dikembalikan.

## Pasal 4: Hak dan Kewajiban Pihak A

4.1. Pihak A berhak meminta, dan menerima data yang akurat untuk hasil profit 100% oleh Pihak B. Jika Pihak A collapse / merugi Pihak B wajib melakukan ganti rugi dengan nilai yang sama kepada Pihak A.

4.2. Pihak A berhak tidak menambah nominal modal selama kontrak perjanjian kerja sama investasi ini berlaku yaitu **{{DURATION_DAYS}}** hari atau minimal **{{MIN_TRANSACTIONS}}** kali transaksi investasi.

4.3. Pihak A berhak mendapatkan panduan investasi terbaik sebanyak 5 hingga 10 kali transaksi per harinya selama masa kontrak perjanjian kerja sama investasi ini berlaku.

4.4. Pihak A wajib mengikuti panduan transaksi dengan benar oleh Pihak B. Jika melakukan transaksi investasi diluar panduan Pihak B seluruh resiko hasil transaksi tersebut bukan tanggung jawab Pihak B.

4.5. Pihak A wajib bayarkan komisi konsultasi sebanyak **{{COMMISSION_PERCENTAGE}}%** dari nilai profit transaksi investasi dan dibayarkan setelah transaksi investasi selesai dan wajib Penarikan seluruh modal investasi dan hasil profit transaksi investasi setelah masa durasi kontrak kerja sama investasi selama **{{DURATION_DAYS}}** hari atau minimal **{{MIN_TRANSACTIONS}}** kali transaksi investasi.

4.6. Pihak A menjamin bahwa dana yang digunakan berasal dari sumber yang sah dan dapat dipertanggung jawabkan.

4.7. Pihak A tidak boleh menggunakan informasi layanan ini untuk tindakan yang melanggar hukum seperti pencucian uang, perjudian, penghindaran pajak, dll.

4.8. Pihak A wajib melakukan / mengikuti panduan investasi sebanyak 3 kali transaksi perharinya sesuai jadwal investasi dari Pihak B.

## Pasal 5: Hak dan Kewajiban Pihak B

5.1. Pihak B harus menangani permintaan konsultasi dari Pihak A sesuai perjanjian.

5.2. Pihak B bertanggung jawab memberikan informasi konsultasi investasi secara akurat dan menanggung resiko sebesar 100% pengembalian modal jika terjadi collapse / merugi kepada Pihak A.

5.3. Dalam jam kerja normal, Pihak B akan merespons permintaan dari Pihak A untuk transaksi investasi diluar jadwal yang diberikan Pihak B.

5.4. Pihak B berhak mendapatkan pembayaran komisi konsultasi dari pihak A sebesar **{{COMMISSION_PERCENTAGE}}%** dari nilai Profit transaksi investasi.

5.5. Pihak B dapat menghentikan layanan jika Pihak A tidak membayar atau bertindak mencurigakan.

5.6. Pihak B tidak dibenarkan meminta pembayaran diluar jumlah yang disepekati dalam isi perjanjian kontrak kerja sama investasi ini.

5.7. Pihak B tidak bertanggung jawab atas risiko operasional dari keputusan investasi yang dilakukan Pihak A tanpa panduan atau diluar panduan pihak B.

5.8. Pihak B dapat menolak transaksi yang melanggar hukum atau mencurigakan.

5.9. Sengketa diselesaikan melalui negosiasi damai.

5.10. Pihak B wajib berikan panduan dan jadwal transaksi investasi minimal 3 kali transaksi per harinya kepada pihak A.

5.11. Pihak B berhak mengakhiri perjanjian jika Pihak A melakukan kecurangan pada akun investasi.

5.12. Jika Pihak A melanggar hukum atau menyebabkan kerugian, Pihak B dapat menuntut ganti rugi dan menyelesaikan secara hukum yang berlaku di indonesia.

5.13. Pihak B berhak tidak bertanggung jawab atas pembekuan seluruh aset / modal dan hasil profit investasi pihak A oleh Platform Tradestation, jika Pihak A melakukan penarikan berulang kali selama masa durasi kontrak kerja sama investasi ini berlangsung / belum selesai.

## Pasal 6: Klausul Kerahasiaan

6.1. Informasi yang diperoleh oleh kedua belah pihak selama masa kontrak kerja sama investasi ini harus dijaga kerahasiaannya dan tidak boleh disebarkan kepada pihak ketiga tanpa izin tertulis.

6.2. Kerahasiaan ini meliputi hal - hal penting dan sensitif serta data diri dari kedua belah pihak.

6.3. Semua informasi tetap milik pihak yang memberikannya dan tidak dapat digunakan tanpa izin oleh pihak manapun.

6.4. Klausul ini tetap berlaku meskipun perjanjian berakhir.

---

**Tertanda:**

**Perwakilan Pihak B:**                           **Tanda tangan Pihak A:**

Prof. Bima Agung Rachel                           ( {{USER_NAME}} )


**Tanggal Penandatanganan:** {{SIGNED_DATE}}`,
                    variables: [
                        'USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'USER_ADDRESS', 'TRADING_ID', 
                        'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'COMMISSION_PERCENTAGE', 
                        'DURATION_DAYS', 'MIN_TRANSACTIONS', 'PAYMENT_METHOD', 'PAYMENT_SCHEDULE', 
                        'PAYMENT_TERMS', 'SIGNED_DATE'
                    ],
                    created_by: admin._id,
                    tags: ['investment', 'tradestation', 'consultation', 'professional']
                });
                console.log('✅ Enhanced default template created');
            }
        }
        
        console.log('🎉 Initial data setup completed!');
        
    } catch (error) {
        console.error('❌ Error in initial data setup:', error);
    }
}

// =====================
// ASSETS SETUP FOR LOGO
// =====================

async function setupAssets() {
    try {
        const assetsDir = path.join(__dirname, 'assets');
        
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
            console.log('📁 Assets directory created');
        }
        
        const logoPath = path.join(assetsDir, 'tradestation-logo.png');
        if (fs.existsSync(logoPath)) {
            console.log('✅ TradeStation logo found at: assets/tradestation-logo.png');
        } else {
            console.log('📥 TradeStation logo not found. Please add logo to: assets/tradestation-logo.png');
            console.log('🎨 Logo specifications:');
            console.log('   - Format: PNG with transparent background');
            console.log('   - Size: 400x120 pixels (optimal)');
            console.log('   - File name: tradestation-logo.png');
        }
        
    } catch (error) {
        console.error('❌ Error setting up assets:', error);
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
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `TSC${year}${month}${day}${hours}${minutes}${random}`;
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

// =====================
// ADVANCED PDF GENERATION WITH TRADESTATION LOGO
// =====================

async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('🎨 Starting ADVANCED PDF generation with TradeStation logo for contract:', contract.number);
            
            if (!contract || !user) {
                throw new Error('Contract atau user data tidak lengkap');
            }

            const startTime = Date.now();
            
            const doc = new PDFDocument({ 
                margin: 40,
                size: 'A4',
                bufferPages: true,
                autoFirstPage: true,
                info: {
                    Title: `Kontrak ${contract.number}`,
                    Author: 'TradeStation Digital Platform',
                    Subject: contract.title || 'Perjanjian Konsultasi Investasi',
                    Creator: 'TradeStation Advanced Professional System',
                    Keywords: 'Kontrak,Investasi,TradeStation,Digital,Professional,Advanced',
                    Producer: 'TradeStation PDF Engine v2.0'
                }
            });
            
            const buffers = [];
            
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => {
                try {
                    const pdfData = Buffer.concat(buffers);
                    const generationTime = Date.now() - startTime;
                    console.log('✅ ADVANCED PDF with logo generated successfully!');
                    console.log(`📊 Generation stats: ${pdfData.length} bytes, ${generationTime}ms`);
                    resolve(pdfData);
                } catch (error) {
                    reject(error);
                }
            });
            doc.on('error', reject);

            // =====================
            // HEADER WITH TRADESTATION LOGO
            // =====================
            
            console.log('🖼️ Adding TradeStation original logo to header...');
            
            // Clean professional background
            const headerGradient = doc.linearGradient(50, 30, 550, 130);
            headerGradient.stop(0, '#ffffff')
                         .stop(0.2, '#f8fafc')
                         .stop(1, '#e2e8f0');
            
            doc.rect(50, 30, 500, 130)
               .fill(headerGradient);
            
            // Professional border
            doc.rect(50, 30, 500, 130)
               .lineWidth(2)
               .strokeColor('#0ea5e9')
               .stroke();

            // Inner shadow effect
            doc.rect(52, 32, 496, 126)
               .lineWidth(1)
               .strokeColor('#cbd5e1')
               .stroke();

            // =====================
            // TRADESTATION LOGO INTEGRATION
            // =====================
            
            const logoPath = path.join(__dirname, 'assets', 'tradestation-logo.png');
            
            if (fs.existsSync(logoPath)) {
                try {
                    // TradeStation logo with perfect positioning
                    doc.image(logoPath, 70, 55, { 
                        width: 220,
                        height: 66
                    });
                    console.log('✅ TradeStation logo added successfully');
                } catch (logoError) {
                    console.warn('⚠️ Error loading logo:', logoError.message);
                    createTextLogo(doc);
                }
            } else {
                console.log('📝 Logo not found, using text fallback');
                createTextLogo(doc);
            }
            
            function createTextLogo(doc) {
                // Professional text logo as fallback
                doc.fontSize(28)
                   .font('Helvetica-Bold')
                   .fillColor('#0ea5e9')
                   .text('TradeStation', 70, 70);
                
                doc.fontSize(12)
                   .fillColor('#64748b')
                   .text('Digital Contract Platform', 70, 105);
                
                doc.fontSize(10)
                   .text('®', 245, 70);
            }

            // =====================
            // COMPANY INFORMATION
            // =====================
            
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#1e293b')
               .text('PT. KONSULTAN PROFESIONAL', 320, 55);
            
            doc.fontSize(14)
               .text('INDONESIA', 320, 75);
            
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#64748b')
               .text('Partner Of TradeStation®', 320, 95);
            
            // Contact details
            doc.fontSize(8)
               .fillColor('#475569')
               .text('📞 +62 852 - 5852 - 8771', 320, 115)
               .text('🌐 www.tradestationindo.com', 320, 125)
               .text('📧 professional@tradestation.com', 320, 135);

            // =====================
            // PROFESSIONAL SEPARATOR
            // =====================
            
            doc.moveTo(50, 170)
               .lineTo(550, 170)
               .lineWidth(3)
               .strokeColor('#0ea5e9')
               .stroke();
            
            doc.moveTo(50, 175)
               .lineTo(550, 175)
               .lineWidth(1)
               .strokeColor('#38bdf8')
               .stroke();

            // =====================
            // CONTRACT INFO SECTION
            // =====================
            
            doc.y = 190;
            const infoY = doc.y;
            
            // Professional info box
            const infoGradient = doc.linearGradient(50, infoY, 550, infoY + 140);
            infoGradient.stop(0, '#f8fafc')
                       .stop(1, '#e2e8f0');
            
            doc.rect(50, infoY, 500, 140)
               .fill(infoGradient);
            
            doc.rect(50, infoY, 500, 140)
               .lineWidth(2)
               .strokeColor('#cbd5e1')
               .stroke();

            // Title section with TradeStation branding
            const titleGradient = doc.linearGradient(60, infoY + 15, 540, infoY + 45);
            titleGradient.stop(0, '#0ea5e9')
                        .stop(1, '#0284c7');
            
            doc.rect(60, infoY + 15, 480, 30)
               .fill(titleGradient);
            
            doc.fontSize(13)
               .font('Helvetica-Bold')
               .fillColor('#ffffff')
               .text('PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI', 
                     70, infoY + 25, { align: 'center', width: 460 });

            // Contract number with emphasis
            doc.fontSize(11)
               .font('Helvetica-Bold')
               .fillColor('#0ea5e9')
               .text(`Nomor Kontrak: ${contract.number || 'N/A'}`, 
                     70, infoY + 60, { align: 'center', width: 460 });

            // Information grid
            const detailY = infoY + 85;
            
            // Left column - Client info
            doc.fontSize(9)
               .font('Helvetica-Bold')
               .fillColor('#374151')
               .text('👤 Nama Klien:', 70, detailY)
               .text('📧 Email:', 70, detailY + 18)
               .text('📱 Telepon:', 70, detailY + 36);
            
            doc.font('Helvetica')
               .fillColor('#111827')
               .text(user.name || 'N/A', 150, detailY)
               .text(user.email || 'N/A', 150, detailY + 18)
               .text(user.phone || 'N/A', 150, detailY + 36);

            // Right column - Contract info
            doc.font('Helvetica-Bold')
               .fillColor('#374151')
               .text('💳 Trading ID:', 320, detailY)
               .text('💰 Nilai Kontrak:', 320, detailY + 18)
               .text('📅 Tanggal Kontrak:', 320, detailY + 36);
            
            doc.font('Helvetica')
               .fillColor('#111827')
               .text(user.trading_account || 'N/A', 420, detailY)
               .text(formatCurrency(contract.amount || 0), 420, detailY + 18)
               .text(new Date(contract.createdAt).toLocaleDateString('id-ID'), 
                     420, detailY + 36);

            doc.y = infoY + 150;

            // =====================
            // WATERMARK
            // =====================
            
            doc.fontSize(45)
               .font('Helvetica-Bold')
               .fillColor('#0ea5e912')
               .text('TRADESTATION', 180, 450, { 
                   rotate: -45,
                   align: 'center'
               });

            // =====================
            // CONTENT PROCESSING
            // =====================
            
            console.log('📋 Processing contract content with advanced formatting...');
            
            let content = contract.content || '';
            
            // Enhanced variable replacement
            const replacements = {
                '{{USER_NAME}}': user.name || '[Nama User]',
                '{{USER_EMAIL}}': user.email || '[Email User]',
                '{{USER_PHONE}}': user.phone || '[Telepon User]',
                '{{TRADING_ID}}': user.trading_account || '[Trading ID]',
                '{{CONTRACT_NUMBER}}': contract.number || '[Nomor Kontrak]',
                '{{CONTRACT_DATE}}': contract.createdAt ? 
                    new Date(contract.createdAt).toLocaleDateString('id-ID', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }) : '[Tanggal Kontrak]',
                '{{AMOUNT}}': contract.amount ? 
                    formatCurrency(contract.amount) : '[Jumlah]',
                '{{SIGNED_DATE}}': contract.signed_at ? 
                    new Date(contract.signed_at).toLocaleString('id-ID', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short'
                    }) : '[Tanggal TTD]'
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

            // =====================
            // ADVANCED CONTENT RENDERING
            // =====================
            
            const lines = content.split('\n');
            let lineCount = 0;
            
            for (const line of lines) {
                try {
                    lineCount++;
                    const trimmedLine = line.trim();
                    
                    if (lineCount > 600) {
                        doc.fontSize(10)
                           .fillColor('#ef4444')
                           .text('... [Konten dipotong untuk optimasi] ...', 
                                 { align: 'center' });
                        break;
                    }
                    
                    // Intelligent page break
                    if (doc.y > 730) {
                        doc.addPage();
                        
                        // Mini header with logo on new page
                        if (fs.existsSync(logoPath)) {
                            try {
                                doc.image(logoPath, 420, 30, { width: 100, height: 30 });
                            } catch (e) {
                                doc.fontSize(10)
                                   .fillColor('#0ea5e9')
                                   .text('TradeStation®', 450, 35);
                            }
                        }
                        
                        doc.fontSize(8)
                           .fillColor('#64748b')
                           .text(`Kontrak ${contract.number} - Halaman ${doc.bufferedPageRange().count}`, 
                                 50, 45, { align: 'right' });
                        doc.y = 80;
                    }
                    
                    if (!trimmedLine) {
                        doc.moveDown(0.4);
                        continue;
                    }
                    
                    // Enhanced text styling
                    if (trimmedLine.startsWith('# ')) {
                        // Main heading with TradeStation styling
                        doc.fontSize(16)
                           .font('Helvetica-Bold')
                           .fillColor('#0ea5e9')
                           .text(trimmedLine.substring(2), { align: 'center' });
                        doc.moveDown(0.8);
                        
                        // Professional underline
                        const textWidth = doc.widthOfString(trimmedLine.substring(2));
                        const startX = (550 - textWidth) / 2 + 50;
                        doc.moveTo(startX, doc.y)
                           .lineTo(startX + textWidth, doc.y)
                           .lineWidth(2)
                           .strokeColor('#0ea5e9')
                           .stroke();
                        doc.moveDown(0.6);
                        
                    } else if (trimmedLine.startsWith('## ')) {
                        // Section heading
                        doc.fontSize(13)
                           .font('Helvetica-Bold')
                           .fillColor('#1e293b')
                           .text(trimmedLine.substring(3));
                        doc.moveDown(0.5);
                        
                        // Accent line
                        doc.moveTo(50, doc.y)
                           .lineTo(200, doc.y)
                           .lineWidth(1)
                           .strokeColor('#0ea5e9')
                           .stroke();
                        doc.moveDown(0.3);
                        
                    } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                        // Bold text with highlighting
                        const text = trimmedLine.replace(/\*\*/g, '');
                        doc.fontSize(10)
                           .font('Helvetica-Bold')
                           .fillColor('#374151')
                           .text(text);
                        doc.moveDown(0.4);
                        
                    } else if (trimmedLine === '---') {
                        // Professional separator
                        doc.moveDown(0.6);
                        const separatorGradient = doc.linearGradient(80, doc.y, 520, doc.y);
                        separatorGradient.stop(0, '#transparent')
                                       .stop(0.5, '#0ea5e9')
                                       .stop(1, '#transparent');
                        doc.moveTo(80, doc.y)
                           .lineTo(520, doc.y)
                           .lineWidth(2)
                           .strokeColor('#0ea5e9')
                           .stroke();
                        doc.moveDown(0.6);
                        
                    } else if (trimmedLine.match(/^\d+\.\d+\./)) {
                        // Numbered sub-items
                        const processedLine = trimmedLine.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(9)
                           .font('Helvetica')
                           .fillColor('#374151')
                           .text(processedLine, 70, doc.y, {
                               align: 'justify',
                               lineGap: 3,
                               indent: 25
                           });
                        doc.moveDown(0.4);
                        
                    } else {
                        // Regular text with professional formatting
                        const processedLine = trimmedLine.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(9)
                           .font('Helvetica')
                           .fillColor('#374151')
                           .text(processedLine, {
                               align: 'justify',
                               lineGap: 3
                           });
                        doc.moveDown(0.3);
                    }
                } catch (lineError) {
                    console.warn(`⚠️ Error processing line ${lineCount}:`, lineError.message);
                }
            }

            // =====================
            // SIGNATURE PAGE WITH PROFESSIONAL DESIGN
            // =====================
            
            doc.addPage();
            
            // Logo in signature page header
            if (fs.existsSync(logoPath)) {
                try {
                    doc.image(logoPath, 225, 50, { width: 150, height: 45 });
                } catch (e) {
                    doc.fontSize(20)
                       .font('Helvetica-Bold')
                       .fillColor('#0ea5e9')
                       .text('TradeStation®', 250, 60, { align: 'center' });
                }
            }
            
            // Professional signature header
            const sigHeaderGradient = doc.linearGradient(50, 110, 550, 140);
            sigHeaderGradient.stop(0, '#059669')
                           .stop(1, '#10b981');
            
            doc.rect(50, 110, 500, 40)
               .fill(sigHeaderGradient);
            
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor('#ffffff')
               .text('HALAMAN PENANDATANGANAN DIGITAL', 60, 125, { 
                   align: 'center', 
                   width: 480 
               });

            doc.moveDown(4);
            
            if (signatureData && contract.signed_at) {
                // Successfully signed contract
                doc.fontSize(16)
                   .font('Helvetica-Bold')
                   .fillColor('#059669')
                   .text('✓ KONTRAK TELAH DITANDATANGANI SECARA DIGITAL', { 
                       align: 'center' 
                   });
                
                doc.moveDown(3);
                
                const signY = doc.y;
                
                // Professional signature boxes
                const leftBoxGradient = doc.linearGradient(80, signY, 280, signY + 120);
                leftBoxGradient.stop(0, '#f8fafc').stop(1, '#e2e8f0');
                
                const rightBoxGradient = doc.linearGradient(320, signY, 520, signY + 120);
                rightBoxGradient.stop(0, '#f0f9ff').stop(1, '#dbeafe');
                
                // Left signature box
                doc.rect(80, signY, 200, 120)
                   .fill(leftBoxGradient);
                doc.rect(80, signY, 200, 120)
                   .lineWidth(2)
                   .strokeColor('#0ea5e9')
                   .stroke();
                
                // Right signature box
                doc.rect(320, signY, 200, 120)
                   .fill(rightBoxGradient);
                doc.rect(320, signY, 200, 120)
                   .lineWidth(2)
                   .strokeColor('#059669')
                   .stroke();
                
                // Labels and names
                doc.fontSize(12)
                   .font('Helvetica-Bold')
                   .fillColor('#1e293b')
                   .text('Perwakilan Pihak B:', 90, signY + 15)
                   .text('Pihak A (Digital):', 330, signY + 15);
                
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#374151')
                   .text('Prof. Bima Agung Rachel', 90, signY + 85)
                   .text(user.name, 330, signY + 85);
                
                // Digital signature verification
                doc.fontSize(9)
                   .fillColor('#059669')
                   .text('✓ Ditandatangani Digital', 330, signY + 45)
                   .text('Terverifikasi Sistem', 330, signY + 60);
                
                doc.moveDown(8);
                
                // Signing details with enhanced formatting
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .fillColor('#1e293b')
                   .text('Detail Penandatanganan:', { align: 'center' });
                
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#374151')
                   .text(`Ditandatangani pada: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, 
                         { align: 'center' });
                
                if (contract.ip_signed) {
                    doc.text(`IP Address: ${contract.ip_signed}`, { align: 'center' });
                }
                
            } else {
                // Pending signature
                doc.fontSize(16)
                   .fillColor('#f59e0b')
                   .text('⏳ MENUNGGU TANDA TANGAN DIGITAL', { align: 'center' });
                
                doc.moveDown(2);
                doc.fontSize(12)
                   .fillColor('#92400e')
                   .text('Kontrak ini akan valid setelah ditandatangani oleh kedua belah pihak', 
                         { align: 'center' });
            }

            // =====================
            // PROFESSIONAL FOOTER
            // =====================
            
            // Footer background
            doc.rect(50, 720, 500, 60)
               .fillAndStroke('#f8fafc', '#e2e8f0');
            
            // Footer content
            doc.fontSize(8)
               .font('Helvetica')
               .fillColor('#64748b')
               .text('Dokumen dibuat secara otomatis oleh TradeStation Digital Platform', 
                     60, 735, { align: 'center', width: 480 });
            
            doc.text(`Generated: ${new Date().toLocaleString('id-ID')} | Version: Advanced 2.0 | Engine: Professional PDF`, 
                     60, 745, { align: 'center', width: 480 });
            
            doc.fontSize(6)
               .fillColor('#94a3b8')
               .text('© 2024 TradeStation Indonesia. All rights reserved. | Document ID: ' + contract._id.toString().substring(0, 8), 
                     60, 755, { align: 'center', width: 480 });

            console.log('🎉 Advanced PDF with TradeStation logo generation completed!');
            doc.end();

        } catch (error) {
            console.error('❌ Error in ADVANCED PDF generation:', error);
            reject(new Error(`Advanced PDF generation failed: ${error.message}`));
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
        return res.status(401).json({ error: 'Token akses diperlukan' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).where('is_active').equals(true);
        
        if (!user) {
            return res.status(401).json({ error: 'Token tidak valid atau user tidak ditemukan' });
        }

        // Check for account lockout
        if (user.locked_until && user.locked_until > new Date()) {
            return res.status(423).json({ 
                error: 'Akun terkunci sementara',
                lockedUntil: user.locked_until
            });
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
                source: 'advanced_system',
                version: '2.0'
            }
        });
    } catch (error) {
        console.error('❌ Failed to log contract activity:', error);
    }
}

// =====================
// ROUTES
// =====================

// Enhanced Health check
app.get('/api/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        
        const stats = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            environment: process.env.NODE_ENV || 'development',
            mongodb: 'MongoDB Atlas',
            uptime: process.uptime(),
            version: '2.0.0-advanced',
            features: {
                logo_support: fs.existsSync(path.join(__dirname, 'assets', 'tradestation-logo.png')),
                pdf_generation: 'advanced',
                digital_signature: 'enabled',
                authentication: 'enhanced'
            },
            memory: process.memoryUsage(),
            system: {
                node_version: process.version,
                platform: process.platform,
                cpu_usage: process.cpuUsage()
            }
        };
        
        res.json(stats);
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message,
            version: '2.0.0-advanced'
        });
    }
});

// =====================
// AUTH ROUTES
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

        // Check account lockout
        if (user.locked_until && user.locked_until > new Date()) {
            return res.status(423).json({ 
                error: 'Akun terkunci sementara',
                lockedUntil: user.locked_until
            });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            // Increment login attempts
            user.login_attempts = (user.login_attempts || 0) + 1;
            
            if (user.login_attempts >= 5) {
                user.locked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
            }
            
            await user.save();
            return res.status(401).json({ error: 'Email atau password salah' });
        }

        // Reset login attempts on successful login
        user.login_attempts = 0;
        user.locked_until = undefined;
        user.last_login = new Date();
        await user.save();

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
        res.status(500).json({ error: 'Login gagal' });
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
        console.error('❌ Error getting user info:', error);
        res.status(500).json({ error: 'Gagal mendapatkan info user' });
    }
});

// =====================
// ADMIN ROUTES - DASHBOARD STATS
// =====================

app.get('/api/admin/stats', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        // Get contract statistics
        const totalContracts = await Contract.countDocuments();
        const pendingSignatures = await Contract.countDocuments({ 
            status: { $in: ['sent', 'viewed'] } 
        });
        const completedContracts = await Contract.countDocuments({ 
            status: { $in: ['signed', 'completed'] } 
        });
        
        // Calculate total value
        const totalValueResult = await Contract.aggregate([
            { $match: { status: { $in: ['signed', 'completed'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalValue = totalValueResult.length > 0 ? totalValueResult[0].total : 0;
        
        // Get user statistics
        const totalUsers = await User.countDocuments({ is_active: true });
        const totalTemplates = await Template.countDocuments({ is_active: true });
        
        res.json({
            stats: {
                totalContracts,
                pendingSignatures,
                completedContracts,
                totalValue,
                totalUsers,
                totalTemplates
            }
        });
    } catch (error) {
        console.error('❌ Error getting admin stats:', error);
        res.status(500).json({ error: 'Gagal mendapatkan statistik' });
    }
});

// =====================
// ADMIN ROUTES - CONTRACT MANAGEMENT
// =====================

app.get('/api/admin/contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const status = req.query.status || '';
        
        // Build query
        let query = {};
        if (search) {
            query.$or = [
                { number: { $regex: search, $options: 'i' } },
                { title: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) {
            query.status = status;
        }
        
        const contracts = await Contract.find(query)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();
        
        const total = await Contract.countDocuments(query);
        
        res.json({
            contracts: contracts.map(contract => ({
                ...contract,
                user_name: contract.user_id?.name || 'Unknown',
                user_email: contract.user_id?.email || '',
                template_name: contract.template_id?.name || 'Custom',
                created_by_name: contract.created_by?.name || 'System'
            })),
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                totalItems: total
            }
        });
    } catch (error) {
        console.error('❌ Error getting contracts:', error);
        res.status(500).json({ error: 'Gagal mendapatkan data kontrak' });
    }
});

app.post('/api/admin/contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const {
            template_id,
            user_id,
            title,
            amount,
            expiry_date,
            variables,
            admin_notes
        } = req.body;

        // Validate required fields
        if (!template_id || !user_id || !title) {
            return res.status(400).json({ 
                error: 'Template, user, dan judul kontrak harus diisi' 
            });
        }

        // Check if template exists
        const template = await Template.findById(template_id);
        if (!template || !template.is_active) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        // Check if user exists
        const user = await User.findById(user_id);
        if (!user || !user.is_active) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        // Generate contract number and access token
        const contractNumber = generateContractNumber();
        const accessToken = generateAccessToken();

        const contract = await Contract.create({
            title,
            number: contractNumber,
            user_id,
            template_id,
            content: template.content,
            amount: amount || 0,
            status: 'draft',
            variables: variables || {},
            expiry_date: expiry_date ? new Date(expiry_date) : null,
            admin_notes,
            access_token: accessToken,
            created_by: req.user._id
        });

        await logContractActivity(
            contract._id,
            'created',
            `Kontrak dibuat oleh admin: ${req.user.name}`,
            req.user._id,
            req
        );

        res.status(201).json({
            message: 'Kontrak berhasil dibuat',
            contract: {
                ...contract.toObject(),
                access_url: `${req.protocol}://${req.get('host')}/?token=${accessToken}`
            }
        });
    } catch (error) {
        console.error('❌ Error creating contract:', error);
        res.status(500).json({ error: 'Gagal membuat kontrak' });
    }
});

app.get('/api/admin/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name content variables')
            .populate('created_by', 'name');

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        res.json({ contract });
    } catch (error) {
        console.error('❌ Error getting contract:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
    }
});

app.put('/api/admin/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { title, amount, expiry_date, variables, admin_notes, status } = req.body;

        const contract = await Contract.findById(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Update contract
        const updatedContract = await Contract.findByIdAndUpdate(
            req.params.id,
            {
                ...(title && { title }),
                ...(amount !== undefined && { amount }),
                ...(expiry_date && { expiry_date: new Date(expiry_date) }),
                ...(variables && { variables }),
                ...(admin_notes !== undefined && { admin_notes }),
                ...(status && { status })
            },
            { new: true }
        ).populate('user_id', 'name email');

        await logContractActivity(
            contract._id,
            'updated',
            `Kontrak diupdate oleh admin: ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({
            message: 'Kontrak berhasil diupdate',
            contract: updatedContract
        });
    } catch (error) {
        console.error('❌ Error updating contract:', error);
        res.status(500).json({ error: 'Gagal mengupdate kontrak' });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
        }

        // Prevent admin from deleting themselves
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri' });
        }

        // Check if user has contracts
        const userContracts = await Contract.countDocuments({ user_id: req.params.id });
        
        if (userContracts > 0) {
            // Soft delete by deactivating
            await User.findByIdAndUpdate(req.params.id, { is_active: false });
            res.json({ message: 'Pengguna berhasil dinonaktifkan' });
        } else {
            // Hard delete if no contracts
            await User.findByIdAndDelete(req.params.id);
            res.json({ message: 'Pengguna berhasil dihapus' });
        }
    } catch (error) {
        console.error('❌ Error deleting user:', error);
        res.status(500).json({ error: 'Gagal menghapus pengguna' });
    }
});

// Reset user password
app.post('/api/admin/users/:id/reset-password', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        await User.findByIdAndUpdate(req.params.id, {
            password: hashedPassword,
            login_attempts: 0,
            locked_until: undefined
        });

        res.json({ message: 'Password berhasil direset' });
    } catch (error) {
        console.error('❌ Error resetting password:', error);
        res.status(500).json({ error: 'Gagal mereset password' });
    }
});

// =====================
// USER ROUTES
// =====================

app.get('/api/user/contracts', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || '';
        
        let query = { user_id: req.user._id };
        if (status) {
            query.status = status;
        }
        
        const contracts = await Contract.find(query)
            .populate('template_id', 'name')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();
        
        const total = await Contract.countDocuments(query);
        
        // Get status counts
        const statusCounts = await Contract.aggregate([
            { $match: { user_id: req.user._id } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        
        const stats = {
            total: total,
            pending: statusCounts.find(s => ['sent', 'viewed'].includes(s._id))?.count || 0,
            completed: statusCounts.find(s => ['signed', 'completed'].includes(s._id))?.count || 0
        };
        
        res.json({
            contracts: contracts.map(contract => ({
                ...contract,
                template_name: contract.template_id?.name || 'Custom',
                created_by_name: contract.created_by?.name || 'System'
            })),
            stats,
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                totalItems: total
            }
        });
    } catch (error) {
        console.error('❌ Error getting user contracts:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak pengguna' });
    }
});

app.get('/api/user/contracts/:id', authenticateToken, async (req, res) => {
    try {
        const contract = await Contract.findOne({
            _id: req.params.id,
            user_id: req.user._id
        })
        .populate('template_id', 'name content variables')
        .populate('created_by', 'name');

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        res.json({ contract });
    } catch (error) {
        console.error('❌ Error getting user contract:', error);
        res.status(500).json({ error: 'Gagal mendapatkan kontrak' });
    }
});

// =====================
// PUBLIC CONTRACT ACCESS (ENHANCED)
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

        if (contract.status === 'sent') {
            await Contract.findByIdAndUpdate(contract._id, { 
                status: 'viewed',
                viewed_at: new Date()
            });
            await logContractActivity(contract._id, 'viewed', 'Kontrak dilihat oleh klien', contract.user_id._id, req);
        }

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
            '{{SIGNED_DATE}}': contract.signed_at ? new Date(contract.signed_at).toLocaleString('id-ID') : ''
        };

        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(key.replace(/[{}]/g, '\\app.delete('/'), 'g');
            content = content.replace(regex, replacements[key]);
        });

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
        console.error('❌ Error accessing contract:', error);
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
            user_agent_signed: req.get('User-Agent'),
            'metadata.pdf_generated': false
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
        console.error('❌ Error signing contract:', error);
        res.status(500).json({ error: 'Gagal menandatangani kontrak' });
    }
});

// =====================
// ENHANCED DOWNLOAD PDF ENDPOINT
// =====================

app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;
        
        console.log('📥 Advanced download request for contract:', contractId);

        if (!contractId || !mongoose.Types.ObjectId.isValid(contractId)) {
            console.log('❌ Invalid contract ID:', contractId);
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account')
            .lean();

        if (!contract) {
            console.log('❌ Contract not found:', contractId);
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (!contract.user_id) {
            console.log('❌ Contract user not found:', contractId);
            return res.status(404).json({ error: 'Data user kontrak tidak ditemukan' });
        }

        console.log('✅ Contract found for advanced generation:', {
            id: contractId,
            number: contract.number,
            status: contract.status,
            user: contract.user_id.name,
            amount: contract.amount,
            hasLogo: fs.existsSync(path.join(__dirname, 'assets', 'tradestation-logo.png'))
        });

        console.log('🚀 Starting ADVANCED PDF generation with TradeStation logo...');
        
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF generation timeout - advanced process taking too long')), 45000)
        );
        
        const pdfPromise = generateContractPDF(contract, contract.user_id, contract.signature_data);
        
        const pdfBuffer = await Promise.race([pdfPromise, timeoutPromise]);

        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new Error('Generated PDF is empty or invalid');
        }

        console.log('✅ ADVANCED PDF generated successfully:', {
            size: pdfBuffer.length,
            sizeKB: Math.round(pdfBuffer.length / 1024),
            contract: contract.number
        });

        // Update contract metadata
        await Contract.findByIdAndUpdate(contractId, {
            'metadata.pdf_generated': true,
            'metadata.pdf_size': pdfBuffer.length,
            'metadata.generation_time': Date.now(),
            $inc: { 'metadata.download_count': 1 }
        });

        logContractActivity(
            contract._id,
            'downloaded',
            'PDF kontrak advanced diunduh dengan logo TradeStation',
            null,
            req
        ).catch(err => console.warn('⚠️ Failed to log activity:', err.message));

        const safeName = (contract.user_id.name || 'User')
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
        
        const filename = `TradeStation_Kontrak_${contract.number}_${safeName}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-PDF-Generator', 'TradeStation Advanced Engine v2.0');
        res.setHeader('X-Contract-Number', contract.number);

        console.log('📤 Sending ADVANCED PDF to client...');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Advanced download error:', {
            contractId: req.params.contractId,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });

        if (res.headersSent) {
            return res.end();
        }

        res.status(500).json({ 
            error: 'Gagal mendownload kontrak advanced',
            message: error.message,
            version: '2.0.0-advanced',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// =====================
// REPORTS & ANALYTICS
// =====================

app.get('/api/admin/reports/daily', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const date = req.query.date ? new Date(req.query.date) : new Date();
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

        const contracts = await Contract.find({
            createdAt: { $gte: startOfDay, $lt: endOfDay }
        }).populate('user_id', 'name email');

        const stats = await Contract.aggregate([
            { $match: { createdAt: { $gte: startOfDay, $lt: endOfDay } } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalValue: { $sum: '$amount' }
                }
            }
        ]);

        res.json({
            date: date.toISOString().split('T')[0],
            contracts,
            statistics: stats,
            summary: {
                totalContracts: contracts.length,
                totalValue: stats.reduce((sum, stat) => sum + stat.totalValue, 0)
            }
        });
    } catch (error) {
        console.error('❌ Error generating daily report:', error);
        res.status(500).json({ error: 'Gagal membuat laporan harian' });
    }
});

app.get('/api/admin/reports/monthly', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0);

        const stats = await Contract.aggregate([
            { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: {
                        day: { $dayOfMonth: '$createdAt' },
                        status: '$status'
                    },
                    count: { $sum: 1 },
                    totalValue: { $sum: '$amount' }
                }
            },
            { $sort: { '_id.day': 1 } }
        ]);

        const summary = await Contract.aggregate([
            { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: null,
                    totalContracts: { $sum: 1 },
                    totalValue: { $sum: '$amount' },
                    signed: {
                        $sum: {
                            $cond: [{ $in: ['$status', ['signed', 'completed']] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        res.json({
            period: `${year}-${month.toString().padStart(2, '0')}`,
            dailyStats: stats,
            summary: summary[0] || { totalContracts: 0, totalValue: 0, signed: 0 }
        });
    } catch (error) {
        console.error('❌ Error generating monthly report:', error);
        res.status(500).json({ error: 'Gagal membuat laporan bulanan' });
    }
});

app.get('/api/admin/reports/export', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const format = req.query.format || 'json';
        const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

        const contracts = await Contract.find({
            createdAt: { $gte: startDate, $lte: endDate }
        })
        .populate('user_id', 'name email phone trading_account')
        .populate('template_id', 'name category')
        .populate('created_by', 'name')
        .lean();

        const exportData = contracts.map(contract => ({
            number: contract.number,
            title: contract.title,
            user_name: contract.user_id?.name || 'Unknown',
            user_email: contract.user_id?.email || '',
            user_phone: contract.user_id?.phone || '',
            trading_account: contract.user_id?.trading_account || '',
            template_name: contract.template_id?.name || 'Custom',
            amount: contract.amount,
            status: contract.status,
            created_at: contract.createdAt,
            signed_at: contract.signed_at,
            created_by: contract.created_by?.name || 'System'
        }));

        if (format === 'csv') {
            const csv = [
                // CSV headers
                Object.keys(exportData[0] || {}).join(','),
                // CSV data
                ...exportData.map(row => Object.values(row).map(val => 
                    typeof val === 'string' && val.includes(',') ? `"${val}"` : val
                ).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="contracts_export.csv"');
            res.send(csv);
        } else {
            res.json({
                exportDate: new Date().toISOString(),
                period: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                },
                totalRecords: exportData.length,
                data: exportData
            });
        }
    } catch (error) {
        console.error('❌ Error exporting data:', error);
        res.status(500).json({ error: 'Gagal mengeksport data' });
    }
});

// =====================
// HELPER ENDPOINTS
// =====================

app.get('/api/templates/public', async (req, res) => {
    try {
        const templates = await Template.find({ is_active: true })
            .select('_id name category description variables')
            .sort({ name: 1 });

        res.json({ templates });
    } catch (error) {
        console.error('❌ Error getting public templates:', error);
        res.status(500).json({ error: 'Gagal mendapatkan template' });
    }
});

app.get('/api/users/public', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const users = await User.find({ is_active: true, role: 'user' })
            .select('_id name email trading_account')
            .sort({ name: 1 });

        res.json({ users });
    } catch (error) {
        console.error('❌ Error getting public users:', error);
        res.status(500).json({ error: 'Gagal mendapatkan pengguna' });
    }
});

// Contract history
app.get('/api/contracts/:id/history', authenticateToken, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Check permissions
        if (req.user.role !== 'admin' && contract.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }

        const history = await ContractHistory.find({ contract_id: req.params.id })
            .populate('performed_by', 'name')
            .sort({ createdAt: -1 });

        res.json({ history });
    } catch (error) {
        console.error('❌ Error getting contract history:', error);
        res.status(500).json({ error: 'Gagal mendapatkan riwayat kontrak' });
    }
});

// =====================
// NOTIFICATION SYSTEM (Basic)
// =====================

app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        // Basic notification system
        const notifications = [];
        
        if (req.user.role === 'admin') {
            // Admin notifications
            const pendingContracts = await Contract.countDocuments({ 
                status: { $in: ['sent', 'viewed'] } 
            });
            
            if (pendingContracts > 0) {
                notifications.push({
                    id: 'pending-contracts',
                    type: 'warning',
                    title: 'Kontrak Menunggu',
                    message: `${pendingContracts} kontrak menunggu tanda tangan`,
                    timestamp: new Date()
                });
            }

            const expiredContracts = await Contract.countDocuments({
                expiry_date: { $lt: new Date() },
                status: { $in: ['sent', 'viewed'] }
            });

            if (expiredContracts > 0) {
                notifications.push({
                    id: 'expired-contracts',
                    type: 'error',
                    title: 'Kontrak Kedaluwarsa',
                    message: `${expiredContracts} kontrak telah kedaluwarsa`,
                    timestamp: new Date()
                });
            }
        } else {
            // User notifications
            const userPendingContracts = await Contract.countDocuments({
                user_id: req.user._id,
                status: { $in: ['sent', 'viewed'] }
            });

            if (userPendingContracts > 0) {
                notifications.push({
                    id: 'user-pending-contracts',
                    type: 'info',
                    title: 'Kontrak Menunggu Tanda Tangan',
                    message: `Anda memiliki ${userPendingContracts} kontrak yang menunggu tanda tangan`,
                    timestamp: new Date()
                });
            }
        }

        res.json({ notifications });
    } catch (error) {
        console.error('❌ Error getting notifications:', error);
        res.status(500).json({ error: 'Gagal mendapatkan notifikasi' });
    }
});

// =====================
// SEARCH ENDPOINTS
// =====================

app.get('/api/search', authenticateToken, async (req, res) => {
    try {
        const query = req.query.q;
        const type = req.query.type || 'all';
        
        if (!query || query.length < 2) {
            return res.status(400).json({ error: 'Query pencarian minimal 2 karakter' });
        }

        const results = {};

        if (type === 'all' || type === 'contracts') {
            let contractQuery = {
                $or: [
                    { number: { $regex: query, $options: 'i' } },
                    { title: { $regex: query, $options: 'i' } }
                ]
            };

            // Limit user to their own contracts
            if (req.user.role !== 'admin') {
                contractQuery.user_id = req.user._id;
            }

            results.contracts = await Contract.find(contractQuery)
                .populate('user_id', 'name email')
                .limit(10)
                .select('_id number title status amount createdAt');
        }

        if ((type === 'all' || type === 'users') && req.user.role === 'admin') {
            results.users = await User.find({
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { email: { $regex: query, $options: 'i' } },
                    { trading_account: { $regex: query, $options: 'i' } }
                ],
                is_active: true
            })
            .limit(10)
            .select('_id name email role trading_account');
        }

        if ((type === 'all' || type === 'templates') && req.user.role === 'admin') {
            results.templates = await Template.find({
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { category: { $regex: query, $options: 'i' } }
                ],
                is_active: true
            })
            .limit(10)
            .select('_id name category description usage_count');
        }

        res.json({ results, query });
    } catch (error) {
        console.error('❌ Error in search:', error);
        res.status(500).json({ error: 'Gagal melakukan pencarian' });
    }
});

// =====================
// SETTINGS & PREFERENCES
// =====================

app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const settings = {
            user: {
                notifications: req.user.preferences?.notifications ?? true,
                language: req.user.preferences?.language ?? 'id',
                theme: req.user.preferences?.theme ?? 'light'
            },
            system: {
                version: '2.0.0-advanced',
                features: {
                    digital_signature: true,
                    pdf_generation: true,
                    logo_support: fs.existsSync(path.join(__dirname, 'assets', 'tradestation-logo.png')),
                    email_notifications: false,
                    sms_notifications: false
                }
            }
        };

        if (req.user.role === 'admin') {
            settings.admin = {
                auto_backup: true,
                maintenance_mode: false,
                max_file_size: '50mb',
                session_timeout: '7d'
            };
        }

        res.json({ settings });
    } catch (error) {
        console.error('❌ Error getting settings:', error);
        res.status(500).json({ error: 'Gagal mendapatkan pengaturan' });
    }
});

app.put('/api/settings/user', authenticateToken, async (req, res) => {
    try {
        const { notifications, language, theme } = req.body;

        const updateData = {};
        if (notifications !== undefined) updateData['preferences.notifications'] = notifications;
        if (language) updateData['preferences.language'] = language;
        if (theme) updateData['preferences.theme'] = theme;

        await User.findByIdAndUpdate(req.user._id, updateData);

        res.json({ message: 'Pengaturan berhasil disimpan' });
    } catch (error) {
        console.error('❌ Error updating user settings:', error);
        res.status(500).json({ error: 'Gagal menyimpan pengaturan' });
    }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Password lama dan baru harus diisi' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
        }

        const user = await User.findById(req.user._id);
        const validPassword = await bcrypt.compare(currentPassword, user.password);

        if (!validPassword) {
            return res.status(400).json({ error: 'Password lama tidak benar' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.findByIdAndUpdate(req.user._id, { password: hashedPassword });

        res.json({ message: 'Password berhasil diubah' });
    } catch (error) {
        console.error('❌ Error changing password:', error);
        res.status(500).json({ error: 'Gagal mengubah password' });
    }
});

// =====================
// EMAIL NOTIFICATION SYSTEM (Optional Enhancement)
// =====================

async function sendEmailNotification(to, subject, message, contractData = null) {
    try {
        // This is a placeholder for email functionality
        // You can integrate with services like SendGrid, Nodemailer, etc.
        console.log(`📧 Email would be sent to: ${to}`);
        console.log(`📧 Subject: ${subject}`);
        console.log(`📧 Message: ${message}`);
        
        if (contractData) {
            console.log(`📧 Contract: ${contractData.number}`);
        }
        
        // TODO: Implement actual email sending
        return true;
    } catch (error) {
        console.error('❌ Error sending email:', error);
        return false;
    }
}

// =====================
// CLEANUP & MAINTENANCE
// =====================

// Auto cleanup expired contracts
async function cleanupExpiredContracts() {
    try {
        const result = await Contract.updateMany(
            {
                expiry_date: { $lt: new Date() },
                status: { $in: ['sent', 'viewed'] }
            },
            { status: 'expired' }
        );
        
        if (result.modifiedCount > 0) {
            console.log(`🧹 Cleanup: ${result.modifiedCount} contracts marked as expired`);
        }
    } catch (error) {
        console.error('❌ Error in cleanup:', error);
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredContracts, 60 * 60 * 1000);

// =====================
// BACKUP SYSTEM (Basic)
// =====================

app.post('/api/admin/backup', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Get all data for backup
        const [users, templates, contracts, history] = await Promise.all([
            User.find({}).lean(),
            Template.find({}).lean(),
            Contract.find({}).lean(),
            ContractHistory.find({}).lean()
        ]);
        
        const backupData = {
            timestamp,
            version: '2.0.0-advanced',
            data: {
                users: users.map(u => ({ ...u, password: '[REDACTED]' })), // Don't backup passwords
                templates,
                contracts,
                history
            },
            stats: {
                totalUsers: users.length,
                totalTemplates: templates.length,
                totalContracts: contracts.length,
                totalHistory: history.length
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="tradestation_backup_${timestamp}.json"`);
        res.json(backupData);
        
        console.log(`💾 Backup created by ${req.user.name} at ${timestamp}`);
    } catch (error) {
        console.error('❌ Error creating backup:', error);
        res.status(500).json({ error: 'Gagal membuat backup' });
    }
});

// =====================
// SYSTEM MONITORING
// =====================

app.get('/api/admin/system-info', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const [
            totalUsers,
            totalContracts,
            totalTemplates,
            recentActivity
        ] = await Promise.all([
            User.countDocuments({ is_active: true }),
            Contract.countDocuments(),
            Template.countDocuments({ is_active: true }),
            ContractHistory.find({})
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('performed_by', 'name')
                .populate('contract_id', 'number')
        ]);
        
        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        // Database connection status
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        const systemInfo = {
            server: {
                uptime: Math.floor(uptime),
                uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                memory: {
                    used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                    total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    external: Math.round(memoryUsage.external / 1024 / 1024)
                },
                platform: process.platform,
                nodeVersion: process.version
            },
            database: {
                status: dbStatus,
                collections: {
                    users: totalUsers,
                    contracts: totalContracts,
                    templates: totalTemplates
                }
            },
            features: {
                logoSupport: fs.existsSync(path.join(__dirname, 'assets', 'tradestation-logo.png')),
                pdfGeneration: true,
                digitalSignature: true,
                emailNotifications: false, // Set to true when implemented
                backupSystem: true
            },
            recentActivity: recentActivity.map(activity => ({
                action: activity.action,
                description: activity.description,
                user: activity.performed_by?.name || 'System',
                contract: activity.contract_id?.number || 'N/A',
                timestamp: activity.createdAt
            }))
        };
        
        res.json({ systemInfo });
    } catch (error) {
        console.error('❌ Error getting system info:', error);
        res.status(500).json({ error: 'Gagal mendapatkan info sistem' });
    }
});

// =====================
// CONTRACT TEMPLATE VARIABLES ENDPOINT
// =====================

app.get('/api/templates/:id/variables', authenticateToken, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }
        
        // Extract variables from content
        const content = template.content;
        const variableRegex = /\{\{([^}]+)\}\}/g;
        const foundVariables = [];
        let match;
        
        while ((match = variableRegex.exec(content)) !== null) {
            const variable = match[1].trim();
            if (!foundVariables.includes(variable)) {
                foundVariables.push(variable);
            }
        }
        
        res.json({ 
            template: {
                id: template._id,
                name: template.name,
                category: template.category
            },
            variables: foundVariables,
            predefinedVariables: template.variables || []
        });
    } catch (error) {
        console.error('❌ Error getting template variables:', error);
        res.status(500).json({ error: 'Gagal mendapatkan variabel template' });
    }
});

// =====================
// BULK OPERATIONS
// =====================

app.post('/api/admin/contracts/bulk-action', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { action, contractIds } = req.body;
        
        if (!action || !contractIds || !Array.isArray(contractIds)) {
            return res.status(400).json({ error: 'Action dan contract IDs harus diisi' });
        }
        
        let result;
        
        switch (action) {
            case 'delete':
                result = await Contract.updateMany(
                    { _id: { $in: contractIds } },
                    { status: 'cancelled' }
                );
                break;
                
            case 'send':
                result = await Contract.updateMany(
                    { _id: { $in: contractIds }, status: 'draft' },
                    { status: 'sent', sent_at: new Date() }
                );
                break;
                
            case 'expire':
                result = await Contract.updateMany(
                    { _id: { $in: contractIds } },
                    { status: 'expired' }
                );
                break;
                
            default:
                return res.status(400).json({ error: 'Action tidak valid' });
        }
        
        // Log bulk action
        for (const contractId of contractIds) {
            await logContractActivity(
                contractId,
                `bulk_${action}`,
                `Bulk action ${action} performed by ${req.user.name}`,
                req.user._id,
                req
            );
        }
        
        res.json({ 
            message: `Bulk ${action} berhasil`,
            affectedCount: result.modifiedCount 
        });
    } catch (error) {
        console.error('❌ Error in bulk action:', error);
        res.status(500).json({ error: 'Gagal melakukan bulk action' });
    }
});

// =====================
// CONTRACT PREVIEW
// =====================

app.post('/api/contracts/preview', authenticateToken, async (req, res) => {
    try {
        const { template_id, user_id, variables } = req.body;
        
        const template = await Template.findById(template_id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }
        
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }
        
        let content = template.content;
        
        // System variables
        const systemVariables = {
            '{{USER_NAME}}': user.name,
            '{{USER_EMAIL}}': user.email,
            '{{USER_PHONE}}': user.phone || '',
            '{{TRADING_ID}}': user.trading_account || '',
            '{{CONTRACT_NUMBER}}': 'PREVIEW-001',
            '{{CONTRACT_DATE}}': new Date().toLocaleDateString('id-ID'),
            '{{SIGNED_DATE}}': new Date().toLocaleString('id-ID')
        };
        
        // Replace system variables
        Object.keys(systemVariables).forEach(key => {
            const regex = new RegExp(key.replace(/[{}]/g, '\\// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Password lama dan baru harus diisi' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
        }

        const user = await User.findById(req.user._id);
        const validPassword = await bcrypt.compare(currentPassword, user.password);

        if (!validPassword) {
            return res.status(400).json({ error: 'Password lama tidak benar' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.findByIdAndUpdate(req.user._id, { password: hashedPassword });

        res.json({ message: 'Password berhasil diubah' });
    } catch (error) {
        console.error('❌ Error changing password:', error);
        res.status(500).json({ error: 'Gagal mengubah password' });
    }
});'), 'g');
            content = content.replace(regex, systemVariables[key]);
        });
        
        // Replace custom variables
        if (variables) {
            Object.keys(variables).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                content = content.replace(regex, variables[key] || `[${key}]`);
            });
        }
        
        res.json({ 
            preview: content,
            template: {
                name: template.name,
                category: template.category
            },
            user: {
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('❌ Error generating preview:', error);
        res.status(500).json({ error: 'Gagal membuat preview' });
    }
});

// =====================
// ADVANCED STATISTICS
// =====================

app.get('/api/admin/analytics', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const period = req.query.period || '30'; // days
        const startDate = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);
        
        // Contract statistics
        const contractStats = await Contract.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                        status: "$status"
                    },
                    count: { $sum: 1 },
                    totalValue: { $sum: "$amount" }
                }
            },
            { $sort: { "_id.date": 1 } }
        ]);
        
        // User activity
        const userActivity = await ContractHistory.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    activities: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]);
        
        // Template usage
        const templateUsage = await Contract.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $lookup: {
                    from: 'templates',
                    localField: 'template_id',
                    foreignField: '_id',
                    as: 'template'
                }
            },
            { $unwind: { path: '$template', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: '$template.name',
                    usage: { $sum: 1 },
                    totalValue: { $sum: '$amount' }
                }
            },
            { $sort: { usage: -1 } },
            { $limit: 10 }
        ]);
        
        // Performance metrics
        const performanceMetrics = await Contract.aggregate([
            {
                $group: {
                    _id: null,
                    totalContracts: { $sum: 1 },
                    signedContracts: {
                        $sum: { $cond: [{ $in: ['$status', ['signed', 'completed']] }, 1, 0] }
                    },
                    totalValue: { $sum: '$amount' },
                    avgSigningTime: {
                        $avg: {
                            $cond: [
                                { $and: ['$sent_at', '$signed_at'] },
                                { $subtract: ['$signed_at', '$sent_at'] },
                                null
                            ]
                        }
                    }
                }
            }
        ]);
        
        const metrics = performanceMetrics[0] || {};
        const conversionRate = metrics.totalContracts > 0 ? 
            (metrics.signedContracts / metrics.totalContracts * 100).toFixed(2) : 0;
        
        res.json({
            period: parseInt(period),
            contractStats,
            userActivity,
            templateUsage,
            summary: {
                totalContracts: metrics.totalContracts || 0,
                signedContracts: metrics.signedContracts || 0,
                conversionRate: parseFloat(conversionRate),
                totalValue: metrics.totalValue || 0,
                avgSigningTime: metrics.avgSigningTime ? 
                    Math.round(metrics.avgSigningTime / (1000 * 60 * 60)) : 0 // hours
            }
        });
    } catch (error) {
        console.error('❌ Error generating analytics:', error);
        res.status(500).json({ error: 'Gagal mendapatkan analitik' });
    }
});

// =====================
// ERROR HANDLING
// =====================

app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint tidak ditemukan',
        path: req.path,
        method: req.method,
        version: '2.0.0-advanced',
        suggestion: 'Periksa dokumentasi API untuk endpoint yang tersedia'
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        version: '2.0.0-advanced',
        timestamp: new Date().toISOString(),
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
    console.log('SIGTERM received, shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');  
    await mongoose.connection.close();
    process.exit(0);
});

// =====================
// START ADVANCED SERVER
// =====================

async function startAdvancedServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Advanced Digital Contract Server v2.0`);
            console.log(`📱 Server running on port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas Connected`);
            console.log(`🎨 Logo Support: ${fs.existsSync(path.join(__dirname, 'assets', 'tradestation-logo.png')) ? 'Enabled' : 'Disabled'}`);
            console.log(`📋 PDF Engine: Advanced v2.0 with TradeStation Branding`);
            console.log(`✅ All advanced features operational!`);
            console.log(`🎯 Ready for production deployment!`);
            console.log(`\n📚 Available Endpoints:`);
            console.log(`   • POST /api/auth/login - User authentication`);
            console.log(`   • GET  /api/auth/me - Get current user info`);
            console.log(`   • GET  /api/admin/stats - Dashboard statistics (Admin)`);
            console.log(`   • GET  /api/admin/contracts - Contract management (Admin)`);
            console.log(`   • GET  /api/admin/templates - Template management (Admin)`);
            console.log(`   • GET  /api/admin/users - User management (Admin)`);
            console.log(`   • GET  /api/contracts/access/:token - Public contract access`);
            console.log(`   • POST /api/contracts/access/:token/sign - Sign contract`);
            console.log(`   • GET  /api/contracts/download/:id - Download PDF`);
            console.log(`   • GET  /api/user/contracts - User contracts`);
            console.log(`   • GET  /api/notifications - Notifications`);
            console.log(`   • GET  /api/search - Search functionality`);
            console.log(`   • GET  /api/settings - User settings`);
            console.log(`   \n🔑 Default Login Credentials:`);
            console.log(`   Admin: admin@tradestation.com / admin123`);
            console.log(`   User:  hermanzal@trader.com / trader123`);
        });

        server.on('error', (error) => {
            console.error('❌ Server error:', error);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM signal received: closing HTTP server');
            server.close(() => {
                console.log('HTTP server closed');
            });
        });

    } catch (error) {
        console.error('❌ Failed to start advanced server:', error);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT} (database connection failed)`);
        });
    }
}

startAdvancedServer();api/admin/contracts/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Soft delete by setting status to cancelled
        await Contract.findByIdAndUpdate(req.params.id, { 
            status: 'cancelled',
            admin_notes: `Dihapus oleh admin: ${req.user.name} pada ${new Date().toISOString()}`
        });

        await logContractActivity(
            contract._id,
            'deleted',
            `Kontrak dihapus oleh admin: ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({ message: 'Kontrak berhasil dihapus' });
    } catch (error) {
        console.error('❌ Error deleting contract:', error);
        res.status(500).json({ error: 'Gagal menghapus kontrak' });
    }
});

app.post('/api/admin/contracts/:id/send', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        if (contract.status !== 'draft') {
            return res.status(400).json({ error: 'Kontrak sudah dikirim atau sudah ditandatangani' });
        }

        await Contract.findByIdAndUpdate(req.params.id, {
            status: 'sent',
            sent_at: new Date()
        });

        await logContractActivity(
            contract._id,
            'sent',
            `Kontrak dikirim oleh admin: ${req.user.name}`,
            req.user._id,
            req
        );

        res.json({
            message: 'Kontrak berhasil dikirim',
            access_url: `${req.protocol}://${req.get('host')}/?token=${contract.access_token}`
        });
    } catch (error) {
        console.error('❌ Error sending contract:', error);
        res.status(500).json({ error: 'Gagal mengirim kontrak' });
    }
});

// =====================
// ADMIN ROUTES - TEMPLATE MANAGEMENT
// =====================

app.get('/api/admin/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        
        let query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }
        
        const templates = await Template.find(query)
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();
        
        const total = await Template.countDocuments(query);
        
        res.json({
            templates: templates.map(template => ({
                ...template,
                created_by_name: template.created_by?.name || 'System'
            })),
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                totalItems: total
            }
        });
    } catch (error) {
        console.error('❌ Error getting templates:', error);
        res.status(500).json({ error: 'Gagal mendapatkan data template' });
    }
});

app.post('/api/admin/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, description, content, variables, tags } = req.body;

        if (!name || !content) {
            return res.status(400).json({ error: 'Nama dan konten template harus diisi' });
        }

        const template = await Template.create({
            name,
            category: category || 'general',
            description,
            content,
            variables: variables ? variables.split(',').map(v => v.trim()) : [],
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
            created_by: req.user._id
        });

        res.status(201).json({
            message: 'Template berhasil dibuat',
            template
        });
    } catch (error) {
        console.error('❌ Error creating template:', error);
        res.status(500).json({ error: 'Gagal membuat template' });
    }
});

app.get('/api/admin/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id)
            .populate('created_by', 'name');

        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        res.json({ template });
    } catch (error) {
        console.error('❌ Error getting template:', error);
        res.status(500).json({ error: 'Gagal mendapatkan template' });
    }
});

app.put('/api/admin/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, description, content, variables, tags, is_active } = req.body;

        const template = await Template.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        const updatedTemplate = await Template.findByIdAndUpdate(
            req.params.id,
            {
                ...(name && { name }),
                ...(category && { category }),
                ...(description !== undefined && { description }),
                ...(content && { content }),
                ...(variables && { variables: variables.split(',').map(v => v.trim()) }),
                ...(tags && { tags: tags.split(',').map(t => t.trim()) }),
                ...(is_active !== undefined && { is_active }),
                version: template.version + 1
            },
            { new: true }
        );

        res.json({
            message: 'Template berhasil diupdate',
            template: updatedTemplate
        });
    } catch (error) {
        console.error('❌ Error updating template:', error);
        res.status(500).json({ error: 'Gagal mengupdate template' });
    }
});

app.delete('/api/admin/templates/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const template = await Template.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        // Check if template is being used
        const contractsUsingTemplate = await Contract.countDocuments({ 
            template_id: req.params.id 
        });

        if (contractsUsingTemplate > 0) {
            // Soft delete by deactivating
            await Template.findByIdAndUpdate(req.params.id, { is_active: false });
            res.json({ message: 'Template berhasil dinonaktifkan' });
        } else {
            // Hard delete if not used
            await Template.findByIdAndDelete(req.params.id);
            res.json({ message: 'Template berhasil dihapus' });
        }
    } catch (error) {
        console.error('❌ Error deleting template:', error);
        res.status(500).json({ error: 'Gagal menghapus template' });
    }
});

// =====================
// ADMIN ROUTES - USER MANAGEMENT
// =====================

app.get('/api/admin/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const role = req.query.role || '';
        
        let query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { trading_account: { $regex: search, $options: 'i' } }
            ];
        }
        if (role) {
            query.role = role;
        }
        
        const users = await User.find(query)
            .select('-password -login_attempts -locked_until')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();
        
        const total = await User.countDocuments(query);
        
        res.json({
            users: users.map(user => ({
                ...user,
                created_by_name: user.created_by?.name || 'System'
            })),
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                totalItems: total
            }
        });
    } catch (error) {
        console.error('❌ Error getting users:', error);
        res.status(500).json({ error: 'Gagal mendapatkan data pengguna' });
    }
});

app.post('/api/admin/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const {
            name,
            email,
            username,
            password,
            phone,
            trading_account,
            balance,
            role
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nama, email, dan password harus diisi' });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email sudah digunakan' });
        }

        // Check if username already exists (if provided)
        if (username) {
            const existingUsername = await User.findOne({ username: username.toLowerCase() });
            if (existingUsername) {
                return res.status(400).json({ error: 'Username sudah digunakan' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            name,
            email: email.toLowerCase(),
            username: username?.toLowerCase(),
            password: hashedPassword,
            phone,
            trading_account,
            balance: balance || 0,
            role: role || 'user',
            created_by: req.user._id
        });

        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json({
            message: 'Pengguna berhasil dibuat',
            user: userResponse
        });
    } catch (error) {
        console.error('❌ Error creating user:', error);
        res.status(500).json({ error: 'Gagal membuat pengguna' });
    }
});

app.get('/api/admin/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password -login_attempts -locked_until')
            .populate('created_by', 'name');

        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
        }

        res.json({ user });
    } catch (error) {
        console.error('❌ Error getting user:', error);
        res.status(500).json({ error: 'Gagal mendapatkan pengguna' });
    }
});

app.put('/api/admin/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const {
            name,
            email,
            username,
            phone,
            trading_account,
            balance,
            role,
            is_active
        } = req.body;

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
        }

        // Check email uniqueness if changed
        if (email && email.toLowerCase() !== user.email) {
            const existingEmail = await User.findOne({ 
                email: email.toLowerCase(),
                _id: { $ne: req.params.id }
            });
            if (existingEmail) {
                return res.status(400).json({ error: 'Email sudah digunakan' });
            }
        }

        // Check username uniqueness if changed
        if (username && username.toLowerCase() !== user.username) {
            const existingUsername = await User.findOne({ 
                username: username.toLowerCase(),
                _id: { $ne: req.params.id }
            });
            if (existingUsername) {
                return res.status(400).json({ error: 'Username sudah digunakan' });
            }
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            {
                ...(name && { name }),
                ...(email && { email: email.toLowerCase() }),
                ...(username && { username: username.toLowerCase() }),
                ...(phone !== undefined && { phone }),
                ...(trading_account !== undefined && { trading_account }),
                ...(balance !== undefined && { balance }),
                ...(role && { role }),
                ...(is_active !== undefined && { is_active })
            },
            { new: true }
        ).select('-password -login_attempts -locked_until');

        res.json({
            message: 'Pengguna berhasil diupdate',
            user: updatedUser
        });
    } catch (error) {
        console.error('❌ Error updating user:', error);
        res.status(500).json({ error: 'Gagal mengupdate pengguna' });
    }
});

app.delete('/
