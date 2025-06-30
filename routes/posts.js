const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const User = require('../models/User');
const sharp = require('sharp');
const Report = require('../models/Report');
const createNotification = require('../utils/createNotification');
// Use Cloudinary multer config for uploads
const upload = require('../config/multer');
const Filter = require('bad-words');
const filter = new Filter();
const isBlocked = require('../utils/isBlocked');
const { sendPushNotificationToUser } = require('../utils/webPush');
const rateLimit = require('express-rate-limit');

// In-memory array for demo (use DB in production)
const postReports = [];

// Strict rate limiting for post creation to prevent bot spam
const postLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // limit each IP to 3 posts per 5 minutes
  message: 'Too many posts created. Please wait 5 minutes before posting again.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper for deep population of comments and replies
const deepPopulateComments = async (postOrPosts) => {
  const isArray = Array.isArray(postOrPosts);
  const posts = isArray ? postOrPosts : [postOrPosts];
  await Promise.all(posts.map(async (post) => {
    try {
      await post.populate({
        path: 'comments.author',
        select: 'username fullName profilePicture avatar role isPremium badgeType'
      });
      await post.populate({
        path: 'comments.replies.author',
        select: 'username fullName profilePicture avatar role isPremium badgeType'
      });
    } catch (err) {
      console.error('Error populating comments or replies:', err);
    }
  }));
  return isArray ? posts : posts[0];
};

