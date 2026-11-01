const ROLES = Object.freeze({
  ADMIN: 'admin',
  VIEWER: 'viewer',
  TV: 'tv',
});

const PRIORITY = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  EMERGENCY: 4,
});

const CONTENT_TYPE = Object.freeze({
  PLAYLIST: 'playlist',
  CLEAR_PLAYLIST: 'clear_playlist',
  TASK: 'task',
  CLEAR_TASK: 'clear_task',
  // Sent to a TV as it connects, before the current alerts and tasks
  RESET_SCHEDULE: 'reset_schedule',
  PLAYBACK: 'playback',
  ALERT: 'alert',
  REGISTER: 'register',
  HEARTBEAT: 'heartbeat',
  DEVICE_LIST: 'device_list',
  ERROR: 'error',
  ACK: 'ack',
});

const NETWORK_TYPE = Object.freeze({
  LAN: 'LAN',
  WIFI: 'WiFi',
});

const DEVICE_ROLE = Object.freeze({
  REFERENCE: 'reference',
  BUFFERED: 'buffered',
});

const MEDIA_TYPE = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
  TEXT: 'text',
  YOUTUBE: 'youtube',
});

module.exports = {
  ROLES,
  PRIORITY,
  CONTENT_TYPE,
  NETWORK_TYPE,
  DEVICE_ROLE,
  MEDIA_TYPE,
};
