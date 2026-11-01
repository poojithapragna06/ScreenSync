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

// Every screen needs its own device ID, otherwise screens kick each other off.
// Priority: ?id=... in the URL > ID saved on this device > newly generated one.
function getDeviceId(prefix) {
  const fromUrl = new URLSearchParams(window.location.search).get('id');
  if (fromUrl) return fromUrl.trim().replace(/[^\w-]/g, '_');

  const key = 'screensync_device_id';
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  } catch (e) { /* storage blocked - fall through */ }

  const generated = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem(key, generated); } catch (e) { /* not persisted */ }
  return generated;
}

// Where the backend is. Opened from the backend itself (college PC, e.g.
// http://<pc>:3000/tv/wifi/): that same address. Served on their own
// (npx serve on 8081 / 8082): port 3000 of the same machine.
function defaultWsUrl() {
  const { protocol, hostname, host, port } = window.location;
  if (!hostname) return 'ws://localhost:3000';
  const scheme = protocol === 'https:' ? 'wss' : 'ws';
  return port === '8081' || port === '8082' ? scheme + '://' + hostname + ':3000' : scheme + '://' + host;
}

// Identifies this page (this tab) to the server, separately from its name:
// the same page reconnecting replaces its old connection, while a different
// screen that happens to use the same name gets its own (e.g. lab_tv_2).
// sessionStorage: kept across reloads of this tab, different for every tab.
function getInstanceId() {
  const key = 'screensync_instance_id';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
  } catch (e) { /* storage blocked - fall through */ }
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try { sessionStorage.setItem(key, id); } catch (e) { /* not kept */ }
  return id;
}
const INSTANCE_ID = getInstanceId();

const CONFIG = {
  WS_URL: window.SCREENSYNC_WS_URL || defaultWsUrl(),
  DEVICE_ID: getDeviceId('wifi_tv'),
  NETWORK: 'WiFi',
  ROLE: 'buffered',
  HEARTBEAT_INTERVAL_MS: 10000,
  RECONNECT_BASE_MS: 1000,
  RECONNECT_MAX_MS: 15000,
};

// Show this screen's ID in the status bar (the ID listed on the dashboard's Devices page)
function showDeviceLabel() {
  document.getElementById('device-label').textContent = `${CONFIG.DEVICE_ID} (WiFi / buffered)`;
}
showDeviceLabel();

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
      instance_id: INSTANCE_ID,
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
    // An old socket closing after a newer one connected: nothing to do
    if (state.socket !== socket) return;
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
      // The server may give this screen another name if ours is already taken
      if (msg.device_id && msg.device_id !== CONFIG.DEVICE_ID) {
        console.warn('[ACK] Name already used by another screen - now ' + msg.device_id);
        CONFIG.DEVICE_ID = msg.device_id;
        showDeviceLabel();
      }
      break;
    case 'error':
      console.error('[Server Error]', msg.message);
      break;
    case 'playlist':
      applyPlaylist(msg);
      // Keep showing a frozen frame if the dashboard has paused playback
      if (playback.paused) freezePlayback();
      break;
    case 'playback':
      handlePlaybackMessage(msg);
      break;
    case 'clear_playlist':
      // Only stop if the deleted playlist is the one being shown
      if (state.playlist && state.playlist.playlist_id === msg.playlist_id) {
        if (state.playlistTimer) clearTimeout(state.playlistTimer);
        state.playlistTimer = null;
        state.playlist = null;
        state.playlistIndex = 0;
        resolveAndRender();
      }
      break;
    case 'task':
      state.tasks.set(msg.task_id, msg);
      resolveAndRender();
      // Switch exactly when it starts / ends (e.g. a "play once" video finishing)
      rerenderAt(msg.schedule.start);
      rerenderAt(msg.schedule.end);
      break;
    case 'clear_task':
      state.tasks.delete(msg.task_id);
      resolveAndRender();
      break;
    case 'reset_schedule':
      // (Re)connected: the server now re-sends every current alert and task
      state.tasks.clear();
      state.alerts.clear();
      // Re-check once they've arrived. Not right away: a task still running
      // would flash off and its video restart on every reconnect.
      setTimeout(resolveAndRender, 1000);
      break;
    case 'alert':
      state.alerts.set(msg.alert_id, msg);
      resolveAndRender();
      rerenderAt(msg.expires);
      break;
    case 'clear_alert':
      state.alerts.delete(msg.alert_id);
      resolveAndRender();
      break;
    default:
      console.warn('Unknown message type', msg.type);
  }
}

