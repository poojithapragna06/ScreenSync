/*
 * ScreenSync - Sony FW-65BZ30L (LAN) TV Client
 *
 * Reference display.
 *
 * Playback is synchronized using the playlist's global sync_timestamp.
 *
 * Browser/WebSocket synchronization is BEST-EFFORT.
 * It does not provide hardware-level frame synchronization.
 */

const CONFIG = {
  // Change to operator's IP
  WS_URL:
    window.SCREENSYNC_WS_URL ||
    'ws://localhost:3000',

  DEVICE_ID: 'sony_lan_tv_01',

  NETWORK: 'LAN',

  ROLE: 'reference',

  HEARTBEAT_INTERVAL_MS: 10000,

  RECONNECT_BASE_MS: 1000,

  RECONNECT_MAX_MS: 15000,
};


// ============================================================
// STATE
// ============================================================

const state = {
  socket: null,

  reconnectAttempt: 0,

  reconnectTimer: null,

  connected: false,

  playlist: null,

  tasks: new Map(),

  alerts: new Map(),

  playlistTimer: null,

  playlistIndex: 0,

  priorityCheckTimer: null,
};


// ============================================================
// DOM ELEMENTS
// ============================================================

const els = {
  status: document.getElementById('connection-status'),

  contentRoot:
    document.getElementById('content-root'),

  alertOverlay:
    document.getElementById('alert-overlay'),

  alertMessage:
    document.getElementById('alert-message'),
};


// ============================================================
// CONNECTION STATUS
// ============================================================

function setConnectionStatus(isOnline) {
  state.connected = isOnline;

  els.status.textContent = isOnline
    ? 'online'
    : 'reconnecting...';

  els.status.className = isOnline
    ? 'online'
    : 'offline';
}


// ============================================================
// SEND MESSAGE
// ============================================================

function send(payload) {
  if (
    state.socket &&
    state.socket.readyState === WebSocket.OPEN
  ) {
    state.socket.send(
      JSON.stringify(payload)
    );
  }
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

function connect() {

  // ----------------------------------------------------------
  // Prevent duplicate connections
  // ----------------------------------------------------------

  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {
    console.log(
      '[WebSocket] Connection already active'
    );

    return;
  }

  console.log(
    '[WebSocket] Connecting to:',
    CONFIG.WS_URL
  );

  const socket =
    new WebSocket(CONFIG.WS_URL);

  state.socket = socket;


  // ----------------------------------------------------------
  // OPEN
  // ----------------------------------------------------------

  socket.addEventListener(
    'open',
    () => {

      console.log(
        '[WebSocket] Connected'
      );

      state.reconnectAttempt = 0;

      // Cancel pending reconnect timer
      if (state.reconnectTimer) {
        clearTimeout(
          state.reconnectTimer
        );

        state.reconnectTimer = null;
      }

      setConnectionStatus(true);


      // ------------------------------------------------------
      // Register this TV
      // ------------------------------------------------------

      send({
        type: 'register',

        device_id:
          CONFIG.DEVICE_ID,

        device_type:
          'tv',

        network:
          CONFIG.NETWORK,

        role:
          CONFIG.ROLE,
      });


      startHeartbeat();
    }
  );


  // ----------------------------------------------------------
  // MESSAGE
  // ----------------------------------------------------------

  socket.addEventListener(
    'message',
    (event) => {

      let msg;

      try {

        msg =
          JSON.parse(event.data);

      } catch (err) {

        console.error(
          '[WebSocket] Invalid message from server',
          err
        );

        return;
      }

      handleMessage(msg);
    }
  );


  // ----------------------------------------------------------
  // CLOSE
  // ----------------------------------------------------------

  socket.addEventListener(
    'close',
    (event) => {

      console.warn(
        '[WebSocket] Connection closed',
        {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }
      );


      // Only react if this is still
      // the active socket.
      if (
        state.socket === socket
      ) {

        state.socket = null;

        setConnectionStatus(false);

        stopHeartbeat();

        scheduleReconnect();
      }
    }
  );


  // ----------------------------------------------------------
  // ERROR
  // ----------------------------------------------------------

  socket.addEventListener(
    'error',
    (err) => {

      console.error(
        '[WebSocket] Error',
        err
      );

      /*
       * Do NOT call socket.close()
       * here.
       *
       * Browser will normally emit
       * close after the error.
       */
    }
  );
}


// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {

  // ----------------------------------------------------------
  // Prevent multiple reconnect timers
  // ----------------------------------------------------------

  if (state.reconnectTimer) {

    console.log(
      '[WebSocket] Reconnect already scheduled'
    );

    return;
  }


  // ----------------------------------------------------------
  // Don't reconnect if socket became active
  // ----------------------------------------------------------

  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {

    return;
  }


  const delay =
    Math.min(
      CONFIG.RECONNECT_BASE_MS *
        2 ** state.reconnectAttempt,

      CONFIG.RECONNECT_MAX_MS
    );


  state.reconnectAttempt += 1;


  console.log(
    `[WebSocket] Reconnecting in ${delay}ms`
  );


  state.reconnectTimer =
    setTimeout(
      () => {

        state.reconnectTimer = null;

        connect();

      },
      delay
    );
}


