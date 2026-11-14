const mongoose = require('mongoose');

const BUCKET_NAME = process.env.GRIDFS_BUCKET || 'screensyncMedia';

function getBucket() {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

function extractGridFsId(url) {
  const match = typeof url === 'string' && url.match(/\/media\/([a-f\d]{24})(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function mediaUrl(req, id) {
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/media/${id}`;
}

async function deleteGridFsIfUnreferenced(ids) {
  const Playlist = require('../models/Playlist');
  const Task = require('../models/Task');
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  for (const id of uniqueIds) {
    const pattern = new RegExp(`/media/${id}(?:$|[?#])`, 'i');
    const [playlistUse, taskUse] = await Promise.all([
      Playlist.exists({ 'items.url': pattern }),
      Task.exists({ 'media.url': pattern }),
    ]);
    if (playlistUse || taskUse) continue;
    const fileExists = await mongoose.connection.db
      .collection(`${BUCKET_NAME}.files`)
      .findOne({ _id: new mongoose.Types.ObjectId(id) }, { projection: { _id: 1 } });
    if (fileExists) {
      await getBucket().delete(new mongoose.Types.ObjectId(id));
    }
  }
}

module.exports = { BUCKET_NAME, getBucket, extractGridFsId, mediaUrl, deleteGridFsIfUnreferenced };
