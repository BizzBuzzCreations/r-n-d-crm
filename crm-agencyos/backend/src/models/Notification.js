const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: {
    type: String,
    enum: [
      'task_assigned', 'task_approved', 'task_ready_approval',
      'meeting_scheduled', 'message_dm', 'client_update', 'todo_submitted',
      'service_added', 'lead_assigned', 'lead_mentioned',
      'new_comment', 'email_sent', 'email_failed', 'email_opened', 'call_requested', 'email_replied', 'lead_captured', 'campaign_response',
      'lead_won', 'lead_lost', 'auth', 'system',
      'leave_requested', 'leave_approved', 'leave_rejected',
    ],
    required: true,
  },
  priority: {
    type: String,
    enum: ['info', 'success', 'warning', 'error', 'critical'],
    default: 'info',
  },
  title:   { type: String, required: true },
  message: { type: String, required: true },
  link:    { type: String, default: '' },
  read:    { type: Boolean, default: false, index: true },
  metadata: { type: mongoose.Schema.Types.Map, of: String },
}, { timestamps: true });

NotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
