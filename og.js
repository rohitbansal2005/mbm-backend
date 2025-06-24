const express = require('express');
const router = express.Router();
const Post = require('./models/Post');
const User = require('./models/User');

router.get('/og/post/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('author');
    if (!post) return res.status(404).send('Post not found');

    const defaultImage = 'https://mbmconnect.onrender.com/logo192.png'; // Replace with your actual domain
    let imageUrl = defaultImage;
    if (post.media) {
      imageUrl = post.media.startsWith('http')
        ? post.media
        : `https://mbmconnect.onrender.com/${post.media.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`;
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>${post.author?.username} on MBM Connect: ${post.content?.slice(0, 40)}...</title>
        <meta property="og:title" content="${post.author?.username} on MBM Connect" />
        <meta property="og:description" content="${post.content}" />
        <meta property="og:image" content="${imageUrl}" />
        <meta property="og:url" content="https://mbmconnect.onrender.com/post/${post._id}" />
        <meta property="og:type" content="article" />
      </head>
      <body>
        <h1>${post.author?.username} on MBM Connect</h1>
        <p>${post.content}</p>
        <img src="${imageUrl}" alt="Post image" style="max-width:400px;" />
        <p><a href="https://mbmconnect.onrender.com/post/${post._id}">View Post</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

module.exports = router; 