// Uploaded files may be saved with another host (e.g. "http://localhost:3000/uploads/x.mp4"
// when uploaded from the laptop); always load them from the backend this TV is connected to.
function getMediaUrl(url) {
  if (!url) return '';
  const backendHttpUrl = CONFIG.WS_URL.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  const path = url.replace(/^https?:\/\/[^/]+(\/uploads\/)/i, '$1');
  return path.startsWith('/uploads/') ? new URL(path, backendHttpUrl).toString() : url;
}

// Warm the browser cache for playlist media so playback can start smoothly
// once the sync_timestamp is reached, reducing jitter caused by Wi-Fi latency.
function preloadPlaylist(items) {
  items.forEach((item) => {
    if (item.media_type === 'image' && item.url && !state.preloadedUrls.has(item.url)) {
      const img = new Image();
      img.src = getMediaUrl(item.url);
      state.preloadedUrls.add(item.url);
    } else if (item.media_type === 'video' && item.url && !state.preloadedUrls.has(item.url)) {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = getMediaUrl(item.url);
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
    const { index, offsetMs } = computePlaybackPosition(msg.items, targetTime, now);
    els.bufferStatus.textContent = '';
    playPlaylistFromPosition(index, offsetMs);
  }
}

function playPlaylistFromPosition(index, offsetMs, continuing = false) {
  if (!state.playlist || !state.playlist.items || state.playlist.items.length === 0) return;

  // A task or alert is on screen: leave it there. The playlist rejoins
  // the shared timeline once it ends.
  if (resolveActiveContent().type !== 'playlist') {
    resolveAndRender();
    return;
  }

  const items = state.playlist.items;
  const item = items[index % items.length];
  state.playlistIndex = index % items.length;

  // Moving on to the same YouTube video that is already playing (e.g. a one-item
  // playlist): keep the player running instead of reloading it, and just line
  // its timeline up with the start of this item.
  if (continuing && isSameYouTubeShowing(item)) {
    restartYouTubeTimeline(offsetMs);
  } else {
    renderContentItem(item, offsetMs);
  }

  // Paused from the dashboard: show this frame frozen and don't advance
  if (playback.paused) {
    freezePlayback();
    return;
  }

  const remainingMs = Math.max(0, item.duration * 1000 - offsetMs);

  if (state.playlistTimer) clearTimeout(state.playlistTimer);
  state.playlistTimer = setTimeout(() => {
    playPlaylistFromPosition(state.playlistIndex + 1, 0, true);
  }, remainingMs);
}

// ============================================================
// YOUTUBE
// ============================================================
// Accepts youtube.com/watch?v=, youtu.be/, /shorts/, /embed/ and /live/ links

function getYouTubeId(url) {
  const match = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i
  );
  return match ? match[1] : null;
}

// Played through YouTube's IFrame Player API rather than a plain embed: it
// reports why a video can't play (instead of YouTube's "Watch on YouTube"
// screen, which takes the TV away from ScreenSync), and lets every screen be
// kept on the same second of the video.

let youTubeApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);

  if (!youTubeApiPromise) {
    youTubeApiPromise = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        youTubeApiPromise = null;
        reject(new Error('Unable to reach YouTube'));
      };
      document.head.appendChild(script);
    });
  }

  return youTubeApiPromise;
}

