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

## Pihak A:
{{USER_NAME}}

## Pihak B: PT. Konsultasi Profesional Indonesia
**Alamat:** Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3, RT.1/RW.2, Kuningan, Jakarta Selatan 12950

**Kontak:** Prof. Bima Agung Rachel

**Telepon:** +62 852 - 5852 - 8771

**Pihak A**, sebagai individu, setuju untuk menggunakan layanan analisis pasar atau layanan konsultasi yang disediakan oleh **Pihak B**, PT. Konsultasi Profesional Indonesia. Pihak B menyediakan layanan seperti analisis pasar, konsultasi investasi, analisis produk, laporan riset pasar, dsb. Untuk memajukan pembangunan dan kerja sama bersama yang saling menguntungkan, dan berdasarkan prinsip kesetaraan dan saling menghormati, kedua belah pihak menyepakati ketentuan-ketentuan berikut untuk kerja sama ini, dan akan secara ketat mematuhinya.

## Pasal 1: Definisi Awal

1.1. Biaya konsultasi layanan merujuk pada nilai profit dari investasi apapun oleh pelanggan. Anda dapat meminta Pihak B untuk melakukan analisis data, laporan, dll.

1.2. Biaya transaksi merujuk pada biaya yang dibebankan oleh Pihak B kepada Pihak A. Biaya ini dihitung berdasarkan jumlah Profit dari transaksi Investasi sebesar 30 % hingga 50 %.

1.3. Nilai modal Investasi Pihak A sebesar {{AMOUNT}} dengan durasi kontrak kerja sama investasi selama {{DAY}} hari atau minimal {{NUMBER}} kali transaksi investasi.

## Pasal 2: Konten Layanan dan Standar Tarif

2.1. Pihak B menyediakan analisis dan rekomendasi kepada Pihak A.

2.2. Pihak A menyetujui metode dan jumlah pembayaran komisi konsultasi.

2.3. Jika ada biaya tambahan dalam proses kerja sama, harus disetujui bersama sebelumnya.

2.4. Laporan akhir yang disediakan Pihak B kepada Pihak A mencakup informasi tentang tren industri, analisis pasar, dan opini profesional lainnya.

2.5. Informasi yang disediakan oleh Pihak B harus dijaga kerahasiaannya oleh Pihak A dan tidak boleh disebarkan tanpa izin tertulis.

## Pasal 3: Metode Penyelesaian

3.1. Pihak A akan menyelesaikan pembayaran untuk layanan konsultasi / panduan transaksi investasi setelah Pihak A mendapatkan nilai Profit dari Transaksi investasi

dan pembayaran komisi konsultasi berlaku selama {{DAY}} hari atau minimal {{NUMBER}} kali transaksi investasi.

3.2. Jika pembayaran tidak dilakukan tepat waktu, Pihak A akan dikenakan denda harian.

3.3. Jika pembayaran tetap tidak dilakukan dalam 48 jam, maka Pihak B dapat menangguhkan layanan.

3.4. Pihak A bertanggung jawab atas biaya tambahan akibat kegagalan pembayaran.

3.5. Jika terjadi pembatalan, biaya layanan yang sudah dibayarkan tidak dapat dikembalikan.

## Pasal 4: Hak dan Kewajiban Pihak A

4.1. Pihak A berhak meminta, dan menerima data yang akurat untuk hasil profit 100 % oleh Pihak B. Jika Pihak A collapse / merugi Pihak B wajib melakukan gant rugi

dengan nilai yang sama kepada Pihak A.

4.2. Pihak A berhak tidak menambah nominal modal selama kontrak perjanjian kerja sama investasi ini berlaku yaitu {{DAY}} hari atau minimal {{NUMBER}} kali transaksi investasi.

4.3. Pihak A berhak mendapatkan panduan investasi terbaik sebanyak 5 hingga 10 kali transaksi per harinya selama masa kontrak perjanjian kerja sama investasi ini berlaku.

4.4. Pihak A wajib mengikuti panduan transaksi dengan benar oleh Pihak B. Jika melakukan transaksi investasi diluar panduan Pihak B

seluruh resiko hasil transaksi tersebut bukan tanggung jawab Pihak B.

