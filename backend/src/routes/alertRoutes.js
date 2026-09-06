const express = require('express');
const { pushAlert, getAlerts, getAllAlerts, clearAlert } = require('../controllers/alertController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/getAlerts', authenticateUser, getAlerts);
router.get('/getAllAlerts', authenticateUser, getAllAlerts);
router.post('/pushAlert', authenticateUser, authorizeRoles(ROLES.ADMIN), pushAlert);
router.post('/clearAlert/:alertId', authenticateUser, authorizeRoles(ROLES.ADMIN), clearAlert);

module.exports = router;
