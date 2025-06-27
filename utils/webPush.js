const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BAo3Qf5fNiL46ibvZLzgik6t0byN02E8VjfxWN7XT3OJ3L98APkMJCBfFpe1dKwnSfG-695d45cfOFqVqo6SB_o';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'YOUR_PRIVATE_KEY_HERE';

webpush.setVapidDetails(
  'mailto:mbmconnect.official@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Send a push notification to all of a user's subscriptions
async function sendPushNotificationToUser(userId, payload) {
  const subscriptions = await PushSubscription.find({ user: userId });
  let success = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: sub.keys
      }, JSON.stringify(payload));
      success++;
    } catch (err) {
      // Optionally: remove invalid subscriptions
    }
  }
  return success;
}

module.exports = { sendPushNotificationToUser }; 