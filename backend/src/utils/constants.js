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
  TASK: 'task',
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
});

module.exports = {
  ROLES,
  PRIORITY,
  CONTENT_TYPE,
  NETWORK_TYPE,
  DEVICE_ROLE,
  MEDIA_TYPE,
};
