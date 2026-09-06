/* ScreenSync - Samsung QM65C (Wi-Fi) TV Client
 * Buffered display: connected over Wi-Fi, so it may experience latency, jitter,
 * or temporary disconnections. Preloads/buffers content and uses timestamp-based
 * synchronization to reduce playback drift relative to the LAN reference display.
 *
 * If a playlist message arrives late (after sync_timestamp has already passed),
 * this client calculates the correct in-progress playback position instead of
 * blindly restarting from the first item.
 *
 * NOTE: Browser/WebSocket-based synchronization is BEST-EFFORT.
 * It does not provide hardware-level frame synchronization between displays.
 */

const CONFIG = {
  WS_URL: window.SCREENSYNC_WS_URL || 'ws://localhost:3000',
  DEVICE_ID: 'samsung_wifi_tv_01',
  NETWORK: 'WiFi',
  ROLE: 'buffered',
  HEARTBEAT_INTERVAL_MS: 10000,
  RECONNECT_BASE_MS: 1000,
  RECONNECT_MAX_MS: 15000,
};

const state = {
  socket: null,
  reconnectAttempt: 0,
  connected: false,
  playlist: null,
  tasks: new Map(),
  alerts: new Map(),
  playlistTimer: null,
  playlistIndex: 0,
  priorityCheckTimer: null,
  preloadedUrls: new Set(),
};

const els = {
  status: document.getElementById('connection-status'),
  bufferStatus: document.getElementById('buffer-status'),
  contentRoot: document.getElementById('content-root'),
  alertOverlay: document.getElementById('alert-overlay'),
  alertMessage: document.getElementById('alert-message'),
};

function setConnectionStatus(isOnline) {
  state.connected = isOnline;
  els.status.textContent = isOnline ? 'online' : 'reconnecting...';
  els.status.className = isOnline ? 'online' : 'offline';
}

function send(payload) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(payload));
  }
}

function connect() {
  const socket = new WebSocket(CONFIG.WS_URL);
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.reconnectAttempt = 0;
    setConnectionStatus(true);
    send({
      type: 'register',
      device_id: CONFIG.DEVICE_ID,
      device_type: 'tv',
      network: CONFIG.NETWORK,
      role: CONFIG.ROLE,
    });
    startHeartbeat();
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      console.error('Invalid message from server', err);
      return;
    }
    handleMessage(msg);
  });

  socket.addEventListener('close', () => {
    setConnectionStatus(false);
    stopHeartbeat();
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
}

function scheduleReconnect() {
  const delay = Math.min(CONFIG.RECONNECT_BASE_MS * 2 ** state.reconnectAttempt, CONFIG.RECONNECT_MAX_MS);
  state.reconnectAttempt += 1;
  setTimeout(connect, delay);
}

let heartbeatHandle = null;
function startHeartbeat() {
  stopHeartbeat();
  heartbeatHandle = setInterval(() => {
    send({
      type: 'heartbeat',
      device_id: CONFIG.DEVICE_ID,
      status: 'online',
      last_sync: state.playlist ? state.playlist.sync_timestamp : null,
      network: CONFIG.NETWORK,
    });
  }, CONFIG.HEARTBEAT_INTERVAL_MS);
}
function stopHeartbeat() {
  if (heartbeatHandle) clearInterval(heartbeatHandle);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'ack':
      console.log('[ACK]', msg.message);
      break;
    case 'error':
      console.error('[Server Error]', msg.message);
      break;
    case 'playlist':
      applyPlaylist(msg);
      break;
    case 'task':
      state.tasks.set(msg.task_id, msg);
      resolveAndRender();
      break;
    case 'alert':
      state.alerts.set(msg.alert_id, msg);
      resolveAndRender();
      break;
    case 'clear_alert':
      state.alerts.delete(msg.alert_id);
      resolveAndRender();
      break;
    default:
      console.warn('Unknown message type', msg.type);
  }
}

// Warm the browser cache for playlist media so playback can start smoothly
// once the sync_timestamp is reached, reducing jitter caused by Wi-Fi latency.
function preloadPlaylist(items) {
  items.forEach((item) => {
    if (item.media_type === 'image' && item.url && !state.preloadedUrls.has(item.url)) {
      const img = new Image();
      img.src = item.url;
      state.preloadedUrls.add(item.url);
    } else if (item.media_type === 'video' && item.url && !state.preloadedUrls.has(item.url)) {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = item.url;
      video.muted = true;
      state.preloadedUrls.add(item.url);
    }
  });
}

// Given a playlist (items + sync_timestamp) and the current time, compute which
// item should be playing right now and how far into it we are. Used when a
// message arrives late so playback resumes mid-stream instead of restarting.
function computePlaybackPosition(items, syncTimestampMs, nowMs) {
  const totalDurationMs = items.reduce((sum, it) => sum + it.duration * 1000, 0);
  if (totalDurationMs <= 0) return { index: 0, offsetMs: 0 };

  let elapsed = nowMs - syncTimestampMs;
  if (elapsed < 0) elapsed = 0;
  elapsed %= totalDurationMs;

  let accumulated = 0;
  for (let i = 0; i < items.length; i += 1) {
    const durMs = items[i].duration * 1000;
    if (elapsed < accumulated + durMs) {
      return { index: i, offsetMs: elapsed - accumulated };
    }
    accumulated += durMs;
  }
  return { index: 0, offsetMs: 0 };
}