4.5. Pihak A wajib bayarkan komisi konsultasi sebanyak 30 % dari nilai profit transaksi investasi dan dibayarkan setelah transaksi investasi selesai dan 

wajib Penarikan seluruh modal investasi dan hasil profit transaksi investasi setelah masa durasi kontrak kerja sama investasi selama {{DAY}} hari atau minimal {{NUMBER}} kali transaksi investasi.

4.6. Pihak A menjamin bahwa dana yang digunakan berasal dari sumber yang sah dan dapat dipertanggung jawabkan.

4.7. Pihak A tidak boleh menggunakan informasi layanan ini untuk tindakan yang melanggar hukum seperti pencucian uang, perjudian, penghindaran pajak, dll.

4.8. Pihak A wajib melakukan / mengikuti panduan investasi sebanyak 3 kali transaksi perharinya sesuai jadwal investasi dari Pihak B.

## Pasal 5: Hak dan Kewajiban Pihak B

5.1. Pihak B harus menangani permintaan konsultasi dari Pihak A sesuai perjanjian.

5.2. Pihak B bertanggung jawab memberikan informasi konsultasi investasi secara akurat dan menanggung resiko sebesar 100% pengembalian modal jika terjadi collapse / merugi kepada Pihak A.

5.3. Dalam jam kerja normal, Pihak B akan merespons permintaan dari Pihak A untuk transaksi investasi diluar jadwal yang diberikan Pihak B.

5.4. Pihak B berhak mendapatkan pembayaran komisi konsultasi dari pihak A sebesar 30 % dari nilai Profit transaksi investasi.

5.5. Pihak B dapat menghentikan layanan jika Pihak A tidak membayar atau bertindak mencurigakan.

5.6. Pihak B tidak dibenarkan meminta pembayaran diluar jumlah yang disepekati dalam isi perjanjian kontrak kerja sama investasi ini.

5.7. Pihak B tidak bertanggung jawab atas risiko operasional dari keputusan investasi yang dilakukan Pihak A tanpa panduan atau diluar panduan pihak B.

5.8. Pihak B dapat menolak transaksi yang melanggar hukum atau mencurigakan.

5.9. Sengketa diselesaikan melalui negosiasi damai.

5.10. Pihak B wajib berikan panduan dan jadwal transaksi investasi minimal 3 kali transaksi per harinya kepada pihak A.

5.11. Pihak B berhak mengakhiri perjanjian jika Pihak A melakukan kecurangan pada akun investasi. 

5.12. Jika Pihak A melanggar hukum atau menyebabkan kerugian, Pihak B dapat menuntut ganti rugi dan menyelesaikan secara hukum yang berlaku di indonesia.

5.13. Pihak B berhak tidak bertanggung jawab atas pembekuan seluruh aset / modal dan hasil profit investasi pihak A oleh Platform Tradestation, jika Pihak A melakukan penarikan berulang kali 

selama masa durasi kontrak kerja sama investasi ini berlangsung / belum selesai.

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
                        'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'CONSULTATION_FEE', 
                        'CONTRACT_PERIOD', 'DAY', 'NUMBER', 
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
// MIDDLEWARE AUTENTIKASI - DIPINDAHKAN KE SINI (SEBELUM ROUTES)
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
// MEMBUAT PDF KONTRAK - DIPINDAHKAN KE SINI (SEBELUM ROUTES)
// =====================

