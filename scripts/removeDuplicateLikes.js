require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../models/Post');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const posts = await Post.find({});
  for (const post of posts) {
    const uniqueLikes = [...new Set(post.likes.map(id => id.toString()))];
    if (uniqueLikes.length !== post.likes.length) {
      post.likes = uniqueLikes;
      await post.save();
      console.log(`Cleaned duplicates for post: ${post._id}`);
    }
  }
  console.log('Done!');
  process.exit();
})(); 