const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const {
  buildRegistrationPaymentRequiredPayload,
  getRegistrationRequirement,
} = require('../services/registration-access');
const { markPasswordModified } = require('../services/account-security');

function signToken(user, expiresIn = '7d') {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt,
  };
}

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please fill all fields' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const user = new User({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      role: role || 'student',
      mustChangePassword: false,
    });
    await user.save();

    const registrationRequirement = await getRegistrationRequirement(user);
    if (registrationRequirement.required) {
      return res.status(402).json(
        buildRegistrationPaymentRequiredPayload(
          user,
          registrationRequirement,
          'Account created. Complete the one-time registration payment before you sign in.'
        )
      );
    }

    const token = signToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please enter email and password' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const registrationRequirement = await getRegistrationRequirement(user);
    if (registrationRequirement.required) {
      return res.status(402).json(
        buildRegistrationPaymentRequiredPayload(
          user,
          registrationRequirement,
          'Complete the one-time registration payment before you sign in.'
        )
      );
    }

    const token = signToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET CURRENT USER
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ user: serializeUser(req.user) });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GUEST REGISTER (removed)
router.post('/guest-register', async (req, res) => {
  res.status(410).json({
    message: 'Guest exam joining has been removed. Please sign in or create an account first.'
  });
});

// CHANGE PASSWORD
router.patch('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    markPasswordModified(user);
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Error changing password' });
  }
});

module.exports = router;
