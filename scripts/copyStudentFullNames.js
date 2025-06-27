// copyStudentFullNames.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');

async function migrateFullNames() {
  const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/YOUR_DB_NAME';
  await mongoose.connect(mongodbUri);
  const students = await Student.find().populate('user');
  for (const student of students) {
    if (student.user && student.fullName) {
      await User.updateOne({ _id: student.user._id }, { $set: { fullName: student.fullName } });
    }
  }
  await mongoose.disconnect();
  console.log('Full names migrated!');
}

migrateFullNames(); 