const YOUTUBE_ERRORS = {
  2: 'The YouTube link is not valid.',
  5: 'This YouTube video cannot be played in this browser.',
  100: 'This YouTube video was removed or is private.',
  101: 'The owner of this YouTube video does not allow it to be played outside YouTube.',
  150: 'The owner of this YouTube video does not allow it to be played outside YouTube.',
  152: 'The owner of this YouTube video does not allow it to be played outside YouTube.',
  153: 'YouTube refused to play this video on this page.',
  network: 'This screen cannot reach YouTube. Check its internet connection.',
};

// The YouTube video on screen (only one at a time). `startedAt` is the clock
// time at which the video was at 0:00 on every screen - the shared timeline.
let currentYouTube = null;

function renderYouTube(item, offsetMs = 0) {
  const id = getYouTubeId(item.url);

  if (!id) {
    els.contentRoot.innerHTML =
      '<p class="placeholder">Invalid YouTube link</p>';
    return;
  }

  // The player goes inside this box, which keeps our markers on it
  const frame = document.createElement('div');
  frame.className = 'youtube-frame';
  frame.dataset.videoId = id;
  const playerHost = document.createElement('div');
  frame.appendChild(playerHost);
  els.contentRoot.appendChild(frame);

  const entry = {
    frame,
    player: null,
    ready: false,
    startedAt: Date.now() - (offsetMs || 0),
    lastCorrection: 0,
  };
  currentYouTube = entry;

  loadYouTubeApi()
    .then((YT) => {
      // Replaced by other content while the API was loading
      if (currentYouTube !== entry || !frame.isConnected) return;

      entry.player = new YT.Player(playerHost, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          mute: playback.muted || !soundEnabled ? 1 : 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          start: Math.floor((offsetMs || 0) / 1000),
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            entry.ready = true;
            applyVolume();
            if (playback.paused) {
              entry.player.pauseVideo();
            } else {
              entry.player.seekTo(youTubeTimelineSeconds(entry), true);
              entry.player.playVideo();
            }
          },
          onStateChange: (event) => {
            // Loop: the playlist item / task can last longer than the video
            if (event.data === YT.PlayerState.ENDED && !playback.paused) {
              entry.player.seekTo(0, true);
              entry.player.playVideo();
            }
          },
          onError: (event) => showYouTubeError(entry, event.data),
        },
      });
    })
    .catch(() => showYouTubeError(entry, 'network'));
}

// Replace the player with a readable message (and no "Watch on YouTube" link)
function showYouTubeError(entry, code) {
  if (currentYouTube !== entry || !entry.frame.isConnected) return;
  console.error('[YOUTUBE] Cannot play video, error', code);

  try {
    if (entry.player) entry.player.destroy();
  } catch (e) { /* already gone */ }
  currentYouTube = null;

  entry.frame.innerHTML = '';
  const message = document.createElement('p');
  message.className = 'placeholder youtube-error';
  message.textContent = YOUTUBE_ERRORS[code] || 'This YouTube video could not be played.';
  const hint = document.createElement('small');
  // On an IP address YouTube blocks videos it would play under the PC's name
  const blockedHere = [101, 150, 152].includes(code) && isIpAddress(window.location.hostname);
  hint.textContent = blockedHere
    ? "This screen was opened by IP address, where YouTube blocks some videos. Open it with the ScreenSync PC's name instead (http://<pc-name>:3000/...)."
    : 'Choose another video in ScreenSync, or upload the video file instead.';
  message.appendChild(document.createElement('br'));
  message.appendChild(hint);
  entry.frame.appendChild(message);
}

// Where the video should be right now on the shared timeline (looping)
function youTubeTimelineSeconds(entry) {
  const duration = entry.player.getDuration();
  const seconds = (Date.now() - entry.startedAt) / 1000;
  return duration > 0 ? seconds % duration : seconds;
}

// The same YouTube video carries on as the next playlist item (e.g. a
// one-item playlist): keep the player, just restart its timeline at the
// item's start so it stays in step with the playlist
function restartYouTubeTimeline(offsetMs) {
  const entry = currentYouTube;
  if (!entry) return;
  entry.startedAt = Date.now() - (offsetMs || 0);
  if (entry.ready && !playback.paused) {
    entry.player.seekTo(youTubeTimelineSeconds(entry), true);
  }
}

