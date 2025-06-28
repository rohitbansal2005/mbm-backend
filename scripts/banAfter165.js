const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function banAfter165() {
  try {
    console.log('🎯 BANNING ALL USERS AFTER FIRST 165...\n');
    
    // Get all users sorted by creation date (oldest first)
    const allUsers = await User.find().sort({ createdAt: 1 }).select('_id username email createdAt');
    
    console.log(`Total users found: ${allUsers.length}`);
    
    if (allUsers.length <= 165) {
      console.log('✅ No users to ban - all users are real!');
      return;
    }
    
    // Get users after the first 165
    const fakeUsers = allUsers.slice(165);
    console.log(`Found ${fakeUsers.length} fake users to ban (after first 165)`);
    
    // Ban all fake users
    let bannedCount = 0;
    for (const user of fakeUsers) {
      try {
        await User.findByIdAndUpdate(user._id, {
          isBanned: true,
          bannedEmail: 'Created after first 165 users - likely bot',
          lastSeen: new Date()
        });
        bannedCount++;
        console.log(`Banned: ${user.username} (${user.email}) - Created: ${user.createdAt}`);
      } catch (error) {
        console.error(`Error banning user ${user._id}:`, error);
      }
    }
    
    console.log(`\n✅ Successfully banned ${bannedCount} fake users!`);
    
    // Clean up their posts and messages
    const fakeUserIds = fakeUsers.map(user => user._id);
    
    const deletedPosts = await Post.deleteMany({
      author: { $in: fakeUserIds }
    });
    
    const deletedMessages = await Message.deleteMany({
      $or: [
        { sender: { $in: fakeUserIds } },
        { recipient: { $in: fakeUserIds } }
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
    console.log(`Real users (first 165): ${Math.min(165, totalUsers)}`);
    
  } catch (error) {
    console.error('Error banning users after 165:', error);
  } finally {
    mongoose.connection.close();
  }
}

banAfter165(); 