const mongoose = require('mongoose');
const { getBucket, BUCKET_NAME } = require('../services/mediaStorage');

async function streamMedia(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Media not found', errors: [] });
    }
    const id = new mongoose.Types.ObjectId(req.params.id);
    const files = mongoose.connection.db.collection(`${BUCKET_NAME}.files`);
    const file = await files.findOne({ _id: id });
    if (!file) return res.status(404).json({ success: false, message: 'Media not found', errors: [] });

    const size = file.length;
    const type = file.metadata?.contentType || file.contentType || 'application/octet-stream';
    let start = 0;
    let end = size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      if (!match[1]) {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), size - 1);
      }
      if (start >= size || end < start) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = getBucket().openDownloadStream(id, { start, end: end + 1 });
    stream.on('error', (err) => {
      if (!res.headersSent) next(err);
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { streamMedia };
