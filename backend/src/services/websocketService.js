const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const Playlist = require('../models/Playlist');
<<<<<<< HEAD
const Alert = require('../models/Alert');
=======
>>>>>>> ab660bdec22f7a433bd9c7f4871722182f9ad951
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

// Remote playback state set from the dashboard (in memory; resets when the backend restarts)
const playbackState = {
  paused: false,
  pausedAt: null,
  volume: 100,
  muted: false,
};

function getPlaybackState() {
  return { ...playbackState };
}

function playbackMessage() {
  return {
    type: CONTENT_TYPE.PLAYBACK,
    paused: playbackState.paused,
    volume: playbackState.volume,
    muted: playbackState.muted,
  };
}

// While paused, shift the timeline by the time spent paused, so a TV that gets
// the playlist now shows the same frozen frame as the other screens
function pauseAdjustedSyncTimestamp(syncTimestamp) {
  if (!playbackState.paused || !playbackState.pausedAt || !syncTimestamp) return syncTimestamp;
  return new Date(
    new Date(syncTimestamp).getTime() + (Date.now() - playbackState.pausedAt)
  );
}

// Merge changes and push the new state to every TV
function setPlaybackState(changes) {
  Object.assign(playbackState, changes);
  broadcastToTVs(playbackMessage());
  return getPlaybackState();
}

let wss = null;
let heartbeatTimeoutMs = 30000;
let heartbeatCheckIntervalMs = 10000;
// Offline TVs are dropped from the device list after this long
let offlineRemoveMs = 5 * 60 * 1000;
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

    const syncTimestamp = pauseAdjustedSyncTimestamp(playlist.sync_timestamp);

    const message = {
      type: CONTENT_TYPE.PLAYLIST,
      playlist_id: playlist._id.toString(),
      name: playlist.name,
      items: playlist.items,
      sync_timestamp: syncTimestamp,
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

<<<<<<< HEAD
  // Pause/volume first, so a TV joining while paused never starts playing
  safeSend(ws, playbackMessage());

  // Send currently active playlist after registration
  await sendActivePlaylistToTV(ws);

  // ...and the alerts / tasks it missed while it was off or disconnected
  await sendScheduleToTV(ws);
}

/**
 * Bring a (re)connecting TV up to date with alerts and tasks: TVs only hear
 * about them when they are pushed, so a screen switched on in the morning
 * would otherwise miss everything created earlier - including tasks
 * scheduled for later in the day.
 */
async function sendScheduleToTV(ws) {
  try {
    const now = new Date();
    const [alerts, tasks] = await Promise.all([
      Alert.find({ active: true, expires: { $gt: now } }).sort({ createdAt: 1 }),
      Task.find({ 'schedule.end': { $gt: now } }),
    ]);

    // Forget what the TV remembers from before (some may have been deleted since)
    safeSend(ws, { type: CONTENT_TYPE.RESET_SCHEDULE });

    alerts.forEach((alert) => {
      safeSend(ws, {
        type: CONTENT_TYPE.ALERT,
        alert_id: alert.alert_id,
        message: alert.message,
        priority: alert.priority,
        expires: alert.expires,
      });
    });

    tasks.forEach((task) => {
      safeSend(ws, {
        type: CONTENT_TYPE.TASK,
        task_id: task.task_id,
        title: task.title,
        content: task.content,
        priority: task.priority,
        schedule: task.schedule,
        media: task.media,
      });
    });

    if (alerts.length || tasks.length) {
      console.log(`[WebSocket] Sent ${alerts.length} alert(s) and ${tasks.length} task(s) to ${ws.deviceId}`);
    }
  } catch (err) {
    console.error('[WebSocket] Failed to send alerts/tasks:', err.message);
  }
=======

  // ==========================================================
  // RESTORE ACTIVE CONTENT AFTER REFRESH
  // ==========================================================

  // Restore active playlist
  await sendActivePlaylistToTV(ws);

  // Restore ALL currently active tasks
  await sendActiveTasksToTV(ws);
>>>>>>> ab660bdec22f7a433bd9c7f4871722182f9ad951
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

<<<<<<< HEAD
  // Ignore sockets that were replaced by a newer connection with the same device_id,
  // otherwise closing the old socket would mark the new one offline
  const entry = tvClients.get(ws.deviceId);
  if (ws.clientType === 'tv' && entry && entry.ws === ws) {
    markOffline(ws.deviceId);
=======

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
>>>>>>> ab660bdec22f7a433bd9c7f4871722182f9ad951
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

<<<<<<< HEAD
  offlineRemoveMs =
    Number(process.env.OFFLINE_REMOVE_MS) || 5 * 60 * 1000;

  wss = new WebSocket.Server({ server });
=======

  wss = new WebSocket.Server({
    server,
  });


  // ==========================================================
  // NEW CONNECTION
  // ==========================================================
>>>>>>> ab660bdec22f7a433bd9c7f4871722182f9ad951

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
<<<<<<< HEAD
        markOffline(entry.device_id);
      } else if (
        entry.status === 'offline' &&
        elapsed > offlineRemoveMs
      ) {
        // Closed tabs / switched-off screens disappear from the dashboard
        removeClient(entry.device_id);
      }
    }
  }, heartbeatCheckIntervalMs);
=======
>>>>>>> ab660bdec22f7a433bd9c7f4871722182f9ad951

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
  getPlaybackState,
  setPlaybackState,
  pauseAdjustedSyncTimestamp,
};