// ============================================================
// HEARTBEAT
// ============================================================

let heartbeatHandle = null;


function startHeartbeat() {

  stopHeartbeat();


  heartbeatHandle =
    setInterval(
      () => {

        send({
          type: 'heartbeat',

          device_id:
            CONFIG.DEVICE_ID,

          status:
            'online',

          last_sync:
            state.playlist
              ? state.playlist.sync_timestamp
              : null,

          network:
            CONFIG.NETWORK,
        });

      },
      CONFIG.HEARTBEAT_INTERVAL_MS
    );
}


function stopHeartbeat() {

  if (heartbeatHandle) {

    clearInterval(
      heartbeatHandle
    );

    heartbeatHandle = null;
  }
}


// ============================================================
// HANDLE SERVER MESSAGE
// ============================================================

function handleMessage(msg) {

  switch (msg.type) {

    // --------------------------------------------------------
    // ACK
    // --------------------------------------------------------

    case 'ack':

      console.log(
        '[ACK]',
        msg.message
      );

      break;


    // --------------------------------------------------------
    // SERVER ERROR
    // --------------------------------------------------------

    case 'error':

      console.error(
        '[Server Error]',
        msg.message
      );

      break;


    // --------------------------------------------------------
    // PLAYLIST
    // --------------------------------------------------------

    case 'playlist':

      applyPlaylist(msg);

      break;


    // --------------------------------------------------------
    // TASK
    // --------------------------------------------------------

    case 'task':

      state.tasks.set(
        msg.task_id,
        msg
      );

      resolveAndRender();

      break;
    case 'clear_task':
      state.tasks.delete(
        msg.task_id
      );

      resolveAndRender();
      break;

    // --------------------------------------------------------
    // ALERT
    // --------------------------------------------------------

    case 'alert':

      state.alerts.set(
        msg.alert_id,
        msg
      );

      resolveAndRender();

      break;


    // --------------------------------------------------------
    // CLEAR ALERT
    // --------------------------------------------------------

    case 'clear_alert':

      state.alerts.delete(
        msg.alert_id
      );

      resolveAndRender();

      break;


    // --------------------------------------------------------
    // UNKNOWN
    // --------------------------------------------------------

    default:

      console.warn(
        '[WebSocket] Unknown message type:',
        msg.type
      );
  }
}


// ============================================================
// APPLY PLAYLIST
// ============================================================

