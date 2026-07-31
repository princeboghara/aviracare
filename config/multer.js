const multer = require('multer');
const path = require('path');
const fs = require('fs');

const sharedStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});

const memoryUpload = multer({ storage: multer.memoryStorage() });
const upload = multer({ storage: sharedStorage });

module.exports = {
    memoryUpload,
    upload
};