const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const Post = require('../models/Post');
const Report = require('../models/Report');
const { aiSecurity } = require('../middleware/aiSecurity');

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

// Get AI Security Dashboard
router.get('/ai-security', auth, admin, async (req, res) => {
  try {
    const users = await User.find({ isBanned: false }).select('username email createdAt lastSeen');
    
    const securityReports = [];
    for (const user of users) {
      const report = await aiSecurity.generateSecurityReport(user._id);
      if (report) {
        securityReports.push(report);
      }
    }

    // Sort by risk score (highest first)
    securityReports.sort((a, b) => b.riskScore - a.riskScore);

    // Get suspicious users (risk score > 50)
    const suspiciousUsers = securityReports.filter(report => report.riskScore > 50);

    // Get recent threats
    const recentThreats = securityReports.filter(report => 
      report.behaviorFlags.length > 0 || report.isSuspicious
    ).slice(0, 10);

    res.json({
      totalUsers: users.length,
      suspiciousUsers: suspiciousUsers.length,
      highRiskUsers: securityReports.filter(r => r.riskScore > 70).length,
      recentThreats,
      topSuspiciousUsers: securityReports.slice(0, 20)
    });
  } catch (error) {
    console.error('Error fetching AI security data:', error);
    res.status(500).json({ message: 'Failed to fetch security data' });
  }
});

// Get user security report
router.get('/user-security/:userId', auth, admin, async (req, res) => {
  try {
    const { userId } = req.params;
    const report = await aiSecurity.generateSecurityReport(userId);
    
    if (!report) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(report);
  } catch (error) {
    console.error('Error fetching user security report:', error);
    res.status(500).json({ message: 'Failed to fetch user report' });
  }
});

// Get AI Security Analytics
router.get('/ai-analytics', auth, admin, async (req, res) => {
  try {
    const users = await User.find({ isBanned: false });
    
    const analytics = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.isOnline).length,
      newUsersToday: users.filter(u => {
        const today = new Date();
        const userDate = new Date(u.createdAt);
        return userDate.toDateString() === today.toDateString();
      }).length,
      newUsersThisWeek: users.filter(u => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return new Date(u.createdAt) > weekAgo;
      }).length,
      averageAccountAge: 0,
      riskDistribution: {
        low: 0,    // 0-30
        medium: 0, // 31-70
        high: 0    // 71-100
      }
    };

    // Calculate average account age and risk distribution
    let totalAge = 0;
    for (const user of users) {
      const age = Date.now() - user.createdAt.getTime();
      totalAge += age;
      
      // Get user's risk score
      const userKey = `user_${user._id}`;
      const userData = aiSecurity.userBehaviorCache.get(userKey);
      const riskScore = userData?.riskScore || 0;
      
      if (riskScore <= 30) analytics.riskDistribution.low++;
      else if (riskScore <= 70) analytics.riskDistribution.medium++;
      else analytics.riskDistribution.high++;
    }
    
    analytics.averageAccountAge = totalAge / users.length;

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching AI analytics:', error);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

// Get real-time threats
router.get('/threats', auth, admin, async (req, res) => {
  try {
    const threats = [];
    
    // Get all users and check for threats
    const users = await User.find({ isBanned: false });
    
    for (const user of users) {
      const userKey = `user_${user._id}`;
      const userData = aiSecurity.userBehaviorCache.get(userKey);
      
      if (userData && userData.riskScore > 70) {
        threats.push({
          userId: user._id,
          username: user.username,
          riskScore: userData.riskScore,
          flags: userData.patterns?.anomalies || [],
          lastActivity: userData.lastActivity,
          type: 'high_risk_user'
        });
      }
    }

    // Sort by risk score
    threats.sort((a, b) => b.riskScore - a.riskScore);

    res.json({ threats: threats.slice(0, 50) });
  } catch (error) {
    console.error('Error fetching threats:', error);
    res.status(500).json({ message: 'Failed to fetch threats' });
  }
});

// Add pending-users route
router.get('/pending-users', [auth, admin], async (req, res) => {
  try {
    const pendingUsers = await User.find({ isApproved: false });
    res.json(pendingUsers);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch pending users', error: error.message });
  }
});

module.exports = router; 