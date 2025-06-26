const webpush = require('web-push');
const User = require('../models/User');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BAo3Qf5fNiL46ibvZLzgik6t0byN02E8VjfxWN7XT3OJ3L98APkMJCBfFpe1dKwnSfG-695d45cfOFqVqo6SB_o';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'YOUR_PRIVATE_KEY_HERE';

webpush.setVapidDetails(
  'mailto:mbmconnect.official@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Send a push notification to all of a user's subscriptions
async function sendPushNotification(userId, payload) {
  const user = await User.findById(userId);
  if (!user || !user.pushSubscriptions) return;
  const notificationPayload = JSON.stringify(payload);
  for (const sub of user.pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, notificationPayload);
    } catch (err) {
      // Remove invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        user.pushSubscriptions = user.pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
        await user.save();
      }
    }
  }
}

module.exports = { sendPushNotification }; 