function applyPlaylist(msg) {

  console.log(
    `[Playlist] Received "${msg.name}"`
  );


  state.playlist = msg;


  // ----------------------------------------------------------
  // Clear previous playlist timer
  // ----------------------------------------------------------

  if (state.playlistTimer) {

    clearTimeout(
      state.playlistTimer
    );

    state.playlistTimer = null;
  }


  const items =
    msg.items || [];


  // ----------------------------------------------------------
  // Empty playlist
  // ----------------------------------------------------------

  if (!items.length) {

    console.warn(
      '[Playlist] Received empty playlist'
    );

    els.contentRoot.innerHTML =
      '<p class="placeholder">Playlist is empty</p>';

    return;
  }


  // ----------------------------------------------------------
  // Convert sync timestamp
  // ----------------------------------------------------------

  const syncTime =
    new Date(
      msg.sync_timestamp
    ).getTime();


  const now =
    Date.now();


  // ----------------------------------------------------------
  // Invalid timestamp
  // ----------------------------------------------------------

  if (
    Number.isNaN(syncTime)
  ) {

    console.error(
      '[Playlist] Invalid sync_timestamp:',
      msg.sync_timestamp
    );

    return;
  }


  // ----------------------------------------------------------
  // Playlist hasn't started
  // ----------------------------------------------------------

  if (now < syncTime) {

    const delay =
      syncTime - now;


    console.log(
      `[SYNC] "${msg.name}" starts in ${delay}ms`
    );


    state.playlistTimer =
      setTimeout(
        () => {

          state.playlistTimer =
            null;

          startPlaylistFromGlobalTime();

        },
        delay
      );


    return;
  }


  // ----------------------------------------------------------
  // Playlist already started
  // ----------------------------------------------------------

  startPlaylistFromGlobalTime();
}


// ============================================================
// START PLAYLIST FROM GLOBAL TIMELINE
// ============================================================

function startPlaylistFromGlobalTime() {

  const items =
    state.playlist?.items || [];


  if (!items.length) {
    return;
  }


  const syncTime =
    new Date(
      state.playlist.sync_timestamp
    ).getTime();


  const now =
    Date.now();


  if (
    Number.isNaN(syncTime)
  ) {

    console.error(
      '[SYNC] Invalid sync timestamp'
    );

    return;
  }


  // ----------------------------------------------------------
  // Time elapsed since global start
  // ----------------------------------------------------------

  let elapsed =
    now - syncTime;


  // ----------------------------------------------------------
  // Calculate total playlist duration
  // ----------------------------------------------------------

  const totalDuration =
    items.reduce(
      (sum, item) => {

        const duration =
          Number(
            item.duration || 5
          ) * 1000;

        return sum + duration;

      },
      0
    );


  if (
    totalDuration <= 0
  ) {

    console.error(
      '[SYNC] Invalid playlist duration'
    );

    return;
  }


  // ----------------------------------------------------------
  // Loop playlist
  // ----------------------------------------------------------

  elapsed =
    elapsed % totalDuration;


  // ----------------------------------------------------------
  // Find current item
  // ----------------------------------------------------------

  let index = 0;

  let offset = elapsed;


  for (
    let i = 0;
    i < items.length;
    i++
  ) {

    const duration =
      Number(
        items[i].duration || 5
      ) * 1000;


    if (
      offset < duration
    ) {

      index = i;

      break;
    }


    offset -= duration;
  }


  state.playlistIndex =
    index;


  console.log(
    `[SYNC] Playlist: ${state.playlist.name}`
  );

  console.log(
    `[SYNC] Global elapsed: ${elapsed}ms`
  );

  console.log(
    `[SYNC] Starting item: ${index}`
  );

  console.log(
    `[SYNC] Offset: ${offset}ms`
  );


  playPlaylistItem(
    index,
    offset
  );
}


// ============================================================
// PLAY PLAYLIST ITEM
// ============================================================

