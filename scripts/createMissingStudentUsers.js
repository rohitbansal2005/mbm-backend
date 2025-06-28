const mongoose = require('mongoose');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@rkbansalclusters.w5yilhm.mongodb.net/mbmconnect`;

async function createMissingStudentUsers() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        // Read missing students list
        const missing = JSON.parse(fs.readFileSync('missing-student-users.json', 'utf-8'));
        if (!missing.length) {
            console.log('✅ No missing users to create.');
            return;
        }
        console.log(`👤 Creating ${missing.length} missing users...`);

        const created = [];
        const failed = [];
        for (const s of missing) {
            try {
                // Generate username from email or fallback
                let baseUsername = (s.email && s.email.split('@')[0]) || s.fullName.replace(/\s+/g, '').toLowerCase() || 'user';
                let username = baseUsername;
                let i = 1;
                // Ensure username is unique
                while (await User.findOne({ username })) {
                    username = `${baseUsername}${i}`;
                    i++;
                }
                // Hash default password
                const password = await bcrypt.hash('MBM@2024', 10);
                // Create user
                const user = new User({
                    _id: s.userId, // Use the same ObjectId as student.user
                    username,
                    email: s.email,
                    fullName: s.fullName,
                    password,
                    isVerified: true,
                    isApproved: true,
                    registrationDate: new Date(),
                    role: 'user'
                });
                await user.save();
                created.push({ username, email: s.email, userId: s.userId });
                console.log(`✅ Created user: ${username} (${s.email})`);
            } catch (err) {
                failed.push({ student: s, error: err.message });
                console.error(`❌ Failed to create user for student ${s.fullName} (${s.email}): ${err.message}`);
            }
        }
        console.log(`\n🎉 Created ${created.length} users for missing students.`);
        if (failed.length > 0) {
            console.log(`❌ Failed to create ${failed.length} users. See details below:`);
            failed.forEach((f, i) => {
                console.log(`${i + 1}. Student: ${f.student.fullName} | Email: ${f.student.email} | Error: ${f.error}`);
            });
        }
    } catch (error) {
        console.error('❌ Error creating missing users:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

createMissingStudentUsers(); 