const express = require('express');
const router = express.Router();
const Follow = require('../models/Follow');
const User = require('../models/User');
const Student = require('../models/Student');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const isBlocked = require('../utils/isBlocked');
const { sendPushNotificationToUser } = require('../utils/webPush');

console.log('Follows routes loaded');

// Follow a user
router.post('/:userId', auth, async (req, res) => {
    try {
        // Log the complete request details
        console.log('=== Follow Request Details ===');
        console.log('Auth User:', req.user);
        console.log('Request Body:', req.body);
        console.log('Request Params:', req.params);
        console.log('Request Headers:', req.headers);

        const { userId } = req.params;
        const followerId = req.user._id;

        // Log the IDs being used
        console.log('IDs being used:', {
            followerId,
            userId,
            followerIdType: typeof followerId,
            userIdType: typeof userId
        });

        // Validate MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(followerId)) {
            console.log('Invalid ObjectId:', { userId, followerId });
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        // Check if trying to follow self
        if (userId === followerId) {
            console.log('User trying to follow self');
            return res.status(400).json({ message: 'You cannot follow yourself' });
        }

        // Check if user exists
        const userToFollow = await User.findById(userId);
        if (!userToFollow) {
            console.log('User not found:', userId);
            return res.status(404).json({ message: 'User not found' });
        }

        // Block check: don't allow follow if either user has blocked the other
        if (await isBlocked(followerId, userId) || await isBlocked(userId, followerId)) {
            return res.status(403).json({ message: 'You cannot follow this user.' });
        }

        // Check if already following or request pending
        const existingFollow = await Follow.findOne({ 
            follower: followerId, 
            following: userId
        });
        
        if (existingFollow) {
            if (existingFollow.status === 'pending') {
                return res.status(400).json({ message: 'Follow request already pending' });
            } else if (existingFollow.status === 'accepted') {
                return res.status(400).json({ message: 'You are already following this user' });
            } else if (existingFollow.status === 'rejected') {
                // If previously rejected, update to pending and create new notification
                console.log('Updating rejected follow request to pending');
                existingFollow.status = 'pending';
                await existingFollow.save();
                
                // Delete any existing follow_request notifications
                await Notification.deleteMany({
                    recipient: userId,
                    sender: followerId,
                    type: 'follow_request',
                    relatedId: existingFollow._id
                });
                
                // Create new notification for follow request
                const followerUser = await User.findById(followerId);
                const followerUsername = followerUser?.username || 'Someone';
                
                const notification = new Notification({
                    recipient: userId,
                    sender: followerId,
                    type: 'follow_request',
                    content: `${followerUsername} wants to follow you`,
                    relatedId: existingFollow._id,
                    onModel: 'Follow'
                });

                await notification.save();
                console.log('New notification created for updated follow request:', notification);

                try {
                    await sendPushNotificationToUser(
                        userId,
                        {
                            title: 'New Follow Request',
                            body: `${followerUsername} wants to follow you`,
                            icon: '/mbmlogo.png',
                            data: { url: '/profile/' + followerId }
                        }
                    );
                } catch (err) {
                    console.error('Push notification error (follow request):', err);
                }

                res.status(200).json({
                    message: 'Follow request sent successfully',
                    follow: existingFollow
                });
                return;
            }
        }

        // Get follower user object
        const followerUser = await User.findById(followerId);
        const followerUsername = followerUser?.username || 'Someone';

        // Create new follow relationship with pending status
        const followData = {
            follower: followerId,
            following: userId,
            status: 'pending'
        };

        console.log('Creating follow with data:', followData);

        const follow = new Follow(followData);
        await follow.save();
        console.log('Follow request created:', follow);

        // Create notification for follow request
        const notification = new Notification({
            recipient: userId,
            sender: followerId,
            type: 'follow_request',
            content: `${followerUsername} wants to follow you`,
            relatedId: follow._id,
            onModel: 'Follow'
        });

        await notification.save();
        console.log('Notification created:', notification);

        try {
            await sendPushNotificationToUser(
                userId,
                {
                    title: 'New Follow Request',
                    body: `${followerUsername} wants to follow you`,
                    icon: '/mbmlogo.png',
                    data: { url: '/profile/' + followerId }
                }
            );
        } catch (err) {
            console.error('Push notification error (follow request):', err);
        }

        res.status(201).json({
            message: 'Follow request sent successfully',
            follow
        });
    } catch (error) {
        console.error('Error in follow:', {
            message: error.message,
            stack: error.stack,
            userId: req.params.userId,
            followerId: req.user._id,
            user: req.user,
            error: error
        });
        res.status(500).json({ message: 'Error following user', error: error.message });
    }
});

