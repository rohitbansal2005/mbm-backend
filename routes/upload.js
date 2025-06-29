const express = require('express');
const router = express.Router();
const upload = require('../config/multer');

// For image upload (profile, post, event, group)
router.post('/image', upload.single('file'), (req, res) => {
  res.json({ url: req.file.path });
});

// For video upload
router.post('/video', upload.single('file'), (req, res) => {
  res.json({ url: req.file.path });
});

// For general file upload
router.post('/file', upload.single('file'), (req, res) => {
  res.json({ url: req.file.path });
});

module.exports = router; 