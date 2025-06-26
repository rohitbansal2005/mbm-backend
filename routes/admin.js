const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const Post = require('../models/Post');
const Report = require('../models/Report');

// Basic admin routes
router.get('/test', [auth, admin], (req, res) => {
    res.json({ message: 'Admin routes working' });
});

// Ban a user and disable all their posts
router.post('/ban-user/:userId', [auth, admin], async (req, res) => {
    try {
        const userId = req.params.userId;
        // Ban the user and store their email as bannedEmail
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        await User.findByIdAndUpdate(userId, { isBanned: true, bannedEmail: user.email });
        // Disable all posts by the user
        await Post.updateMany({ author: userId }, { isActive: false });
        res.json({ message: 'User banned, email blocked, and all posts disabled.' });
    } catch (error) {
        res.status(500).json({ message: 'Error banning user and disabling posts', error: error.message });
    }
});

// Unban a user and re-enable all their posts
router.post('/unban-user/:userId', [auth, admin], async (req, res) => {
    try {
        const userId = req.params.userId;
        // Unban the user and clear bannedEmail
        await User.findByIdAndUpdate(userId, { isBanned: false, bannedEmail: '' });
        // Re-enable all posts by the user
        await Post.updateMany({ author: userId }, { isActive: true });
        res.json({ message: 'User unbanned and all posts re-enabled.' });
    } catch (error) {
        res.status(500).json({ message: 'Error unbanning user and enabling posts', error: error.message });
    }
});

// Get unread user reports count (admin only)
router.get('/unread-count', [auth, admin], async (req, res) => {
  try {
    const unreadCount = await Report.countDocuments({ resolved: false });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ unreadCount: 0, error: err.message });
  }
});

// Mark all user reports as read (admin only)
router.post('/mark-all-read', [auth, admin], async (req, res) => {
  try {
    await Report.updateMany({ resolved: false }, { $set: { resolved: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 