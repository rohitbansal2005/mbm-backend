const mongoose = require('mongoose');

const EventReadSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
}, { timestamps: true });

EventReadSchema.index({ user: 1, event: 1 }, { unique: true });

module.exports = mongoose.model('EventRead', EventReadSchema); 