const WS_URL =
  import.meta.env.VITE_WS_URL ||
  'ws://localhost:3000';

// Lightweight admin WebSocket client used for live device status updates.
// Automatically reconnects with backoff if the connection drops.
export function createAdminSocket({
  token,
  onMessage,
  onOpen,
  onClose,
}) {
  let socket = null;
  let reconnectAttempt = 0;
  let closedByUser = false;
  let reconnectTimer = null;


  // ==========================================================
  // CONNECT
  // ==========================================================

  function connect() {
  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  const newSocket = new WebSocket(WS_URL);

  socket = newSocket;

  newSocket.addEventListener('open', () => {
    if (socket !== newSocket) return;

    reconnectAttempt = 0;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    newSocket.send(
      JSON.stringify({
        type: 'register',
        device_type: 'admin',
        token,
      })
    );

    if (onOpen) onOpen();
  });

  newSocket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);

      if (onMessage) {
        onMessage(data);
      }
    } catch (err) {
      console.error(
        '[Admin WS] Failed to parse WS message',
        err
      );
    }
  });

  newSocket.addEventListener('close', (event) => {
    console.warn('[Admin WS] Connection closed', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });

    // Ignore events from an old socket
    if (socket !== newSocket) {
      return;
    }

    socket = null;

    if (onClose) {
      onClose();
    }

    if (!closedByUser) {
      scheduleReconnect();
    }
  });

  newSocket.addEventListener('error', (err) => {
    console.error(
      '[Admin WS] WebSocket error',
      err
    );

    // Let the close event handle reconnection
  });
}


  // ==========================================================
  // CURRENT SOCKET
  // ==========================================================

  let currentSocket = null;


  // ==========================================================
  // RECONNECT
  // ==========================================================

  function scheduleReconnect() {

    // --------------------------------------------------------
    // Don't create multiple reconnect timers
    // --------------------------------------------------------

    if (reconnectTimer) {

      console.log(
        '[Admin WS] Reconnect already scheduled'
      );

      return;
    }


    // --------------------------------------------------------
    // Don't reconnect if a socket is already active
    // --------------------------------------------------------

    if (
      socket &&
      (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }


    const delay =
      Math.min(
        1000 * 2 ** reconnectAttempt,
        15000
      );


    reconnectAttempt += 1;


    console.log(
      `[Admin WS] Reconnecting in ${delay}ms`
    );


    reconnectTimer =
      setTimeout(
        () => {

          reconnectTimer = null;


          if (closedByUser) {
            return;
          }


          connect();

        },
        delay
      );
  }


  // ==========================================================
  // INITIAL CONNECTION
  // ==========================================================

  connect();


  // ==========================================================
  // PUBLIC API
  // ==========================================================

  return {

    close: () => {

      console.log(
        '[Admin WS] Closing connection manually'
      );


      closedByUser = true;


      // Cancel pending reconnect
      if (reconnectTimer) {

        clearTimeout(
          reconnectTimer
        );

        reconnectTimer = null;
      }


      const socketToClose =
        socket;


      socket = null;


      if (
        socketToClose &&
        (
          socketToClose.readyState === WebSocket.OPEN ||
          socketToClose.readyState === WebSocket.CONNECTING
        )
      ) {

        socketToClose.close(
          1000,
          'Closed by user'
        );
      }
    },
  };
}