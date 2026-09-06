const express = require('express');
const { createTask, getTasks, getAllTasks, deleteTask } = require('../controllers/taskController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/getTasks', authenticateUser, getTasks);
router.get('/getAllTasks', authenticateUser, getAllTasks);
router.post('/createTask', authenticateUser, authorizeRoles(ROLES.ADMIN), createTask);
router.delete('/deleteTask/:taskId', authenticateUser, authorizeRoles(ROLES.ADMIN), deleteTask);

module.exports = router;
