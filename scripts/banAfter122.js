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

async function banUsersAfter122() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Get all users sorted by creation date
    const allUsers = await User.find({}).sort({ createdAt: 1 });
    console.log(`Total users found: ${allUsers.length}`);

    if (allUsers.length < 122) {
      console.log('Less than 122 users found. No users to ban.');
      return;
    }

    // Get users from position 122 onwards (index 121 and beyond)
    const usersToBan = allUsers.slice(121);
    console.log(`Users to ban: ${usersToBan.length}`);

    if (usersToBan.length === 0) {
      console.log('No users to ban.');
      return;
    }

    const userIdsToBan = usersToBan.map(user => user._id);
    const usernamesToBan = usersToBan.map(user => user.username);

    console.log('Users to be banned:');
    usersToBan.forEach((user, index) => {
      console.log(`${122 + index}. ${user.username} (${user.email}) - Created: ${user.createdAt}`);
    });

    // Ban the users
    const banResult = await User.updateMany(
      { _id: { $in: userIdsToBan } },
      { 
        $set: { 
          isBanned: true,
          banReason: 'Bot account - created after position 122',
          bannedAt: new Date()
        }
      }
    );

    console.log(`\n✅ Banned ${banResult.modifiedCount} users`);

    // Delete their posts
    const postsDeleted = await Post.deleteMany({ author: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${postsDeleted.deletedCount} posts from banned users`);

    // Delete their messages
    const messagesDeleted = await Message.deleteMany({ 
      $or: [
        { sender: { $in: userIdsToBan } },
        { recipient: { $in: userIdsToBan } }
      ]
    });
    console.log(`🗑️ Deleted ${messagesDeleted.deletedCount} messages from banned users`);

    // Delete their group messages
    const groupMessagesDeleted = await GroupMessage.deleteMany({ sender: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${groupMessagesDeleted.deletedCount} group messages from banned users`);

    // Delete their follows
    const followsDeleted = await Follow.deleteMany({
      $or: [
        { follower: { $in: userIdsToBan } },
        { following: { $in: userIdsToBan } }
      ]
    });
    console.log(`🗑️ Deleted ${followsDeleted.deletedCount} follow relationships from banned users`);

    // Delete their notifications
    const notificationsDeleted = await Notification.deleteMany({
      $or: [
        { recipient: { $in: userIdsToBan } },
        { sender: { $in: userIdsToBan } }
      ]
    });
    console.log(`🗑️ Deleted ${notificationsDeleted.deletedCount} notifications from banned users`);

    // Delete their reports
    const reportsDeleted = await Report.deleteMany({
      $or: [
        { reporter: { $in: userIdsToBan } },
        { reportedUser: { $in: userIdsToBan } }
      ]
    });
    console.log(`🗑️ Deleted ${reportsDeleted.deletedCount} reports from banned users`);

    // Delete their payments
    const paymentsDeleted = await Payment.deleteMany({ user: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${paymentsDeleted.deletedCount} payments from banned users`);

    // Delete their event reads
    const eventReadsDeleted = await EventRead.deleteMany({ user: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${eventReadsDeleted.deletedCount} event reads from banned users`);

    // Delete their push subscriptions
    const pushSubsDeleted = await PushSubscription.deleteMany({ user: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${pushSubsDeleted.deletedCount} push subscriptions from banned users`);

    // Delete their user settings
    const settingsDeleted = await UserSettings.deleteMany({ user: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${settingsDeleted.deletedCount} user settings from banned users`);

    // Delete their help center messages
    const helpMessagesDeleted = await HelpCenterMessage.deleteMany({ user: { $in: userIdsToBan } });
    console.log(`🗑️ Deleted ${helpMessagesDeleted.deletedCount} help center messages from banned users`);

    // Get final count of real users
    const realUsers = await User.find({ isBanned: { $ne: true } }).sort({ createdAt: 1 });
    console.log(`\n📊 Final count of real users: ${realUsers.length}`);

    console.log('\n✅ Bot cleanup completed successfully!');
    console.log(`\nReal users (first ${realUsers.length}):`);
    realUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username} (${user.email}) - Created: ${user.createdAt}`);
    });

  } catch (error) {
    console.error('Error during bot cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
banUsersAfter122(); 