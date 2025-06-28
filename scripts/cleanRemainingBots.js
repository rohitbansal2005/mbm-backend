const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function cleanRemainingBots() {
  try {
    console.log('🧹 CLEANING REMAINING BOTS...\n');
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Find all users with empty fullName created recently
    const emptyNameUsers = await User.find({
      fullName: { $in: ['', null] },
      createdAt: { $gte: oneDayAgo }
    }).select('_id username email createdAt');
    
    console.log(`Found ${emptyNameUsers.length} users with empty fullName`);
    
    // Ban all these users
    let bannedCount = 0;
    for (const user of emptyNameUsers) {
      try {
        await User.findByIdAndUpdate(user._id, {
          isBanned: true,
          bannedEmail: 'Empty fullName - likely bot',
          lastSeen: new Date()
        });
        bannedCount++;
        console.log(`Banned: ${user.username} (${user.email})`);
      } catch (error) {
        console.error(`Error banning user ${user._id}:`, error);
      }
    }
    
    // Also ban users with suspicious email domains
    const suspiciousEmailDomains = [
      'tutanota.com', 'fastmail.com', 'zoho.com', 'yandex.com',
      'msn.com', 'rediffmail.com', 'yahoo.co.in', 'yahoo.com',
      'aol.com', 'protonmail.com', 'hotmail.com', 'outlook.com',
      'gmx.com', 'icloud.com', 'mail.com', 'inbox.com'
    ];
    
    const suspiciousEmailUsers = await User.find({
      email: { $regex: `@(${suspiciousEmailDomains.join('|')})$` },
      createdAt: { $gte: oneDayAgo },
      isBanned: { $ne: true }
    }).select('_id username email createdAt');
    
    console.log(`\nFound ${suspiciousEmailUsers.length} users with suspicious email domains`);
    
    for (const user of suspiciousEmailUsers) {
      try {
        await User.findByIdAndUpdate(user._id, {
          isBanned: true,
          bannedEmail: 'Suspicious email domain - likely bot',
          lastSeen: new Date()
        });
        bannedCount++;
        console.log(`Banned: ${user.username} (${user.email})`);
      } catch (error) {
        console.error(`Error banning user ${user._id}:`, error);
      }
    }
    
    // Ban users with suspicious username patterns
    const suspiciousUsernameUsers = await User.find({
      username: { 
        $regex: /^(\w+)_(\w+)_(\d{3,4})$|^(\w+)(\d{2,4})$|^(\w+)(\d{2,4})(\w+)$/ 
      },
      createdAt: { $gte: oneDayAgo },
      isBanned: { $ne: true }
    }).select('_id username email createdAt');
    
    console.log(`\nFound ${suspiciousUsernameUsers.length} users with suspicious username patterns`);
    
    for (const user of suspiciousUsernameUsers) {
      try {
        await User.findByIdAndUpdate(user._id, {
          isBanned: true,
          bannedEmail: 'Suspicious username pattern - likely bot',
          lastSeen: new Date()
        });
        bannedCount++;
        console.log(`Banned: ${user.username} (${user.email})`);
      } catch (error) {
        console.error(`Error banning user ${user._id}:`, error);
      }
    }
    
    console.log(`\n✅ Successfully banned ${bannedCount} additional bot accounts!`);
    
    // Clean up their posts and messages
    const allBannedUsers = await User.find({ isBanned: true }).select('_id');
    const bannedUserIds = allBannedUsers.map(user => user._id);
    
    const deletedPosts = await Post.deleteMany({
      author: { $in: bannedUserIds }
    });
    
    const deletedMessages = await Message.deleteMany({
      $or: [
        { sender: { $in: bannedUserIds } },
        { recipient: { $in: bannedUserIds } }
      ]
    });
    
    console.log(`🗑️ Deleted ${deletedPosts.deletedCount} spam posts`);
    console.log(`🗑️ Deleted ${deletedMessages.deletedCount} spam messages`);
    
    // Show final stats
    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const activeUsers = totalUsers - bannedUsers;
    
    console.log(`\n📊 FINAL STATS:`);
    console.log(`Total users: ${totalUsers}`);
    console.log(`Banned users: ${bannedUsers}`);
    console.log(`Active users: ${activeUsers}`);
    
  } catch (error) {
    console.error('Error cleaning remaining bots:', error);
  } finally {
    mongoose.connection.close();
  }
}

cleanRemainingBots(); 