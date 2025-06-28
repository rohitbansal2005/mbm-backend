const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function checkRealUsers() {
  try {
    console.log('👥 CHECKING REAL USERS...\n');
    
    // Get first 20 users to show
    const firstUsers = await User.find().sort({ createdAt: 1 }).limit(20).select('username email fullName createdAt');
    
    console.log('First 20 users (oldest first):');
    console.log('================================');
    
    firstUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username} (${user.email})`);
      console.log(`   Full Name: ${user.fullName || 'Empty'}`);
      console.log(`   Created: ${user.createdAt}`);
      console.log('');
    });
    
    // Get total count
    const totalUsers = await User.countDocuments();
    console.log(`Total users in database: ${totalUsers}`);
    
    console.log('\n❓ QUESTION:');
    console.log('Which user number is the LAST real user?');
    console.log('(e.g., if user 15 is the last real one, type 15)');
    
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    mongoose.connection.close();
  }
}

checkRealUsers(); 