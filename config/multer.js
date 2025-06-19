const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinary');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'mbmconnect',
    resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image',
  }),
});

const upload = multer({ storage: storage });

module.exports = upload; 