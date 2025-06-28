const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const Post = require('../models/Post');
const Message = require('../models/Message');
const UserSettings = require('../models/UserSettings');
const isBlocked = require('../utils/isBlocked');
const { getOnlineUserIds } = require('../socket');
const Follow = require('../models/Follow');
const nodemailer = require('nodemailer');
const { transporter } = require('./auth');
const { savePushSubscription } = require('../controllers/userController');

// Get all users
router.get('/', async (req, res) => {
    try {
        // Only select public fields
        const users = await User.find().select('username fullName profilePicture avatar _id role isPremium badgeType');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get current user
router.get('/me', auth, async (req, res) => {
    try {
        console.log('Fetching user data for ID:', req.user._id);
        const user = await User.findById(req.user._id).select('-password');
        if (!user) {
            console.log('User not found');
            return res.status(404).json({ message: 'User not found' });
        }
        console.log('User found:', user);
        res.json({ 
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                profilePicture: user.profilePicture,
                bio: user.bio,
                followers: user.followers,
                following: user.following,
                createdAt: user.createdAt
            }
        });
    } catch (err) {
        console.error('Error in /me route:', err);
        res.status(500).json({ message: err.message });
    }
});

// Search users by name or email
router.get('/search', auth, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ message: 'Search query is required' });
        }

        // Find users matching the query
        const users = await User.find({
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { fullName: { $regex: query, $options: 'i' } }
            ]
        }).select('_id username fullName profilePicture avatar role isPremium badgeType');

        // For each user, get their Student profile and filter out blocked users
        const results = await Promise.all(users.map(async user => {
            const student = await Student.findOne({ user: user._id });
            // Block check: skip if either user has blocked the other
            const requesterId = req.user._id.toString();
            const userId = user._id.toString();
            if (requesterId !== userId) {
                if (await isBlocked(requesterId, userId) || await isBlocked(userId, requesterId)) {
                    return null;
                }
            }
            return {
                _id: user._id,
                username: user.username,
                fullName: user.fullName,
                profilePicture: user.profilePicture,
                avatar: user.avatar,
                role: user.role,
                isPremium: user.isPremium,
                badgeType: user.badgeType,
                branch: student?.branch || '',
                session: student?.session || '',
                semester: student?.semester || '',
                bio: student?.bio || '',
            };
        }));

        res.json(results.filter(Boolean));
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ message: 'Error searching users' });
    }
});

