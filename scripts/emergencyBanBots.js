const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function emergencyBanBots() {
  try {
    console.log('🚨 EMERGENCY BOT BAN - Starting...\n');
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Find users with suspicious activity patterns
    const suspiciousUsers = [];
    
    // 1. Users with many posts in short time
    const spamPostUsers = await Post.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $group: { _id: '$author', count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } }
    ]);
    
    for (const user of spamPostUsers) {
      suspiciousUsers.push(user._id);
    }
    
    // 2. Users with many messages in short time
    const spamMessageUsers = await Message.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $group: { _id: '$sender', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } }
    ]);
    
    for (const user of spamMessageUsers) {
      suspiciousUsers.push(user._id);
    }
    
    // 3. Recent users with empty fullName
    const emptyNameUsers = await User.find({
      fullName: { $in: ['', null] },
      createdAt: { $gte: oneDayAgo }
    }).select('_id');
    
    for (const user of emptyNameUsers) {
      suspiciousUsers.push(user._id);
    }
    
    // 4. Users with suspicious usernames
    const suspiciousUsernameUsers = await User.find({
      username: { 
        $regex: /^(\w+)_(\w+)_(\d{3,4})$|^(\w+)(\d{2,4})$|^(\w+)(\d{2,4})(\w+)$/ 
      },
      createdAt: { $gte: oneDayAgo }
    }).select('_id');
    
    for (const user of suspiciousUsernameUsers) {
      suspiciousUsers.push(user._id);
    }
    
    // Remove duplicates
    const uniqueSuspiciousUsers = [...new Set(suspiciousUsers)];
    
    console.log(`Found ${uniqueSuspiciousUsers.length} suspicious users to ban`);
    
    // Ban all suspicious users
    let bannedCount = 0;
    for (const userId of uniqueSuspiciousUsers) {
      try {
        await User.findByIdAndUpdate(userId, {
          isBanned: true,
          bannedEmail: 'Bot activity detected',
          lastSeen: new Date()
        });
        bannedCount++;
        
        // Get user details for logging
        const user = await User.findById(userId).select('username email createdAt');
        console.log(`Banned: ${user?.username || 'Unknown'} (${user?.email})`);
        
      } catch (error) {
        console.error(`Error banning user ${userId}:`, error);
      }
    }
    
    console.log(`\n✅ Successfully banned ${bannedCount} bot accounts!`);
    
    // Clean up their posts and messages
    const deletedPosts = await Post.deleteMany({
      author: { $in: uniqueSuspiciousUsers }
    });
    
    const deletedMessages = await Message.deleteMany({
      $or: [
        { sender: { $in: uniqueSuspiciousUsers } },
        { recipient: { $in: uniqueSuspiciousUsers } }
      ]
    });
    
    console.log(`🗑️ Deleted ${deletedPosts.deletedCount} spam posts`);
    console.log(`🗑️ Deleted ${deletedMessages.deletedCount} spam messages`);
    
  } catch (error) {
    console.error('Error in emergency bot ban:', error);
  } finally {
    mongoose.connection.close();
  }
}

emergencyBanBots(); 