function playPlaylistItem(
  index,
  offset = 0
) {

  const items =
    state.playlist?.items || [];


  if (!items.length) {
    return;
  }


  // ----------------------------------------------------------
  // Validate index
  // ----------------------------------------------------------

  if (
    index < 0 ||
    index >= items.length
  ) {

    index = 0;

    offset = 0;
  }


  state.playlistIndex =
    index;


  const item =
    items[index];


  // ----------------------------------------------------------
  // Render current item
  // ----------------------------------------------------------

  renderContentItem(
    item,
    offset
  );


  // ----------------------------------------------------------
  // Duration
  // ----------------------------------------------------------

  const duration =
    Number(
      item.duration || 5
    ) * 1000;


  // ----------------------------------------------------------
  // Remaining duration
  // ----------------------------------------------------------

  const remaining =
    Math.max(
      100,
      duration - offset
    );


  console.log(
    `[PLAY] item=${index} ` +
    `offset=${offset}ms ` +
    `duration=${duration}ms ` +
    `remaining=${remaining}ms`
  );


  // ----------------------------------------------------------
  // Clear old timer
  // ----------------------------------------------------------

  if (
    state.playlistTimer
  ) {

    clearTimeout(
      state.playlistTimer
    );

    state.playlistTimer = null;
  }


  // ----------------------------------------------------------
  // Schedule next item
  // ----------------------------------------------------------

  state.playlistTimer =
    setTimeout(
      () => {

        state.playlistTimer =
          null;


        const nextIndex =
          (
            state.playlistIndex + 1
          ) % items.length;


        playPlaylistItem(
          nextIndex,
          0
        );

      },
      remaining
    );
}


// ============================================================
// VIDEO URL DETECTION
// ============================================================

function isVideoUrl(url) {

  if (!url) {
    return false;
  }


  return /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(
    url
  );
}


// ============================================================
// MEDIA URL
// ============================================================

function getMediaUrl(url) {

  if (!url) {
    return '';
  }


  // ----------------------------------------------------------
  // Absolute URL
  // ----------------------------------------------------------

  if (
    /^https?:\/\//i.test(url)
  ) {

    return url;
  }


  // ----------------------------------------------------------
  // Uploaded media
  // ----------------------------------------------------------

  if (
    url.startsWith('/uploads/')
  ) {

    try {

      const backendHttpUrl =
        CONFIG.WS_URL
          .replace(
            /^ws:/i,
            'http:'
          )
          .replace(
            /^wss:/i,
            'https:'
          );


      return new URL(
        url,
        backendHttpUrl
      ).toString();

    } catch (err) {

      console.warn(
        '[MEDIA] Could not build backend media URL:',
        err
      );
    }
  }


  return url;
}


// ============================================================
// RENDER CONTENT ITEM
// ============================================================

