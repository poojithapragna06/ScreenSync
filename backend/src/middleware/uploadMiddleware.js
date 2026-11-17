const multer = require('multer');
const path = require('path');
const convertHeic = require('heic-convert');
const { getBucket } = require('../services/mediaStorage');

const EXTENSION_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
};

function resolveContentType(file) {
  const reportedType = String(file.mimetype || '').toLowerCase();
  if (reportedType.startsWith('image/') || reportedType.startsWith('video/')) return reportedType;
  return EXTENSION_MIME_TYPES[path.extname(file.originalname || '').toLowerCase()] || '';
}

function saveBuffer(file, buffer, contentType, filename, cb) {
  let uploadStream;
  try {
    uploadStream = getBucket().openUploadStream(filename, {
      contentType,
      metadata: { originalName: file.originalname, contentType },
    });
  } catch (err) {
    cb(err);
    return;
  }

  uploadStream.once('error', cb);
  uploadStream.once('finish', () => cb(null, {
    id: uploadStream.id,
    filename: uploadStream.filename,
    size: uploadStream.length,
  }));
  uploadStream.end(buffer);
}

// Keep normal uploads streaming to GridFS. HEIC/HEIF needs a buffer for
// conversion so TVs receive the broadly supported JPEG format instead.
const storage = {
  _handleFile(req, file, cb) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const isHeic = file.detectedContentType.startsWith('image/heic') ||
      file.detectedContentType.startsWith('image/heif') ||
      ['.heic', '.heif'].includes(extension);

    if (isHeic) {
      const chunks = [];
      file.stream.on('data', (chunk) => chunks.push(chunk));
      file.stream.once('error', cb);
      file.stream.once('end', async () => {
        try {
          const jpeg = await convertHeic({
            buffer: Buffer.concat(chunks),
            format: 'JPEG',
            quality: 0.9,
          });
          const filename = file.originalname.replace(/\.(heic|heif)$/i, '.jpg');
          saveBuffer(file, jpeg, 'image/jpeg', filename, cb);
        } catch (err) {
          cb(new Error(`Could not convert HEIC image ${file.originalname}: ${err.message}`));
        }
      });
      return;
    }

    let uploadStream;
    try {
      uploadStream = getBucket().openUploadStream(file.originalname, {
        contentType: file.detectedContentType,
        metadata: { originalName: file.originalname, contentType: file.detectedContentType },
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
    const contentType = resolveContentType(file);
    if (contentType) {
      file.detectedContentType = contentType;
      return cb(null, true);
    }
    return cb(new Error('Only image and video files are allowed'), false);
  },
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024 },
});

module.exports = upload;
