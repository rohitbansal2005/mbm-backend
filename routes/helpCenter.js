const express = require('express');
const router = express.Router();
const HelpCenterMessage = require('../models/HelpCenterMessage');
const Report = require('../models/Report');

// Dummy Help Center Data
const helpCenterData = [
    { id: 1, title: 'FAQ', link: '/faq' },
    { id: 2, title: 'Contact Us', link: '/contact' },
    { id: 3, title: 'Support', link: '/support' },
];

// GET Help Center Data
router.get('/', (req, res) => {
    res.json(helpCenterData);
});

// Dummy data for FAQs with category field
const faqs = [
  {
    id: 1,
    question: "How do I reset my password?",
    answer: "Go to the Login page and click on 'Forgot Password'. Follow the instructions sent to your registered email to reset your password.",
    category: "Account"
  },
  {
    id: 2,
    question: "How can I update my profile picture?",
    answer: "Visit your Profile page, click on your current picture, and upload a new image. Changes will be saved automatically.",
    category: "Account"
  },
  {
    id: 3,
    question: "How do I join a group?",
    answer: "Go to the Groups page, browse or search for a group, and click 'Join'. If the group is private, your request will be sent to the group admin for approval.",
    category: "Groups"
  },
  {
    id: 4,
    question: "How do I create a new group?",
    answer: "On the Groups page, click 'Create Group', fill in the details, and submit. Only admins can create new groups.",
    category: "Groups"
  },
  {
    id: 5,
    question: "How can I join an announcement?",
    answer: "Go to the Announcements page, select the announcement you are interested in, and click 'Join' or 'Acknowledge'. You will be added to the announcement participants list if required.",
    category: "Announcements"
  },
  {
    id: 6,
    question: "How do I report a problem or contact support?",
    answer: "Use the 'Contact Support' form at the bottom of this Help Center page. Fill in your name, email, and message, then click 'Send Message'. Our support team will get back to you soon.",
    category: "Support"
  },
  {
    id: 7,
    question: "How do I change my privacy or notification settings?",
    answer: "Go to the Settings page from the sidebar. Here you can update your privacy, notification, and appearance preferences.",
    category: "Account"
  },
  {
    id: 8,
    question: "Who can see my online status?",
    answer: "Only users who have enabled 'Show Online Status' in their settings will appear online to others. You can control this in your Settings page.",
    category: "Account"
  }
];

// GET all FAQs
router.get('/faqs', (req, res) => {
  res.json(faqs);
});

// POST /api/help-center/message
router.post('/message', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  try {
    await HelpCenterMessage.create({ name, email, message });

    // Also save as admin user report
    let reporter = null;
    if (req.user && req.user._id) {
      reporter = req.user._id;
    }
    await Report.create({
      reporter,
      itemType: 'Help',
      reason: 'Other',
      description: message
    });
    res.json({ success: true, msg: 'Your message has been sent to admin!' });
  } catch (err) {
    console.error('Help Center Report Error:', err);
    res.status(500).json({ error: 'Failed to save message.' });
  }
});

// GET all user queries/messages (admin only)
router.get('/messages', async (req, res) => {
  // TODO: Add admin authentication middleware here!
  try {
    const allMessages = await HelpCenterMessage.find().sort({ createdAt: -1 });
    res.json(allMessages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

module.exports = router;