function renderContentItem(
  item,
  offset = 0
) {

  els.contentRoot.innerHTML = '';


  if (!item) {

    console.warn(
      '[MEDIA] Empty playlist item'
    );

    return;
  }


  let mediaType =
    String(
      item.media_type || ''
    ).toLowerCase();


  const mediaUrl =
    getMediaUrl(item.url);


  // ----------------------------------------------------------
  // AUTO-DETECT VIDEO
  // ----------------------------------------------------------

  if (
    mediaType === 'image' &&
    isVideoUrl(mediaUrl)
  ) {

    console.warn(
      '[MEDIA] media_type=image but URL is a video.'
    );

    console.warn(
      '[MEDIA] Treating item as video:',
      mediaUrl
    );

    mediaType = 'video';
  }


  // ==========================================================
  // IMAGE
  // ==========================================================

  if (
    mediaType === 'image'
  ) {

    const img =
      document.createElement('img');


    img.src =
      mediaUrl;


    img.alt =
      item.content || '';


    img.addEventListener(
      'load',
      () => {

        console.log(
          '[IMAGE] Loaded:',
          mediaUrl
        );

      }
    );


    img.addEventListener(
      'error',
      (err) => {

        console.error(
          '[IMAGE] Failed to load:',
          mediaUrl,
          err
        );

      }
    );


    els.contentRoot.appendChild(
      img
    );


    return;
  }


  // ==========================================================
  // VIDEO
  // ==========================================================

  if (
    mediaType === 'video'
  ) {

    console.log(
      `[VIDEO] Loading: ${mediaUrl} | offset=${offset}ms`
    );


    const video =
      document.createElement('video');


    video.src =
      mediaUrl;


    // --------------------------------------------------------
    // Autoplay settings
    // --------------------------------------------------------

    video.autoplay =
      true;

    video.muted =
      true;

    video.defaultMuted =
      true;

    video.playsInline =
      true;

    video.preload =
      'auto';

    video.loop =
      false;

    video.controls =
      false;


    // --------------------------------------------------------
    // Styling
    // --------------------------------------------------------

    video.style.width =
      '100%';

    video.style.height =
      '100%';

    video.style.objectFit =
      'contain';


    // --------------------------------------------------------
    // Metadata loaded
    // --------------------------------------------------------

    video.addEventListener(
      'loadedmetadata',
      () => {

        console.log(
          `[VIDEO] Metadata loaded | duration=${video.duration}s`
        );


        // ----------------------------------------------------
        // Synchronize position
        // ----------------------------------------------------

        if (
          offset > 0 &&
          Number.isFinite(
            video.duration
          )
        ) {

          const requestedTime =
            offset / 1000;


          const safeTime =
            Math.min(
              Math.max(
                0,
                requestedTime
              ),

              Math.max(
                0,
                video.duration - 0.1
              )
            );


          try {

            video.currentTime =
              safeTime;


            console.log(
              `[VIDEO] Seeked to ${safeTime.toFixed(2)}s`
            );

          } catch (err) {

            console.warn(
              '[VIDEO] Could not set currentTime:',
              err
            );
          }
        }


        // ----------------------------------------------------
        // Start video
        // ----------------------------------------------------

        video.play()
          .then(
            () => {

              console.log(
                '[VIDEO] Playing successfully'
              );

            }
          )
          .catch(
            (err) => {

              console.error(
                '[VIDEO] Autoplay/play failed:',
                err
              );

            }
          );
      }
    );


    // --------------------------------------------------------
    // Can play
    // --------------------------------------------------------

    video.addEventListener(
      'canplay',
      () => {

        console.log(
          '[VIDEO] Can play:',
          mediaUrl
        );

      }
    );


    // --------------------------------------------------------
    // Playing
    // --------------------------------------------------------

    video.addEventListener(
      'playing',
      () => {

        console.log(
          '[VIDEO] Playing:',
          mediaUrl
        );

      }
    );


    // --------------------------------------------------------
    // Ended
    // --------------------------------------------------------

    video.addEventListener(
      'ended',
      () => {

        console.log(
          '[VIDEO] Video ended:',
          mediaUrl
        );

      }
    );


    // --------------------------------------------------------
    // Error
    // --------------------------------------------------------

    video.addEventListener(
      'error',
      () => {

        const error =
          video.error;


        console.error(
          '[VIDEO] Failed to load/play video:',
          mediaUrl,
          error
            ? {
                code: error.code,
                message: error.message,
              }
            : 'Unknown video error'
        );


        els.contentRoot.innerHTML =
          '<p class="placeholder">Unable to play video</p>';
      }
    );


    els.contentRoot.appendChild(
      video
    );


    return;
  }


  // ==========================================================
  // TEXT
  // ==========================================================

  if (
    mediaType === 'text'
  ) {

    const div =
      document.createElement('div');


    div.className =
      'text-slide';


    div.textContent =
      item.content || '';


    els.contentRoot.appendChild(
      div
    );


    return;
  }


  // ==========================================================
  // UNKNOWN MEDIA TYPE
  // ==========================================================

  console.warn(
    '[Playlist] Unknown media type:',
    item.media_type
  );


  els.contentRoot.innerHTML =
    '<p class="placeholder">Unsupported content type</p>';
}


// ============================================================
// TASK BANNER
// ============================================================

function renderTaskBanner(task) {
  const banner =
    document.getElementById('taskBanner');

  const title =
    document.getElementById('taskTitle');

  const content =
    document.getElementById('taskContent');

  // ----------------------------------------------------------
  // If banner elements exist in HTML, use them
  // ----------------------------------------------------------

  if (banner && title && content) {
    title.textContent =
      task.title || '';

    content.textContent =
      task.content || '';

    banner.classList.remove('hidden');

    return;
  }

  // ----------------------------------------------------------
  // Fallback:
  // Create banner if HTML does not have one
  // ----------------------------------------------------------

  let fallbackBanner =
    document.getElementById(
      'taskBanner'
    );

  if (!fallbackBanner) {
    fallbackBanner =
      document.createElement('div');

    fallbackBanner.id =
      'taskBanner';

    fallbackBanner.className =
      'task-banner';

    document.body.appendChild(
      fallbackBanner
    );
  }

  fallbackBanner.textContent =
    `${task.title || ''}\n${task.content || ''}`;

  fallbackBanner.classList.remove(
    'hidden'
  );
}


