const mongoose = require('mongoose');
const fs = require('fs');
const Student = require('../models/Student');
const User = require('../models/User');
require('dotenv').config();

const mongoURI = process.env.MONGODB_URI || `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@rkbansalclusters.w5yilhm.mongodb.net/mbmconnect`;

async function checkStudentUserSync() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB');

        const students = await Student.find({});
        console.log(`🎓 Total students: ${students.length}`);

        let missingUsers = [];
        for (const student of students) {
            const user = await User.findById(student.user);
            if (!user) {
                missingUsers.push({
                    studentId: student._id,
                    fullName: student.fullName,
                    email: student.email,
                    userId: student.user
                });
            }
        }

        if (missingUsers.length === 0) {
            console.log('✅ All students have corresponding user records.');
        } else {
            console.log(`❌ ${missingUsers.length} students do not have corresponding user records.`);
            fs.writeFileSync('missing-student-users.json', JSON.stringify(missingUsers, null, 2));
            console.log('📄 List saved to missing-student-users.json');
        }
    } catch (error) {
        console.error('❌ Error during student-user sync check:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

checkStudentUserSync(); 