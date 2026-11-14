const multer = require('multer');
const { getBucket } = require('../services/mediaStorage');

// Multer's storage engine streams the incoming file directly to GridFS; file
// bytes are never buffered in application memory or written to local disk.
const storage = {
  _handleFile(req, file, cb) {
    let uploadStream;
    try {
      uploadStream = getBucket().openUploadStream(file.originalname, {
        contentType: file.mimetype,
        metadata: { originalName: file.originalname, contentType: file.mimetype },
      });
    } catch (err) {
      cb(err);
      return;
    }
    file.stream.once('error', (err) => uploadStream.destroy(err));
    uploadStream.once('error', cb);
    uploadStream.once('finish', () => cb(null, {
      id: uploadStream.id,
      filename: uploadStream.filename,
      size: uploadStream.length,
    }));
    file.stream.pipe(uploadStream);
  },
  _removeFile(req, file, cb) {
    if (!file.id) return cb(null);
    getBucket().delete(file.id).then(() => cb(null), cb);
  },
};

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only image and video files are allowed'), false);
  },
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024 },
});

module.exports = upload;
