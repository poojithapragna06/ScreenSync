// Where the backend's live connection is:
// 1. VITE_WS_URL if set
// 2. else the same server as VITE_API_URL (http -> ws, https -> wss), so a
//    dashboard hosted separately (e.g. Vercel) only needs VITE_API_URL
// 3. else like services/api.js: dev server -> port 3000, otherwise the page's own address
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/^http/i, 'ws')) ||
  (window.location.port === '5173'
    ? `ws://${window.location.hostname}:3000`
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`);

// Lightweight admin WebSocket client used for live device status updates.
// Automatically reconnects with backoff if the connection drops.
export function createAdminSocket({ token, onMessage, onOpen, onClose }) {
  let socket = null;
  let reconnectAttempt = 0;
  let closedByUser = false;
  let reconnectTimer = null;

  function connect() {
    socket = new WebSocket(WS_URL);

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: 'register', device_type: 'admin', token }));
      if (onOpen) onOpen();
    });

    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    });

    socket.addEventListener('close', () => {
      if (onClose) onClose();
      if (!closedByUser) {
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  connect();

  return {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    },
  };
}
