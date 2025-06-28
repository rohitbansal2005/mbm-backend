const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// List of suspicious usernames to delete
const suspiciousUsernames = [
  'radhachokshi77',
  'Jaya_Gowda_228', 
  'Leela89Joshi',
  'falgunimodi48',
  'mayankdalmia69',
  'Harsha_Bhardwaj_614',
  'GarimaBhatia4139',
  'Akash_Surana_903',
  'ManePalak72',
  'Avadhi_Sharma',
  'Rudrakshi',
  'Arya_More_242',
  'ParekhAbhishek65',
  'GargYamini69',
  'Pradeep631Srivastava',
  'tanishgandhi19',
  'Vicky_Jana_295',
  'YadavAditi98',
  'SachinChopra2221',
  'Yash_Kadam_22',
  'AakRat5091',
  'DivyaJadhav1880',
  'KambleAkhil63',
  'ChauhanHarsh22',
  'BoseMaya30',
  'YashikaJoshi2757',
  'BhattacharyaPranav11',
  'TandonVicky76',
  'LeelaRoy8803',
  'Manish811Kelkar'
];

// List of suspicious email domains
const suspiciousEmailDomains = [
  'tutanota.com',
  'fastmail.com',
  'zoho.com',
  'yandex.com',
  'msn.com',
  'rediffmail.com',
  'yahoo.co.in',
  'yahoo.com',
  'aol.com',
  'protonmail.com'
];

async function deleteFakeAccounts() {
  try {
    console.log('Starting fake account cleanup...');
    
    // Delete by suspicious usernames
    const usernameResult = await User.deleteMany({
      username: { $in: suspiciousUsernames }
    });
    console.log(`Deleted ${usernameResult.deletedCount} accounts by suspicious usernames`);
    
    // Delete by suspicious email domains
    const emailResult = await User.deleteMany({
      email: { $regex: `@(${suspiciousEmailDomains.join('|')})$` }
    });
    console.log(`Deleted ${emailResult.deletedCount} accounts by suspicious email domains`);
    
    // Delete accounts with empty fullName and created recently (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEmptyResult = await User.deleteMany({
      fullName: { $in: ['', null] },
      createdAt: { $gte: oneDayAgo }
    });
    console.log(`Deleted ${recentEmptyResult.deletedCount} recent accounts with empty fullName`);
    
    // Delete accounts with suspicious patterns in username
    const suspiciousPatternResult = await User.deleteMany({
      username: { 
        $regex: /^(.*?)(\d{2,4})$|^(\w+)_(\w+)_(\d{3,4})$/ 
      }
    });
    console.log(`Deleted ${suspiciousPatternResult.deletedCount} accounts with suspicious username patterns`);
    
    console.log('Fake account cleanup completed!');
    
  } catch (error) {
    console.error('Error deleting fake accounts:', error);
  } finally {
    mongoose.connection.close();
  }
}

deleteFakeAccounts(); 