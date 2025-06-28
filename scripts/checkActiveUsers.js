const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function checkActiveUsers() {
  try {
    console.log('Checking active users and suspicious activity...\n');
    
    // Get total users
    const totalUsers = await User.countDocuments();
    console.log(`Total users: ${totalUsers}`);
    
    // Get online users
    const onlineUsers = await User.countDocuments({ isOnline: true });
    console.log(`Online users: ${onlineUsers}`);
    
    // Get users created in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsers = await User.countDocuments({ createdAt: { $gte: oneDayAgo } });
    console.log(`Users created in last 24 hours: ${recentUsers}`);
    
    // Get recent posts (last 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentPosts = await Post.countDocuments({ createdAt: { $gte: oneHourAgo } });
    console.log(`Posts created in last 1 hour: ${recentPosts}`);
    
    // Get recent messages (last 1 hour)
    const recentMessages = await Message.countDocuments({ createdAt: { $gte: oneHourAgo } });
    console.log(`Messages sent in last 1 hour: ${recentMessages}`);
    
    // Find users with suspicious activity (many posts in short time)
    const suspiciousUsers = await Post.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $group: { _id: '$author', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    console.log('\nUsers with 5+ posts in last hour:');
    for (const user of suspiciousUsers) {
      const userData = await User.findById(user._id).select('username email createdAt');
      console.log(`- ${userData?.username || 'Unknown'} (${user.count} posts)`);
    }
    
    // Find users with many messages in short time
    const suspiciousMessageUsers = await Message.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $group: { _id: '$sender', count: { $sum: 1 } } },
      { $match: { count: { $gte: 10 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    console.log('\nUsers with 10+ messages in last hour:');
    for (const user of suspiciousMessageUsers) {
      const userData = await User.findById(user._id).select('username email createdAt');
      console.log(`- ${userData?.username || 'Unknown'} (${user.count} messages)`);
    }
    
    // Check for users with empty fullName (potential bots)
    const emptyFullNameUsers = await User.countDocuments({ 
      fullName: { $in: ['', null] },
      createdAt: { $gte: oneDayAgo }
    });
    console.log(`\nRecent users with empty fullName: ${emptyFullNameUsers}`);
    
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    mongoose.connection.close();
  }
}

checkActiveUsers(); 