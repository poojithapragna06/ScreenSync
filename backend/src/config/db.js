const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/screensync';

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    if (!process.env.MONGODB_URI) {
      console.error('[MongoDB] MONGODB_URI is not set, so the local database was tried. On a hosting service, set MONGODB_URI to your MongoDB Atlas connection string.');
    } else if (/mongodb\+srv:/.test(uri)) {
      console.error('[MongoDB] Check the Atlas user/password in MONGODB_URI, and that Atlas "Network Access" allows this server (0.0.0.0/0 for Render).');
    }
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] Error:', err.message);
  });
}

module.exports = connectDB;
