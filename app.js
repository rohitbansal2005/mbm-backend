const express = require('express');
const cors = require('cors');
require('./models/Comment'); // Register Comment model for mongoose populate
const app = express();
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const postRoutes = require('./routes/posts');

// CORS configuration
app.use(cors({
  origin: [
    'https://mbmconnect.vercel.app',
    'http://localhost:3000',
    'https://mbmconnect.onrender.com'
  ],
  credentials: true
}));

// ... other middleware like bodyParser, cors, etc.
app.use(express.json());

// Register your settings routes
app.use('/api/settings', settingsRoutes);

// Register your notification routes
app.use('/api/notifications', notificationRoutes);

// Register your report routes
app.use('/api/reports', reportRoutes);

// Register the posts route
app.use('/api/posts', postRoutes);

// ... other routes

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 