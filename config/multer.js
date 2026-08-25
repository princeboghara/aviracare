const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// In serverless environments like Vercel, /var/task is read-only.
// We must store temporary uploaded files in os.tmpdir() (e.g. /tmp)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const uploadDir = isServerless 
    ? path.join(os.tmpdir(), 'uploads') 
    : path.join(__dirname, '..', 'public', 'uploads');

try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (err) {
    console.warn('⚠️ Multer uploadDir creation note:', err.message);
}

const sharedStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const cleanName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${cleanName}`);
    }
});

const limits = { fileSize: 50 * 1024 * 1024 }; // 50MB Max File Size

const memoryUpload = multer({ storage: multer.memoryStorage(), limits });
const upload = multer({ storage: sharedStorage, limits });
const uploadPdf = multer({ storage: sharedStorage, limits });

module.exports = {
    upload,
    uploadPdf,
    memoryUpload
};
