const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { check, validationResult } = require('express-validator');
const Filter = require('bad-words');
const filter = new Filter();
const isBlocked = require('../utils/isBlocked');
const { sendPushNotification } = require('../utils/webPush');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const AES = require('crypto-js/aes');
const Utf8 = require('crypto-js/enc-utf8');

// Strict rate limiting for message sending to prevent bot spam
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 messages per minute
  message: 'Too many messages sent. Please wait 1 minute before sending again.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to format message with proper image URLs
const formatMessage = (message) => {
    const formattedMessage = message.toObject();
    
    // Format sender's image URLs
    if (formattedMessage.sender) {
        formattedMessage.sender.profilePicture = formattedMessage.sender.profilePicture
            ? (formattedMessage.sender.profilePicture.startsWith('http')
                ? formattedMessage.sender.profilePicture
                : `http://localhost:5000/${formattedMessage.sender.profilePicture}`)
            : null;
        formattedMessage.sender.avatar = formattedMessage.sender.avatar
            ? (formattedMessage.sender.avatar.startsWith('http')
                ? formattedMessage.sender.avatar
                : `http://localhost:5000/${formattedMessage.sender.avatar}`)
            : null;
    }

    // Format recipient's image URLs
    if (formattedMessage.recipient) {
        formattedMessage.recipient.profilePicture = formattedMessage.recipient.profilePicture
            ? (formattedMessage.recipient.profilePicture.startsWith('http')
                ? formattedMessage.recipient.profilePicture
                : `http://localhost:5000/${formattedMessage.recipient.profilePicture}`)
            : null;
        formattedMessage.recipient.avatar = formattedMessage.recipient.avatar
            ? (formattedMessage.recipient.avatar.startsWith('http')
                ? formattedMessage.recipient.avatar
                : `http://localhost:5000/${formattedMessage.recipient.avatar}`)
            : null;
    }

    return formattedMessage;
};