// Get all posts
router.get('/', async (req, res) => {
    try {
        console.log('Fetching all posts...');
        const page = parseInt(req.query.page) || 1;
        const limit = req.query.limit ? parseInt(req.query.limit) : 0; // 0 means no limit in MongoDB
        const skip = (page - 1) * (limit || 0);

        const posts = await Post.find({ author: { $exists: true, $ne: null } })
            .populate('author', 'username fullName profilePicture avatar role isPremium badgeType')
            .populate('likes', 'username fullName profilePicture avatar isPremium badgeType')
            .populate({
                path: 'comments.author',
                select: 'username fullName profilePicture avatar role isPremium badgeType'
            })
            .populate({
                path: 'comments.replies.author',
                select: 'username fullName profilePicture avatar role isPremium badgeType'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit) // if limit is 0, MongoDB returns all
            .lean();
        
        // Filter out posts where author population failed
        const validPosts = posts.filter(post => post.author && post.author._id);
        // Filter out posts where requester is blocked by author or has blocked author
        const requesterId = req.user?._id;
        let filteredPosts = validPosts;
        if (requesterId) {
            filteredPosts = validPosts.filter(post => {
                // Block check: skip post if either user has blocked the other
                if (!post.author._id) return false;
                const authorId = post.author._id.toString();
                if (authorId === requesterId.toString()) return true;
                // Use isBlocked utility synchronously (assume it is async, so use Promise.all below if needed)
                return true; // Will filter below if needed
            });
            // Actually filter with async isBlocked
            const blockChecks = await Promise.all(filteredPosts.map(async post => {
                const authorId = post.author._id.toString();
                if (authorId === requesterId.toString()) return true;
                const blocked1 = await isBlocked(requesterId, authorId);
                const blocked2 = await isBlocked(authorId, requesterId);
                return !(blocked1 || blocked2);
            }));
            filteredPosts = filteredPosts.filter((_, idx) => blockChecks[idx]);
        }
        res.json(filteredPosts);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ 
            message: error.message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

// Create post with AI content moderation
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { content } = req.body;
    const userId = req.user.id;

    // AI Content Analysis
    let contentAnalysis = null;
    if (content) {
      contentAnalysis = req.aiSecurity?.textAnalysis;
      
      // If content is flagged as harmful, reject the post
      if (contentAnalysis && !contentAnalysis.safe) {
        return res.status(400).json({
          message: 'Post contains inappropriate content and cannot be published.',
          flags: contentAnalysis.flags,
          score: contentAnalysis.score
        });
      }
    }

    // Check user behavior risk
    const behaviorAnalysis = req.aiSecurity?.behavior;
    if (behaviorAnalysis && behaviorAnalysis.isSuspicious) {
      return res.status(429).json({
        message: 'Posting temporarily restricted due to suspicious activity.',
        riskScore: behaviorAnalysis.riskScore
      });
    }

    // Create post
    const post = new Post({
      author: req.user._id,
      content,
      image: req.file ? req.file.filename : null,
      aiAnalysis: {
        contentScore: contentAnalysis?.score || 100,
        contentFlags: contentAnalysis?.flags || [],
        behaviorScore: behaviorAnalysis?.riskScore || 0,
        behaviorFlags: behaviorAnalysis?.flags || []
      }
    });

    await post.save();

    // Populate user data
    await post.populate('author', 'username fullName profilePicture badgeType');

    // Emit socket event for new post
    const io = req.app.get('io');
    if (io) {
      io.emit('newPost', post);
    }

    res.status(201).json({
      message: 'Post created successfully',
      post,
      aiAnalysis: {
        contentSafe: contentAnalysis?.safe !== false,
        contentScore: contentAnalysis?.score || 100,
        behaviorScore: behaviorAnalysis?.riskScore || 0
      }
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ message: 'Failed to create post' });
  }
});

// Like/Unlike a post
router.put('/:id/like', auth, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        // Block check: don't allow like if either user has blocked the other
        const authorId = post.author.toString();
        const requesterId = req.user._id.toString();
        if (await isBlocked(requesterId, authorId) || await isBlocked(authorId, requesterId)) {
            return res.status(403).json({ message: 'You cannot like this post.' });
        }
        
        // Remove all existing likes by this user (cleanup in case of duplicates)
        post.likes = post.likes.filter(id => id.toString() !== req.user._id.toString());
        
        // Like or Unlike logic
        if (req.body.like === true) {
            post.likes.push(req.user._id);
            // Create notification for like (only if not liking own post)
            if (post.author.toString() !== req.user._id.toString()) {
                try {
                    await createNotification(
                        post.author,
                        req.user._id,
                        'post_like',
                        `${req.user.username} liked your post`,
                        post._id,
                        'Post'
                    );
                    await sendPushNotificationToUser(
                        post.author,
                        {
                            title: 'New Like',
                            body: `${req.user.username} liked your post`,
                            icon: '/mbmlogo.png',
                            data: { url: '/post/' + post._id }
                        }
                    );
                } catch (notificationError) {
                    console.error('Failed to create like notification:', notificationError);
                    // Don't fail the request if notification creation fails
                }
            }
        }
        // else: user is unliking, so don't add back

        const updatedPost = await post.save();
        await updatedPost.populate('author', 'username fullName profilePicture avatar role isPremium badgeType');
        await updatedPost.populate('likes', 'username fullName profilePicture avatar isPremium badgeType');
        res.json(updatedPost);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Add a comment
router.post('/:id/comment', auth, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        // Block check: don't allow comment if either user has blocked the other
        const authorId = post.author.toString();
        const requesterId = req.user._id.toString();
        if (await isBlocked(requesterId, authorId) || await isBlocked(authorId, requesterId)) {
            return res.status(403).json({ message: 'You cannot comment on this post.' });
        }

        if (filter.isProfane(req.body.text)) {
            return res.status(400).json({ message: 'Inappropriate language is not allowed in comments.' });
        }

        post.comments.push({
            text: req.body.text,
            author: req.user._id,
            createdAt: new Date()
        });

        const updatedPost = await post.save();
        // Get the new comment (last in array)
        const newComment = updatedPost.comments[updatedPost.comments.length - 1];
        // Populate author for the post and comments
        await updatedPost.populate('author', 'username fullName profilePicture avatar role isPremium badgeType');
        await updatedPost.populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType');
        // Emit socket event for new comment
        const io = req.app.get('io');
        if (io) {
            io.emit('commentAdded', { postId: req.params.id, comment: newComment });
        }
        // Create notification for comment (only if not commenting on own post)
        if (post.author.toString() !== req.user._id.toString()) {
            try {
                await createNotification(
                    post.author,
                    req.user._id,
                    'post_comment',
                    `${req.user.username} commented on your post`,
                    post._id,
                    'Post'
                );
                await sendPushNotificationToUser(
                    post.author,
                    {
                        title: 'New Comment',
                        body: `${req.user.username} commented on your post`,
                        icon: '/mbmlogo.png',
                        data: { url: '/post/' + post._id }
                    }
                );
            } catch (notificationError) {
                console.error('Failed to create comment notification:', notificationError);
                // Don't fail the request if notification creation fails
            }
        }
        res.json(updatedPost);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Delete a post
router.delete('/:id', auth, async (req, res) => {
    try {
        console.log('=== Delete Post Request ===');
        console.log('Post ID:', req.params.id);
        console.log('User from auth:', req.user);
        console.log('Auth token:', req.headers.authorization ? '[HIDDEN]' : 'none');

        if (!req.user || !req.user._id) {
            console.log('No user found in request');
            return res.status(401).json({ message: 'Authentication required' });
        }

        const post = await Post.findById(req.params.id);
        console.log('Found post:', {
            id: post?._id,
            author: post?.author,
            content: post?.content?.substring(0, 50) + '...'
        });

        if (!post) {
            console.log('Post not found');
            return res.status(404).json({ message: 'Post not found' });
        }

        // Debug: Log types and string values
        console.log('Comparing for delete:', {
            postAuthor: post.author,
            postAuthorType: typeof post.author,
            postAuthorStr: post.author.toString(),
            userId: req.user._id,
            userIdType: typeof req.user._id,
            userIdStr: req.user._id.toString(),
            isMatch: post.author.toString() === req.user._id.toString()
        });

        // Only allow the author to delete
        if (post.author.toString() !== req.user._id.toString()) {
            console.log('Authorization failed:', {
                postAuthor: post.author.toString(),
                userId: req.user._id.toString()
            });
            return res.status(403).json({ message: 'Not authorized to delete this post' });
        }

        console.log('Attempting to delete post...');
        const deletedPost = await Post.findByIdAndDelete(req.params.id);
        console.log('Delete result:', deletedPost);

        if (!deletedPost) {
            console.log('Post deletion failed - no post returned');
            return res.status(404).json({ message: 'Post not found or already deleted' });
        }

        // Emit Socket.IO event for post deletion
        const io = req.app.get('io');
        if (io) {
            io.emit('postDeleted', { postId: deletedPost._id });
        }

        console.log('Post deleted successfully');
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error('Error in delete post route:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({ 
            message: 'Error deleting post',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Edit/Update a post
router.put('/:id', auth, async (req, res) => {
    try {
        console.log('=== Edit Post Request ===');
        console.log('Post ID:', req.params.id);
        console.log('User from auth:', req.user);
        console.log('Auth token:', req.headers.authorization ? '[HIDDEN]' : 'none');

        if (!req.user || !req.user._id) {
            console.log('No user found in request');
            return res.status(401).json({ message: 'Authentication required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            console.log('Post not found');
            return res.status(404).json({ message: 'Post not found' });
        }

        console.log('Found post:', {
            id: post._id,
            author: post.author,
            content: post.content?.substring(0, 50) + '...'
        });

        // Convert both IDs to strings for comparison
        const postAuthorId = post.author.toString();
        const userId = req.user._id.toString();

        console.log('Comparing IDs:', {
            postAuthorId,
            userId,
            isMatch: postAuthorId === userId
        });

        if (postAuthorId !== userId) {
            console.log('Authorization failed:', {
                postAuthor: postAuthorId,
                userId: userId
            });
            return res.status(403).json({ message: 'Not authorized to edit this post' });
        }

        if (req.body.content !== undefined) post.content = req.body.content;
        if (req.body.media !== undefined) post.media = req.body.media;
        if (req.body.mediaType !== undefined) post.mediaType = req.body.mediaType;
        post.edited = true;
        post.editedAt = new Date();

        console.log('Attempting to save post...');
        const updatedPost = await post.save();
        console.log('Post saved successfully');

        await updatedPost.populate('author', 'username fullName profilePicture avatar role isPremium badgeType');
        res.json(updatedPost);
    } catch (error) {
        console.error('Error in edit post route:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(400).json({ message: error.message });
    }
});

// Delete a comment
router.delete('/:postId/comment/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    console.log('Delete comment:', {
      commentAuthor: comment.author,
      postAuthor: post.author,
      reqUser: req.user._id,
      commentMatch: comment.author.toString() === req.user._id.toString(),
      postMatch: post.author.toString() === req.user._id.toString()
    });
    if (
      comment.author.toString() !== req.user._id.toString() &&
      post.author.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    // Remove comment (fix for Mongoose 6+)
    post.comments = post.comments.filter(
      c => c._id.toString() !== req.params.commentId
    );
    await post.save();
    await post.populate('author', 'username fullName profilePicture avatar role isPremium badgeType');
    await post.populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType');
    // Emit socket event for comment deletion
    const io = req.app.get('io');
    if (io) {
      io.emit('commentDeleted', { postId: req.params.postId, commentId: req.params.commentId });
    }
    res.json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Edit a comment
router.put('/:postId/comment/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    console.log('Edit comment:', {
      commentAuthor: comment.author,
      reqUser: req.user._id,
      isMatch: comment.author.toString() === req.user._id.toString()
    });
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to edit this comment' });
    }
    comment.text = req.body.text;
    comment.edited = true;
    comment.editedAt = new Date();
    await post.save();
    await post.populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType');
    // Emit socket event for comment edit
    const io = req.app.get('io');
    if (io) {
      io.emit('commentEdited', { postId: req.params.postId, comment });
    }
    res.json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Report a post
router.post('/:id/report', auth, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        // Validate reason and description
        const allowedReasons = [
            'Spam',
            'Inappropriate Content',
            'Harassment',
            'Hate Speech',
            'Violence',
            'Other'
        ];
        const { reason, description } = req.body;
        if (!reason || !allowedReasons.includes(reason)) {
            return res.status(400).json({ message: 'Invalid or missing reason. Allowed: ' + allowedReasons.join(', ') });
        }
        if (!description || description.length < 10 || description.length > 500) {
            return res.status(400).json({ message: 'Description is required (10-500 chars).' });
        }
        // Save to Report collection for admin
        await Report.create({
            reporter: req.user._id,
            reportedItem: post._id,
            itemType: 'Post',
            reason,
            description
        });
        res.json({ message: 'Post reported successfully' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Get all post reports (admin only)
router.get('/reports/all', (req, res) => {
    // TODO: Add admin authentication middleware here!
    res.json(postReports);
});

// Get posts by user ID
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { userId } = req.params;
    const requesterId = req.user._id;
    console.log('--- [DEBUG] Fetching posts for user:', userId, 'by requester:', requesterId);

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log('[DEBUG] Invalid user ID');
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Fetch student profile to check privacy settings
    const studentProfile = await require('../models/Student').findOne({ user: userId });
    if (studentProfile) {
      // Ensure both IDs are strings for comparison
      const requesterIdStr = requesterId.toString();
      const userIdStr = userId.toString();
      const isOwner = requesterIdStr === userIdStr;
      console.log('[DEBUG] Owner check:', { requesterIdStr, userIdStr, isOwner });
      const privacySetting = studentProfile.privacy?.profile || 'public';
      let canView = false;
      console.log('[DEBUG] Privacy setting:', privacySetting, '| isOwner:', isOwner);

      if (isOwner) {
        canView = true;
        console.log('[DEBUG] Requester is owner, can view posts');
      } else {
        switch (privacySetting) {
          case 'public':
            canView = true;
            console.log('[DEBUG] Profile is public, can view posts');
            break;
          case 'friends':
            const Follow = require('../models/Follow');
            const userFollowsTarget = await Follow.findOne({ follower: requesterId, following: userId, status: 'accepted' });
            const targetFollowsUser = await Follow.findOne({ follower: userId, following: requesterId, status: 'accepted' });
            console.log('[DEBUG] Friends privacy:', { userFollowsTarget: !!userFollowsTarget, targetFollowsUser: !!targetFollowsUser });
            if (userFollowsTarget && targetFollowsUser) {
              canView = true;
              console.log('[DEBUG] Mutual follow, can view posts');
            }
            break;
          case 'private':
            const FollowModel = require('../models/Follow');
            const isFollower = await FollowModel.findOne({ follower: requesterId, following: userId, status: 'accepted' });
            console.log('[DEBUG] Private privacy, isFollower:', !!isFollower);
            if (isFollower) {
              canView = true;
              console.log('[DEBUG] Requester is follower, can view posts');
            }
            break;
        }
      }
      if (!canView) {
        console.log('[DEBUG] Not allowed to view posts. Returning 403.');
        return res.status(403).json({ message: 'This user\'s posts are private.' });
      }
    } else {
      console.log('[DEBUG] No student profile found, allowing posts (legacy user)');
    }
    // If no student profile, allow (legacy users)
    const posts = await Post.find({ author: userId })
      .populate('author', 'username fullName profilePicture avatar role isPremium badgeType')
      .populate('likes', 'username fullName profilePicture avatar isPremium badgeType')
      .populate({
        path: 'comments.author',
        select: 'username fullName profilePicture avatar role isPremium badgeType'
      })
      .populate({
        path: 'comments.replies.author',
        select: 'username fullName profilePicture avatar role isPremium badgeType'
      })
      .sort({ createdAt: -1 });
    console.log('[DEBUG] Returning', posts.length, 'posts');
    await deepPopulateComments(posts);
    res.json(posts);
  } catch (error) {
    console.error('Error fetching user posts:', error);
    res.status(500).json({ 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
});

// Save a post
router.post('/:id/save', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const user = await User.findById(req.user._id);
    if (!user.savedPosts.includes(post._id)) {
      user.savedPosts.push(post._id);
      await user.save();
    }

    res.json({ message: 'Post saved successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Unsave a post
router.post('/:id/unsave', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const user = await User.findById(req.user._id);
    user.savedPosts = user.savedPosts.filter(id => id.toString() !== post._id.toString());
    await user.save();

    res.json({ message: 'Post unsaved successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get saved posts
router.get('/saved', auth, async (req, res) => {
    try {
        console.log('Fetching saved posts for user:', req.user._id);
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const savedPosts = await Post.find({
            _id: { $in: user.savedPosts }
        })
        .populate('author', 'username fullName profilePicture avatar role isPremium badgeType')
        .populate('likes', 'username fullName profilePicture avatar isPremium badgeType')
        .populate({
            path: 'comments.author',
            select: 'username fullName profilePicture avatar role isPremium badgeType'
        })
        .populate({
            path: 'comments.replies.author',
            select: 'username fullName profilePicture avatar role isPremium badgeType'
        })
        .sort({ createdAt: -1 });

        console.log(`Found ${savedPosts.length} saved posts`);
        await deepPopulateComments(savedPosts);
        res.json(savedPosts);
    } catch (error) {
        console.error('Error fetching saved posts:', error);
        res.status(500).json({ 
            message: error.message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

// Get trending topics
router.get('/trending', async (req, res) => {
  try {
    const posts = await Post.find({}, 'content');
    const hashtags = {};
    
    // Extract hashtags from posts
    posts.forEach(post => {
      const matches = post.content.match(/#\w+/g);
      if (matches) {
        matches.forEach(tag => {
          hashtags[tag] = (hashtags[tag] || 0) + 1;
        });
      }
    });

    // Convert to array and sort by count
    const trendingTopics = Object.entries(hashtags)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json(trendingTopics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get a single post by ID
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username fullName profilePicture avatar role isPremium badgeType')
      .populate('likes', 'username fullName profilePicture avatar isPremium badgeType')
      .populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType')
      .populate('comments.replies.author', 'username fullName profilePicture avatar role isPremium badgeType');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    await deepPopulateComments(post);
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Report a comment
router.post('/:postId/comment/:commentId/report', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    // Validate reason and description
    const allowedReasons = [
      'Spam',
      'Inappropriate Content',
      'Harassment',
      'Hate Speech',
      'Violence',
      'Other'
    ];
    const { reason, description } = req.body;
    if (!reason || !allowedReasons.includes(reason)) {
      return res.status(400).json({ message: 'Invalid or missing reason. Allowed: ' + allowedReasons.join(', ') });
    }
    if (!description || description.length < 10 || description.length > 500) {
      return res.status(400).json({ message: 'Description is required (10-500 chars).' });
    }

    // Save to Report collection for admin
    await Report.create({
      reporter: req.user._id,
      reportedItem: comment._id,
      itemType: 'Comment',
      reason,
      description
    });

    res.json({ message: 'Comment reported successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Like/Unlike a comment
router.post('/:postId/comment/:commentId/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    const userId = req.user._id.toString();
    const index = comment.likes.findIndex(id => id.toString() === userId);
    
    if (index === -1) {
      comment.likes.push(userId);
      
      // Create notification for comment like (only if not liking own comment)
      if (comment.author.toString() !== userId) {
        try {
          await createNotification(
            comment.author,
            req.user._id,
            'post_comment',
            `${req.user.username} liked your comment`,
            post._id,
            'Post'
          );
        } catch (notificationError) {
          console.error('Failed to create comment like notification:', notificationError);
          // Don't fail the request if notification creation fails
        }
      }
    } else {
      comment.likes.splice(index, 1);
    }
    
    await post.save();
    await post.populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType');
    res.json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Reply to a comment
router.post('/:postId/comment/:commentId/reply', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const parentComment = post.comments.id(req.params.commentId);
    if (!parentComment) return res.status(404).json({ message: 'Comment not found' });
    parentComment.replies.push({
      text: req.body.text,
      author: req.user._id,
      createdAt: new Date()
    });
    await post.save();
    await post.populate('comments.author', 'username fullName profilePicture avatar role isPremium badgeType');
    res.json(post);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Cleanup posts with null authors (admin route)
router.delete('/cleanup/null-authors', auth, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const result = await Post.deleteMany({ 
            $or: [
                { author: null },
                { author: { $exists: false } }
            ]
        });

        console.log(`Cleaned up ${result.deletedCount} posts with null authors`);
        res.json({ 
            message: `Cleaned up ${result.deletedCount} posts with null authors`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error cleaning up posts:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router; 