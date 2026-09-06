const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const Playlist = require('../models/Playlist');

const {
  CONTENT_TYPE,
  NETWORK_TYPE,
  DEVICE_ROLE,
} = require('../utils/constants');

// deviceId -> {
//   ws,
//   device_id,
//   device_type,
//   network,
//   role,
//   status,
//   last_heartbeat,
//   last_sync,
//   current_content,
//   registeredAt
// }
const tvClients = new Map();

// Admin dashboard sockets
const adminClients = new Set();

let wss = null;
let heartbeatTimeoutMs = 30000;
let heartbeatCheckIntervalMs = 10000;
let checkIntervalHandle = null;
let pingIntervalHandle = null;

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function deviceSummary(entry) {
  return {
    device_id: entry.device_id,
    device_type: entry.device_type,
    network: entry.network,
    role: entry.role,
    status: entry.status,
    last_heartbeat: entry.last_heartbeat,
    last_sync: entry.last_sync,
    current_content: entry.current_content,
    registeredAt: entry.registeredAt,
  };
}

function getDevices() {
  return Array.from(tvClients.values()).map(deviceSummary);
}

function broadcastToAdmins(message) {
  for (const adminWs of adminClients) {
    safeSend(adminWs, message);
  }
}

function broadcastDeviceListToAdmins() {
  broadcastToAdmins({
    type: CONTENT_TYPE.DEVICE_LIST,
    devices: getDevices(),
  });
}
function broadcast(message) {
  broadcastToTVs(message);
  broadcastToAdmins(message);
}
// Send message to every registered TV
function broadcastToTVs(message) {
  for (const entry of tvClients.values()) {
    safeSend(entry.ws, message);

    if (message.type === CONTENT_TYPE.PLAYLIST) {
      entry.current_content = {
        type: 'playlist',
        name: message.name || null,
      };

      entry.last_sync =
        message.sync_timestamp || new Date().toISOString();
    } else if (message.type === CONTENT_TYPE.TASK) {
      entry.current_content = {
        type: 'task',
        title: message.title,
      };
    } else if (message.type === CONTENT_TYPE.ALERT) {
      entry.current_content = {
        type: 'alert',
        message: message.message,
      };
    }
  }

  broadcastDeviceListToAdmins();
}

// Send a message to one specific device
function sendToDevice(deviceId, message) {
  const entry = tvClients.get(deviceId);

  if (!entry || entry.status !== 'online') {
    return false;
  }

  safeSend(entry.ws, message);
  return true;
}

function removeClient(deviceId) {
  const entry = tvClients.get(deviceId);

  if (entry) {
    tvClients.delete(deviceId);
    broadcastDeviceListToAdmins();
  }
}

function markOffline(deviceId) {
  const entry = tvClients.get(deviceId);

  if (entry && entry.status !== 'offline') {
    entry.status = 'offline';
    broadcastDeviceListToAdmins();
  }
}

/**
 * Send the currently active playlist to a newly connected TV.
 *
 * This fixes the refresh problem:
 *
 * TV refresh
 *    ↓
 * WebSocket reconnect
 *    ↓
 * register
 *    ↓
 * fetch active playlist
 *    ↓
 * send playlist to TV
 */
async function sendActivePlaylistToTV(ws) {
  try {
    const playlist = await Playlist.findOne({ active: true });

    if (!playlist) {
      console.log('[WebSocket] No active playlist for newly registered TV');
      return;
    }

    const message = {
      type: CONTENT_TYPE.PLAYLIST,
      playlist_id: playlist._id.toString(),
      name: playlist.name,
      items: playlist.items,
      sync_timestamp: playlist.sync_timestamp,
    };

    safeSend(ws, message);

    const deviceId = ws.deviceId;
    const entry = tvClients.get(deviceId);

    if (entry) {
      entry.current_content = {
        type: 'playlist',
        name: playlist.name,
      };

      entry.last_sync = playlist.sync_timestamp;
    }

    console.log(
      `[WebSocket] Sent active playlist "${playlist.name}" to ${deviceId}`
    );

    broadcastDeviceListToAdmins();
  } catch (err) {
    console.error(
      '[WebSocket] Failed to send active playlist:',
      err.message
    );
  }
}