// Every 2 s, put the YouTube video back on the shared timeline if it has
// drifted (buffering on Wi-Fi, a slow start) or stopped by itself
const YOUTUBE_MAX_DRIFT_S = 1.5;
const YOUTUBE_CORRECTION_GAP_MS = 6000; // let a seek finish buffering first

setInterval(() => {
  const entry = currentYouTube;
  if (!entry || !entry.ready || playback.paused || !entry.frame.isConnected) return;

  const player = entry.player;
  const state = player.getPlayerState();

  if (state === YT.PlayerState.BUFFERING) return;
  if (state !== YT.PlayerState.PLAYING) {
    player.playVideo();
    return;
  }

  const now = Date.now();
  if (now - entry.lastCorrection < YOUTUBE_CORRECTION_GAP_MS) return;

  const expected = youTubeTimelineSeconds(entry);
  const duration = player.getDuration();
  let drift = player.getCurrentTime() - expected;
  // Near the loop point, 0.5 s and duration - 0.5 s are only 1 s apart
  if (duration > 0) {
    if (drift > duration / 2) drift -= duration;
    if (drift < -duration / 2) drift += duration;
  }

  if (Math.abs(drift) > YOUTUBE_MAX_DRIFT_S) {
    console.log(`[YOUTUBE] Drifted ${drift.toFixed(1)}s, re-syncing`);
    entry.lastCorrection = now;
    player.seekTo(expected, true);
  }
}, 2000);

function isSameYouTubeShowing(item) {
  if (item.media_type !== 'youtube') return false;
  const frame = els.contentRoot.querySelector('.youtube-frame');
  return Boolean(frame && frame.dataset.videoId === getYouTubeId(item.url));
}

function renderContentItem(item, offsetMs = 0) {
  els.contentRoot.innerHTML = '';
  if (item.media_type === 'image') {
    const img = document.createElement('img');
    img.src = getMediaUrl(item.url);
    els.contentRoot.appendChild(img);
  } else if (item.media_type === 'video') {
    const video = document.createElement('video');
    video.src = getMediaUrl(item.url);
    video.autoplay = true;
    video.muted = !soundEnabled || playback.muted; // muted until sound is allowed (launch-tv.bat, or a click on the screen)
    video.volume = playback.volume / 100;
    video.loop = false;
    video.playsInline = true;
    els.contentRoot.appendChild(video);
    playWithSoundFallback(video);
    if (offsetMs > 0) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(offsetMs / 1000, video.duration || 0);
      });
    }
  } else if (item.media_type === 'youtube') {
    renderYouTube(item, offsetMs);
  } else if (item.media_type === 'text') {
    const div = document.createElement('div');
    div.className = 'text-slide';
    div.textContent = item.content;
    els.contentRoot.appendChild(div);
  }
}

function renderTaskBanner(task) {
  // Already showing this task: leave it alone (this runs every 5 s, and
  // re-rendering would restart the task's video each time)
  const current = els.contentRoot.querySelector('.task-banner');
  if (current && current.dataset.taskId === task.task_id) return;

  els.contentRoot.innerHTML = '';
  if (task.media && task.media.url) renderTaskMedia(task);

  const banner = document.createElement('div');
  banner.className = 'task-banner';
  banner.dataset.taskId = task.task_id;
  // textContent, not innerHTML: task text is shown as typed, never run as HTML
  const title = document.createElement('strong');
  title.textContent = task.title;
  banner.appendChild(title);
  if (task.content) {
    banner.appendChild(document.createElement('br'));
    banner.appendChild(document.createTextNode(task.content));
  }
  els.contentRoot.appendChild(banner);
}

