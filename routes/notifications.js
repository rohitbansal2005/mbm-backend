const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const isBlocked = require('../utils/isBlocked');
const { sendPushNotification } = require('../utils/webPush');

// Get all notifications for the current user
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        let notifications = await Notification.find({ recipient: userId })
            .populate('sender', 'username fullName profilePicture')
            .sort({ createdAt: -1 })
            .limit(50);
        // Filter out notifications from blocked users
        notifications = await Promise.all(notifications.map(async n => {
            if (!n.sender) return null;
            const senderId = n.sender._id.toString();
            if (await isBlocked(userId, senderId) || await isBlocked(senderId, userId)) {
                return null;
            }
            return n;
        }));
        notifications = notifications.filter(Boolean);
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Error fetching notifications', error: error.message });
    }
});

// Mark notification as read
router.put('/:notificationId/read', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.notificationId, recipient: userId },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.json(notification);
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Error marking notification as read', error: error.message });
    }
});

// Mark all notifications as read
router.put('/read-all', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        await Notification.updateMany(
            { recipient: userId, read: false },
            { read: true }
        );

        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Error marking all notifications as read', error: error.message });
    }
});

// Delete a notification
router.delete('/:notificationId', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        const notification = await Notification.findOneAndDelete({
            _id: req.params.notificationId,
            recipient: userId
        });

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Error deleting notification', error: error.message });
    }
});

// Get unread notification count
router.get('/unread/count', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        const count = await Notification.countDocuments({
            recipient: userId,
            read: false
        });

        res.json({ count });
    } catch (error) {
        console.error('Error getting unread notification count:', error);
        res.status(500).json({ message: 'Error getting unread notification count', error: error.message });
    }
});

// Add a POST / route to create a notification and send a push notification
router.post('/', auth, async (req, res) => {
    try {
        const { recipient, type, content, relatedId, onModel } = req.body;
        if (!recipient || !type || !content) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        const notification = new Notification({
            recipient,
            sender: req.user._id,
            type,
            content,
            relatedId,
            onModel
        });
        await notification.save();
        // Send push notification to recipient
        try {
            await sendPushNotification(recipient, {
                title: 'Notification',
                body: content,
                icon: '/mbmlogo.png',
                data: { url: '/' }
            });
        } catch (err) {
            console.error('Push notification error (notification):', err);
        }
        res.json(notification);
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ message: 'Error creating notification', error: error.message });
    }
});

module.exports = router;
