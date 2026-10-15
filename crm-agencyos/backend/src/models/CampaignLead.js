'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');

const OpenEventSchema = new mongoose.Schema({
  at:        { type: Date, default: Date.now },
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { _id: false });

const ClickEventSchema = new mongoose.Schema({
  at:  { type: Date, default: Date.now },
  url: { type: String, default: '' },
}, { _id: false });

const ResponseEventSchema = new mongoose.Schema({
  at:     { type: Date, default: Date.now },
  option: { type: String, default: '' },
}, { _id: false });

const CampaignLeadSchema = new mongoose.Schema({
  campaign:   { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },

  email:      { type: String, required: [true, 'Email is required'], trim: true, lowercase: true },
  firstName:  { type: String, default: '' },
  lastName:   { type: String, default: '' },
  // Optional — imported alongside email/first/last name. Sent together with
  // email when reporting engagement to IVA CRM (see utils/mainCrmNotify.js),
  // giving their lead-matcher both identifiers to work with instead of just one.
  phone:      { type: String, default: '', trim: true },

  // B2B import format — a campaign's leads are either individuals
  // (firstName/lastName above) or businesses (this), never a mix of
  // meaning in the same field. businessName is read by the SAME
  // {{first_name}} merge tag as firstName (see workers/campaignWorker.js's
  // renderMergeTags — businessName wins when both are present), so a
  // template author never needs a separate tag or to know which import
  // format a given lead came from. businessType/cityLocation are metadata
  // only, for filtering/segmenting the leads list — deliberately not wired
  // into any merge tag.
  businessName:  { type: String, default: '' },
  businessType:  { type: String, default: '' },
  cityLocation:  { type: String, default: '' },

  // ── Website audit snapshot ────────────────────────────────────────────
  // Set when a lead is pushed here from a Prospect Audit batch (see
  // prospectAuditController.pushToCampaign). Read by the merge tags in
  // workers/campaignWorker.js so an email can quote measured facts about
  // this specific prospect's website.
  //
  // Embedded, not a populated ref to ProspectAudit, for two reasons:
  // sending must not depend on a join in the worker's hot path, and an audit
  // claim is point-in-time — if the prospect fixes their site next week, the
  // email already sent should still reflect what was actually measured when
  // it was written. Same write-once reasoning as Lead's attribution blocks.
  auditSnapshot: {
    prospectId:       { type: mongoose.Schema.Types.ObjectId, ref: 'ProspectAudit', default: null },
    auditedAt:        { type: Date, default: null },
    website:          { type: String, default: '' },
    tier:             { type: String, default: '' },
    technicalScore:   { type: Number, default: null },
    opportunityScore: { type: Number, default: null },
    perfMobile:       { type: Number, default: null },
    perfDesktop:      { type: Number, default: null },
    seoScore:         { type: Number, default: null },
    lcpMs:            { type: Number, default: null },
    pageWeightKb:     { type: Number, default: null },
    // Denormalised top sentence + the angle it belongs to. The angle is kept
    // so reply rate per sales angle can be measured later (BACKLOG.md §1.4)
    // without re-deriving it from the finding codes.
    topFinding:       { type: String, default: '' },
    primaryAngle:     { type: String, default: '' },
    findings: {
      type: [{
        _id:      false,
        code:     { type: String, default: '' },
        angle:    { type: String, default: '' },
        sentence: { type: String, default: '' },
      }],
      default: [],
    },
  },

  status: {
    type: String,
    enum: ['pending', 'scheduled', 'sending', 'sent', 'failed', 'bounced', 'replied', 'unsubscribed'],
    default: 'pending',
  },

  accountUsed: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailAccount', default: null },

  // Email verification — syntax + MX record check (see utils/emailVerify.js).
  // Not a full SMTP mailbox-exists check; see that file for why.
  verificationStatus: { type: String, enum: ['unverified', 'valid', 'invalid', 'risky'], default: 'unverified' },
  verificationDetail: { type: String, default: '' },
  provider:           { type: String, default: '' }, // e.g. "Gmail", "Google Workspace", "Microsoft 365"
  verifiedAt:         { type: Date, default: null },

  sentAt:         { type: Date, default: null },
  openedAt:       { type: Date, default: null }, // most recent open — kept for fast sort/filter
  openCount:      { type: Number, default: 0 },
  // Opens that passed the scanner/prefetch filter (non-scanner user agent and
  // more than OPEN_NOTIFICATION_DELAY_GATE_MS after the send) — i.e. the ones
  // plausibly made by a person. openCount above still counts every pixel hit,
  // because the raw number is what the opens[] history reflects and what
  // existing analytics show. This is the number the "hot" threshold uses, so
  // that a low threshold can't be tripped by two automated fetches.
  humanOpenCount: { type: Number, default: 0 },
  // Full history of opens (capped — see trackingController). openedAt/openCount
  // above are denormalized copies of this for cheap queries/stats.
  opens:          { type: [OpenEventSchema], default: [] },
  clickedAt:      { type: Date, default: null }, // most recent click — kept for fast sort/filter
  clickCount:     { type: Number, default: 0 },
  clicks:         { type: [ClickEventSchema], default: [] }, // full history, capped — see trackingController
  repliedAt:      { type: Date, default: null },
  unsubscribedAt: { type: Date, default: null },
  // Clicked the "Request a Call" button in the email (see trackingController
  // .requestCall) — a deliberate, purpose-built CTA distinct from a generic
  // link click, so it can trigger the pipeline sync as its own strong signal
  // (same tier as an actual reply) instead of just adding to clickCount.
  callRequested:   { type: Boolean, default: false },
  callRequestedAt: { type: Date, default: null },
  error:          { type: String, default: '' },

  // Checkbox-style response options (see Campaign.settings.responseOptions
  // and the {{response_options}} merge tag) — which option this lead
  // clicked, if any. responses[] keeps the full history (a lead could click
  // more than one link over time); responseOption/respondedAt are the most
  // recent, for cheap sort/filter — same denormalization pattern as opens/clicks.
  responseOption: { type: String, default: '' },
  respondedAt:    { type: Date, default: null },
  responses:      { type: [ResponseEventSchema], default: [] },

  // Auto-follow-up (see cron/followUpDispatcher.js) — its own lifecycle,
  // deliberately separate from status/sentAt/error above so the original
  // send's outcome is never overwritten by the follow-up attempt.
  followUpStatus:     { type: String, enum: ['none', 'queued', 'sending', 'sent', 'failed'], default: 'none' },
  followUpSentAt:      { type: Date, default: null },
  followUpAccountUsed: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailAccount', default: null },
  followUpError:       { type: String, default: '' },

  // Single opaque token used for the open pixel, click redirects, and the
  // unsubscribe link — unguessable, unrelated to the Mongo _id. Also reused
  // for the follow-up email's tracking links (see workers/campaignWorker.js).
  token: { type: String, unique: true, default: () => crypto.randomBytes(16).toString('hex') },
}, { timestamps: true });

CampaignLeadSchema.index({ campaign: 1, status: 1 });
CampaignLeadSchema.index({ campaign: 1, email: 1 }, { unique: true }); // no duplicate import within a campaign

module.exports = mongoose.model('CampaignLead', CampaignLeadSchema);
