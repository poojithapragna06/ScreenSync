const express = require('express');
const {
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  getPlaylists,
  getPlaylist,
  broadcastPlaylist,
  uploadMedia,
} = require('../controllers/playlistController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');
const { ROLES } = require('../utils/constants');
const upload = require('../middleware/uploadMiddleware');

const router = express.Router();

router.get('/getPlaylists', authenticateUser, getPlaylists);
router.get('/getPlaylist/:playlistId', authenticateUser, getPlaylist);
router.post('/createPlaylist', authenticateUser, authorizeRoles(ROLES.ADMIN), createPlaylist);
router.put('/updatePlaylist/:playlistId', authenticateUser, authorizeRoles(ROLES.ADMIN), updatePlaylist);
router.delete('/deletePlaylist/:playlistId', authenticateUser, authorizeRoles(ROLES.ADMIN), deletePlaylist);
router.post('/broadcastPlaylist/:playlistId', authenticateUser, authorizeRoles(ROLES.ADMIN), broadcastPlaylist);
router.post(
  '/uploadMedia',
  authenticateUser,
  authorizeRoles(ROLES.ADMIN),
  upload.single('file'),
  uploadMedia
);
module.exports = router;
