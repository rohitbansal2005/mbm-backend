const mongoose = require('mongoose');
const User = require('../models/User');

// Replace with your MongoDB URI if needed
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mbmconnect.render.com/mbmconnect';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

async function addReferralFields() {
  try {
    const result = await User.updateMany(
      { $or: [
        { referralCount: { $exists: false } },
        { referredBy: { $exists: false } },
        { studentCornerUnlocked: { $exists: false } }
      ] },
      { $set: { referralCount: 0, referredBy: null, studentCornerUnlocked: false } }
    );
    console.log(`Updated ${result.nModified || result.modifiedCount} users with referral fields.`);
  } catch (err) {
    console.error('Error updating users:', err);
  } finally {
    mongoose.disconnect();
  }
}

addReferralFields(); 