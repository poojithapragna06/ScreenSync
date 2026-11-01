const express = require('express');
const { getPlayback, controlPlayback } = require('../controllers/playbackController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/playback', authenticateUser, getPlayback);
router.post('/playback', authenticateUser, authorizeRoles(ROLES.ADMIN), controlPlayback);

module.exports = router;
