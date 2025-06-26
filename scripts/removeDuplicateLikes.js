require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../models/Post');

// Use environment variable for MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable not set.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const posts = await Post.find({});
    for (let post of posts) {
      if (post.likes && post.likes.length > 0) {
        const uniqueLikes = [...new Set(post.likes.map(id => id.toString()))];
        if (uniqueLikes.length !== post.likes.length) {
          post.likes = uniqueLikes;
          await post.save();
          console.log(`Cleaned post: ${post._id}`);
        }
      }
    }
    console.log('Duplicate likes removed!');
    mongoose.disconnect();
  })
  .catch(err => {
    console.error(err);
    mongoose.disconnect();
  }); 