function hideTaskBanner() {
  const banner =
    document.getElementById(
      'taskBanner'
    );

  if (banner) {
    banner.classList.add(
      'hidden'
    );
  }
}


// ============================================================
// ALERT
// ============================================================

function showAlert(alert) {

  els.alertMessage.textContent =
    alert.message;


  els.alertOverlay.classList.remove(
    'hidden'
  );
}


function hideAlert() {

  els.alertOverlay.classList.add(
    'hidden'
  );
}


// ============================================================
// TASK CLASH / ROTATION LOGIC
// ============================================================

const TASK_DISPLAY_TIME = {
  4: Infinity,      // Emergency
  3: 30 * 1000,     // High
  2: 20 * 1000,     // Medium
  1: 10 * 1000,     // Low
};

let taskRotationTimer = null;
let currentTaskId = null;


// ============================================================
// GET ACTIVE TASKS
// ============================================================

function getActiveTasks() {
  const now = new Date();

  return Array.from(
    state.tasks.values()
  ).filter((task) => {

    if (
      !task.schedule?.start ||
      !task.schedule?.end
    ) {
      return false;
    }

    const start =
      new Date(
        task.schedule.start
      );

    const end =
      new Date(
        task.schedule.end
      );

    return (
      start <= now &&
      now < end
    );
  });
}


// ============================================================
// STOP TASK ROTATION
// ============================================================

function stopTaskRotation() {

  if (taskRotationTimer) {
    clearTimeout(
      taskRotationTimer
    );

    taskRotationTimer = null;
  }
}


// ============================================================
// DISPLAY TASK
// ============================================================

function displayTask(task) {

  if (!task) {
    currentTaskId = null;
    hideTaskBanner();
    return;
  }

  currentTaskId =
    task.task_id;

  renderTaskBanner(task);
}


// ============================================================
// ROTATE TO NEXT TASK
// ============================================================

function rotateTask() {

  const activeTasks =
    getActiveTasks();


  // ----------------------------------------------------------
  // No active tasks
  // ----------------------------------------------------------

  if (
    activeTasks.length === 0
  ) {
    stopTaskRotation();

    currentTaskId = null;

    hideTaskBanner();

    return;
  }


  // ----------------------------------------------------------
  // Emergency
  // ----------------------------------------------------------

  const emergencyTask =
    activeTasks.find(
      (task) =>
        Number(task.priority) === 4
    );


  if (emergencyTask) {

    stopTaskRotation();

    displayTask(
      emergencyTask
    );


    // Check again after 1 second
    // in case emergency expires.

    taskRotationTimer =
      setTimeout(
        () => {
          taskRotationTimer = null;
          resolveTaskDisplay();
        },
        1000
      );

    return;
  }


  // ----------------------------------------------------------
  // Sort by priority
  // ----------------------------------------------------------

  activeTasks.sort(
    (a, b) =>
      Number(b.priority) -
      Number(a.priority)
  );


  // ----------------------------------------------------------
  // Find current task
  // ----------------------------------------------------------

  let currentIndex =
    activeTasks.findIndex(
      (task) =>
        task.task_id ===
        currentTaskId
    );


  // Current task no longer exists
  if (currentIndex === -1) {

    currentIndex = 0;

  } else {

    // Move to next task
    currentIndex =
      (
        currentIndex + 1
      ) % activeTasks.length;
  }


  const task =
    activeTasks[
      currentIndex
    ];


  displayTask(task);


  // ----------------------------------------------------------
  // Display duration
  // ----------------------------------------------------------

  const displayTime =
    TASK_DISPLAY_TIME[
      Number(task.priority)
    ] || 10000;


  // ----------------------------------------------------------
  // Schedule next rotation
  // ----------------------------------------------------------

  if (
    displayTime !== Infinity
  ) {

    taskRotationTimer =
      setTimeout(
        () => {

          taskRotationTimer =
            null;

          rotateTask();

        },
        displayTime
      );
  }
}


