const Playlist = require('../models/Playlist');
const asyncHandler = require('../utils/asyncHandler');
const { broadcastToTVs } = require('../services/websocketService');
const { CONTENT_TYPE } = require('../utils/constants');

// POST /createPlaylist
const createPlaylist = asyncHandler(async (req, res) => {
  const { name, items } = req.body;

  const playlist = await Playlist.create({
    name,
    items,
    createdBy: req.user.id,
  });

  return res.status(201).json({
    success: true,
    message: 'Playlist created successfully',
    data: { playlist },
  });
});

// PUT /updatePlaylist/:playlistId
const updatePlaylist = asyncHandler(async (req, res) => {
  const { playlistId } = req.params;
  const { name, items } = req.body;

  const playlist = await Playlist.findById(playlistId);
  if (!playlist) {
    return res.status(404).json({ success: false, message: 'Playlist not found', errors: [] });
  }

  if (name !== undefined) playlist.name = name;
  if (items !== undefined) playlist.items = items;

  await playlist.save();

  return res.status(200).json({
    success: true,
    message: 'Playlist updated successfully',
    data: { playlist },
  });
});

// DELETE /deletePlaylist/:playlistId
const deletePlaylist = asyncHandler(async (req, res) => {
  const { playlistId } = req.params;

  const playlist = await Playlist.findByIdAndDelete(playlistId);
  if (!playlist) {
    return res.status(404).json({ success: false, message: 'Playlist not found', errors: [] });
  }

  return res.status(200).json({
    success: true,
    message: 'Playlist deleted successfully',
    data: {},
  });
});

// GET /getPlaylists
const getPlaylists = asyncHandler(async (req, res) => {
  const playlists = await Playlist.find().sort({ createdAt: -1 });
  return res.status(200).json({
    success: true,
    message: 'Playlists retrieved successfully',
    data: { playlists },
  });
});

// GET /getPlaylist/:playlistId
const getPlaylist = asyncHandler(async (req, res) => {
  const { playlistId } = req.params;
  const playlist = await Playlist.findById(playlistId);
  if (!playlist) {
    return res.status(404).json({ success: false, message: 'Playlist not found', errors: [] });
  }
  return res.status(200).json({ success: true, message: 'Playlist retrieved successfully', data: { playlist } });
});

// POST /broadcastPlaylist/:playlistId - synchronize a playlist to all connected TVs
const broadcastPlaylist = asyncHandler(async (req, res) => {
  const { playlistId } = req.params;
  const bufferMs = Number(process.env.SYNC_BUFFER_MS) || 2000;

  const playlist = await Playlist.findById(playlistId);
  if (!playlist) {
    return res.status(404).json({ success: false, message: 'Playlist not found', errors: [] });
  }

  await Playlist.updateMany({ active: true }, { $set: { active: false } });

  const syncTimestamp = new Date(Date.now() + bufferMs).toISOString();
  playlist.active = true;
  playlist.sync_timestamp = syncTimestamp;
  await playlist.save();

  broadcastToTVs({
    type: CONTENT_TYPE.PLAYLIST,
    playlist_id: playlist._id.toString(),
    name: playlist.name,
    items: playlist.items,
    sync_timestamp: syncTimestamp,
  });

  return res.status(200).json({
    success: true,
    message: 'Playlist broadcast to all connected TVs',
    data: { playlist },
  });
});
// POST /uploadMedia
const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No media file uploaded',
      errors: [],
    });
  }

  const baseUrl =
    process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

  const url = `${baseUrl}/uploads/${req.file.filename}`;

  const mediaType = req.file.mimetype.startsWith('image/')
    ? 'image'
    : 'video';

  return res.status(201).json({
    success: true,
    message: 'Media uploaded successfully',
    data: {
      url,
      media_type: mediaType,
      filename: req.file.filename,
      original_name: req.file.originalname,
      size: req.file.size,
    },
  });
});
module.exports = {
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  getPlaylists,
  getPlaylist,
  broadcastPlaylist,
  uploadMedia,
};
