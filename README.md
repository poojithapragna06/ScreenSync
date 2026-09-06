# ScreenSync

Real-time synchronization and centralized management for multiple digital displays.

ScreenSync lets an administrator manage playlists, scheduled tasks, and emergency
alerts from a single dashboard and push them, over WebSockets, to every connected
TV in real time — regardless of whether that TV is on a fast LAN connection or a
flakier Wi-Fi connection.

---

## 1. Overview

Two reference devices are modeled out of the box:

| Device | Connection | Role |
|---|---|---|
| Sony FW-65BZ30L | LAN | Reference display — assumed low-latency, starts playback exactly at the sync timestamp |
| Samsung QM65C | Wi-Fi | Buffered display — preloads content and compensates for latency/jitter using timestamp math |

Both are plain browser clients (no proprietary Sony/Samsung SDKs). Any device that
can open a Chromium-based browser can register as a new display without changing
the backend or frontend.

## 2. Architecture

```
React Admin UI  ──REST + JWT──▶  Node.js/Express Backend  ──▶  MongoDB
                                          │
                                     WebSocket (ws)
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                     ▼
                 Sony LAN TV client                  Samsung Wi-Fi TV client
                 (reference clock)                    (buffered playback)
```

The same WebSocket server also pushes live device-status updates to any admin
dashboard connected to it, so the Devices/Dashboard pages update without polling.

## 3. Technology Stack

**Backend:** Node.js, Express.js, MongoDB + Mongoose, `ws`, JWT, bcryptjs, dotenv, cors
**Frontend:** React 18, React Router, Axios, native WebSocket API, Vite
**TV Clients:** Plain HTML/CSS/JavaScript, native WebSocket API

## 4. Project Structure

```
screensync/
├── backend/
│   └── src/
│       ├── config/db.js
│       ├── models/{User,Playlist,Task,Alert}.js
│       ├── controllers/{auth,playlist,task,alert,device}Controller.js
│       ├── routes/{auth,playlist,task,alert,device}Routes.js
│       ├── middleware/{authMiddleware,errorHandler}.js
│       ├── services/{websocketService,priorityService}.js
│       ├── utils/{constants,asyncHandler}.js
│       └── server.js
├── frontend/
│   └── src/
│       ├── components/{Navbar,Sidebar,PlaylistCard,TaskCard,DeviceCard,AlertBanner,ProtectedRoute}.jsx
│       ├── pages/{Login,Dashboard,Playlists,Tasks,Alerts,Devices}.jsx
│       ├── services/{api,websocket}.js
│       ├── context/AuthContext.jsx
│       ├── App.jsx, main.jsx, index.css
├── tv-client/
│   ├── lan-tv/  (index.html, app.js, style.css)
│   └── wifi-tv/ (index.html, app.js, style.css)
└── README.md
```

## 5. Prerequisites

* Node.js 18+
* MongoDB running locally (or a connection string to a remote instance)
* A modern browser (Chrome/Edge/Firefox) for the admin UI and TV clients

## 6. MongoDB Setup

Start a local MongoDB instance, e.g.:

```bash
mongod --dbpath /path/to/your/data
```

The backend will create the `screensync` database and its collections automatically
on first write — no manual schema setup is required.

## 7. Backend Setup

```bash
cd backend
cp .env.example .env    # edit JWT_SECRET and MONGODB_URI as needed
npm install
npm run dev              # nodemon, auto-restarts on change
# or: npm start
```

The API and WebSocket server both run on the same port (`PORT`, default `3000`).

Create your first admin user:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin User","email":"admin@screensync.local","password":"changeme123","role":"admin"}'
```

## 8. Frontend Setup

```bash
cd frontend
cp .env.example .env      # point at your backend if not localhost:3000
npm install
npm run dev                # Vite dev server on http://localhost:5173
```

Log in with the admin account you registered above.

## 9. TV Client Setup

The TV clients are static files — no build step required. Serve each folder with
any static file server and open it in a browser (or on the TV itself, in kiosk
mode):

```bash
# from the tv-client directory
npx serve lan-tv -l 8081
npx serve wifi-tv -l 8082
```

Then open `http://localhost:8081` (Sony/LAN) and `http://localhost:8082`
(Samsung/Wi-Fi) — or load them on the actual TVs' browsers, pointed at your
backend's LAN IP.

By default each client connects to `ws://localhost:3000`. To point at a different
backend, set `window.SCREENSYNC_WS_URL` before `app.js` loads, e.g. add this to
`index.html` above the `<script src="app.js">` tag:

