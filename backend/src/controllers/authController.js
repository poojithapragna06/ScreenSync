const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../utils/constants');

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

// POST /auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['name, email and password are required'],
    });
  }

  const requestedRole = Object.values(ROLES).includes(role) ? role : ROLES.VIEWER;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'A user with this email already exists',
      errors: [],
    });
  }

  const user = await User.create({ name, email, password, role: requestedRole });
  const token = signToken(user);

  return res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: { user: user.toSafeObject(), token },
  });
});

// POST /auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['email and password are required'],
    });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password', errors: [] });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid email or password', errors: [] });
  }

  const token = signToken(user);

  return res.status(200).json({
    success: true,
    message: 'Login successful',
    data: { user: user.toSafeObject(), token },
  });
});

// GET /auth/me
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found', errors: [] });
  }
  return res.status(200).json({ success: true, message: 'Current user', data: { user: user.toSafeObject() } });
});

module.exports = { register, login, me };