async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('🔄 Starting PDF generation for contract:', contract.number);
            
            // Validasi input data
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
            
            // Event handlers dengan error handling
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

            // Mulai membuat PDF
            console.log('📝 Adding content to PDF...');

            // HEADER
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
            
            // Garis pemisah
            doc.moveTo(50, doc.y)
               .lineTo(550, doc.y)
               .stroke();
            
            doc.moveDown(1);
            
            // Judul kontrak
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .text('PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(11)
               .font('Helvetica')
               .text(`Nomor Kontrak: ${contract.number || 'N/A'}`, { align: 'center' });
            
            doc.moveDown(1.5);

            // Info kontrak dalam box
            const infoY = doc.y;
            doc.rect(50, infoY, 500, 80).stroke();
            
            doc.fontSize(10)
               .font('Helvetica-Bold')
               .text('INFORMASI KONTRAK', 60, infoY + 10);
            
            doc.fontSize(9)
               .font('Helvetica')
               .text(`Nama: ${user.name || 'N/A'}`, 60, infoY + 25)
               .text(`Email: ${user.email || 'N/A'}`, 60, infoY + 40)
               .text(`Trading ID: ${user.trading_account || 'N/A'}`, 300, infoY + 25)
               .text(`Nilai: ${formatCurrency(contract.amount || 0)}`, 300, infoY + 40)
               .text(`Tanggal: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, 60, infoY + 55);
            
            doc.y = infoY + 90;
            doc.moveDown(1);

            // Konten kontrak
            console.log('📋 Processing contract content...');
            
            let content = contract.content || '';
            
            // Jika tidak ada content, gunakan content default sederhana
            if (!content.trim()) {
                content = `
# PERJANJIAN LAYANAN KERJA SAMA KONSULTASI INVESTASI

**Pihak A:** {{USER_NAME}}
**Pihak B:** PT. Konsultasi Profesional Indonesia

Dengan ini kedua belah pihak sepakat untuk melakukan kerja sama konsultasi investasi dengan nilai {{AMOUNT}} sesuai dengan ketentuan yang berlaku.

**Tanggal Kontrak:** {{CONTRACT_DATE}}
**Nomor Kontrak:** {{CONTRACT_NUMBER}}

Kontrak ini sah dan mengikat kedua belah pihak.
                `;
            }
            
            // Replace variables dengan safe handling
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
                    '[Tanggal TTD]'
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

            // Process content line by line dengan safety check
            const lines = content.split('\n');
            let lineCount = 0;
            
            for (const line of lines) {
                try {
                    lineCount++;
                    const trimmedLine = line.trim();
                    
                    // Safety check - jangan buat PDF terlalu panjang
                    if (lineCount > 500) {
                        doc.fontSize(10)
                           .text('... [Konten dipotong untuk mencegah error] ...', { align: 'center' });
                        break;
                    }
                    
                    // Check if need new page
                    if (doc.y > 750) {
                        doc.addPage();
                    }
                    
                    if (!trimmedLine) {
                        doc.moveDown(0.3);
                        continue;
                    }
                    
                    // Format different line types
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
                        // Regular text
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
                    // Skip this line and continue
                }
            }

            // Signature section
            doc.addPage();
            
            // Header untuk halaman tanda tangan
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
                
                // Tanda tangan area
                const signY = doc.y;
                
                // Kolom kiri - Pihak B
                doc.fontSize(10)
                   .font('Helvetica-Bold')
                   .text('Perwakilan Pihak B:', 80, signY);
                
                doc.fontSize(9)
                   .font('Helvetica')
                   .text('Prof. Bima Agung Rachel', 80, signY + 60);
                
                // Kolom kanan - Pihak A
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
                
            } else {
                doc.fontSize(12)
                   .fillColor('#FF6600')
                   .text('⏳ MENUNGGU TANDA TANGAN', { align: 'center' });
                doc.fillColor('black');
            }

            // Footer
            doc.fontSize(8)
               .font('Helvetica')
               .text(`Dokumen dibuat otomatis oleh TradeStation pada ${new Date().toLocaleString('id-ID')}`,
                     50, 770, { align: 'center' });

            console.log('🔚 Finalizing PDF...');
            doc.end();

        } catch (error) {
            console.error('❌ Error in PDF generation:', error);
            reject(new Error(`PDF generation failed: ${error.message}`));
        }
    });
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
            version: '2.1.0',
            features: [
                'Sistem Kontrak Digital Lengkap',
                'Generasi PDF Lanjutan',
                'Dukungan Tanda Tangan Digital',
                'Manajemen Template',
                'Manajemen User',
                'Audit Trail',
                'Statistik Real-time',
                'Edit Template & User',
                'Preview Template',
                'Detail Kontrak'
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

// =====================
// ENDPOINT DOWNLOAD PDF - VERSI PERBAIKAN (TANPA DUPLIKASI)
// =====================

app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;
        
        console.log('📥 Download request for contract:', contractId);

        // Validasi ID
        if (!contractId || !mongoose.Types.ObjectId.isValid(contractId)) {
            console.log('❌ Invalid contract ID:', contractId);
            return res.status(400).json({ error: 'ID kontrak tidak valid' });
        }

        // Cari kontrak
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

        console.log('✅ Contract found:', {
            id: contractId,
            number: contract.number,
            status: contract.status,
            user: contract.user_id.name,
            amount: contract.amount
        });

        // Generate PDF dengan timeout protection
        console.log('🔄 Starting PDF generation...');
        
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF generation timeout')), 30000)
        );
        
        const pdfPromise = generateContractPDF(contract, contract.user_id, contract.signature_data);
        
        const pdfBuffer = await Promise.race([pdfPromise, timeoutPromise]);

        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new Error('PDF buffer kosong atau tidak valid');
        }

        console.log('✅ PDF generated successfully, size:', pdfBuffer.length);

        // Log activity (non-blocking)
        logContractActivity(
            contract._id,
            'downloaded',
            'PDF kontrak diunduh',
            null,
            req
        ).catch(err => console.warn('⚠️ Failed to log activity:', err.message));

        // Buat filename yang aman
        const safeName = (contract.user_id.name || 'User')
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
        
        const filename = `Kontrak_${contract.number}_${safeName}.pdf`;

        // Set response headers
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
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// =====================
// ENDPOINT TEST PDF - SEKARANG BISA MENGGUNAKAN authenticateToken
// =====================

app.get('/api/contracts/:contractId/test-pdf', authenticateToken, async (req, res) => {
    try {
        const { contractId } = req.params;
        
        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account')
            .lean();

        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan' });
        }

        // Test data untuk debugging
        const testData = {
            contract: {
                id: contract._id,
                number: contract.number,
                title: contract.title,
                amount: contract.amount,
                status: contract.status,
                content_available: !!contract.content,
                content_length: contract.content ? contract.content.length : 0,
                variables: contract.variables || {},
                signed_at: contract.signed_at,
                has_signature: !!contract.signature_data
            },
            user: contract.user_id ? {
                name: contract.user_id.name,
                email: contract.user_id.email,
                phone: contract.user_id.phone,
                trading_account: contract.user_id.trading_account
            } : null,
            system_info: {
                node_version: process.version,
                memory_usage: process.memoryUsage(),
                uptime: process.uptime()
            },
            pdf_ready: contract.user_id && contract.content
        };

        res.json(testData);
    } catch (error) {
        console.error('Test PDF error:', error);
        res.status(500).json({ error: error.message });
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
        if (content) updateData.content = content.trim();

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
// ADDITIONAL ROUTES FOR ENHANCED FEATURES
// =====================

// Route untuk reset password user (admin only)
app.post('/api/users/:id/reset-password', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID user tidak valid' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        const passwordToUse = newPassword || 'trader123';
        const hashedPassword = await bcrypt.hash(passwordToUse, 12);

        await User.findByIdAndUpdate(id, { password: hashedPassword });

        res.json({
            message: 'Password berhasil direset',
            newPassword: passwordToUse
        });
    } catch (error) {
        console.error('Error reset password:', error);
        res.status(500).json({ error: 'Gagal reset password' });
    }
});

// Route untuk export data kontrak
app.get('/api/contracts/export', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { format = 'json', status, user_id, start_date, end_date } = req.query;
        
        let query = {};
        if (status) query.status = status;
        if (user_id) query.user_id = user_id;
        if (start_date || end_date) {
            query.createdAt = {};
            if (start_date) query.createdAt.$gte = new Date(start_date);
            if (end_date) query.createdAt.$lte = new Date(end_date);
        }

        const contracts = await Contract.find(query)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });

        const exportData = contracts.map(contract => ({
            number: contract.number,
            title: contract.title,
            user_name: contract.user_id?.name,
            user_email: contract.user_id?.email,
            amount: contract.amount,
            status: contract.status,
            created_at: contract.createdAt,
            signed_at: contract.signed_at,
            template_name: contract.template_id?.name,
            created_by: contract.created_by?.name
        }));

        if (format === 'csv') {
            // Convert to CSV
            const csvHeaders = 'Number,Title,User Name,User Email,Amount,Status,Created At,Signed At,Template,Created By\n';
            const csvRows = exportData.map(row => 
                [
                    row.number,
                    `"${row.title}"`,
                    `"${row.user_name}"`,
                    row.user_email,
                    row.amount,
                    row.status,
                    row.created_at,
                    row.signed_at || '',
                    `"${row.template_name || ''}"`,
                    `"${row.created_by || ''}"`
                ].join(',')
            ).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="contracts_export_${new Date().toISOString().split('T')[0]}.csv"`);
            res.send(csvHeaders + csvRows);
        } else {
            res.json({
                data: exportData,
                total: exportData.length,
                exported_at: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Error export kontrak:', error);
        res.status(500).json({ error: 'Gagal export kontrak' });
    }
});

