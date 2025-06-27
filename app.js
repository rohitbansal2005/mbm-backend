const express = require('express');
const cors = require('cors');
require('./models/Comment'); // Register Comment model for mongoose populate
const app = express();
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const postRoutes = require('./routes/posts');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const webpush = require('web-push');
const usersRouter = require('./routes/users');
const PushSubscription = require('./models/PushSubscription');

dotenv.config();

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

// Register the users route
app.use('/api', usersRouter);

// --- Web Push Notification Setup ---
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '<YOUR_VAPID_PUBLIC_KEY_HERE>';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '<YOUR_VAPID_PRIVATE_KEY_HERE>';

webpush.setVapidDetails(
  'mailto:admin@mbmconnect.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Route to save push subscription from frontend
app.post('/api/save-subscription', async (req, res) => {
  try {
    const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = require('jsonwebtoken').decode(token);
    if (!decoded || !decoded.id) return res.status(401).json({ message: 'Invalid token' });
    const userId = decoded.id;
    const subscription = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ message: 'Invalid subscription' });
    }
    await PushSubscription.findOneAndUpdate(
      { user: userId, endpoint: subscription.endpoint },
      { $set: { keys: subscription.keys } },
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Subscription saved' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save subscription', error: err.message });
  }
});

// Route to send a test notification to all subscribers
app.post('/api/send-test-notification', async (req, res) => {
  const payload = JSON.stringify({
    title: 'MBMConnect',
    body: 'This is a test push notification!',
    icon: '/logo192.png'
  });
  let success = 0;
  for (const sub of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      success++;
    } catch (err) {
      // Ignore errors for now
    }
  }
  res.json({ message: `Notifications sent to ${success} subscribers.` });
});

// ... other routes

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 