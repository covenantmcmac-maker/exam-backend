const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

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
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.log('❌ MongoDB Connection Error:', err));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Exam Platform API is running!' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/attempts', require('./routes/attempts'));
app.use('/api/admin', require('./routes/admin'));

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