// Route untuk duplicate template
app.post('/api/templates/:id/duplicate', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID template tidak valid' });
        }

        const originalTemplate = await Template.findById(id);
        if (!originalTemplate) {
            return res.status(404).json({ error: 'Template tidak ditemukan' });
        }

        const duplicatedTemplate = await Template.create({
            name: `${originalTemplate.name} (Copy)`,
            category: originalTemplate.category,
            content: originalTemplate.content,
            description: originalTemplate.description,
            variables: originalTemplate.variables,
            created_by: req.user._id
        });

        res.json({
            message: 'Template berhasil diduplikasi',
            data: duplicatedTemplate
        });
    } catch (error) {
        console.error('Error duplicate template:', error);
        res.status(500).json({ error: 'Gagal menduplikasi template' });
    }
});

// Route untuk bulk operations
app.post('/api/contracts/bulk-action', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { action, contract_ids } = req.body;
        
        if (!action || !contract_ids || !Array.isArray(contract_ids)) {
            return res.status(400).json({ error: 'Action dan contract_ids diperlukan' });
        }

        let updateData = {};
        let actionDescription = '';

        switch (action) {
            case 'cancel':
                updateData = { status: 'cancelled' };
                actionDescription = 'dibatalkan secara bulk';
                break;
            case 'send':
                updateData = { status: 'sent', sent_at: new Date() };
                actionDescription = 'dikirim secara bulk';
                break;
            default:
                return res.status(400).json({ error: 'Action tidak valid' });
        }

        const result = await Contract.updateMany(
            { 
                _id: { $in: contract_ids },
                status: { $nin: ['signed', 'completed'] }
            },
            updateData
        );

        // Log activity for each contract
        for (const contractId of contract_ids) {
            await logContractActivity(
                contractId,
                action,
                `Kontrak ${actionDescription} oleh admin ${req.user.name}`,
                req.user._id,
                req
            );
        }

        res.json({
            message: `${result.modifiedCount} kontrak berhasil ${actionDescription}`,
            modified_count: result.modifiedCount
        });
    } catch (error) {
        console.error('Error bulk action:', error);
        res.status(500).json({ error: 'Gagal melakukan bulk action' });
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
            console.log(`🚀 TradeStation Digital Contract Server v2.1.0`);
            console.log(`📱 Server berjalan di port ${PORT}`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`💾 Database: MongoDB Atlas Terhubung`);
            console.log(`✅ Fitur: Sistem Kontrak Digital Lengkap`);
            console.log(`🎯 Siap menangani permintaan!`);
            console.log(`📋 Perbaikan yang telah dilakukan:`);
            console.log(`   - ✅ MIDDLEWARE ORDER FIXED - authenticateToken sekarang di atas routes`);
            console.log(`   - ✅ PDF GENERATION FIXED - generateContractPDF dipindah ke posisi yang benar`);
            console.log(`   - ✅ NO DUPLICATION - hanya 1 endpoint download PDF yang diperbaiki`);
            console.log(`   - ✅ ENHANCED ERROR HANDLING - timeout dan logging lengkap`);
            console.log(`   - ✅ CLEAN STRUCTURE - urutan kode yang benar dan konsisten`);
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
