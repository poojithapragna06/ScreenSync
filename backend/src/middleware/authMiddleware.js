const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the JWT in the Authorization header and attaches req.user
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token missing or malformed',
        errors: [],
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User associated with token no longer exists',
        errors: [],
      });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', errors: [] });
    }
    return res.status(401).json({ success: false, message: 'Invalid authentication token', errors: [] });
  }
}

// Restricts a route to a set of allowed roles. Usage: authorizeRoles('admin')
function authorizeRoles(...allowedRoles) {
  return function authorize(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated', errors: [] });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to perform this action`,
        errors: [],
      });
    }
    next();
  };
}

module.exports = { authenticateUser, authorizeRoles };