// ============================================================
// RESOLVE TASK DISPLAY
// ============================================================
//
// IMPORTANT:
//
// This function can run every second.
//
// It DOES NOT rotate every second.
//
// Rotation happens only through taskRotationTimer.
// ============================================================

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
    stopTaskRotation();

    if (currentTaskId !== emergencyTask.task_id) {
      displayTask(emergencyTask);
    }

    return;
  }

  // ----------------------------------------------------------
  // ONLY ONE ACTIVE TASK
  // ----------------------------------------------------------
  if (activeTasks.length === 1) {
    // Single task should remain continuously visible.
    stopTaskRotation();

    const task = activeTasks[0];

    if (currentTaskId !== task.task_id) {
      displayTask(task);
    }

    return;
  }

  // ----------------------------------------------------------
  // MULTIPLE ACTIVE TASKS
  // ----------------------------------------------------------

  activeTasks.sort(
    (a, b) => Number(b.priority) - Number(a.priority)
  );

  const currentTaskStillActive = activeTasks.some(
    (task) => task.task_id === currentTaskId
  );

  // ----------------------------------------------------------
  // Current task expired/removed
  // ----------------------------------------------------------
  if (!currentTaskStillActive) {
    stopTaskRotation();

    const task = activeTasks[0];

    displayTask(task);

    const displayTime =
      TASK_DISPLAY_TIME[Number(task.priority)] || 10000;

    if (displayTime !== Infinity) {
      taskRotationTimer = setTimeout(() => {
        taskRotationTimer = null;
        rotateTask();
      }, displayTime);
    }

    return;
  }

  // ----------------------------------------------------------
  // Multiple tasks started while current task was showing
  // ----------------------------------------------------------
  //
  // Keep current task on screen, but start its rotation timer.
  //
  if (!taskRotationTimer) {
    const currentTask = activeTasks.find(
      (task) => task.task_id === currentTaskId
    );

    if (currentTask) {
      const displayTime =
        TASK_DISPLAY_TIME[
          Number(currentTask.priority)
        ] || 10000;

      if (displayTime !== Infinity) {
        taskRotationTimer = setTimeout(() => {
          taskRotationTimer = null;
          rotateTask();
        }, displayTime);
      }
    }
  }

  // Otherwise rotation timer is already controlling the display.
}

// ============================================================
// RESOLVE AND RENDER
// ============================================================
//
// IMPORTANT:
//
// Tasks are displayed as a banner.
//
// They do NOT stop the playlist.
// ============================================================

function resolveAndRender() {

  pruneExpired();


  // ==========================================================
  // ALERTS
  // ==========================================================

  const now =
    new Date();

  const activeAlerts =
    Array.from(
      state.alerts.values()
    ).filter(
      (alert) =>
        new Date(
          alert.expires
        ) > now
    );


  if (
    activeAlerts.length > 0
  ) {

    activeAlerts.sort(
      (a, b) =>
        Number(b.priority) -
        Number(a.priority)
    );

    showAlert(
      activeAlerts[0]
    );

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

  // IMPORTANT:
  //
  // Do NOT stop playlistTimer here.
  //
  // Playlist continues independently.
}


// ============================================================
// REMOVE EXPIRED TASKS / ALERTS
// ============================================================

function pruneExpired() {

  const now =
    new Date();


  // ==========================================================
  // ALERTS
  // ==========================================================

  for (
    const [id, alert]
    of state.alerts.entries()
  ) {

    if (
      new Date(alert.expires) <= now
    ) {

      state.alerts.delete(id);
    }
  }


  // ==========================================================
  // TASKS
  // ==========================================================

  for (
    const [id, task]
    of state.tasks.entries()
  ) {

    if (
      task.schedule &&
      task.schedule.end &&
      new Date(
        task.schedule.end
      ) <= now
    ) {

      state.tasks.delete(id);
    }
  }
}


// ============================================================
// PERIODIC PRIORITY CHECK
// ============================================================

state.priorityCheckTimer =
  setInterval(
    resolveAndRender,
    1000
  );


// ============================================================
// START
// ============================================================

connect();