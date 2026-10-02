const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const Playlist = require('../models/Playlist');
const Task = require('../models/Task');

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


// ============================================================
// SAFE SEND
// ============================================================

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}


// ============================================================
// DEVICE HELPERS
// ============================================================

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


// ============================================================
// ADMIN BROADCAST
// ============================================================

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


// ============================================================
// GENERAL BROADCAST
// ============================================================

function broadcast(message) {
  broadcastToTVs(message);
  broadcastToAdmins(message);
}


// ============================================================
// BROADCAST TO ALL TVs
// ============================================================

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


// ============================================================
// SEND TO ONE DEVICE
// ============================================================

function sendToDevice(deviceId, message) {
  const entry = tvClients.get(deviceId);

  if (!entry || entry.status !== 'online') {
    return false;
  }

  safeSend(entry.ws, message);

  return true;
}


// ============================================================
// REMOVE CLIENT
// ============================================================

function removeClient(deviceId) {
  const entry = tvClients.get(deviceId);

  if (entry) {
    tvClients.delete(deviceId);
    broadcastDeviceListToAdmins();
  }
}


// ============================================================
// MARK DEVICE OFFLINE
// ============================================================

function markOffline(deviceId) {
  const entry = tvClients.get(deviceId);

  if (entry && entry.status !== 'offline') {
    entry.status = 'offline';
    broadcastDeviceListToAdmins();
  }
}


// ============================================================
// SEND ACTIVE PLAYLIST TO NEWLY REGISTERED TV
// ============================================================

