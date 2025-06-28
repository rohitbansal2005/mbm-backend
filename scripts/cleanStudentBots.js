const mongoose = require('mongoose');
const Student = require('../models/Student');
require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@rkbansalclusters.w5yilhm.mongodb.net/mbmconnect`;

async function cleanStudentBots() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        // Get all students sorted by creation date
        const allStudents = await Student.find({}).sort({ createdAt: 1 });
        console.log(`📊 Total students found: ${allStudents.length}`);

        if (allStudents.length <= 169) {
            console.log('✅ No bot students to clean. All students are legitimate.');
            return;
        }

        // Get students after position 169 (bot students)
        const botStudents = allStudents.slice(169);
        console.log(`🤖 Bot students found: ${botStudents.length}`);

        if (botStudents.length === 0) {
            console.log('✅ No bot students to clean.');
            return;
        }

        // Extract bot student IDs
        const botStudentIds = botStudents.map(student => student._id);
        const botUserIds = botStudents.map(student => student.user);

        console.log('🧹 Starting cleanup process...');

        // Delete bot students
        const deleteResult = await Student.deleteMany({
            _id: { $in: botStudentIds }
        });

        console.log(`🗑️ Deleted ${deleteResult.deletedCount} bot students`);

        // Also clean related data
        console.log('🧹 Cleaning related data...');

        // Clean posts by bot users
        const Post = require('../models/Post');
        const postDeleteResult = await Post.deleteMany({
            author: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${postDeleteResult.deletedCount} bot posts`);

        // Clean messages by bot users
        const Message = require('../models/Message');
        const messageDeleteResult = await Message.deleteMany({
            $or: [
                { sender: { $in: botUserIds } },
                { recipient: { $in: botUserIds } }
            ]
        });
        console.log(`🗑️ Deleted ${messageDeleteResult.deletedCount} bot messages`);

        // Clean notifications by bot users
        const Notification = require('../models/Notification');
        const notificationDeleteResult = await Notification.deleteMany({
            $or: [
                { sender: { $in: botUserIds } },
                { recipient: { $in: botUserIds } }
            ]
        });
        console.log(`🗑️ Deleted ${notificationDeleteResult.deletedCount} bot notifications`);

        // Clean follows by bot users
        const Follow = require('../models/Follow');
        const followDeleteResult = await Follow.deleteMany({
            $or: [
                { follower: { $in: botUserIds } },
                { following: { $in: botUserIds } }
            ]
        });
        console.log(`🗑️ Deleted ${followDeleteResult.deletedCount} bot follows`);

        // Clean groups by bot users
        const Group = require('../models/Group');
        const groupDeleteResult = await Group.deleteMany({
            creator: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${groupDeleteResult.deletedCount} bot groups`);

        // Clean group messages by bot users
        const GroupMessage = require('../models/GroupMessage');
        const groupMessageDeleteResult = await GroupMessage.deleteMany({
            sender: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${groupMessageDeleteResult.deletedCount} bot group messages`);

        // Clean events by bot users
        const Event = require('../models/Event');
        const eventDeleteResult = await Event.deleteMany({
            creator: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${eventDeleteResult.deletedCount} bot events`);

        // Clean reports by bot users
        const Report = require('../models/Report');
        const reportDeleteResult = await Report.deleteMany({
            reporter: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${reportDeleteResult.deletedCount} bot reports`);

        // Clean payments by bot users
        const Payment = require('../models/Payment');
        const paymentDeleteResult = await Payment.deleteMany({
            user: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${paymentDeleteResult.deletedCount} bot payments`);

        // Clean push subscriptions by bot users
        const PushSubscription = require('../models/PushSubscription');
        const pushSubscriptionDeleteResult = await PushSubscription.deleteMany({
            user: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${pushSubscriptionDeleteResult.deletedCount} bot push subscriptions`);

        // Clean help center messages by bot users
        const HelpCenterMessage = require('../models/HelpCenterMessage');
        const helpCenterMessageDeleteResult = await HelpCenterMessage.deleteMany({
            user: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${helpCenterMessageDeleteResult.deletedCount} bot help center messages`);

        // Clean event reads by bot users
        const EventRead = require('../models/EventRead');
        const eventReadDeleteResult = await EventRead.deleteMany({
            user: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${eventReadDeleteResult.deletedCount} bot event reads`);

        // Clean user settings by bot users
        const UserSettings = require('../models/UserSettings');
        const userSettingsDeleteResult = await UserSettings.deleteMany({
            user: { $in: botUserIds }
        });
        console.log(`🗑️ Deleted ${userSettingsDeleteResult.deletedCount} bot user settings`);

        console.log('✅ Student bot cleanup completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`   - Bot students deleted: ${deleteResult.deletedCount}`);
        console.log(`   - Bot posts deleted: ${postDeleteResult.deletedCount}`);
        console.log(`   - Bot messages deleted: ${messageDeleteResult.deletedCount}`);
        console.log(`   - Bot notifications deleted: ${notificationDeleteResult.deletedCount}`);
        console.log(`   - Bot follows deleted: ${followDeleteResult.deletedCount}`);
        console.log(`   - Bot groups deleted: ${groupDeleteResult.deletedCount}`);
        console.log(`   - Bot group messages deleted: ${groupMessageDeleteResult.deletedCount}`);
        console.log(`   - Bot events deleted: ${eventDeleteResult.deletedCount}`);
        console.log(`   - Bot reports deleted: ${reportDeleteResult.deletedCount}`);
        console.log(`   - Bot payments deleted: ${paymentDeleteResult.deletedCount}`);
        console.log(`   - Bot push subscriptions deleted: ${pushSubscriptionDeleteResult.deletedCount}`);
        console.log(`   - Bot help center messages deleted: ${helpCenterMessageDeleteResult.deletedCount}`);
        console.log(`   - Bot event reads deleted: ${eventReadDeleteResult.deletedCount}`);
        console.log(`   - Bot user settings deleted: ${userSettingsDeleteResult.deletedCount}`);

    } catch (error) {
        console.error('❌ Error during student bot cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run the cleanup
cleanStudentBots(); 