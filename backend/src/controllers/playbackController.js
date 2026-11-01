const Playlist = require('../models/Playlist');
const asyncHandler = require('../utils/asyncHandler');
const {
  broadcastToTVs,
  getPlaybackState,
  setPlaybackState,
} = require('../services/websocketService');
const { CONTENT_TYPE } = require('../utils/constants');

// Every TV derives "which item, how far in" from the playlist's sync_timestamp.
// So resume / next / previous / restart just move that timestamp and re-send the
// playlist - all screens recompute the same position and stay in step.

function itemDurationMs(item) {
  return Number(item.duration || 5) * 1000;
}

// Index of the item playing at time `atMs`
function currentIndex(playlist, atMs) {
  const items = playlist.items;
  const total = items.reduce((sum, item) => sum + itemDurationMs(item), 0);
  let elapsed = (atMs - new Date(playlist.sync_timestamp).getTime()) % total;
  if (elapsed < 0) elapsed += total;

  for (let i = 0; i < items.length; i += 1) {
    elapsed -= itemDurationMs(items[i]);
    if (elapsed < 0) return i;
  }
  return 0;
}

// Start time (ms from playlist start) of item `index`
function itemStartMs(playlist, index) {
  return playlist.items
    .slice(0, index)
    .reduce((sum, item) => sum + itemDurationMs(item), 0);
}

async function sendPlaylist(playlist, syncTimeMs) {
  playlist.sync_timestamp = new Date(syncTimeMs);
  await playlist.save();

  broadcastToTVs({
    type: CONTENT_TYPE.PLAYLIST,
    playlist_id: playlist._id.toString(),
    name: playlist.name,
    items: playlist.items,
    sync_timestamp: playlist.sync_timestamp.toISOString(),
  });
}

function respond(res, message, playlist) {
  const { pausedAt, ...state } = getPlaybackState();
  return res.status(200).json({
    success: true,
    message,
    data: {
      ...state,
      playlist: playlist ? { _id: playlist._id, name: playlist.name } : null,
    },
  });
}

// GET /playback - current state for the dashboard controls
const getPlayback = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findOne({ active: true });
  return respond(res, 'Playback state', playlist);
});

// POST /playback  { action: 'pause' | 'resume' | 'next' | 'previous' | 'restart' | 'volume' | 'mute' | 'unmute', volume? }
const controlPlayback = asyncHandler(async (req, res) => {
  const { action, volume } = req.body;
  const state = getPlaybackState();
  const now = Date.now();

  // Volume / mute don't need a playlist
  if (action === 'volume') {
    const value = Number(volume);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return res.status(400).json({ success: false, message: 'volume must be 0-100', errors: [] });
    }
    setPlaybackState({ volume: Math.round(value), muted: false });
    return respond(res, 'Volume updated', await Playlist.findOne({ active: true }));
  }

  if (action === 'mute' || action === 'unmute') {
    setPlaybackState({ muted: action === 'mute' });
    return respond(res, action === 'mute' ? 'Muted' : 'Unmuted', await Playlist.findOne({ active: true }));
  }

  const playlist = await Playlist.findOne({ active: true });
  if (!playlist || !playlist.items.length || !playlist.sync_timestamp) {
    return res.status(400).json({
      success: false,
      message: 'Nothing is playing. Click "Sync to TVs" on a playlist first.',
      errors: [],
    });
  }

  // While paused, the screens are frozen at `pausedAt`, so measure position from there
  const positionAt = state.paused && state.pausedAt ? state.pausedAt : now;

  switch (action) {
    case 'pause':
      if (!state.paused) setPlaybackState({ paused: true, pausedAt: now });
      return respond(res, 'Paused', playlist);

    case 'resume': {
      if (state.paused) {
        // Shift the timeline by the time spent paused -> continues from the same spot
        const shifted = new Date(playlist.sync_timestamp).getTime() + (now - state.pausedAt);
        setPlaybackState({ paused: false, pausedAt: null });
        await sendPlaylist(playlist, shifted);
      }
      return respond(res, 'Resumed', playlist);
    }

    case 'next':
    case 'previous': {
      const count = playlist.items.length;
      const index = currentIndex(playlist, positionAt);
      const target = (index + (action === 'next' ? 1 : -1) + count) % count;
      setPlaybackState({ paused: false, pausedAt: null });
      await sendPlaylist(playlist, now - itemStartMs(playlist, target));
      return respond(res, `Playing item ${target + 1} of ${count}`, playlist);
    }

    case 'restart':
      setPlaybackState({ paused: false, pausedAt: null });
      await sendPlaylist(playlist, now);
      return respond(res, 'Restarted from the beginning', playlist);

    default:
      return res.status(400).json({ success: false, message: `Unknown action "${action}"`, errors: [] });
  }
});

module.exports = { getPlayback, controlPlayback };