// Full-screen image / video / YouTube for a task. Every screen starts at the
// same spot: the time since the task's start, looping over the video's length.
function renderTaskMedia(task) {
  const { media_type: type, url, duration } = task.media;
  const sinceStartMs = Math.max(0, Date.now() - new Date(task.schedule.start).getTime());

  if (type === 'image') {
    const img = document.createElement('img');
    img.src = getMediaUrl(url);
    els.contentRoot.appendChild(img);
  } else if (type === 'video') {
    const video = document.createElement('video');
    video.src = getMediaUrl(url);
    video.loop = true; // repeat until the task ends
    video.muted = !soundEnabled || playback.muted;
    video.volume = playback.volume / 100;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', () => {
      if (isFinite(video.duration) && video.duration > 0) {
        video.currentTime = (sinceStartMs / 1000) % video.duration;
      }
      if (!playback.paused) playWithSoundFallback(video);
    });
    els.contentRoot.appendChild(video);
  } else if (type === 'youtube') {
    const offsetMs = duration > 0 ? sinceStartMs % (duration * 1000) : 0;
    renderYouTube({ url }, offsetMs);
  }
}

// Shows every active alert at once (list is already sorted:
// highest priority first, newest first within the same priority)
const ALERT_LABELS = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'EMERGENCY' };

function showAlert(alerts) {
  els.alertMessage.innerHTML = '';
  alerts.forEach((alert) => {
    const line = document.createElement('p');
    line.className = 'alert-line';
    const tag = document.createElement('span');
    tag.className = 'alert-tag';
    tag.textContent = ALERT_LABELS[alert.priority] || 'ALERT';
    line.append(tag, alert.message);
    els.alertMessage.appendChild(line);
  });
  // Screen colour follows the highest priority (list is sorted, so it's the first)
  els.alertOverlay.className = `alert-overlay priority-${alerts[0].priority}`;
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
    // Map keeps arrival order -> reverse so newest comes first, then a stable sort puts higher priority on top
    const sorted = activeAlerts.reverse().sort((a, b) => b.priority - a.priority);
    return { type: 'alert', content: sorted };
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
    // Stop the playlist underneath so its sound doesn't play over the alert;
    // it rejoins the shared timeline once the alert ends
    if (!playback.paused) {
      if (state.playlistTimer) clearTimeout(state.playlistTimer);
      state.playlistTimer = null;
      els.contentRoot.innerHTML = '';
    }
    showAlert(content);
    return;
  }
  hideAlert();

  if (type === 'task') {
    // Pause the playlist so it doesn't overwrite the banner; it resumes once the task ends
    if (state.playlistTimer) clearTimeout(state.playlistTimer);
    state.playlistTimer = null;
    renderTaskBanner(content);
    return;
  }

  if (type === 'playlist') {
    if (!state.playlistTimer && !playback.paused) {
      // Only kick off playback here if nothing is currently scheduled
      // (applyPlaylist already manages its own buffering/timer lifecycle).
      // Rejoin where the shared timeline is now (e.g. after a task ends),
      // not at the start of the item, so this screen matches the others.
      const { index, offsetMs } = computePlaybackPosition(
        state.playlist.items,
        new Date(state.playlist.sync_timestamp).getTime(),
        Date.now()
      );
      playPlaylistFromPosition(index, offsetMs);
    }

    // Paused while a task / alert was showing and it has now ended: put the
    // playlist back (frozen) instead of leaving the screen blank or showing
    // the old task. playPlaylistFromPosition freezes it because we're paused.
    if (
      playback.paused &&
      (!els.contentRoot.children.length || els.contentRoot.querySelector('.task-banner'))
    ) {
      const { index, offsetMs } = computePlaybackPosition(
        state.playlist.items,
        new Date(state.playlist.sync_timestamp).getTime(),
        Date.now()
      );
      playPlaylistFromPosition(index, offsetMs);
    }
    return;
  }

  els.contentRoot.innerHTML = '<p class="placeholder">Waiting for content from ScreenSync...</p>';
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

// Re-check at an exact moment (a task starting or ending, an alert expiring),
// instead of waiting up to 5 s for the periodic check
function rerenderAt(time) {
  const delay = new Date(time).getTime() - Date.now();
  // setTimeout can't wait longer than ~24 days; the periodic check covers that
  if (delay > 0 && delay < 2147483647) setTimeout(resolveAndRender, delay + 50);
}