async function handleRegister(ws, msg) {
  const {
    device_id,
    device_type,
    network,
    role,
  } = msg;

  // -----------------------------
  // Admin / Viewer registration
  // -----------------------------
  if (device_type === 'admin') {
    try {
      const decoded = jwt.verify(
        msg.token || '',
        process.env.JWT_SECRET
      );

      if (!['admin', 'viewer'].includes(decoded.role)) {
        safeSend(ws, {
          type: CONTENT_TYPE.ERROR,
          message: 'Role not permitted on admin channel',
        });

        ws.close();
        return;
      }

      ws.clientType = 'admin';

      adminClients.add(ws);

      safeSend(ws, {
        type: CONTENT_TYPE.ACK,
        message: 'Registered as admin',
      });

      safeSend(ws, {
        type: CONTENT_TYPE.DEVICE_LIST,
        devices: getDevices(),
      });
    } catch (err) {
      safeSend(ws, {
        type: CONTENT_TYPE.ERROR,
        message: 'Invalid or missing admin token',
      });

      ws.close();
    }

    return;
  }

  // -----------------------------
  // TV registration validation
  // -----------------------------
  if (!device_id || device_type !== 'tv') {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Invalid registration payload',
    });

    ws.close();
    return;
  }

  if (
    ![NETWORK_TYPE.LAN, NETWORK_TYPE.WIFI].includes(network)
  ) {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Invalid network type',
    });

    ws.close();
    return;
  }

  if (
    ![
      DEVICE_ROLE.REFERENCE,
      DEVICE_ROLE.BUFFERED,
    ].includes(role)
  ) {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Invalid device role',
    });

    ws.close();
    return;
  }

  // -----------------------------
  // Handle reconnection
  // -----------------------------
  const existing = tvClients.get(device_id);

  if (
    existing &&
    existing.ws !== ws &&
    existing.ws.readyState === WebSocket.OPEN
  ) {
    existing.ws.close();
  }

  ws.clientType = 'tv';
  ws.deviceId = device_id;

  tvClients.set(device_id, {
    ws,
    device_id,
    device_type: 'tv',
    network,
    role,
    status: 'online',
    last_heartbeat: new Date().toISOString(),
    last_sync: existing ? existing.last_sync : null,
    current_content: existing
      ? existing.current_content
      : null,
    registeredAt: existing
      ? existing.registeredAt
      : new Date().toISOString(),
  });

  safeSend(ws, {
    type: CONTENT_TYPE.ACK,
    message: `Registered device ${device_id}`,
  });

  broadcastDeviceListToAdmins();

  // Send currently active playlist after registration
  await sendActivePlaylistToTV(ws);
}

function handleHeartbeat(msg) {
  const {
    device_id,
    status,
    last_sync,
    network,
  } = msg;

  const entry = tvClients.get(device_id);

  if (!entry) return;

  entry.status =
    status === 'online'
      ? 'online'
      : entry.status;

  entry.last_heartbeat =
    new Date().toISOString();

  if (last_sync) {
    entry.last_sync = last_sync;
  }

  if (network) {
    entry.network = network;
  }

  broadcastDeviceListToAdmins();
}

function handleMessage(ws, raw) {
  let msg;

  try {
    msg = JSON.parse(raw);
  } catch (err) {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Message must be valid JSON',
    });

    return;
  }

  if (!msg || typeof msg.type !== 'string') {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Message must include a "type" field',
    });

    return;
  }

  switch (msg.type) {
    case CONTENT_TYPE.REGISTER:
      handleRegister(ws, msg);
      break;

    case CONTENT_TYPE.HEARTBEAT:
      handleHeartbeat(msg);
      break;

    default:
      safeSend(ws, {
        type: CONTENT_TYPE.ERROR,
        message: `Unknown message type: ${msg.type}`,
      });
  }
}

function handleClose(ws) {
  if (ws.clientType === 'admin') {
    adminClients.delete(ws);
    return;
  }

  if (ws.clientType === 'tv' && ws.deviceId) {
    markOffline(ws.deviceId);
  }
}

function initWebSocketServer(server) {
  heartbeatTimeoutMs =
    Number(process.env.HEARTBEAT_TIMEOUT_MS) || 30000;

  heartbeatCheckIntervalMs =
    Number(process.env.HEARTBEAT_INTERVAL_MS) || 10000;

  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      handleMessage(ws, raw);
    });

    ws.on('close', () => {
      handleClose(ws);
    });

    ws.on('error', () => {
      handleClose(ws);
    });
  });

  // Detect dead connections
  pingIntervalHandle = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        handleClose(ws);
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, heartbeatCheckIntervalMs);

  // Mark TVs offline when heartbeat expires
  checkIntervalHandle = setInterval(() => {
    const now = Date.now();

    for (const entry of tvClients.values()) {
      const elapsed =
        now -
        new Date(entry.last_heartbeat).getTime();

      if (
        elapsed > heartbeatTimeoutMs &&
        entry.status !== 'offline'
      ) {
        markOffline(entry.device_id);
      }
    }
  }, heartbeatCheckIntervalMs);

  console.log('[WebSocket] Server initialized');

  return wss;
}

function shutdownWebSocketServer() {
  if (checkIntervalHandle) {
    clearInterval(checkIntervalHandle);
  }

  if (pingIntervalHandle) {
    clearInterval(pingIntervalHandle);
  }

  if (wss) {
    wss.close();
  }
}

module.exports = {
  initWebSocketServer,
  shutdownWebSocketServer,
  broadcast,
  broadcastToTVs,
  broadcastToAdmins,
  sendToDevice,
  removeClient,
  getDevices,
};