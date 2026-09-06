const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/screensync';

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
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
