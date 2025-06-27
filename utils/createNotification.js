const Notification = require('../models/Notification');
const { sendPushNotificationToUser } = require('./webPush');

const createNotification = async (recipientId, senderId, type, content, relatedId = null, onModel = null) => {
    try {
        // Don't create notification if sender and recipient are the same
        if (recipientId.toString() === senderId.toString()) {
            return null;
        }

        const notification = new Notification({
            recipient: recipientId,
            sender: senderId,
            type,
            content,
            relatedId,
            onModel
        });

        await notification.save();

        // Send push notification
        await sendPushNotificationToUser(recipientId, {
            title: 'MBMConnect',
            body: content,
            icon: '/mbmlogo.png',
            data: { url: '/' }
        });

        return notification;
    } catch (error) {
        console.error('Error creating notification:', error);
        return null;
    }
};

module.exports = createNotification; 