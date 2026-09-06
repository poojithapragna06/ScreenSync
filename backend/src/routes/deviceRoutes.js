const express = require('express');
const { listDevices } = require('../controllers/deviceController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/getDevices', authenticateUser, listDevices);

module.exports = router;
