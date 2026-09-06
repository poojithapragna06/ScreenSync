require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { initWebSocketServer } = require('./services/websocketService');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const playlistRoutes = require('./routes/playlistRoutes');
const taskRoutes = require('./routes/taskRoutes');
const alertRoutes = require('./routes/alertRoutes');
const deviceRoutes = require('./routes/deviceRoutes');

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'ScreenSync backend is healthy', data: { uptime: process.uptime() } });
});

app.use('/auth', authRoutes);
app.use('/', playlistRoutes);
app.use('/', taskRoutes);
app.use('/', alertRoutes);
app.use('/', deviceRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

initWebSocketServer(server);

async function start() {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`[ScreenSync] Backend listening on http://localhost:${PORT}`);
    console.log(`[ScreenSync] WebSocket endpoint: ws://localhost:${PORT}`);
  });
}

start();

process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err);
});

module.exports = { app, server };