async function sendActivePlaylistToTV(ws) {
  try {
    const playlist = await Playlist.findOne({
      active: true,
    });

    if (!playlist) {
      console.log(
        '[WebSocket] No active playlist for newly registered TV'
      );

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


// ============================================================
// SEND ACTIVE TASKS TO NEWLY REGISTERED TV
// ============================================================
//
// This fixes the refresh problem.
//
// TV refresh
//    ↓
// WebSocket reconnect
//    ↓
// register
//    ↓
// fetch active tasks
//    ↓
// send tasks to TV
//
// All currently active tasks are sent so that the TV can
// perform its own priority/rotation logic.
// ============================================================

async function sendActiveTasksToTV(ws) {
  try {
    const now = new Date();

    const tasks = await Task.find({
      'schedule.start': {
        $lte: now,
      },

      'schedule.end': {
        $gt: now,
      },
    });

    for (const task of tasks) {
      safeSend(ws, {
        type: CONTENT_TYPE.TASK,

        task_id: task.task_id,

        title: task.title,

        content: task.content,

        priority: task.priority,

        schedule: task.schedule,
      });
    }

    console.log(
      `[WebSocket] Sent ${tasks.length} active task(s) to ${ws.deviceId}`
    );

  } catch (err) {
    console.error(
      '[WebSocket] Failed to send active tasks:',
      err.message
    );
  }
}


// ============================================================
// HANDLE TV / ADMIN REGISTRATION
// ============================================================

async function handleRegister(ws, msg) {
  const {
    device_id,
    device_type,
    network,
    role,
  } = msg;


  // ==========================================================
  // ADMIN / VIEWER REGISTRATION
  // ==========================================================

  if (device_type === 'admin') {
    try {
      const decoded = jwt.verify(
        msg.token || '',
        process.env.JWT_SECRET
      );

      if (
        !['admin', 'viewer'].includes(decoded.role)
      ) {
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


  // ==========================================================
  // TV REGISTRATION VALIDATION
  // ==========================================================

  if (
    !device_id ||
    device_type !== 'tv'
  ) {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Invalid registration payload',
    });

    ws.close();

    return;
  }


  // ==========================================================
  // NETWORK VALIDATION
  // ==========================================================

  if (
    ![
      NETWORK_TYPE.LAN,
      NETWORK_TYPE.WIFI,
    ].includes(network)
  ) {
    safeSend(ws, {
      type: CONTENT_TYPE.ERROR,
      message: 'Invalid network type',
    });

    ws.close();

    return;
  }


  // ==========================================================
  // ROLE VALIDATION
  // ==========================================================

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


  // ==========================================================
  // HANDLE RECONNECTION
  // ==========================================================

  const existing = tvClients.get(device_id);

  if (
    existing &&
    existing.ws !== ws &&
    existing.ws.readyState === WebSocket.OPEN
  ) {
    console.log(
      `[WebSocket] Closing previous connection for ${device_id}`
    );

    existing.ws.close(
      1000,
      'Reconnected from same device'
    );
  }


  // ==========================================================
  // REGISTER TV
  // ==========================================================

  ws.clientType = 'tv';

  ws.deviceId = device_id;

  tvClients.set(device_id, {
    ws,

    device_id,

    device_type: 'tv',

    network,

    role,

    status: 'online',

    last_heartbeat:
      new Date().toISOString(),

    last_sync:
      existing
        ? existing.last_sync
        : null,

    current_content:
      existing
        ? existing.current_content
        : null,

    registeredAt:
      existing
        ? existing.registeredAt
        : new Date().toISOString(),
  });


  // ==========================================================
  // REGISTRATION ACK
  // ==========================================================

  safeSend(ws, {
    type: CONTENT_TYPE.ACK,
    message: `Registered device ${device_id}`,
  });


  broadcastDeviceListToAdmins();


  // ==========================================================
  // RESTORE ACTIVE CONTENT AFTER REFRESH
  // ==========================================================

  // Restore active playlist
  await sendActivePlaylistToTV(ws);

  // Restore ALL currently active tasks
  await sendActiveTasksToTV(ws);
}


// ============================================================
// HANDLE HEARTBEAT
// ============================================================

function handleHeartbeat(msg) {
  const {
    device_id,
    status,
    last_sync,
    network,
  } = msg;

  const entry = tvClients.get(device_id);

  if (!entry) {
    return;
  }

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


// ============================================================
// HANDLE MESSAGE
// ============================================================

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


  if (
    !msg ||
    typeof msg.type !== 'string'
  ) {
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


// ============================================================
// HANDLE CLOSE
// ============================================================

function handleClose(ws) {

  if (ws.clientType === 'admin') {
    adminClients.delete(ws);

    return;
  }


  if (
    ws.clientType === 'tv' &&
    ws.deviceId
  ) {
    const entry =
      tvClients.get(ws.deviceId);


    // IMPORTANT:
    // Only mark the device offline if THIS socket
    // is still the active socket for that device.

    if (
      entry &&
      entry.ws === ws
    ) {
      entry.status = 'offline';

      broadcastDeviceListToAdmins();
    }
  }
}


// ============================================================
// INITIALIZE WEBSOCKET SERVER
// ============================================================

function initWebSocketServer(server) {

  heartbeatTimeoutMs =
    Number(
      process.env.HEARTBEAT_TIMEOUT_MS
    ) || 30000;


  heartbeatCheckIntervalMs =
    Number(
      process.env.HEARTBEAT_INTERVAL_MS
    ) || 10000;


  wss = new WebSocket.Server({
    server,
  });


  // ==========================================================
  // NEW CONNECTION
  // ==========================================================

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


  // ==========================================================
  // DETECT DEAD CONNECTIONS
  // ==========================================================

  pingIntervalHandle =
    setInterval(() => {

      wss.clients.forEach((ws) => {

        if (ws.isAlive === false) {

          handleClose(ws);

          return ws.terminate();
        }

        ws.isAlive = false;

        ws.ping();

      });

    }, heartbeatCheckIntervalMs);


  // ==========================================================
  // MARK TVs OFFLINE WHEN HEARTBEAT EXPIRES
  // ==========================================================

  checkIntervalHandle =
    setInterval(() => {

      const now = Date.now();


      for (
        const entry of tvClients.values()
      ) {

        const elapsed =
          now -
          new Date(
            entry.last_heartbeat
          ).getTime();


        if (
          elapsed > heartbeatTimeoutMs &&
          entry.status !== 'offline'
        ) {
          markOffline(
            entry.device_id
          );
        }
      }

    }, heartbeatCheckIntervalMs);


  console.log(
    '[WebSocket] Server initialized'
  );


  return wss;
}


// ============================================================
// SHUTDOWN
// ============================================================

function shutdownWebSocketServer() {

  if (checkIntervalHandle) {
    clearInterval(
      checkIntervalHandle
    );

    checkIntervalHandle = null;
  }


  if (pingIntervalHandle) {
    clearInterval(
      pingIntervalHandle
    );

    pingIntervalHandle = null;
  }


  if (wss) {
    wss.close();

    wss = null;
  }
}


// ============================================================
// EXPORTS
// ============================================================

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