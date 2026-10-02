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
  console.log('[TASK RECEIVED BY WIFI TV]', msg);
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
    case 'clear_task':
      state.tasks.delete(msg.task_id);
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
  const banner = document.getElementById('taskBanner');
  const title = document.getElementById('taskTitle');
  const content = document.getElementById('taskContent');

  if (!banner || !title || !content) {
    console.error('Task banner elements not found');
    return;
  }

  title.textContent = task.title;
  content.textContent = task.content;

  banner.classList.remove('hidden');
}

function hideTaskBanner() {
  const banner = document.getElementById('taskBanner');

  if (!banner) return;

  banner.classList.add('hidden');
}

function showAlert(alert) {
  els.alertMessage.textContent = alert.message;
  els.alertOverlay.classList.remove('hidden');
}

function hideAlert() {
  els.alertOverlay.classList.add('hidden');
}


/* 
 * ============================================================ 
 * TASK CLASH / ROTATION LOGIC 
 * ============================================================ 
 * 
 * Single active task:
 *   -> displayed continuously for its full schedule.
 * 
 * Multiple active tasks:
 *   Emergency -> continuous, suppresses other tasks.
 *   High      -> 30 seconds
 *   Medium    -> 20 seconds
 *   Low       -> 10 seconds
 * 
 * Playlist continues playing in the background.
 * ============================================================ 
 */

const TASK_DISPLAY_TIME = {
  4: Infinity,      // Emergency
  3: 30 * 1000,     // High = 30 seconds
  2: 20 * 1000,     // Medium = 20 seconds
  1: 10 * 1000,     // Low = 10 seconds
};

let taskRotationTimer = null;
let currentTaskId = null;


/**
 * Get all tasks whose schedule includes the current time.
 */
function getActiveTasks() {
  const now = new Date();

  return Array.from(state.tasks.values()).filter((task) => {
    if (!task.schedule?.start || !task.schedule?.end) {
      return false;
    }

    const start = new Date(task.schedule.start);
    const end = new Date(task.schedule.end);

    return start <= now && now < end;
  });
}


/**
 * Stop task rotation timer.
 */
function stopTaskRotation() {
  if (taskRotationTimer) {
    clearTimeout(taskRotationTimer);
    taskRotationTimer = null;
  }
}


/**
 * Display one task.
 */
function displayTask(task) {
  if (!task) {
    currentTaskId = null;
    hideTaskBanner();
    return;
  }

  currentTaskId = task.task_id;

  renderTaskBanner(task);
}


/**
 * Rotate to the next active task.
 *
 * This function is called ONLY when the current task's
 * display duration has finished.
 */
function rotateTask() {
  const activeTasks = getActiveTasks();

  // ----------------------------------------------------------
  // No active tasks
  // ----------------------------------------------------------

  if (activeTasks.length === 0) {
    stopTaskRotation();
    currentTaskId = null;
    hideTaskBanner();
    return;
  }


  // ----------------------------------------------------------
  // Emergency task
  // ----------------------------------------------------------

  const emergencyTask = activeTasks.find(
    (task) => Number(task.priority) === 4
  );

  if (emergencyTask) {
    stopTaskRotation();
    displayTask(emergencyTask);

    // Check again shortly in case the emergency expires
    // and another task becomes active.
    taskRotationTimer = setTimeout(() => {
      taskRotationTimer = null;
      resolveTaskDisplay();
    }, 1000);

    return;
  }


  // ----------------------------------------------------------
  // Sort by priority
  // ----------------------------------------------------------

  activeTasks.sort(
    (a, b) => Number(b.priority) - Number(a.priority)
  );


  // ----------------------------------------------------------
  // Find current task
  // ----------------------------------------------------------

  let currentIndex = activeTasks.findIndex(
    (task) => task.task_id === currentTaskId
  );


  // Current task is no longer active
  if (currentIndex === -1) {
    currentIndex = 0;
  } else {
    // Move to next task
    currentIndex =
      (currentIndex + 1) % activeTasks.length;
  }


  const task = activeTasks[currentIndex];

  displayTask(task);


  // ----------------------------------------------------------
  // Determine how long this task should stay
  // ----------------------------------------------------------

  const displayTime =
    TASK_DISPLAY_TIME[Number(task.priority)] || 10000;


  // Emergency is already handled above
  if (displayTime === Infinity) {
    return;
  }


  // ----------------------------------------------------------
  // Schedule the next rotation
  // ----------------------------------------------------------

  taskRotationTimer = setTimeout(() => {
    taskRotationTimer = null;
    rotateTask();
  }, displayTime);
}


