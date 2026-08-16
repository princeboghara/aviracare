require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

if (process.env.CLOUDINARY_URL) {
    cloudinary.config({
        cloudinary_url: process.env.CLOUDINARY_URL
    });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true
    });
}

/**
 * Upload a local file to Cloudinary and return secure URL.
 * If Cloudinary is not configured, returns local URL path.
 * 
 * @param {string} localFilePath Absolute path to file on disk
 * @param {object} options Cloudinary upload options (folder, resource_type, public_id)
 * @returns {Promise<{ url: string, public_id?: string, isCloud: boolean }>}
 */
async function uploadFile(localFilePath, options = {}) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
    const hasKeys = Boolean(cloudName && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) || Boolean(process.env.CLOUDINARY_URL);

    const filename = path.basename(localFilePath);
    const localUrl = `/uploads/${filename}`;

    if (!hasKeys) {
        return { url: localUrl, isCloud: false };
    }

    try {
        const uploadOptions = {
            folder: options.folder || 'aviracare/uploads',
            resource_type: options.resource_type || 'auto',
            use_filename: true,
            unique_filename: true,
            ...options
        };

        const result = await cloudinary.uploader.upload(localFilePath, uploadOptions);
        
        // Remove local temporary file once uploaded to Cloudinary
        if (fs.existsSync(localFilePath) && options.removeLocalAfterUpload !== false) {
            try { fs.unlinkSync(localFilePath); } catch (e) {}
        }

        return {
            url: result.secure_url,
            public_id: result.public_id,
            bytes: result.bytes,
            format: result.format,
            isCloud: true
        };
    } catch (err) {
        console.error("Cloudinary upload failed, falling back to local:", err.message);
        return { url: localUrl, isCloud: false };
    }
}

/**
 * Upload from Buffer (Memory) directly to Cloudinary
 */
function uploadBuffer(buffer, options = {}) {
    return new Promise((resolve, reject) => {
        const hasKeys = Boolean(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_URL);
        if (!hasKeys) {
            return reject(new Error("Cloudinary not configured"));
        }

        const uploadOptions = {
            folder: options.folder || 'aviracare/uploads',
            resource_type: options.resource_type || 'auto',
            ...options
        };

        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) return reject(error);
            resolve({
                url: result.secure_url,
                public_id: result.public_id,
                bytes: result.bytes,
                format: result.format,
                isCloud: true
            });
        });

        uploadStream.end(buffer);
    });
}

/**
 * Delete a file from Cloudinary given its public_id or full URL
 */
async function deleteCloudinaryFile(urlOrPublicId, options = {}) {
    if (!urlOrPublicId) return;
    try {
        let publicId = urlOrPublicId;
        if (urlOrPublicId.startsWith('http')) {
            // Extract public ID from cloudinary URL
            // e.g. https://res.cloudinary.com/lj87jjg9/image/upload/v12345/aviracare/products/sample.png -> aviracare/products/sample
            const matches = urlOrPublicId.match(/\/upload\/(?:v\d+\/)?([^\.]+)/);
            if (matches && matches[1]) {
                publicId = matches[1];
            }
        }
        await cloudinary.uploader.destroy(publicId, {
            resource_type: options.resource_type || 'auto'
        });
    } catch (err) {
        console.error("Cloudinary delete failed:", err.message);
    }
}

module.exports = {
    cloudinary,
    uploadFile,
    uploadBuffer,
    deleteCloudinaryFile
};