// ============================================================
// REMOTE PLAYBACK CONTROL (from the dashboard)
// ============================================================
// Resume / next / previous / restart arrive as a re-sent playlist with a shifted
// sync_timestamp (so every screen lands on the same spot). Here we only freeze
// the screen on pause and apply volume / mute.

const playback = {
  paused: false,
  volume: 100, // 0-100
  muted: false,
};

function eachVideo(fn) {
  document.querySelectorAll('.content-root video').forEach(fn);
}

// Control the YouTube player on screen (pauseVideo, playVideo, setVolume, mute, unMute)
function youtubeCommand(func, args = []) {
  const entry = currentYouTube;
  if (!entry || !entry.ready || !entry.frame.isConnected) return;
  try {
    entry.player[func](...args);
  } catch (e) { /* player already gone */ }
}

function applyVolume() {
  const silent = playback.muted || !soundEnabled;
  eachVideo((video) => {
    video.volume = playback.volume / 100;
    video.muted = silent;
  });
  youtubeCommand('setVolume', [playback.volume]);
  youtubeCommand(silent ? 'mute' : 'unMute');
}

function freezePlayback() {
  playback.paused = true;
  if (state.playlistTimer) {
    clearTimeout(state.playlistTimer);
    state.playlistTimer = null;
  }
  eachVideo((video) => video.pause());
  youtubeCommand('pauseVideo');
}

// A YouTube player that started muted can only get sound by reloading it,
// so re-render the current item at the current position (now with sound)
function reloadYouTubeWithSound() {
  const silent = playback.muted || !soundEnabled;
  if (silent || playback.paused || !document.querySelector('.youtube-frame')) return;
  // A task's YouTube video is showing: re-render the task, not the playlist
  if (els.contentRoot.querySelector('.task-banner')) {
    els.contentRoot.innerHTML = '';
    resolveAndRender();
    return;
  }
  if (!state.playlist) return;
  const { index, offsetMs } = computePlaybackPosition(
    state.playlist.items,
    new Date(state.playlist.sync_timestamp).getTime(),
    Date.now()
  );
  playPlaylistFromPosition(index, offsetMs);
}

function handlePlaybackMessage(msg) {
  const wasSilent = playback.muted || !soundEnabled;
  playback.volume = Number.isFinite(msg.volume) ? msg.volume : playback.volume;
  playback.muted = Boolean(msg.muted);
  applyVolume();
  if (wasSilent) reloadYouTubeWithSound();

  if (msg.paused) {
    if (!playback.paused) freezePlayback();
  } else {
    // Unpausing: the backend follows up with the playlist at the right position
    const wasPaused = playback.paused;
    playback.paused = false;
    // A task stays on screen through that, so restart its own media here
    if (wasPaused && els.contentRoot.querySelector('.task-banner')) {
      eachVideo((video) => video.play().catch(() => {}));
      youtubeCommand('playVideo');
    }
  }
}

// ============================================================
// SOUND + FULL SCREEN
// ============================================================
// Content always starts by itself (muted video may autoplay). Sound is another
// matter: browsers only allow it after a click on the page - unless the browser
// was opened with launch-tv.bat, which allows autoplay with sound (and runs full
// screen). Without that, a small "Sound off" note shows until someone clicks
// anywhere once.

// True when this browser lets videos play with sound without a click
function soundAllowedWithoutClick() {
  try {
    if (navigator.getAutoplayPolicy) {
      return navigator.getAutoplayPolicy('mediaelement') === 'allowed';
    }
  } catch (e) { /* not supported - try the next check */ }
  try {
    // Audio starts out suspended in browsers that need a click first
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const allowed = ctx.state === 'running';
    ctx.close();
    return allowed;
  } catch (e) {
    return false;
  }
}

let soundEnabled = soundAllowedWithoutClick();

const soundHint = document.getElementById('sound-hint');

// Launched as a kiosk (launch-tv.bat): already full screen, no status strip
const isKiosk = new URLSearchParams(window.location.search).has('kiosk');
if (isKiosk) document.documentElement.classList.add('kiosk');

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