// Unfollow a user
router.delete('/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const followerId = req.user._id;

        const follow = await Follow.findOneAndDelete({
            follower: followerId,
            following: userId
        });

        if (!follow) {
            return res.status(404).json({ message: 'Follow relationship not found' });
        }

        // Update student models
        const followerStudent = await Student.findOne({ user: followerId });
        const followingStudent = await Student.findOne({ user: userId });

        if (followerStudent && followingStudent) {
            // Remove from following list
            followerStudent.following = followerStudent.following.filter(id => id.toString() !== userId);
            await followerStudent.save();

            // Remove from followers list
            followingStudent.followers = followingStudent.followers.filter(id => id.toString() !== followerId);
            await followingStudent.save();
        }

        res.json({ message: 'Unfollowed successfully' });
    } catch (error) {
        console.error('Error in unfollow:', error);
        res.status(500).json({ message: 'Error unfollowing user', error: error.message });
    }
});

// Get followers list
router.get('/followers/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const requesterId = req.user._id;

        // Block check: don't show followers if either user has blocked the other
        if (requesterId.toString() !== userId.toString()) {
            if (await isBlocked(requesterId, userId) || await isBlocked(userId, requesterId)) {
                return res.status(403).json({ message: 'You cannot view this user.' });
            }
        }

        // 1. First, ensure the target user exists.
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 2. Fetch student profile to check for privacy settings (it may not exist).
        const targetStudent = await Student.findOne({ user: userId });
        
        const isOwner = requesterId.toString() === userId.toString();
        // 3. Default to public if no student profile or privacy setting exists.
        const privacySetting = targetStudent?.privacy?.followers || 'public';
        let canView = false;

        if (isOwner) {
            canView = true;
        } else {
            switch (privacySetting) {
                case 'public':
                    canView = true;
                    break;
                case 'friends':
                    const userFollowsTarget = await Follow.findOne({ follower: requesterId, following: userId, status: 'accepted' });
                    const targetFollowsUser = await Follow.findOne({ follower: userId, following: requesterId, status: 'accepted' });
                    if (userFollowsTarget && targetFollowsUser) {
                        canView = true;
                    }
                    break;
                case 'private':
                    const isFollower = await Follow.findOne({ follower: requesterId, following: userId, status: 'accepted' });
                    if (isFollower) {
                        canView = true;
                    }
                    break;
            }
        }

        if (!canView) {
            return res.status(403).json({ message: 'Followers list is private.' });
        }
        
        const followers = await Follow.find({ 
            following: userId,
            status: 'accepted'
        })
        .populate('follower', 'username fullName profilePicture role isPremium')
        .sort({ createdAt: -1 });

        // Return the full follow object, not just the follower details
        res.json(followers);

    } catch (error) {
        console.error('Error fetching followers list:', error);
        res.status(500).json({ message: 'Error fetching followers list' });
    }
});