function applyPlaylist(msg) {
  state.playlist = msg;
  preloadPlaylist(msg.items || []);
  if (state.playlistTimer) clearTimeout(state.playlistTimer);

  const targetTime = new Date(msg.sync_timestamp).getTime();
  const now = Date.now();
  const delay = targetTime - now;

  if (delay > 0) {
    // Sync point is in the future: buffer and wait for it, same as the LAN reference.
    els.bufferStatus.textContent = `buffering, starts in ${Math.ceil(delay / 1000)}s`;
    state.playlistTimer = setTimeout(() => {
      els.bufferStatus.textContent = '';
      playPlaylistFromPosition(0, 0);
    }, delay);
  } else {
    // Message arrived late: calculate correct in-progress position instead of
    // restarting from item 0, so this display re-joins the sequence in sync.
    els.bufferStatus.textContent = 'resyncing (late message)';
    const { index, offsetMs } = computePlaybackPosition(msg.items, targetTime, now);
    setTimeout(() => {
      els.bufferStatus.textContent = '';
      playPlaylistFromPosition(index, offsetMs);
    }, 0);
  }
}

function playPlaylistFromPosition(index, offsetMs) {
  if (!state.playlist || !state.playlist.items || state.playlist.items.length === 0) return;
  const items = state.playlist.items;
  const item = items[index % items.length];
  state.playlistIndex = index % items.length;

  renderContentItem(item, offsetMs);

  const remainingMs = Math.max(0, item.duration * 1000 - offsetMs);

  if (state.playlistTimer) clearTimeout(state.playlistTimer);
  state.playlistTimer = setTimeout(() => {
    playPlaylistFromPosition(state.playlistIndex + 1, 0);
  }, remainingMs);
}

function renderContentItem(item, offsetMs = 0) {
  els.contentRoot.innerHTML = '';
  if (item.media_type === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    els.contentRoot.appendChild(img);
  } else if (item.media_type === 'video') {
    const video = document.createElement('video');
    video.src = item.url;
    video.autoplay = true;
    video.muted = true;
    video.loop = false;
    els.contentRoot.appendChild(video);
    if (offsetMs > 0) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(offsetMs / 1000, video.duration || 0);
      });
    }
  } else if (item.media_type === 'text') {
    const div = document.createElement('div');
    div.className = 'text-slide';
    div.textContent = item.content;
    els.contentRoot.appendChild(div);
  }
}

function renderTaskBanner(task) {
  els.contentRoot.innerHTML = '';
  const banner = document.createElement('div');
  banner.className = 'task-banner';
  banner.innerHTML = `<strong>${task.title}</strong><br/>${task.content}`;
  els.contentRoot.appendChild(banner);
}

function showAlert(alert) {
  els.alertMessage.textContent = alert.message;
  els.alertOverlay.classList.remove('hidden');
}
function hideAlert() {
  els.alertOverlay.classList.add('hidden');
}

/**
 * resolveActiveContent()
 * Priority order: Emergency Alert > High Task > Medium Task > Low Task > Normal Playlist
 * Returns the highest-priority currently active content descriptor.
 */
function resolveActiveContent() {
  const now = new Date();

  const activeAlerts = Array.from(state.alerts.values()).filter((a) => new Date(a.expires) > now);
  if (activeAlerts.length > 0) {
    const top = activeAlerts.sort((a, b) => b.priority - a.priority)[0];
    return { type: 'alert', content: top };
  }

  const activeTasks = Array.from(state.tasks.values()).filter((t) => {
    const start = new Date(t.schedule.start);
    const end = new Date(t.schedule.end);
    return start <= now && end >= now;
  });
  if (activeTasks.length > 0) {
    const top = activeTasks.sort((a, b) => b.priority - a.priority)[0];
    return { type: 'task', content: top };
  }

  if (state.playlist) {
    return { type: 'playlist', content: state.playlist };
  }

  return { type: null, content: null };
}
window.resolveActiveContent = resolveActiveContent;

function resolveAndRender() {
  pruneExpired();
  const { type, content } = resolveActiveContent();

  if (type === 'alert') {
    showAlert(content);
    return;
  }
  hideAlert();

  if (type === 'task') {
    renderTaskBanner(content);
    return;
  }

  if (type === 'playlist' && !state.playlistTimer) {
    // Only kick off playback here if nothing is currently scheduled
    // (applyPlaylist already manages its own buffering/timer lifecycle).
    playPlaylistFromPosition(state.playlistIndex || 0, 0);
  }
}

function pruneExpired() {
  const now = new Date();
  for (const [id, alert] of state.alerts.entries()) {
    if (new Date(alert.expires) <= now) state.alerts.delete(id);
  }
  for (const [id, task] of state.tasks.entries()) {
    if (new Date(task.schedule.end) <= now) state.tasks.delete(id);
  }
}

// Periodically re-check priority so expired tasks/alerts fall back correctly
state.priorityCheckTimer = setInterval(resolveAndRender, 5000);

connect();