```html
<script>window.SCREENSYNC_WS_URL = 'ws://192.168.1.50:3000';</script>
```

## 10. Environment Configuration

**backend/.env**
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/screensync
JWT_SECRET=replace_with_secure_secret
JWT_EXPIRES_IN=24h
HEARTBEAT_TIMEOUT_MS=30000
HEARTBEAT_INTERVAL_MS=10000
SYNC_BUFFER_MS=2000
CORS_ORIGIN=http://localhost:5173
```

**frontend/.env**
```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

Never commit real secrets — `.env` is for local values only, `.env.example` is
checked in as a template.

## 11. Authentication

JWT-based auth with three roles: `admin`, `viewer`, `tv`.

* `POST /auth/register` — create a user (defaults to `viewer` if no role given)
* `POST /auth/login` — returns `{ user, token }`
* `GET /auth/me` — returns the authenticated user (requires `Authorization: Bearer <token>`)

Only `admin` users can create/update/delete playlists, tasks, and alerts.
`viewer` users can read dashboards but not modify content. `tv` is reserved for
device-identity tokens if you choose to authenticate TV WebSocket connections
with JWTs in the future — the current TV registration flow authenticates by
`device_id` at the WebSocket layer instead.

## 12. REST APIs

All responses follow:
```json
{ "success": true, "message": "...", "data": {} }
{ "success": false, "message": "...", "errors": [] }
```

### Playlists
```
GET    /getPlaylists
GET    /getPlaylist/:playlistId
POST   /createPlaylist                 (admin)
PUT    /updatePlaylist/:playlistId     (admin)
DELETE /deletePlaylist/:playlistId     (admin)
POST   /broadcastPlaylist/:playlistId  (admin) — pushes the playlist to all connected TVs
```

Example payload:
```json
{
  "name": "Morning Schedule",
  "items": [
    { "media_type": "image", "url": "https://example.com/image.jpg", "duration": 10 },
    { "media_type": "video", "url": "https://example.com/video.mp4", "duration": 30 },
    { "media_type": "text", "content": "Welcome to ScreenSync", "duration": 8 }
  ]
}
```

```bash
curl -X POST http://localhost:3000/createPlaylist \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Morning Schedule","items":[{"media_type":"text","content":"Hello","duration":5}]}'
```

### Tasks
```
GET  /getTasks       — active tasks only, sorted by priority desc
GET  /getAllTasks     — all tasks (admin UI listing)
POST /createTask      (admin)
DELETE /deleteTask/:taskId (admin)
```

```json
{
  "title": "Important Announcement",
  "content": "Meeting starts at 2 PM",
  "priority": 3,
  "schedule": { "start": "2026-09-01T12:00:00.000Z", "end": "2026-09-01T14:00:00.000Z" }
}
```
Priority: `1=Low, 2=Medium, 3=High, 4=Emergency`.

### Alerts
```
GET  /getAlerts       — active, non-expired alerts
GET  /getAllAlerts     — full history
POST /pushAlert        (admin)
POST /clearAlert/:alertId (admin)
```

```json
{ "message": "Emergency evacuation required.", "priority": 4, "expires": "2026-09-01T13:00:00.000Z" }
```

### Devices
```
GET /getDevices — live snapshot of registered TVs and their status
```

## 13. WebSocket Protocol

All clients connect to `ws://<host>:<port>` and speak newline-delimited JSON
messages of the form `{ "type": "...", ...fields }`.

### TV registration
```json
{ "type": "register", "device_id": "sony_lan_tv_01", "device_type": "tv", "network": "LAN", "role": "reference" }
{ "type": "register", "device_id": "samsung_wifi_tv_01", "device_type": "tv", "network": "WiFi", "role": "buffered" }
```

### Admin dashboard registration (for live device-status updates)
```json
{ "type": "register", "device_type": "admin", "token": "<JWT>" }
```

### Heartbeat (sent every `HEARTBEAT_INTERVAL_MS` by TV clients)
```json
{ "type": "heartbeat", "device_id": "sony_lan_tv_01", "status": "online", "last_sync": "2026-09-01T12:00:05.000Z", "network": "LAN" }
```
A device is marked offline if no heartbeat arrives within `HEARTBEAT_TIMEOUT_MS`.

### Server → TV pushes
```json
{ "type": "playlist", "playlist_id": "...", "name": "Morning Schedule", "items": [...], "sync_timestamp": "..." }
{ "type": "task", "task_id": "...", "title": "...", "content": "...", "priority": 3, "schedule": {...} }
{ "type": "alert", "alert_id": "...", "message": "...", "priority": 4, "expires": "..." }
{ "type": "clear_alert", "alert_id": "..." }
{ "type": "device_list", "devices": [ ... ] }   (admin channel only)
{ "type": "ack", "message": "..." }
{ "type": "error", "message": "..." }
```

