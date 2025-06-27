const mongoose = require('mongoose');
const User = require('../models/User');
const nodemailer = require('nodemailer');

// TODO: Replace with your actual credentials and DB string
const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME';
const EMAIL_USER = 'your-email@gmail.com';
const EMAIL_PASS = 'your-app-password';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

async function sendPremiumEmail(user) {
  const mailOptions = {
    from: EMAIL_USER,
    to: user.email,
    subject: 'Congratulations! You are now a Premium Member 🎉',
    text: `Hi ${user.fullName || user.username},\n\nYou have been awarded the Premium badge on MBM Connect! Enjoy your premium features.\n\nThank you for being awesome!\n\n- MBM Connect Team`
  };
  await transporter.sendMail(mailOptions);
}

async function processPremiumEmails() {
  await mongoose.connect(MONGO_URI);
  const users = await User.find({ isPremium: true, premiumEmailSent: { $ne: true } });
  for (const user of users) {
    try {
      await sendPremiumEmail(user);
      user.premiumEmailSent = true;
      await user.save();
      console.log(`Premium email sent to ${user.email}`);
    } catch (err) {
      console.error(`Failed to send email to ${user.email}:`, err);
    }
  }
  await mongoose.disconnect();
}

// Run once when script is executed
processPremiumEmails().then(() => {
  console.log('Done processing premium emails.');
  process.exit(0);
}); 