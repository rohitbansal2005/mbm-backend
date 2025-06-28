const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Post = require('../models/Post');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Follow = require('../models/Follow');
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const Event = require('../models/Event');
const Report = require('../models/Report');
const Payment = require('../models/Payment');
const PushSubscription = require('../models/PushSubscription');
const HelpCenterMessage = require('../models/HelpCenterMessage');
const EventRead = require('../models/EventRead');
const UserSettings = require('../models/UserSettings');
require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@rkbansalclusters.w5yilhm.mongodb.net/mbmconnect`;

async function checkAllCollections() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        console.log('\n📊 COLLECTION STATUS REPORT');
        console.log('=' .repeat(50));

        // Check Users
        const totalUsers = await User.countDocuments();
        const bannedUsers = await User.countDocuments({ isBanned: true });
        console.log(`👥 Users: ${totalUsers} total, ${bannedUsers} banned`);

        // Check Students
        const totalStudents = await Student.countDocuments();
        console.log(`🎓 Students: ${totalStudents} total`);

        // Check Posts
        const totalPosts = await Post.countDocuments();
        const botPosts = await Post.countDocuments({ 
            author: { $exists: false } 
        });
        console.log(`📝 Posts: ${totalPosts} total, ${botPosts} orphaned`);

        // Check Messages
        const totalMessages = await Message.countDocuments();
        const orphanedMessages = await Message.countDocuments({
            $or: [
                { sender: { $exists: false } },
                { recipient: { $exists: false } }
            ]
        });
        console.log(`💬 Messages: ${totalMessages} total, ${orphanedMessages} orphaned`);

        // Check Notifications
        const totalNotifications = await Notification.countDocuments();
        const orphanedNotifications = await Notification.countDocuments({
            $or: [
                { sender: { $exists: false } },
                { recipient: { $exists: false } }
            ]
        });
        console.log(`🔔 Notifications: ${totalNotifications} total, ${orphanedNotifications} orphaned`);

        // Check Follows
        const totalFollows = await Follow.countDocuments();
        const orphanedFollows = await Follow.countDocuments({
            $or: [
                { follower: { $exists: false } },
                { following: { $exists: false } }
            ]
        });
        console.log(`👥 Follows: ${totalFollows} total, ${orphanedFollows} orphaned`);

        // Check Groups
        const totalGroups = await Group.countDocuments();
        const orphanedGroups = await Group.countDocuments({
            creator: { $exists: false }
        });
        console.log(`👥 Groups: ${totalGroups} total, ${orphanedGroups} orphaned`);

        // Check Group Messages
        const totalGroupMessages = await GroupMessage.countDocuments();
        const orphanedGroupMessages = await GroupMessage.countDocuments({
            sender: { $exists: false }
        });
        console.log(`💬 Group Messages: ${totalGroupMessages} total, ${orphanedGroupMessages} orphaned`);

        // Check Events
        const totalEvents = await Event.countDocuments();
        const orphanedEvents = await Event.countDocuments({
            creator: { $exists: false }
        });
        console.log(`📅 Events: ${totalEvents} total, ${orphanedEvents} orphaned`);

        // Check Reports
        const totalReports = await Report.countDocuments();
        const orphanedReports = await Report.countDocuments({
            reporter: { $exists: false }
        });
        console.log(`🚨 Reports: ${totalReports} total, ${orphanedReports} orphaned`);

        // Check Payments
        const totalPayments = await Payment.countDocuments();
        const orphanedPayments = await Payment.countDocuments({
            user: { $exists: false }
        });
        console.log(`💰 Payments: ${totalPayments} total, ${orphanedPayments} orphaned`);

        // Check Push Subscriptions
        const totalPushSubscriptions = await PushSubscription.countDocuments();
        const orphanedPushSubscriptions = await PushSubscription.countDocuments({
            user: { $exists: false }
        });
        console.log(`📱 Push Subscriptions: ${totalPushSubscriptions} total, ${orphanedPushSubscriptions} orphaned`);

        // Check Help Center Messages
        const totalHelpMessages = await HelpCenterMessage.countDocuments();
        const orphanedHelpMessages = await HelpCenterMessage.countDocuments({
            user: { $exists: false }
        });
        console.log(`❓ Help Messages: ${totalHelpMessages} total, ${orphanedHelpMessages} orphaned`);

        // Check Event Reads
        const totalEventReads = await EventRead.countDocuments();
        const orphanedEventReads = await EventRead.countDocuments({
            user: { $exists: false }
        });
        console.log(`👁️ Event Reads: ${totalEventReads} total, ${orphanedEventReads} orphaned`);

        // Check User Settings
        const totalUserSettings = await UserSettings.countDocuments();
        const orphanedUserSettings = await UserSettings.countDocuments({
            user: { $exists: false }
        });
        console.log(`⚙️ User Settings: ${totalUserSettings} total, ${orphanedUserSettings} orphaned`);

        console.log('\n' + '=' .repeat(50));
        console.log('✅ Database health check completed!');

        // Check for suspicious patterns
        console.log('\n🔍 SUSPICIOUS PATTERN ANALYSIS');
        console.log('=' .repeat(50));

        // Check for users with suspicious usernames
        const suspiciousUsers = await User.countDocuments({
            username: { $regex: /^(bot|fake|test|spam|user\d+)$/i }
        });
        console.log(`🤖 Users with suspicious usernames: ${suspiciousUsers}`);

        // Check for users with empty fullName
        const emptyFullNameUsers = await User.countDocuments({
            $or: [
                { fullName: { $exists: false } },
                { fullName: '' },
                { fullName: null }
            ]
        });
        console.log(`📝 Users with empty fullName: ${emptyFullNameUsers}`);

        // Check for users with suspicious email domains
        const suspiciousEmailUsers = await User.countDocuments({
            email: { $regex: /@(test|fake|bot|spam|temp|example)\./i }
        });
        console.log(`📧 Users with suspicious email domains: ${suspiciousEmailUsers}`);

        // Check for recent registrations (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentUsers = await User.countDocuments({
            createdAt: { $gte: oneDayAgo }
        });
        console.log(`🕐 Users registered in last 24 hours: ${recentUsers}`);

        console.log('\n' + '=' .repeat(50));
        console.log('✅ Analysis completed!');

    } catch (error) {
        console.error('❌ Error during collection check:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run the check
checkAllCollections(); 