const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const backfillSubject = require('./scripts/backfill-subject');

// Create express app
const app = express();

// Middleware
// Browsers block any origin not listed here. Native mobile builds send no
// Origin header and are unaffected, but every browser-based client needs an
// entry — including the local dev servers below.
//
// Deploying the web app to a NEW domain? Add it here and redeploy, or login
// will fail on the live site. `npm run check:deploy <url>` verifies this.
app.use(cors({
  origin: [
    'http://localhost:3000',   // Create React App dev server
    'http://localhost:8081',   // Expo web dev server (npm run web)
    'http://localhost:8080',   // local PWA preview (npm run serve:pwa)
    'https://macmultimediaexams.netlify.app'
  ],
  credentials: true
}));
// `verify` keeps the raw body so Paystack webhook signatures can be checked
// against exactly what the gateway sent.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected Successfully');

    // Repair legacy questions after the connection is ready. A migration
    // failure must never prevent the API from starting.
    try {
      await backfillSubject({ log: console.log });
    } catch (err) {
      console.warn('⚠️ Subject backfill failed; continuing startup:', err);
    }
  })
  .catch(err => console.log('❌ MongoDB Connection Error:', err));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Exam Platform API is running!' });
});

// Public app config (currency, defaults, payment mode — no secrets).
app.get('/api/config', async (req, res) => {
  try {
    const paystack = require('./services/paystack');
    const { getPlatformConfig, sanitizePlatformConfig } = require('./services/platform-config');
    const platformConfig = sanitizePlatformConfig(await getPlatformConfig());
    const studentRegistrationFee = platformConfig.studentRegistrationFee;

    res.json({
      ...paystack.publicConfig(),
      studentRegistrationFee,
      studentRegistrationFeeActive: studentRegistrationFee > 0,
      applyRegistrationFeeToExistingStudents:
        platformConfig.applyRegistrationFeeToExistingStudents,
    });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ message: 'Error loading configuration' });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/attempts', require('./routes/attempts'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});