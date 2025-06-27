const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
// Use Cloudinary multer config for uploads
const upload = require('../config/multer');
const cloudinary = require('../config/cloudinary');
const EventRead = require('../models/EventRead'); // You may need to create this model

// Get all events
router.get('/', async (req, res) => {
  try {
    const events = await Event.find()
      .sort({ createdAt: -1 })
      .populate('organizer', 'username fullName profilePicture');
    
    // Add user's reaction status if user is authenticated
    if (req.user) {
      events.forEach(event => {
        const userReaction = event.reactions.find(r => r.user.toString() === req.user._id.toString());
        event.userReaction = userReaction ? userReaction.type : null;
      });
    }
    
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new event (admin only)
router.post('/', [auth, admin, upload.single('image')], async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    const event = new Event({
      title,
      description,
      organizer: req.user._id,
      image: req.file ? req.file.path : '' // Cloudinary URL
    });

    const savedEvent = await event.save();
    
    // Emit socket event for new update
    req.app.get('io').emit('newUpdate', savedEvent);
    
    res.status(201).json(savedEvent);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// React to an event
router.post('/:id/react', auth, async (req, res) => {
  try {
    const { reactionType } = req.body;
    if (!['like', 'dislike'].includes(reactionType)) {
      return res.status(400).json({ message: 'Invalid reaction type' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Find existing reaction
    const existingReactionIndex = event.reactions.findIndex(
      r => r.user.toString() === req.user._id.toString()
    );

    if (existingReactionIndex !== -1) {
      const existingReaction = event.reactions[existingReactionIndex];
      
      // If same reaction type, remove it
      if (existingReaction.type === reactionType) {
        event.reactions.splice(existingReactionIndex, 1);
        if (reactionType === 'like') {
          event.likes = Math.max(0, event.likes - 1);
        } else {
          event.dislikes = Math.max(0, event.dislikes - 1);
        }
      } else {
        // If different reaction type, update it
        event.reactions[existingReactionIndex].type = reactionType;
        if (reactionType === 'like') {
          event.likes += 1;
          event.dislikes = Math.max(0, event.dislikes - 1);
        } else {
          event.dislikes += 1;
          event.likes = Math.max(0, event.likes - 1);
        }
      }
    } else {
      // Add new reaction
      event.reactions.push({
        user: req.user._id,
        type: reactionType
      });
      if (reactionType === 'like') {
        event.likes += 1;
      } else {
        event.dislikes += 1;
      }
    }

    const updatedEvent = await event.save();
    
    // Emit socket event for reaction update
    req.app.get('io').emit('updateReaction', updatedEvent);
    
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error reacting to event:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// Helper to extract Cloudinary public_id from URL
function extractCloudinaryPublicId(url) {
    if (!url) return null;
    // Example: https://res.cloudinary.com/demo/image/upload/v1234567890/folder/filename.jpg
    // public_id: folder/filename (without extension)
    const parts = url.split('/');
    const file = parts.slice(-2).join('/').split('.')[0];
    return file;
}

// Update event (admin only)
router.put('/:id', [auth, admin, upload.single('image')], async (req, res) => {
  try {
    const { title, description, date, time, location, type } = req.body;

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    event.title = title;
    event.description = description;
    event.date = date;
    event.time = time;
    event.location = location;
    event.type = type;

    // Handle image removal
    if (req.body.removeImage) {
      const publicId = extractCloudinaryPublicId(event.image);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.error('Cloudinary delete error:', err.message);
        }
      }
      event.image = null;
    }

    if (req.file) {
      event.image = req.file.path; // Cloudinary URL
    }

    const updatedEvent = await event.save();
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// Delete event (admin only)
router.delete('/:id', [auth, admin], async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    await event.deleteOne();
    res.json({ message: 'Event deleted' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// Get upcoming events
router.get('/upcoming', auth, async (req, res) => {
  try {
    const currentDate = new Date();
    const upcomingEvents = await Event.find({
      date: { $gte: currentDate }
    })
    .sort({ date: 1 })
    .limit(5)
    .populate('organizer', 'username fullName profilePicture')
    .select('title date description location attendees');

    res.json(upcomingEvents);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get event details
router.get('/:id', auth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'username fullName profilePicture')
      .populate('attendees', 'username fullName profilePicture');
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get unread updates count for current user
router.get('/unread-count', auth, async (req, res) => {
  try {
    const allEvents = await Event.find();
    const readEvents = await EventRead.find({ user: req.user._id }).select('event');
    const readEventIds = readEvents.map(er => er.event.toString());
    const unreadCount = allEvents.filter(ev => !readEventIds.includes(ev._id.toString())).length;
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ unreadCount: 0, error: err.message });
  }
});

// Mark all updates as read for current user
router.post('/mark-all-read', auth, async (req, res) => {
  try {
    const allEvents = await Event.find();
    const bulk = allEvents.map(ev => ({ user: req.user._id, event: ev._id }));
    await EventRead.insertMany(bulk, { ordered: false }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 