/**
 * Decide what should currently be displayed.
 *
 * IMPORTANT:
 * This function is called every second.
 *
 * It MUST NOT rotate the task every second.
 *
 * It only:
 *   1. Removes expired tasks
 *   2. Detects newly active tasks
 *   3. Detects when the current task is no longer active
 *
 * Actual rotation is handled by rotateTask().
 */
function resolveTaskDisplay() {
  const activeTasks = getActiveTasks();


  // ----------------------------------------------------------
  // No active tasks
  // ----------------------------------------------------------

  if (activeTasks.length === 0) {
    stopTaskRotation();
    currentTaskId = null;
    hideTaskBanner();
    return;
  }


  // ----------------------------------------------------------
  // Emergency always wins
  // ----------------------------------------------------------

  const emergencyTask = activeTasks.find(
    (task) => Number(task.priority) === 4
  );

  if (emergencyTask) {

    if (currentTaskId !== emergencyTask.task_id) {
      stopTaskRotation();
      displayTask(emergencyTask);
    }

    return;
  }


  // ----------------------------------------------------------
  // Check whether current task is still active
  // ----------------------------------------------------------

  const currentTaskStillActive =
    activeTasks.some(
      (task) => task.task_id === currentTaskId
    );


  // ----------------------------------------------------------
  // Current task is still active
  //
  // DO NOTHING.
  //
  // The rotation timer will change it when its
  // 30/20/10 second duration finishes.
  // ----------------------------------------------------------

  if (currentTaskStillActive) {
    return;
  }


  // ----------------------------------------------------------
  // Current task is no longer active
  // ----------------------------------------------------------

  stopTaskRotation();


  // Highest priority task starts first
  activeTasks.sort(
    (a, b) => Number(b.priority) - Number(a.priority)
  );


  const task = activeTasks[0];

  displayTask(task);


  // ----------------------------------------------------------
  // If multiple tasks are active, start rotation
  // ----------------------------------------------------------

  if (activeTasks.length > 1) {

    const displayTime =
      TASK_DISPLAY_TIME[
        Number(task.priority)
      ] || 10000;


    // Emergency was already handled above
    if (displayTime !== Infinity) {

      taskRotationTimer = setTimeout(() => {
        taskRotationTimer = null;
        rotateTask();
      }, displayTime);

    }
  }
}


/**
 * Remove expired tasks and alerts from memory.
 */
function pruneExpired() {
  const now = new Date();


  // ----------------------------------------------------------
  // Remove expired alerts
  // ----------------------------------------------------------

  for (const [id, alert] of state.alerts.entries()) {

    if (
      new Date(alert.expires) <= now
    ) {
      state.alerts.delete(id);
    }
  }


  // ----------------------------------------------------------
  // Remove expired tasks
  // ----------------------------------------------------------

  for (const [id, task] of state.tasks.entries()) {

    if (
      task.schedule?.end &&
      new Date(task.schedule.end) <= now
    ) {
      state.tasks.delete(id);
    }
  }
}


/**
 * Main rendering logic.
 *
 * Playlist continues independently.
 * Tasks appear only as the bottom banner.
 */
function resolveAndRender() {

  pruneExpired();


  // ==========================================================
  // ALERTS
  // ==========================================================

  const activeAlerts = Array.from(
    state.alerts.values()
  ).filter(
    (alert) =>
      new Date(alert.expires) > new Date()
  );


  if (activeAlerts.length > 0) {

    activeAlerts.sort(
      (a, b) =>
        Number(b.priority) -
        Number(a.priority)
    );

    showAlert(activeAlerts[0]);

  } else {

    hideAlert();

  }


  // ==========================================================
  // TASKS
  // ==========================================================

  resolveTaskDisplay();


  // ==========================================================
  // PLAYLIST
  // ==========================================================

  // Playlist keeps running independently.
}
 

// ============================================================
// CHECK TASK SCHEDULE EVERY SECOND
// ============================================================
//
// This DOES NOT rotate tasks every second.
//
// It only checks whether:
//   - a task started
//   - a task ended
//   - an emergency appeared
//   - the current task is no longer active
//
// Actual 30/20/10 second rotation is controlled by
// taskRotationTimer.
// ============================================================

state.priorityCheckTimer = setInterval(
  resolveAndRender,
  1000
);


connect();