// Get following list
router.get('/following/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const requesterId = req.user._id;

        // Block check: don't show following if either user has blocked the other
        if (requesterId.toString() !== userId.toString()) {
            if (await isBlocked(requesterId, userId) || await isBlocked(userId, requesterId)) {
                return res.status(403).json({ message: 'You cannot view this user.' });
            }
        }

        // 1. First, ensure the target user exists.
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 2. Fetch student profile to check for privacy settings (it may not exist).
        const targetStudent = await Student.findOne({ user: userId });

        const isOwner = requesterId.toString() === userId.toString();
        // 3. Default to public if no student profile or privacy setting exists.
        const privacySetting = targetStudent?.privacy?.following || 'public';
        let canView = false;

        if (isOwner) {
            canView = true;
        } else {
            switch (privacySetting) {
                case 'public':
                    canView = true;
                    break;
                case 'friends':
                    const userFollowsTarget = await Follow.findOne({ follower: requesterId, following: userId, status: 'accepted' });
                    const targetFollowsUser = await Follow.findOne({ follower: userId, following: requesterId, status: 'accepted' });
                    if (userFollowsTarget && targetFollowsUser) {
                        canView = true;
                    }
                    break;
                case 'private':
                    const isFollower = await Follow.findOne({ follower: requesterId, following: userId, status: 'accepted' });
                    if (isFollower) {
                        canView = true;
                    }
                    break;
            }
        }

        if (!canView) {
            return res.status(403).json({ message: 'Following list is private.' });
        }
        
        const following = await Follow.find({ 
            follower: userId,
            status: 'accepted'
        })
        .populate('following', 'username fullName profilePicture role isPremium')
        .sort({ createdAt: -1 });

        // Return the full follow object, not just the following details
        res.json(following);
        
    } catch (error) {
        console.error('Error fetching following list:', error);
        res.status(500).json({ message: 'Error fetching following list' });
    }
});

// Get pending follow requests
router.get('/pending', auth, async (req, res) => {
    try {
        const pendingRequests = await Follow.find({
            following: req.user._id,
            status: 'pending'
        })
        .populate('follower', 'username fullName profilePicture role isPremium')
        .sort({ createdAt: -1 });

        res.json(pendingRequests);
    } catch (error) {
        console.error('Error getting pending requests:', error);
        res.status(500).json({ message: 'Error getting pending requests', error: error.message });
    }
});

// Accept follow request
router.put('/accept/:followId', auth, async (req, res) => {
    console.log('Accept follow request route hit', req.params, req.user);
    try {
        console.log('io object in follows route:', req.app.get('io') ? 'Available' : 'Not available');
        const { followId } = req.params;
        const userId = req.user._id;

        const follow = await Follow.findOne({
            _id: followId,
            following: userId,
            status: 'pending'
        });

        if (!follow) {
            return res.status(404).json({ message: 'Follow request not found' });
        }

        follow.status = 'accepted';
        await follow.save();

        // Delete the original follow_request notification
        await Notification.deleteMany({
            recipient: userId,
            sender: follow.follower,
            type: 'follow_request',
            relatedId: follow._id
        });

        // Create notification for follow acceptance
        const notification = new Notification({
            recipient: follow.follower,
            sender: userId,
            type: 'follow_accepted',
            content: `${req.user.username} accepted your follow request`,
            relatedId: follow._id,
            onModel: 'Follow'
        });

        await notification.save();

        // Update student models
        const followerStudent = await Student.findOne({ user: follow.follower });
        const followingStudent = await Student.findOne({ user: follow.following });

        if (followerStudent && followingStudent) {
            // Add to following list
            if (!followerStudent.following.includes(follow.following)) {
                followerStudent.following.push(follow.following);
                await followerStudent.save();
            }

            // Add to followers list
            if (!followingStudent.followers.includes(follow.follower)) {
                followingStudent.followers.push(follow.follower);
                await followingStudent.save();
            }
        }

        // Emit Socket.IO event
        const io = req.app.get('io');
        if (io) {
            console.log('Emitting followStatusUpdated event');
            io.to(follow.follower.toString()).emit('followStatusUpdated', {
                followerId: follow.follower.toString(),
                followingId: follow.following.toString(),
                status: 'accepted'
            });
             io.to(follow.following.toString()).emit('followStatusUpdated', {
                followerId: follow.follower.toString(),
                followingId: follow.following.toString(),
                status: 'accepted'
            });
        }

        try {
            await sendPushNotificationToUser(
                follow.follower,
                {
                    title: 'Follow Request Accepted',
                    body: `${req.user.username} accepted your follow request`,
                    icon: '/mbmlogo.png',
                    data: { url: '/profile/' + userId }
                }
            );
        } catch (err) {
            console.error('Push notification error (follow accepted):', err);
        }

        res.json({ message: 'Follow request accepted', follow });
    } catch (error) {
        console.error('Error accepting follow request:', error);
        res.status(500).json({ message: 'Error accepting follow request', error: error.message });
    }
});