// True when the page already fills the whole screen: real full screen, F11,
// or a kiosk window (launch-tv.bat / a TV's URL launcher). ?kiosk=1 alone
// doesn't count - it is also typed into ordinary browser windows.
function coversScreen() {
  return isFullscreen() ||
    (window.innerWidth >= window.screen.width && window.innerHeight >= window.screen.height);
}

// Browsers only allow this from a click / key press
function enterFullscreen() {
  if (isFullscreen()) return;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  try {
    // Returns a promise in modern browsers; ignore refusals (e.g. iPhone)
    if (request) Promise.resolve(request.call(root)).catch(() => {});
  } catch (e) { /* full screen not supported */ }
}

// The corner note says what one click would still fix (sound and/or full screen)
function updateScreenHint() {
  const needsFullscreen = !coversScreen();
  if (soundEnabled && !needsFullscreen) {
    soundHint.classList.add('hidden');
    return;
  }
  soundHint.textContent = soundEnabled
    ? 'Click anywhere for full screen'
    : '\u{1F507} Click anywhere for full screen and sound';
  soundHint.classList.remove('hidden');
}

function enableSound() {
  if (soundEnabled) return;
  soundEnabled = true;

  // Unmute what is already playing (respecting the dashboard's mute/volume)
  applyVolume();
  if (!playback.paused) {
    eachVideo((video) => video.play().catch(() => {}));
  }
  reloadYouTubeWithSound();
}

// One click or key press anywhere: full screen + sound. (Esc leaves full
// screen; the note then comes back so the next click can re-enter it.)
function onScreenInteraction() {
  enterFullscreen();
  enableSound();
  updateScreenHint();
}

document.addEventListener('click', onScreenInteraction);
document.addEventListener('keydown', onScreenInteraction);
document.addEventListener('fullscreenchange', updateScreenHint);
document.addEventListener('webkitfullscreenchange', updateScreenHint);
window.addEventListener('resize', updateScreenHint); // e.g. F11 pressed
updateScreenHint();

// Hide the mouse pointer when it hasn't moved for 3 s (it's a TV)
let cursorTimer = null;
function showCursorBriefly() {
  document.documentElement.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.documentElement.classList.add('hide-cursor'), 3000);
}
document.addEventListener('mousemove', showCursorBriefly);
showCursorBriefly();

// Play with sound if allowed; if the browser refuses, fall back to muted so the video still plays
function playWithSoundFallback(video) {
  video.play().catch(() => {
    // play() is also rejected when a pause interrupts it - stay paused then
    if (!video.muted && !playback.paused) {
      video.muted = true;
      video.play().catch(() => {});
    }
  });
}

// ============================================================
// IP ADDRESS -> PC NAME
// ============================================================
// YouTube refuses some videos (error 150) on pages opened by IP address,
// e.g. http://172.22.20.118:3000, yet plays them when the same page is
// opened by the PC's name (http://<pc-name>:3000). A page opened by IP
// therefore checks whether this screen can reach the PC by name and, if
// so, reloads itself under that name (same page, same ?id=...). If the
// name can't be reached, the page just stays on the IP address.

function isIpAddress(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

async function switchToPcName() {
  const { protocol, hostname, port, pathname, search, hash } = window.location;
  if (!isIpAddress(hostname)) return false;

  try {
    // The ScreenSync server reports its own name
    const health = await fetch('/health', { cache: 'no-store' }).then((res) => res.json());
    const name = health && health.data && health.data.hostname;
    if (!name || isIpAddress(name)) return false;

    const base = `${protocol}//${name}${port ? `:${port}` : ''}`;

    // Can this screen reach the PC by name? Any reply within 3 s will do
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    await fetch(`${base}/health`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);

    console.log(`[SCREEN] Switching to ${base} (YouTube allows more videos there)`);
    window.location.replace(base + pathname + search + hash);
    return true;
  } catch (e) {
    // Name not reachable from this screen (or not served by ScreenSync): stay on the IP
    return false;
  }
}

switchToPcName().then((switching) => {
  if (!switching) connect();
});

