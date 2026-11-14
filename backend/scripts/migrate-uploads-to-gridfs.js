require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const connectDB = require('../src/config/db');
const mongoose = require('mongoose');
const Playlist = require('../src/models/Playlist');
const Task = require('../src/models/Task');
const { getBucket } = require('../src/services/mediaStorage');

const uploadDir = path.join(__dirname, '../uploads');

function localFilename(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, 'http://screensync.local');
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    const filename = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    return filename && !filename.includes('/') && !filename.includes('\\') ? filename : null;
  } catch (_) {
    return null;
  }
}

async function main() {
  await connectDB();
  const bucket = getBucket();
  const mapping = new Map();
  const migratedByFilename = new Map();
  let migrated = 0;
  let missing = 0;

  const playlists = await Playlist.find();
  const tasks = await Task.find({ 'media.url': { $regex: '/uploads/' } });
  const urls = new Set();
  for (const playlist of playlists) for (const item of playlist.items) urls.add(item.url);
  for (const task of tasks) urls.add(task.media?.url);

  for (const oldUrl of urls) {
    const filename = localFilename(oldUrl);
    if (!filename) continue;
    const sourcePath = path.join(uploadDir, filename);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      missing += 1;
      console.warn(`[Migration] File not found; references left unchanged: ${filename}`);
      continue;
    }
    let id = migratedByFilename.get(filename);
    if (!id) {
      const upload = bucket.openUploadStream(filename, {
        contentType: require('mime-types').lookup(filename) || 'application/octet-stream',
        metadata: { originalName: filename, migratedFrom: 'backend/uploads' },
      });
      await pipeline(fs.createReadStream(sourcePath), upload);
      id = upload.id.toString();
      migratedByFilename.set(filename, id);
      migrated += 1;
      console.log(`[Migration] ${filename} -> GridFS ${id}`);
    }
    const origin = /^https?:\/\//i.test(oldUrl) ? new URL(oldUrl).origin : (process.env.PUBLIC_BASE_URL || '');
    mapping.set(oldUrl, `${origin}/media/${id}`);
  }

  for (const playlist of playlists) {
    let changed = false;
    for (const item of playlist.items) {
      if (mapping.has(item.url)) { item.url = mapping.get(item.url); changed = true; }
    }
    if (changed) await playlist.save();
  }
  for (const task of tasks) {
    if (mapping.has(task.media?.url)) {
      task.media.url = mapping.get(task.media.url);
      await task.save();
    }
  }
  console.log(`[Migration] Complete: ${migrated} file(s) copied, ${missing} missing file(s). Local originals were kept.`);
}

main()
  .catch((err) => { console.error('[Migration] Failed:', err); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
