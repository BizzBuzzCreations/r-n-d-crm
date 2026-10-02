const mongoose = require('mongoose');

const PayRunSchema = new mongoose.Schema({
  name:        { type: String, required: [true, 'Name is required'], trim: true },
  periodType:  { type: String, enum: ['monthly', 'weekly', 'biweekly', 'custom'], default: 'monthly' },
  periodStart: { type: String, required: [true, 'Period start is required'] }, // YYYY-MM-DD
  periodEnd:   { type: String, required: [true, 'Period end is required'] },
  payDate:     { type: String, default: '' },                                  // empty = "TBA"
  status:      { type: String, enum: ['draft', 'under_review', 'approved', 'locked'], default: 'draft', index: true },
  employees:   { type: Number, default: 0, min: 0 },
  totalSalary: { type: Number, default: 0, min: 0 },
  totalNet:    { type: Number, default: 0, min: 0 },
  notes:       { type: String, default: '', trim: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('PayRun', PayRunSchema);
