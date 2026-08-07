const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function resolveUserFromAuthHeader(req) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return { token: null, user: null, error: null };

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return { token, user: null, error: 'User not found' };
    }
    return { token, user, error: null };
  } catch {
    return { token, user: null, error: 'Token is not valid' };
  }
}

// Check if user is logged in
const auth = async (req, res, next) => {
  const { token, user, error } = await resolveUserFromAuthHeader(req);

  if (!token) {
    return res.status(401).json({ message: 'No token, access denied' });
  }
  if (!user) {
    return res.status(401).json({ message: error || 'Token is not valid' });
  }

  req.user = user;
  next();
};

const optionalAuth = async (req, res, next) => {
  const { user } = await resolveUserFromAuthHeader(req);
  if (user) req.user = user;
  next();
};

// Check if user has required role
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    next();
  };
};

module.exports = { auth, optionalAuth, authorize };