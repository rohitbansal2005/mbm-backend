const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
const GroupMessage = require('../models/GroupMessage');
const Follow = require('../models/Follow');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const Payment = require('../models/Payment');
const EventRead = require('../models/EventRead');
const PushSubscription = require('../models/PushSubscription');
const UserSettings = require('../models/UserSettings');
const HelpCenterMessage = require('../models/HelpCenterMessage');

require('dotenv').config();

async function deleteBannedUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Get all banned users
    const bannedUsers = await User.find({ isBanned: true });
    console.log(`Found ${bannedUsers.length} banned users to delete`);

    if (bannedUsers.length === 0) {
      console.log('No banned users found to delete.');
      return;
    }

    const bannedUserIds = bannedUsers.map(user => user._id);
    const bannedUsernames = bannedUsers.map(user => user.username);

    console.log('Users to be deleted:');
    bannedUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username} (${user.email}) - Created: ${user.createdAt}`);
    });

    // Delete their posts
    const postsDeleted = await Post.deleteMany({ author: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${postsDeleted.deletedCount} posts from banned users`);

    // Delete their messages
    const messagesDeleted = await Message.deleteMany({ 
      $or: [
        { sender: { $in: bannedUserIds } },
        { recipient: { $in: bannedUserIds } }
      ]
    });
    console.log(`🗑️ Deleted ${messagesDeleted.deletedCount} messages from banned users`);

    // Delete their group messages
    const groupMessagesDeleted = await GroupMessage.deleteMany({ sender: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${groupMessagesDeleted.deletedCount} group messages from banned users`);

    // Delete their follows
    const followsDeleted = await Follow.deleteMany({
      $or: [
        { follower: { $in: bannedUserIds } },
        { following: { $in: bannedUserIds } }
      ]
    });
    console.log(`🗑️ Deleted ${followsDeleted.deletedCount} follow relationships from banned users`);

    // Delete their notifications
    const notificationsDeleted = await Notification.deleteMany({
      $or: [
        { recipient: { $in: bannedUserIds } },
        { sender: { $in: bannedUserIds } }
      ]
    });
    console.log(`🗑️ Deleted ${notificationsDeleted.deletedCount} notifications from banned users`);

    // Delete their reports
    const reportsDeleted = await Report.deleteMany({
      $or: [
        { reporter: { $in: bannedUserIds } },
        { reportedUser: { $in: bannedUserIds } }
      ]
    });
    console.log(`🗑️ Deleted ${reportsDeleted.deletedCount} reports from banned users`);

    // Delete their payments
    const paymentsDeleted = await Payment.deleteMany({ user: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${paymentsDeleted.deletedCount} payments from banned users`);

    // Delete their event reads
    const eventReadsDeleted = await EventRead.deleteMany({ user: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${eventReadsDeleted.deletedCount} event reads from banned users`);

    // Delete their push subscriptions
    const pushSubsDeleted = await PushSubscription.deleteMany({ user: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${pushSubsDeleted.deletedCount} push subscriptions from banned users`);

    // Delete their user settings
    const settingsDeleted = await UserSettings.deleteMany({ user: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${settingsDeleted.deletedCount} user settings from banned users`);

    // Delete their help center messages
    const helpMessagesDeleted = await HelpCenterMessage.deleteMany({ user: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${helpMessagesDeleted.deletedCount} help center messages from banned users`);

    // Finally, delete the banned users themselves
    const usersDeleted = await User.deleteMany({ _id: { $in: bannedUserIds } });
    console.log(`🗑️ Deleted ${usersDeleted.deletedCount} banned users from database`);

    // Get final count of users
    const totalUsers = await User.countDocuments();
    const realUsers = await User.find({}).sort({ createdAt: 1 });
    console.log(`\n📊 Final count of users in database: ${totalUsers}`);

    console.log('\n✅ Complete deletion of banned users completed successfully!');
    console.log(`\nRemaining users (${realUsers.length}):`);
    realUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username} (${user.email}) - Created: ${user.createdAt}`);
    });

  } catch (error) {
    console.error('Error during user deletion:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
deleteBannedUsers(); 