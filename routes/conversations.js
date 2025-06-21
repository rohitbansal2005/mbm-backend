const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');

// @route   GET /api/conversations
// @desc    Get all conversations for the current user
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const userId = req.user._id;

        const conversations = await Message.aggregate([
            {
                $match: {
                    $or: [{ sender: userId }, { recipient: userId }]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: {
                            if: { $eq: ["$sender", userId] },
                            then: "$recipient",
                            else: "$sender"
                        }
                    },
                    lastMessage: { $first: "$text" },
                    lastMessageTimestamp: { $first: "$createdAt" },
                    unreadCount: {
                        $sum: {
                            $cond: [{ $and: [{ $eq: ["$read", false] }, { $eq: ["$recipient", userId] }] }, 1, 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: User.collection.name,
                    localField: '_id',
                    foreignField: '_id',
                    as: 'withUser'
                }
            },
            {
                $unwind: '$withUser'
            },
            {
                $project: {
                    _id: 0,
                    withUser: {
                        _id: '$withUser._id',
                        username: '$withUser.username',
                        profilePicture: '$withUser.profilePicture',
                        avatar: '$withUser.avatar'
                    },
                    lastMessage: 1,
                    lastMessageTimestamp: 1,
                    unreadCount: 1
                }
            },
            {
                $sort: { lastMessageTimestamp: -1 }
            }
        ]);

        res.json(conversations);
    } catch (error) {
        console.error('Error getting conversations:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ message: 'Server error while fetching conversations' });
    }
});

module.exports = router; 