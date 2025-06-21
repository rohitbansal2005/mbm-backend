const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');
const mongoose = require('mongoose');

// @route   GET /api/conversations
// @desc    Get all conversations for the current user
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.user._id;

        // Find all messages involving the user
        const messages = await Message.find({
            $or: [{ sender: userId }, { recipient: userId }]
        }).sort({ createdAt: -1 });

        const conversations = {};

        for (const message of messages) {
            const otherUserId = message.sender.equals(userId) ? message.recipient : message.sender;
            const otherUserIdStr = otherUserId.toString();

            if (!conversations[otherUserIdStr]) {
                const otherUser = await User.findById(otherUserId).select('username profilePicture avatar');
                if (otherUser) {
                    conversations[otherUserIdStr] = {
                        withUser: otherUser,
                        lastMessage: message.text,
                        lastMessageTimestamp: message.createdAt,
                        unreadCount: 0
                    };
                }
            }
            
            // Increment unread count if the message is unread and the recipient is the current user
            if (!message.read && message.recipient.equals(userId)) {
                if(conversations[otherUserIdStr]) {
                    conversations[otherUserIdStr].unreadCount++;
                }
            }
        }

        const conversationsArray = Object.values(conversations)
            .sort((a, b) => new Date(b.lastMessageTimestamp) - new Date(a.lastMessageTimestamp));

        res.json(conversationsArray);
    } catch (error) {
        console.error('Error getting conversations:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 