The backend exposes these functions internally (`services/websocketService.js`):
`broadcast(message)`, `broadcastToTVs(message)`, `sendToDevice(deviceId, message)`,
`removeClient(deviceId)`. Dead connections are detected via ping/pong and
terminated; TVs reconnect automatically with exponential backoff (capped at 15s).

## 14. Synchronization Mechanism

When an admin broadcasts a playlist, the backend computes
`sync_timestamp = now + SYNC_BUFFER_MS` and sends it to every TV.

* **Sony (LAN, reference):** waits until `sync_timestamp`, then starts from item 0.
* **Samsung (Wi-Fi, buffered):** preloads/warms the browser cache for playlist
  media immediately, then also waits until `sync_timestamp`. If the message
  arrives **after** `sync_timestamp` has already passed (late delivery due to
  Wi-Fi latency), it calculates the correct in-progress item and offset —
  `computePlaybackPosition()` in `tv-client/wifi-tv/app.js` — and resumes
  mid-sequence instead of restarting from the beginning.

All timestamps are ISO 8601, generated server-side, so client clock skew doesn't
affect the reference point.

> **This is best-effort synchronization.** Browser rendering, video decode
> startup, and network jitter all introduce sub-second variance. This system
> does not provide hardware-level, frame-accurate synchronization — it keeps
> independent browser clients closely aligned, which is sufficient for digital
> signage but not for applications requiring frame-perfect sync (e.g. video walls).

## 15. Priority System

Every TV client exposes `resolveActiveContent()`, which returns the
highest-priority content that should be on screen right now:

```
Emergency Alert  >  High Task  >  Medium Task  >  Low Task  >  Normal Playlist
```

Alerts and tasks are pruned client-side once expired; when the last active
alert/task disappears, `resolveActiveContent()` automatically falls back to
the next-highest priority content, ultimately resuming the standing playlist.

## 16. Testing Instructions

### Authentication
```bash
# Valid login
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@screensync.local","password":"changeme123"}'

# Invalid login
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@screensync.local","password":"wrong"}'
# -> 401

# Unauthorized request (no token)
curl http://localhost:3000/getPlaylists
# -> 401

# Viewer attempting an admin operation
curl -X POST http://localhost:3000/createPlaylist -H "Authorization: Bearer <VIEWER_TOKEN>" \
  -H "Content-Type: application/json" -d '{"name":"x","items":[{"media_type":"text","content":"x","duration":5}]}'
# -> 403
```

### Playlists
* Create via `POST /createPlaylist`, confirm `201` and the doc in `GET /getPlaylists`.
* Update via `PUT /updatePlaylist/:id`, confirm fields changed.
* Delete via `DELETE /deletePlaylist/:id`, confirm `404` on subsequent `GET`.
* Submit an item missing `duration` or an invalid `media_type` → expect `400` with validation errors.
* Broadcast via `POST /broadcastPlaylist/:id` with two TV clients connected — both should render the new content at (approximately) the same wall-clock moment.

### Tasks
* Create tasks with priorities 1–4, confirm `GET /getTasks` returns only those whose schedule window includes "now", sorted descending by priority.
* Create a task with an `end` time in the past — confirm it does **not** appear in `GET /getTasks` (but does appear in `GET /getAllTasks`).

### Alerts
* `POST /pushAlert` with a short `expires` window; confirm connected TVs immediately show the red alert overlay, overriding any task/playlist.
* Wait past `expires` (or call `POST /clearAlert/:id`); confirm the TV falls back to the next-highest-priority content within one priority-check cycle (~5s).

### WebSockets
* Open both `tv-client/lan-tv` and `tv-client/wifi-tv` in separate tabs; confirm both appear in `GET /getDevices` and on the Devices page with `status: online`.
* Kill one tab's network (DevTools → offline) and confirm it flips to `offline` in the dashboard within `HEARTBEAT_TIMEOUT_MS`.
* Reconnect it and confirm it re-registers and returns to `online`.
* Send a malformed message manually (e.g. via browser console `socket.send("not json")`) and confirm the server responds with a `type: "error"` message rather than crashing.

---

Built as a modular, horizontally-extensible signage platform — adding a third,
fourth, or Nth display only requires pointing a new browser client at the same
WebSocket endpoint with a unique `device_id`; no backend or frontend changes
are required.
