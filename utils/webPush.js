const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

// Only set VAPID details if both keys are properly configured
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      'mailto:mbmconnect.official@gmail.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
  } catch (error) {
    console.warn('VAPID keys not properly configured, push notifications disabled:', error.message);
  }
} else {
  console.warn('VAPID keys not configured, push notifications will be disabled');
}

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