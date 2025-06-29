const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mbmconnect';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

async function resetUserPassword() {
  try {
    console.log('🔧 Resetting user password...\n');
    
    const email = 'rohitbansal23rk@gmail.com';
    const newPassword = 'Rkb@2007';
    
    // Find the user
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found!');
      return;
    }
    
    console.log('✅ User found:', user.username);
    console.log('Old password hash:', user.password.substring(0, 20) + '...');
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    console.log('New password hash:', hashedPassword.substring(0, 20) + '...');
    
    // Update the user's password
    user.password = hashedPassword;
    user.passwordChangedAt = new Date();
    user.lastPasswordChange = new Date();
    
    await user.save();
    
    console.log('✅ Password updated successfully!');
    console.log('New password:', newPassword);
    console.log('You can now login with this password.');
    
    // Verify the password works
    const isMatch = await bcrypt.compare(newPassword, user.password);
    console.log('Verification:', isMatch ? '✅ Password works!' : '❌ Password does not work!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.disconnect();
    console.log('\n🔚 Disconnected from MongoDB');
  }
}

resetUserPassword(); 