// @route   GET api/messages
// @desc    Get all messages for current user
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { sender: req.user._id },
                { recipient: req.user._id }
            ]
        })
        .sort({ createdAt: -1 })
        .populate('sender', 'username fullName profilePicture avatar role isPremium badgeType')
        .populate('recipient', 'username fullName profilePicture avatar role isPremium badgeType');

        const formattedMessages = messages.map(formatMessage);
        
        // Decrypt messages before sending to frontend
        const decryptedMessages = formattedMessages.map(message => {
            try {
                const bytes = AES.decrypt(message.text, process.env.SECRET_KEY || 'fallback-secret-key');
                message.decryptedText = bytes.toString(Utf8) || '';
            } catch {
                message.decryptedText = '';
            }
            return message;
        });
        
        res.json(decryptedMessages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET api/messages/:userId
// @desc    Get messages between current user and another user
// @access  Private
router.get('/:userId', auth, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { sender: req.user._id, recipient: req.params.userId },
                { sender: req.params.userId, recipient: req.user._id }
            ]
        })
        .populate('sender', 'username fullName profilePicture avatar role isPremium badgeType')
        .populate('recipient', 'username fullName profilePicture avatar role isPremium badgeType')
        .sort({ createdAt: 1 });

        const formattedMessages = messages.map(formatMessage);
        
        // Decrypt messages before sending to frontend
        const decryptedMessages = formattedMessages.map(message => {
            try {
                const bytes = AES.decrypt(message.text, process.env.SECRET_KEY || 'fallback-secret-key');
                message.decryptedText = bytes.toString(Utf8) || '';
            } catch {
                message.decryptedText = '';
            }
            return message;
        });
        
        res.json(decryptedMessages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST api/messages/:userId
// @desc    Send a message to another user
// @access  Private
router.post(
    '/:userId',
    [
        auth,
        [check('text', 'Text is required').not().isEmpty()],
        messageLimiter
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const recipient = await User.findById(req.params.userId);
            if (!recipient) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Block check: don't allow message if either user has blocked the other
            const senderId = req.user._id.toString();
            const recipientId = req.params.userId.toString();
            if (await isBlocked(senderId, recipientId) || await isBlocked(recipientId, senderId)) {
                return res.status(403).json({ message: 'You cannot send messages to this user.' });
            }

            // Decrypt the text for profanity check
            const bytes = AES.decrypt(req.body.text, process.env.SECRET_KEY || 'fallback-secret-key');
            const decrypted = bytes.toString(Utf8) || '';

            if (filter.isProfane(decrypted)) {
                return res.status(400).json({ message: 'Inappropriate language is not allowed in messages.' });
            }

            const newMessage = new Message({
                sender: req.user._id,
                recipient: req.params.userId,
                text: req.body.text,
                media: req.body.media || null,
                mediaType: req.body.mediaType || null
            });

            await newMessage.save();

            // Populate sender and recipient details
            await newMessage.populate('sender', 'username fullName profilePicture avatar role isPremium badgeType');
            await newMessage.populate('recipient', 'username fullName profilePicture avatar role isPremium badgeType');

            const formattedMessage = formatMessage(newMessage);
            // Add decrypted text for frontend
            formattedMessage.decryptedText = decrypted;

            // Emit the new message through Socket.IO
            const io = req.app.get('io');
            if (io) {
                // Emit to recipient's room
                io.to(req.params.userId).emit('newMessage', formattedMessage);
                // Emit to sender's room for confirmation
                io.to(req.user._id).emit('messageSent', formattedMessage);
            }

            // Send push notification to recipient
            try {
                await sendPushNotification(req.params.userId, {
                    title: 'New Message',
                    body: `${req.user.username}: ${decrypted.substring(0, 50)}${decrypted.length > 50 ? '...' : ''}`,
                    icon: '/mbmlogo.png',
                    data: { url: '/messages/' + req.user._id }
                });
            } catch (err) {
                console.error('Push notification error:', err);
            }

            res.json(formattedMessage);
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// @route   PUT api/messages/:messageId
// @desc    Update a message
// @access  Private
router.put(
    '/:messageId',
    [
        auth,
        [check('text', 'Text is required').not().isEmpty()]
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const message = await Message.findById(req.params.messageId);
            if (!message) {
                return res.status(404).json({ message: 'Message not found' });
            }

            // Check if user is the sender (fix: use String comparison)
            if (String(message.sender) !== String(req.user._id)) {
                return res.status(403).json({ message: 'Not authorized to edit this message' });
            }

            // Decrypt the text for profanity check
            const bytes = AES.decrypt(req.body.text, process.env.SECRET_KEY || 'fallback-secret-key');
            const decrypted = bytes.toString(Utf8) || '';

            if (filter.isProfane(decrypted)) {
                return res.status(400).json({ message: 'Inappropriate language is not allowed in messages.' });
            }

            // The text is already encrypted from frontend, so save it directly
            message.text = req.body.text;
            message.updatedAt = Date.now();
            await message.save();

            // Populate sender and recipient details
            await message.populate('sender', 'username fullName profilePicture avatar role isPremium badgeType');
            await message.populate('recipient', 'username fullName profilePicture avatar role isPremium badgeType');

            const formattedMessage = formatMessage(message);
            // Add decrypted text for frontend
            formattedMessage.decryptedText = decrypted;

            // Emit the updated message through Socket.IO
            const io = req.app.get('io');
            if (io) {
                io.to(message.recipient.toString()).emit('messageUpdated', formattedMessage);
                io.to(message.sender.toString()).emit('messageUpdated', formattedMessage);
            }

            res.json(formattedMessage);
        } catch (error) {
            console.error('Error updating message:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// @route   DELETE api/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete('/:messageId', auth, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        // Check if user is the sender (fix: use String comparison)
        if (String(message.sender) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to delete this message' });
        }

        await message.deleteOne();

        // Emit the deleted message through Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(message.recipient.toString()).emit('messageDeleted', {
                messageId: req.params.messageId
            });
            io.to(message.sender.toString()).emit('messageDeleted', {
                messageId: req.params.messageId
            });
        }

        res.json({ message: 'Message deleted' });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST api/messages/mark-read/:userId
// @desc    Mark all messages as read between current user and another user
// @access  Private
router.post('/mark-read/:userId', auth, async (req, res) => {
    try {
        const updated = await Message.updateMany(
            {
                sender: req.params.userId,
                recipient: req.user._id,
                read: false
            },
            { $set: { read: true } }
        );
        res.json({ success: true, updatedCount: updated.nModified || updated.modifiedCount });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get unread one-to-one messages count for current user
router.get('/unread-count', auth, async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({ recipient: req.user._id, read: false });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ unreadCount: 0, error: err.message });
  }
});

// Mark all messages as read for current user
router.post('/mark-all-read', auth, async (req, res) => {
  try {
    await Message.updateMany({ recipient: req.user._id, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all conversations for the current user
router.get('/conversations', auth, async (req, res) => {
    try {
        const conversations = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { sender: req.user._id },
                        { recipient: req.user._id }
                    ]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$sender', req.user._id] },
                            '$recipient',
                            '$sender'
                        ]
                    },
                    lastMessage: { $first: '$$ROOT' }
                }
            }
        ]);

        // Populate user details for each conversation
        const populatedConversations = await Message.populate(conversations, [
            {
                path: 'lastMessage.sender',
                select: 'username fullName profilePicture avatar role isPremium badgeType'
            },
            {
                path: 'lastMessage.recipient',
                select: 'username fullName profilePicture avatar role isPremium badgeType'
            }
        ]);

        const formattedConversations = populatedConversations.map(conv => ({
            ...conv,
            lastMessage: formatMessage(conv.lastMessage)
        }));

        res.json(formattedConversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ message: 'Error fetching conversations' });
    }
});

module.exports = router;