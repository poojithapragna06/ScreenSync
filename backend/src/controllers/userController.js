const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../utils/constants');

// Roles a dashboard account can have ('tv' is for screens, not people)
const USER_ROLES = [ROLES.ADMIN, ROLES.VIEWER];

function fail(res, status, message) {
  return res.status(status).json({ success: false, message, errors: [] });
}

// Would this change leave nobody able to manage the system?
async function isLastAdmin(user) {
  if (user.role !== ROLES.ADMIN) return false;
  return (await User.countDocuments({ role: ROLES.ADMIN })) <= 1;
}

// GET /users - everyone who can sign in to the dashboard
const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  return res.status(200).json({
    success: true,
    message: 'Users retrieved successfully',
    data: { users: users.map((u) => u.toSafeObject()) },
  });
});

// POST /users { name, email, password, role }
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return fail(res, 400, 'Name, email and password are required');
  }
  if (role && !USER_ROLES.includes(role)) {
    return fail(res, 400, `Role must be one of: ${USER_ROLES.join(', ')}`);
  }
  if (await User.findOne({ email: String(email).toLowerCase() })) {
    return fail(res, 409, 'A user with this email already exists');
  }

  const user = await User.create({ name, email, password, role: role || ROLES.VIEWER });
  return res.status(201).json({
    success: true,
    message: `${user.name} can now sign in`,
    data: { user: user.toSafeObject() },
  });
});

// PATCH /users/:userId { name?, role?, password? }
const updateUser = asyncHandler(async (req, res) => {
  const { name, role, password } = req.body;
  const user = await User.findById(req.params.userId);
  if (!user) return fail(res, 404, 'User not found');

  if (role !== undefined && role !== user.role) {
    if (!USER_ROLES.includes(role)) {
      return fail(res, 400, `Role must be one of: ${USER_ROLES.join(', ')}`);
    }
    if (user._id.toString() === req.user.id) {
      return fail(res, 400, "You can't change your own role. Ask another admin.");
    }
    if (await isLastAdmin(user)) {
      return fail(res, 400, 'This is the only admin. Make someone else an admin first.');
    }
    user.role = role;
  }
  if (name !== undefined) user.name = name;
  if (password) user.password = password; // hashed by the model on save

  await user.save();
  return res.status(200).json({
    success: true,
    message: password ? `Password updated for ${user.name}` : `${user.name} updated`,
    data: { user: user.toSafeObject() },
  });
});

// DELETE /users/:userId
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) return fail(res, 404, 'User not found');

  if (user._id.toString() === req.user.id) {
    return fail(res, 400, "You can't remove your own account.");
  }
  if (await isLastAdmin(user)) {
    return fail(res, 400, 'This is the only admin. Make someone else an admin first.');
  }

  await user.deleteOne();
  return res.status(200).json({ success: true, message: `${user.name} removed`, data: {} });
});

module.exports = { listUsers, createUser, updateUser, deleteUser, USER_ROLES };
