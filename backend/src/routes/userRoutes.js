const express = require('express');
const { listUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');
const { authenticateUser, authorizeRoles } = require('../middleware/authMiddleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

// Managing dashboard accounts is admin-only
router.use('/users', authenticateUser, authorizeRoles(ROLES.ADMIN));

router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:userId', updateUser);
router.delete('/users/:userId', deleteUser);

module.exports = router;