// Reject follow request
router.put('/reject/:followId', auth, async (req, res) => {
    try {
        console.log('Reject follow request route hit');
        console.log('io object in follows route:', req.app.get('io') ? 'Available' : 'Not available');
        const { followId } = req.params;
        const userId = req.user._id;

        const follow = await Follow.findOne({
            _id: followId,
            following: userId,
            status: 'pending'
        });

        if (!follow) {
            return res.status(404).json({ message: 'Follow request not found' });
        }

        follow.status = 'rejected';
        await follow.save();

        // Delete the original follow_request notification
        await Notification.deleteMany({
            recipient: userId,
            sender: follow.follower,
            type: 'follow_request',
            relatedId: follow._id
        });

        // Emit Socket.IO event
        const io = req.app.get('io');
        if (io) {
             console.log('Emitting followStatusUpdated event for rejection');
             io.to(follow.follower.toString()).emit('followStatusUpdated', {
                followerId: follow.follower.toString(),
                followingId: follow.following.toString(),
                status: 'rejected'
            });
        }

        res.json({ message: 'Follow request rejected' });
    } catch (error) {
        console.error('Error rejecting follow request:', error);
        res.status(500).json({ message: 'Error rejecting follow request', error: error.message });
    }
});

// Check if following
router.get('/check/:userId', auth, async (req, res) => {
    try {
        console.log('=== Check Follow Status Route ===');
        console.log('Request received for user ID:', req.params.userId);
        console.log('Auth user:', req.user);
        
        const { userId } = req.params;
        const followerId = req.user._id;

        // Validate MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            console.log('Invalid user ID format:', userId);
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        const follow = await Follow.findOne({
            follower: followerId,
            following: userId
        });

        console.log('Follow status found:', follow);

        res.json({
            isFollowing: follow?.status === 'accepted',
            status: follow ? follow.status : null
        });
    } catch (error) {
        console.error('Error checking follow status:', error);
        res.status(500).json({ message: 'Error checking follow status', error: error.message });
    }
});

// Allow POST as alias for PUT for accepting follow requests
router.post('/accept/:followId', auth, async (req, res, next) => {
  req.method = 'PUT';
  next();
});

// Cancel/withdraw follow request by followId
router.delete('/by-id/:followId', auth, async (req, res) => {
  try {
    const { followId } = req.params;
    const follow = await Follow.findOneAndDelete({
      _id: followId,
      follower: req.user._id,
      status: 'pending'
    });
    if (!follow) {
      return res.status(404).json({ message: 'Follow request not found' });
    }
    // Delete related notification
    await Notification.deleteMany({
      sender: req.user._id,
      relatedId: followId,
      type: 'follow_request'
    });
    res.json({ message: 'Follow request cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Error cancelling follow request', error: error.message });
  }
});

// Cancel/withdraw follow request by userId
router.delete('/withdraw/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user._id;

    const follow = await Follow.findOneAndDelete({
      follower: followerId,
      following: userId,
      status: 'pending'
    });

    if (!follow) {
      return res.status(404).json({ message: 'Follow request not found or already actioned.' });
    }

    // Also delete the notification that was created
    await Notification.deleteMany({
      relatedId: follow._id,
      type: 'follow_request'
    });

    res.json({ message: 'Follow request withdrawn successfully' });
  } catch (error) {
    console.error('Error withdrawing follow request:', error);
    res.status(500).json({ message: 'Error withdrawing follow request', error: error.message });
  }
});

module.exports = router; 