const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const User = require('../models/User');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { check, validationResult } = require('express-validator');
const Message = require('../models/Message');
const fs = require('fs');
const upload = require('../config/multer'); // Use Cloudinary multer config
const GroupMessage = require('../models/GroupMessage');
const Filter = require('bad-words');
const filter = new Filter();
const createNotification = require('../utils/createNotification');
const cloudinary = require('../config/cloudinary');
const { sendPushNotification } = require('../utils/webPush');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '..', 'uploads', 'groups');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const uploadMulter = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
});

// Check file type
function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

// Helper to extract Cloudinary public_id from URL
function extractCloudinaryPublicId(url) {
    if (!url) return null;
    // Example: https://res.cloudinary.com/demo/image/upload/v1234567890/folder/filename.jpg
    // public_id: folder/filename (without extension)
    const parts = url.split('/');
    const file = parts.slice(-2).join('/').split('.')[0];
    return file;
}

// @route   POST api/groups
// @desc    Create a group
// @access  Private
router.post('/', [auth, upload.single('coverImage'), [
    check('name', 'Name is required').not().isEmpty(),
    check('description', 'Description is required').not().isEmpty()
]], async (req, res) => {
    console.log('DEBUG group creation: req.user =', req.user); // Debug log
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { name, description, isPrivate, rules, tags, selectedFriends } = req.body;

        // Parse selectedFriends if it's a string
        let selectedFriendsArr = [];
        if (selectedFriends) {
            if (typeof selectedFriends === 'string') {
                try {
                    selectedFriendsArr = JSON.parse(selectedFriends);
                } catch (e) {
                    selectedFriendsArr = [];
                }
            } else if (Array.isArray(selectedFriends)) {
                selectedFriendsArr = selectedFriends;
            }
        }

        const newGroup = new Group({
            name,
            description,
            type: 'custom',
            creator: req.user._id,
            admins: [req.user._id],
            members: selectedFriendsArr.length > 0 ? [...selectedFriendsArr, req.user._id] : [req.user._id],
            isPrivate: isPrivate === 'true',
            rules: rules ? rules.split(',').map(rule => rule.trim()) : [],
            tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
            coverImage: req.file ? req.file.path : null,
            allowMemberPosts: true,
            allowMemberChat: true,
            memberCount: selectedFriendsArr.length + 1
        });

        const group = await newGroup.save();
        
        // Populate the group with member details before sending response
        await group.populate('members', 'username profilePicture role');
        await group.populate('admins', 'username profilePicture role');
        
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/groups
// @desc    Get all groups
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const groups = await Group.find()
            .populate('creator', 'username profilePicture')
            .populate('members', 'username profilePicture role')
            .populate('admins', 'username profilePicture role')
            .sort({ createdAt: -1 });

        // Filter groups: show only if user is member, admin, or creator, or if group.type === 'admin'
        const userId = req.user._id.toString();
        const filteredGroups = groups.filter(group => {
            if (group.type === 'admin') return true;
            if (group.creator && group.creator._id && group.creator._id.toString() === userId) return true;
            if (group.admins && group.admins.some(a => a._id && a._id.toString() === userId)) return true;
            if (group.members && group.members.some(m => m._id && m._id.toString() === userId)) return true;
            return false;
        });

        res.json(filteredGroups);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/groups/:id
// @desc    Get group by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id)
            .populate('creator', 'username profilePicture')
            .populate('members', 'username profilePicture role')
            .populate('admins', 'username profilePicture role')
            .populate('pendingMembers', 'username profilePicture');

        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        res.json(group);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Group not found' });
        }
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id
// @desc    Update a group
// @access  Private
router.put('/:id', [auth, upload.single('coverImage')], async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is admin or creator
        if (group.creator.toString() !== req.user._id.toString() && !group.admins.map(a => a.toString()).includes(req.user._id.toString())) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        const { name, description, isPrivate, rules, tags, allowMemberPosts, allowMemberChat } = req.body;

        // Update group fields
        group.name = name || group.name;
        group.description = description || group.description;
        group.isPrivate = isPrivate === 'true' || group.isPrivate;
        group.rules = rules ? rules.split(',').map(rule => rule.trim()) : group.rules;
        group.tags = tags ? tags.split(',').map(tag => tag.trim()) : group.tags;
        group.allowMemberPosts = allowMemberPosts === 'true' || group.allowMemberPosts;
        group.allowMemberChat = allowMemberChat === 'true' || group.allowMemberChat;

        // Handle image removal
        if (req.body.removeImage) {
            const publicId = extractCloudinaryPublicId(group.coverImage);
            if (publicId) {
                try {
                    await cloudinary.uploader.destroy(publicId);
                } catch (err) {
                    console.error('Cloudinary delete error:', err.message);
                }
            }
            group.coverImage = null;
        }

        if (req.file) {
            group.coverImage = req.file.path;
        }

        await group.save();
        // Re-fetch the updated group with all fields
        const updatedGroup = await Group.findById(group._id);
        res.json(updatedGroup);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/groups/:id
// @desc    Delete a group
// @access  Private
router.delete('/:id', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }
        // Check if user is creator
        if (group.creator.toString() !== req.user._id.toString()) {
            return res.status(401).json({ msg: 'User not authorized' });
        }
        // Optionally: delete all group messages, posts, events here
        await group.deleteOne(); // Use deleteOne instead of remove
        res.json({ msg: 'Group removed' });
    } catch (err) {
        console.error('Group delete error:', err);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/join
// @desc    Join a group
// @access  Private
router.put('/:id/join', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is already a member
        if (group.members.map(m => m.toString()).includes(req.user._id.toString())) {
            return res.status(400).json({ msg: 'Already a member of this group' });
        }

        // Check if user is in pending members
        if (group.pendingMembers.map(m => m.toString()).includes(req.user._id.toString())) {
            return res.status(400).json({ msg: 'Already requested to join this group' });
        }

        if (group.isPrivate) {
            // Add to pending members if group is private
            group.pendingMembers.push(req.user._id);
        } else {
            // Add directly to members if group is public
            group.members.push(req.user._id);
        }

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/leave
// @desc    Leave a group
// @access  Private
router.put('/:id/leave', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Prevent creator from leaving
        if (group.creator.toString() === req.user._id.toString()) {
            return res.status(400).json({ msg: 'Creator cannot leave the group. You can delete the group or transfer ownership.' });
        }

        // Check if user is a member
        if (!group.members.map(m => m.toString()).includes(req.user._id.toString())) {
            return res.status(400).json({ msg: 'Not a member of this group' });
        }

        // Remove from members
        group.members = group.members.filter(member => member.toString() !== req.user._id.toString());

        // Remove from admins if user is an admin
        if (group.admins.map(a => a.toString()).includes(req.user._id.toString())) {
            group.admins = group.admins.filter(admin => admin.toString() !== req.user._id.toString());
        }

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/approve/:userId
// @desc    Approve a member request
// @access  Private
router.put('/:id/approve/:userId', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is admin or creator
        if (group.creator.toString() !== req.user._id.toString() && !group.admins.map(a => a.toString()).includes(req.user._id.toString())) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        // Check if user is in pending members
        if (!group.pendingMembers.map(m => m.toString()).includes(req.params.userId)) {
            return res.status(400).json({ msg: 'User has not requested to join' });
        }

        // Remove from pending members and add to members
        group.pendingMembers = group.pendingMembers.filter(member => member.toString() !== req.params.userId);
        group.members.push(req.params.userId);

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/reject/:userId
// @desc    Reject a member request
// @access  Private
router.put('/:id/reject/:userId', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is admin or creator
        if (group.creator.toString() !== req.user._id.toString() && !group.admins.map(a => a.toString()).includes(req.user._id.toString())) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        // Remove from pending members
        group.pendingMembers = group.pendingMembers.filter(member => member.toString() !== req.params.userId);

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/make-admin/:userId
// @desc    Make a member an admin
// @access  Private
router.put('/:id/make-admin/:userId', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is creator
        if (group.creator.toString() !== req.user._id.toString()) {
            return res.status(401).json({ msg: 'Only creator can make admins' });
        }

        // Check if user is a member
        if (!group.members.map(m => m.toString()).includes(req.params.userId)) {
            return res.status(400).json({ msg: 'User is not a member of this group' });
        }

        // Add to admins
        group.admins.push(req.params.userId);

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/remove-admin/:userId
// @desc    Remove admin status from a member
// @access  Private
router.put('/:id/remove-admin/:userId', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }

        // Check if user is creator
        if (group.creator.toString() !== req.user._id.toString()) {
            return res.status(401).json({ msg: 'Only creator can remove admins' });
        }

        // Remove from admins
        group.admins = group.admins.filter(admin => admin.toString() !== req.params.userId);

        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/groups/:groupId/messages
// @desc    Get messages for a group
// @access  Private
router.get('/:groupId/messages', auth, async (req, res) => {
    try {
        const messages = await GroupMessage.find({ group: req.params.groupId })
            .populate('sender', 'username profilePicture avatar')
            .sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/groups/:groupId/messages
// @desc    Send a message to a group
// @access  Private
router.post('/:groupId/messages', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group) {
            return res.status(404).json({ msg: 'Group not found' });
        }
        if (!group.members.map(m => m.toString()).includes(req.user._id.toString())) {
             return res.status(403).json({ msg: 'You are not a member of this group' });
        }
        if (filter.isProfane(req.body.text)) {
            return res.status(400).json({ msg: 'Inappropriate language is not allowed in group messages.' });
        }
        const newMessage = new GroupMessage({
            group: req.params.groupId,
            sender: req.user._id,
            text: req.body.text,
        });
        await newMessage.save();
        await newMessage.populate('sender', 'username profilePicture avatar');
        // Mention detection and notification
        const mentionRegex = /@([a-zA-Z0-9_]+)/g;
        const mentionedUsernames = [];
        let match;
        while ((match = mentionRegex.exec(req.body.text)) !== null) {
            mentionedUsernames.push(match[1]);
        }
        if (mentionedUsernames.length > 0) {
            // Find mentioned users who are group members
            const mentionedUsers = await User.find({
                username: { $in: mentionedUsernames },
                _id: { $in: group.members }
            });
            for (const user of mentionedUsers) {
                if (user._id.toString() !== req.user._id.toString()) {
                    await createNotification(
                        user._id,
                        req.user._id,
                        'group_mention',
                        'You were mentioned in a group message',
                        newMessage._id,
                        'Group'
                    );
                }
            }
        }
        const io = req.app.get('io');
        if (io) {
            // Include group info in the socket event
            const messageWithGroup = {
                ...newMessage.toObject(),
                group: {
                    _id: group._id,
                    name: group.name,
                    description: group.description
                }
            };
            io.to(req.params.groupId).emit('receiveGroupMessage', messageWithGroup);
        }
        // Send push notification to all group members except sender
        try {
            const memberIds = group.members.map(m => m.toString()).filter(id => id !== req.user._id.toString());
            for (const memberId of memberIds) {
                await sendPushNotification(memberId, {
                    title: `New message in ${group.name}`,
                    body: `${req.user.username} sent a message in group ${group.name}`,
                    icon: '/mbmlogo.png',
                    data: { url: '/groups/' + group._id }
                });
            }
        } catch (err) {
            console.error('Push notification error (group):', err);
        }
        res.json(newMessage);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:groupId/messages/:messageId
// @desc    Edit a group message
// @access  Private
router.put('/:groupId/messages/:messageId', auth, async (req, res) => {
    try {
        const message = await GroupMessage.findById(req.params.messageId);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }
        // Only sender can edit
        if (message.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ msg: 'Not authorized to edit this message' });
        }
        if (filter.isProfane(req.body.text)) {
            return res.status(400).json({ msg: 'Inappropriate language is not allowed in group messages.' });
        }
        message.text = req.body.text;
        await message.save();
        await message.populate('sender', 'username profilePicture avatar');
        res.json(message);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/groups/:groupId/messages/:messageId
// @desc    Delete a group message
// @access  Private
router.delete('/:groupId/messages/:messageId', auth, async (req, res) => {
    try {
        const message = await GroupMessage.findById(req.params.messageId);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }
        // Only sender can delete
        if (message.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ msg: 'Not authorized to delete this message' });
        }
        await message.deleteOne();
        res.json({ msg: 'Message deleted', messageId: req.params.messageId });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/add-member
// @desc    Add a member to group
// @access  Private (creator/admin only)
router.put('/:id/add-member', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ msg: 'Group not found' });

        // Only creator or admin can add members
        if (
            group.creator.toString() !== req.user._id.toString() &&
            !group.admins.map(a => a.toString()).includes(req.user._id.toString())
        ) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        const { userId } = req.body;
        if (!userId) return res.status(400).json({ msg: 'User ID required' });

        if (group.members.map(m => m.toString()).includes(userId)) {
            return res.status(400).json({ msg: 'User already a member' });
        }

        group.members.push(userId);
        await group.save();
        // Send push notification to the invited user
        try {
            await sendPushNotification(userId, {
                title: 'Group Invite',
                body: `You have been added to the group ${group.name}`,
                icon: '/mbmlogo.png',
                data: { url: '/groups/' + group._id }
            });
        } catch (err) {
            console.error('Push notification error (group invite):', err);
        }
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:id/remove-member
// @desc    Remove a member from group
// @access  Private (creator/admin only)
router.put('/:id/remove-member', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ msg: 'Group not found' });

        // Only creator or admin can remove members
        if (
            group.creator.toString() !== req.user._id.toString() &&
            !group.admins.map(a => a.toString()).includes(req.user._id.toString())
        ) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        const { userId } = req.body;
        if (!userId) return res.status(400).json({ msg: 'User ID required' });

        // Prevent removing creator
        if (group.creator.toString() === userId) {
            return res.status(400).json({ msg: 'Cannot remove group creator' });
        }

        group.members = group.members.filter(m => m.toString() !== userId);
        group.admins = group.admins.filter(a => a.toString() !== userId); // Also remove from admins if needed
        await group.save();
        res.json(group);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/groups/messages/user
// @desc    Get all group messages for groups user is member of
// @access  Private
router.get('/messages/user', auth, async (req, res) => {
    try {
        // Get all groups where user is a member
        const userGroups = await Group.find({
            members: req.user._id
        }).select('_id name description');

        if (userGroups.length === 0) {
            return res.json([]);
        }

        // Get the latest message from each group
        const groupIds = userGroups.map(group => group._id);
        const latestMessages = await GroupMessage.aggregate([
            {
                $match: {
                    group: { $in: groupIds }
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: '$group',
                    latestMessage: { $first: '$$ROOT' }
                }
            }
        ]);

        // Populate sender info for each message
        const populatedMessages = await GroupMessage.populate(latestMessages, [
            {
                path: 'latestMessage.sender',
                select: 'username profilePicture avatar'
            }
        ]);

        // Add group info to each message
        const messagesWithGroupInfo = populatedMessages.map(item => {
            const group = userGroups.find(g => g._id.toString() === item._id.toString());
            return {
                ...item.latestMessage,
                group: {
                    _id: group._id,
                    name: group.name,
                    description: group.description
                }
            };
        });

        // Sort by latest message time
        messagesWithGroupInfo.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(messagesWithGroupInfo);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/groups/:groupId/messages/:messageId/seen
// @desc    Mark a group message as seen by the current user
// @access  Private
router.put('/:groupId/messages/:messageId/seen', auth, async (req, res) => {
    try {
        const message = await GroupMessage.findById(req.params.messageId);
        if (!message) {
            return res.status(404).json({ msg: 'Message not found' });
        }
        // Add user to seenBy if not already present
        if (!message.seenBy.some(id => id.toString() === req.user._id.toString())) {
            message.seenBy.push(req.user._id);
            await message.save();
        }
        await message.populate('sender', 'username profilePicture avatar');
        res.json(message);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get unread group messages count for current user
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userGroups = await Group.find({ members: req.user._id }).select('_id');
    if (!userGroups.length) return res.json({ unreadCount: 0 });
    const groupIds = userGroups.map(g => g._id);
    const unreadCount = await GroupMessage.countDocuments({
      group: { $in: groupIds },
      sender: { $ne: req.user._id },
      seenBy: { $ne: req.user._id }
    });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ unreadCount: 0, error: err.message });
  }
});

// Mark all group messages as seen for current user
router.post('/mark-all-seen', auth, async (req, res) => {
  try {
    const userGroups = await Group.find({ members: req.user._id }).select('_id');
    if (!userGroups.length) return res.json({ success: true });
    const groupIds = userGroups.map(g => g._id);
    await GroupMessage.updateMany(
      {
        group: { $in: groupIds },
        sender: { $ne: req.user._id },
        seenBy: { $ne: req.user._id }
      },
      { $addToSet: { seenBy: req.user._id } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;