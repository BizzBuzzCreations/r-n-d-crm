const mongoose = require('mongoose');

// 'casual' is no longer offered in the UI but stays valid so older requests still load.
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other', 'casual'];

const LeaveSchema = new mongoose.Schema({
  employee:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:       { type: String, enum: LEAVE_TYPES, default: 'other' },
  // Calendar dates as YYYY-MM-DD strings (same convention as joinDate / onboardingDate elsewhere)
  from:       { type: String, required: [true, 'Start date is required'] },
  to:         { type: String, required: [true, 'End date is required'] },
  // Whether the first / last day is a full or half day off
  startBreakdown: { type: String, enum: ['full', 'half'], default: 'full' },
  endBreakdown:   { type: String, enum: ['full', 'half'], default: 'full' },
  attachment: { url: { type: String, default: '' }, name: { type: String, default: '' } },
  days:       { type: Number, required: true },
  reason:     { type: String, default: '', trim: true },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actionedAt: { type: Date, default: null },
  remarks:    { type: String, default: '', trim: true },
}, { timestamps: true });

LeaveSchema.statics.TYPES = LEAVE_TYPES;
module.exports = mongoose.model('Leave', LeaveSchema);