// Place /blocked route BEFORE any /:id or similar parameterized routes
router.get('/blocked', auth, async (req, res) => {
    console.log('Blocked route hit!'); // Debug log
    try {
        const userId = req.user._id || req.user.userId;
        console.log('Fetching blocked users for user:', userId);
        
        // First verify the user exists
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found:', userId);
            return res.status(404).json({ error: 'User not found' });
        }

        // Then get the populated user data
        const populatedUser = await User.findById(userId)
            .populate({
                path: 'blockedUsers.user',
                select: 'username fullName profilePicture avatar role isPremium badgeType',
                model: 'User'
            });
            
        if (!populatedUser) {
            console.error('Failed to populate blocked users for user:', userId);
            return res.status(500).json({ error: 'Failed to populate blocked users' });
        }

        // Map the blocked users to the expected format
        const blocked = (populatedUser.blockedUsers || []).map(b => ({
            _id: b.user._id,
            username: b.user.username,
            fullName: b.user.fullName,
            profilePicture: b.user.profilePicture,
            avatar: b.user.avatar,
            blockedAt: b.blockedAt
        }));
        
        console.log('Returning blocked users:', blocked);
        res.json(blocked);
    } catch (error) {
        console.error('Get blocked users error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch blocked users', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get online users with showOnlineStatus: true
router.get('/online', auth, async (req, res) => {
  try {
    const onlineUsers = await User.find({
      lastSeen: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    })
    .select('_id fullName avatar username profilePicture lastSeen role isPremium badgeType')
    .lean();

    console.log('Fetched onlineUsers:', onlineUsers);

    if (!onlineUsers || onlineUsers.length === 0) {
      return res.json([]);
    }

    // Only use valid user IDs
    const userIds = onlineUsers.map(u => u._id).filter(id => id && (typeof id === 'string' || (id && id.toString && id.toString().length === 24)));
    console.log('User IDs for settings:', userIds);

    if (userIds.length === 0) {
      return res.json([]);
    }

    let settings = [];
    try {
      settings = await UserSettings.find({ 
        user: { $in: userIds }
      });
      console.log('Fetched settings:', settings);
    } catch (settingsErr) {
      console.error('Error fetching user settings:', settingsErr);
      return res.json([]); // Defensive: don't crash if settings fetch fails
    }

    // Create a map of user settings
    const settingsMap = new Map(
      settings.map(s => [s.user.toString(), s])
    );

    // Filter users based on settings and add online status
    const filteredUsers = onlineUsers
      .filter(user => {
        const userSettings = settingsMap.get(user._id.toString());
        // If no settings exist, default to showing online status
        return !userSettings || userSettings.showOnlineStatus;
      })
      .map(user => ({
        ...user,
        isOnline: true
      }));

    res.json(filteredUsers);
  } catch (err) {
    console.error('Error fetching online users:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Get user by username
router.get('/findByUsername/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('_id username fullName profilePicture role isPremium badgeType'); // Select only necessary fields
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error finding user by username:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's friends
router.get('/friends', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        // Get all users that are friends with the current user
        const friends = await User.find({
            _id: { $in: user.friends }
        }).select('username fullName profilePicture avatar role isPremium badgeType');

        res.json(friends);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get user by ID
router.get('/:id', auth, async (req, res) => {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid user ID' });
    }
    try {
        const { id: targetUserId } = req.params;
        const { _id: requesterId } = req.user;

        // 1. Check for blocking first
        if (await isBlocked(requesterId, targetUserId) || await isBlocked(targetUserId, requesterId)) {
            return res.status(403).json({ message: 'You cannot view this profile.' });
        }

        // 2. Fetch student profile to check privacy settings
        const studentProfile = await Student.findOne({ user: targetUserId });
        if (!studentProfile) {
            // Fallback for users without a student profile
            const user = await User.findById(targetUserId).select('-password');
            if (!user) return res.status(404).json({ message: 'User not found' });
            return res.json(user);
        }

        // 3. Perform privacy check
        const isOwner = requesterId.toString() === targetUserId.toString();
        const privacySetting = studentProfile.privacy?.profile || 'public';
        let canView = false;

        if (isOwner) {
            canView = true;
        } else {
            switch (privacySetting) {
                case 'public':
                    canView = true;
                    break;
                case 'friends': // Assuming 'friends' means mutual follow
                    const userFollowsTarget = await Follow.findOne({ follower: requesterId, following: targetUserId, status: 'accepted' });
                    const targetFollowsUser = await Follow.findOne({ follower: targetUserId, following: requesterId, status: 'accepted' });
                    if (userFollowsTarget && targetFollowsUser) {
                        canView = true;
                    }
                    break;
                case 'private':
                    const isFollower = await Follow.findOne({ follower: requesterId, following: targetUserId, status: 'accepted' });
                    if (isFollower) {
                        canView = true;
                    }
                    break;
            }
        }
        
        if (!canView) {
            // Return only public info
            const user = await User.findById(targetUserId).select('-password');
            if (!user) return res.status(404).json({ message: 'User not found' });

            // Only public fields from student profile
            let publicStudent = null;
            if (studentProfile) {
                publicStudent = {
                    fullName: studentProfile.fullName,
                    branch: studentProfile.branch,
                    session: studentProfile.session,
                    semester: studentProfile.semester,
                    bio: studentProfile.bio,
                    privacy: studentProfile.privacy
                };
            }

            return res.json({
                _id: user._id,
                username: user.username,
                fullName: user.fullName,
                profilePicture: user.profilePicture,
                bio: user.bio,
                student: publicStudent,
                isPrivate: true
            });
        }
        
        // 4. If all checks pass, return the full profile with student data
        const user = await User.findById(targetUserId).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get student profile data
        const studentProfileData = await Student.findOne({ user: targetUserId });
        
        // Combine user and student data
        const profileData = {
            ...user.toObject(),
            student: studentProfileData ? studentProfileData.toObject() : null
        };

        res.json(profileData);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        console.log('Login attempt:', { email: req.body.email });
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                message: 'Please provide both email and password' 
            });
        }
        
        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found:', email);
            return res.status(400).json({ 
                success: false,
                message: 'Invalid credentials' 
            });
        }

        // Check if account is locked
        if (user.isLocked()) {
            return res.status(403).json({
                success: false,
                message: 'Account is locked. Please try again later.'
            });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.log('Invalid password for user:', email);
            // Increment failed login attempts
            await user.incrementLoginAttempts();
            return res.status(400).json({ 
                success: false,
                message: 'Invalid credentials' 
            });
        }

        // Reset failed login attempts on successful login
        if (user.failedLoginAttempts > 0) {
            user.failedLoginAttempts = 0;
            user.lockUntil = undefined;
            await user.save();
        }

        console.log('Login successful for user:', email);

        // Create JWT token
        const tokenPayload = {
            _id: user._id.toString(),
            role: user.role || 'user'
        };

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured');
        }

        const token = jwt.sign(
            tokenPayload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Get user data without password
        const userData = {
            _id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role || 'user',
            profilePicture: user.profilePicture,
            bio: user.bio,
            followers: user.followers,
            following: user.following,
            createdAt: user.createdAt
        };

        console.log('Sending response with token and user data');
        res.json({
            success: true,
            token,
            user: userData
        });
    } catch (error) {
        console.error('Login error:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Create a new user
router.post('/', async (req, res) => {
    try {
        const { username, email, password, inviteCode, referralCode } = req.body;

        if (inviteCode !== 'MBM2005') {
            return res.status(400).json({ message: 'Invalid invite code. Only college students can register.' });
        }

        // Check if user already exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Referral logic
        let referredBy = null;
        if (referralCode && referralCode !== username) {
            const referrer = await User.findOne({ referralCode });
            if (referrer) {
                referredBy = referrer._id;
                referrer.referralCount = (referrer.referralCount || 0) + 1;
                // Unlock Student Corner if 10 or more referrals
                if (referrer.referralCount === 10) {
                    referrer.studentCornerUnlocked = true;
                    // Send congratulation email
                    if (transporter) {
                        try {
                            await transporter.sendMail({
                                from: process.env.EMAIL_USER,
                                to: referrer.email,
                                subject: 'Congratulations! Student Corner Unlocked 🎓',
                                html: `
                                    <div style="background: #f5f7fa; padding: 32px 0; min-height: 100vh; font-family: 'Segoe UI', Arial, sans-serif;">
                                      <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.07); padding: 32px 28px;">
                                        <div style="text-align: center;">
                                          <img src='https://mbmconnect.vercel.app/mbmlogo.png' alt='MBMConnect Logo' style='width: 64px; height: 64px; margin-bottom: 16px;' />
                                          <h1 style="color: #1976d2; margin-bottom: 8px; font-size: 2.2rem;">Congratulations, <span style='color:#ff9800;'>${referrer.username}</span>!</h1>
                                        </div>
                                        <p style="color: #444; font-size: 1.05rem; line-height: 1.7; margin-bottom: 18px;">
                                          🎉 <b>You have successfully referred 10 friends!</b><br>
                                          <b>Student Corner</b> is now <span style='color:green;'>unlocked</span> for your account.<br>
                                          <br>
                                          Explore exclusive resources, mentorship, and more.<br>
                                          <br>
                                          <a href="https://mbmconnect.vercel.app/student-corner" style="background: #1976d2; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 1.1rem; font-weight: 600; letter-spacing: 1px; display: inline-block; box-shadow: 0 2px 8px rgba(25,118,210,0.08);">Go to Student Corner</a>
                                        </p>
                                        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px 0;" />
                                        <p style="color: #bbb; font-size: 0.93rem; text-align: center;">With ❤️ from the MBMConnect Team</p>
                                      </div>
                                    </div>
                                `
                            });
                        } catch (err) {
                            console.error('Failed to send Student Corner unlock email:', err);
                        }
                    }
                }
                await referrer.save();
            }
        }

        // Create new user with referralCode always set to username
        user = new User({
            username,
            email,
            password, // plain password, hashing will be done in pre-save hook
            referralCode: username,
            referredBy
        });

        await user.save();

        // Create student profile
        const student = new Student({
            user: user._id,
            fullName: username,
            rollNumber: `MBM${Date.now()}`,
            branch: 'Not specified',
            session: 'Not specified',
            semester: 'Not specified',
            email: email
        });

        await student.save();

        // Send welcome email
        if (transporter) {
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'Welcome to MBMConnect!',
                    html: `
                        <div style="background: #f5f7fa; padding: 32px 0; min-height: 100vh; font-family: 'Segoe UI', Arial, sans-serif;">
                          <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.07); padding: 32px 28px;">
                            <div style="text-align: center;">
                              <img src='https://mbmconnect.vercel.app/mbmlogo.png' alt='MBMConnect Logo' style='width: 64px; height: 64px; margin-bottom: 16px;' />
                              <h1 style="color: #1976d2; margin-bottom: 8px; font-size: 2.2rem;">Welcome to <span style='color:#ff9800;'>MBMConnect</span>!</h1>
                              <h2 style="color: #333; margin-bottom: 16px; font-size: 1.3rem; font-weight: 400;">Hi ${username},</h2>
                            </div>
                            <p style="color: #444; font-size: 1.05rem; line-height: 1.7; margin-bottom: 18px;">
                              🎉 <b>Congratulations!</b> You are now a part of the <b>MBMConnect</b> family.<br>
                              Connect, share, and grow with your college community.<br>
                            </p>
                            <div style="background: #fffbe6; border: 1px solid #ffe082; border-radius: 8px; padding: 16px 18px; margin-bottom: 18px; color: #795548; font-size: 1.04rem;">
                              <b>Referral Program:</b><br>
                              Invite your friends to MBMConnect using your referral code (your username) or your referral link.<br>
                              When 10 friends join using your code, you'll unlock <b>Student Corner</b> (exclusive resources) and appear on the leaderboard!<br>
                              <span style="color:#1976d2;">Share your code and start inviting now!</span>
                            </div>
                            <span style="color: #1976d2; font-weight: 500;">What's next?</span><br>
                            <ul style="margin: 10px 0 18px 20px; color: #555;">
                              <li>👥 <b>Find and connect</b> with classmates and alumni</li>
                              <li>📝 <b>Share posts, ideas, and achievements</b></li>
                              <li>💬 <b>Join groups, discussions, and events</b></li>
                              <li>🔔 <b>Stay updated</b> with campus news and notifications</li>
                            </ul>
                            <div style="text-align: center; margin: 32px 0;">
                              <a href="https://mbmconnect.vercel.app" style="background: #1976d2; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 6px; font-size: 1.1rem; font-weight: 600; letter-spacing: 1px; display: inline-block; box-shadow: 0 2px 8px rgba(25,118,210,0.08);">Explore MBMConnect</a>
                            </div>
                            <p style="color: #888; font-size: 0.98rem; text-align: center; margin-top: 24px;">If you have any questions, just reply to this email.<br>We're here to help you!</p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px 0;" />
                            <p style="color: #bbb; font-size: 0.93rem; text-align: center;">With ❤️ from the MBMConnect Team</p>
                          </div>
                        </div>
                    `
                });
            } catch (err) {
                console.error('Failed to send welcome email:', err);
            }
        }

        // Create JWT token
        const token = jwt.sign(
            { _id: user._id, role: user.role },
            process.env.JWT_SECRET || 'your_jwt_secret_key_here',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            token,
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture,
                bio: user.bio,
                followers: user.followers,
                following: user.following,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Update user profile
router.put('/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Secure password check for username change
        if (req.body.username) {
            if (!req.body.password) {
                return res.status(400).json({ message: 'Password is required to change username.' });
            }
            // Use comparePassword if available, otherwise use bcrypt directly
            let isMatch = false;
            if (typeof user.comparePassword === 'function') {
                isMatch = await user.comparePassword(req.body.password);
            } else {
                const bcrypt = require('bcryptjs');
                isMatch = await bcrypt.compare(req.body.password, user.password);
            }
            if (!isMatch) {
                return res.status(401).json({ message: 'Incorrect password.' });
            }
            // Username change limit logic
            const now = new Date();
            if (!user.usernameChangeHistory) user.usernameChangeHistory = [];
            if (user.usernameChangeHistory.length >= 2) {
                // Check if last change was more than 1 month ago
                const lastChange = user.lastUsernameChange || user.usernameChangeHistory[user.usernameChangeHistory.length - 1];
                if (lastChange && (now - new Date(lastChange)) < 30 * 24 * 60 * 60 * 1000) {
                    return res.status(400).json({ message: 'You can only change your username 2 times. After that, you must wait 1 month between changes.' });
                }
            }
            // Allow change, update history
            user.usernameChangeHistory.push(now);
            user.lastUsernameChange = now;
            user.username = req.body.username;
        }
        if (req.body.email) user.email = req.body.email;
        if (req.body.bio) user.bio = req.body.bio;
        if (req.body.profilePicture) user.profilePicture = req.body.profilePicture;

        const updatedUser = await user.save();
        res.json(updatedUser);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Follow/Unfollow user
// DISABLED: Use /api/follows for follow requests with pending/accept flow
// router.put('/:id/follow', async (req, res) => {
//     try {
//         const userToFollow = await User.findById(req.params.id);
//         const currentUser = await User.findById(req.body.userId);
//
//         if (!userToFollow || !currentUser) {
//             return res.status(404).json({ message: 'User not found' });
//         }
//
//         if (currentUser.following.includes(req.params.id)) {
//             // Unfollow
//             currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
//             userToFollow.followers = userToFollow.followers.filter(id => id.toString() !== req.body.userId);
//         } else {
//             // Follow
//             currentUser.following.push(req.params.id);
//             userToFollow.followers.push(req.body.userId);
//         }
//
//         await currentUser.save();
//         await userToFollow.save();
//         res.json({ message: 'Follow status updated' });
//     } catch (error) {
//         res.status(400).json({ message: error.message });
//     }
// });

// Get suggested users
router.get('/suggested', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.userId)
      .populate('followers following');

    // Get users who are not already followed
    const suggestedUsers = await User.find({
      _id: { 
        $nin: [
          req.user.userId,
          ...currentUser.following.map(f => f._id)
        ]
      }
    })
    .select('username fullName profilePicture avatar role isPremium badgeType')
    .limit(5);

    // Calculate mutual friends for each suggested user
    const usersWithMutualFriends = await Promise.all(
      suggestedUsers.map(async (user) => {
        const userFollowers = await User.findById(user._id)
          .select('followers');
        
        const mutualFriends = currentUser.followers.filter(follower => 
          userFollowers.followers.includes(follower._id)
        ).length;

        return {
          ...user.toObject(),
          mutualFriends
        };
      })
    );

    res.json(usersWithMutualFriends);
  } catch (error) {
    console.error('Error in suggested users:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update delete account route to require password and reason
router.delete('/me', auth, async (req, res) => {
    try {
        const userId = req.user._id || req.user.userId;
        const { password, reason } = req.body;
        if (!password || !reason) {
            return res.status(400).json({ message: 'Password and reason are required.' });
        }
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect password.' });
        }
        // Optionally log/store the reason (here we just log it)
        console.log(`User ${user.email} is deleting their account. Reason: ${reason}`);
        // Delete associated student profile if exists
        await Student.findOneAndDelete({ user: user._id });
        // Delete user's posts
        await Post.deleteMany({ author: user._id });
        // Delete user's messages
        await Message.deleteMany({ 
            $or: [
                { sender: user._id },
                { recipient: user._id }
            ]
        });
        // Remove user from followers/following lists
        await User.updateMany(
            { followers: user._id },
            { $pull: { followers: user._id } }
        );
        await User.updateMany(
            { following: user._id },
            { $pull: { following: user._id } }
        );
        // Delete user settings
        await UserSettings.findOneAndDelete({ user: user._id });
        // Finally delete the user
        await user.deleteOne();
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ message: 'Error deleting account' });
    }
});

// Block a user
router.post('/block/:userId', auth, async (req, res) => {
    try {
        const userToBlock = await User.findById(req.params.userId);
        if (!userToBlock) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already blocked
        const alreadyBlocked = (req.user.blockedUsers || []).some(b => b.user.toString() === req.params.userId);
        if (alreadyBlocked) {
            return res.status(400).json({ error: 'User is already blocked' });
        }

        // Add to blocked users with date
        await User.findByIdAndUpdate(req.user._id, {
            $push: { blockedUsers: { user: req.params.userId, blockedAt: new Date() } }
        });

        // Remove from followers/following if exists
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { 
                followers: req.params.userId,
                following: req.params.userId
            }
        });

        await User.findByIdAndUpdate(req.params.userId, {
            $pull: { 
                followers: req.user._id,
                following: req.user._id
            }
        });

        res.json({ message: 'User blocked successfully' });
    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ error: 'Failed to block user' });
    }
});

// Unblock a user
router.post('/unblock/:userId', auth, async (req, res) => {
    try {
        // Remove from blocked users
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { blockedUsers: { user: req.params.userId } }
        });

        res.json({ message: 'User unblocked successfully' });
    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ error: 'Failed to unblock user' });
    }
});

// Save push subscription for web push notifications
router.post('/save-subscription', auth, savePushSubscription);

// Referral Leaderboard
router.get('/leaderboard', auth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const skip = parseInt(req.query.skip) || 0;
        const users = await User.find()
            .select('username referralCount studentCornerUnlocked profilePicture role isPremium badgeType')
            .sort({ referralCount: -1, username: 1 })
            .skip(skip)
            .limit(limit);
        const total = await User.countDocuments();
        res.json({ users, total });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Add a catch-all for unmatched routes at the end for debugging
router.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

module.exports = router; 