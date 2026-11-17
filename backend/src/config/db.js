const dns = require('dns');
const mongoose = require('mongoose');

// Atlas (mongodb+srv) addresses need a DNS "SRV" lookup. On some Windows PCs
// Node only knows a local DNS server (127.0.0.1) that refuses these lookups
// ("querySrv ECONNREFUSED"), so use public DNS servers there instead.
function useWorkingDnsForAtlas(uri) {
  if (!/^mongodb\+srv:/.test(uri)) return;
  const servers = dns.getServers();
  if (servers.length && servers.every((s) => s === '127.0.0.1' || s === '::1')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('[MongoDB] Local DNS server only - using public DNS (8.8.8.8, 1.1.1.1) to find Atlas');
  }
}

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/screensync';

  mongoose.set('strictQuery', true);
  useWorkingDnsForAtlas(uri);

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
