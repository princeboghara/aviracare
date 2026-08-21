const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
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
