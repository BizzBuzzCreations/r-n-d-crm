// NEW FILE for R&D CRM: backend/src/models/SsoTokenUse.js
//
// Remembers every Admin Portal SSO token (by its `jti`) that has been used,
// so the same token can never log anyone in twice. MongoDB deletes each
// record automatically once the token would have expired anyway (TTL index).
const mongoose = require('mongoose');

const SsoTokenUseSchema = new mongoose.Schema({
  jti:       { type: String, required: true, unique: true },
  email:     { type: String },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

SsoTokenUseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SsoTokenUse || mongoose.model('SsoTokenUse', SsoTokenUseSchema);
