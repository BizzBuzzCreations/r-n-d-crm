'use strict';
const mongoose = require('mongoose');

const CampaignSettingsSchema = new mongoose.Schema({
  accounts:           [{ type: mongoose.Schema.Types.ObjectId, ref: 'EmailAccount' }],
  stopOnReply:        { type: Boolean, default: true },
  openTracking:       { type: Boolean, default: true },
  linkTracking:       { type: Boolean, default: false },
  // Off by choice, not by accident: commercial email is legally required to
  // carry an opt-out mechanism in most jurisdictions (CAN-SPAM etc.), and
  // Gmail/Yahoo increasingly penalize bulk senders that lack List-Unsubscribe.
  // Defaults true so disabling it is always a deliberate, informed action.
  includeUnsubscribeLink: { type: Boolean, default: true },
  // Where recipients land after clicking a tracked CTA button using the
  // {{redirect_url}} merge tag (today: "Request a Call", but the mechanism
  // isn't specific to that one button — any tracked-click-then-redirect CTA
  // can reuse it) — configurable per campaign since different campaigns/
  // sending sites can point at different destination pages, without ever
  // needing a server .env edit + restart. Falls back to
  // CALL_REQUEST_REDIRECT_URL in .env when left blank — see
  // trackingController.requestCall.
  redirectUrl: { type: String, default: '' },
  // Checkbox-style response options rendered as individually-tracked links
  // via the {{response_options}} merge tag (see workers/campaignWorker.js).
  // Not true AMP4Email (that requires Google to manually approve the
  // sending domain first, Gmail-only) — plain tracked links, work in every
  // client immediately. Capped at 5 in the UI.
  responseOptions: { type: [String], default: [] },

  // Which columns the Leads table shows for THIS campaign (Settings tab).
  // Empty/absent means "never configured" and renders the default set, so
  // every existing campaign looks exactly as it did before this was added.
  // Stored per campaign rather than per user because the useful set depends
  // on the campaign: an audit-driven one wants the Audit column, a plain
  // mail-merge does not.
  leadColumns: { type: [String], default: [] },
  textOnly:           { type: Boolean, default: false },
  firstEmailTextOnly: { type: Boolean, default: false },
  dailyLimit:         { type: Number, default: 30 },
  minGapMinutes:      { type: Number, default: 9 },
  randomGapMinutes:   { type: Number, default: 5 },
  maxNewLeadsPerDay:  { type: Number, default: null }, // null = no limit

  // Sending hours window — avoids the robotic look of off-hours sends,
  // which hurts engagement-based reputation scoring. See utils/sendingWindow.js.
  sendingHoursEnabled: { type: Boolean, default: false },
  sendingHourStart:    { type: Number, default: 9 },  // 0-23, local to `timezone`
  sendingHourEnd:      { type: Number, default: 18 }, // 0-23, local to `timezone`
  sendingDays:         { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sun..6=Sat
  timezone:            { type: String, default: 'Asia/Kolkata' },

  // Auto follow-up to hot leads — see cron/followUpDispatcher.js. A single,
  // one-time email, not a multi-step sequence: sent once per lead that
  // crosses the "hot" threshold (repeat opens or a call request) and stays
  // sent (status === 'sent') — i.e. hasn't already replied/bounced/unsubscribed.
  followUpEnabled:    { type: Boolean, default: false },
  followUpDelayHours: { type: Number, default: 48 }, // hours after going hot before it sends
  followUpSubject:    { type: String, default: '' },
  followUpBodyHtml:   { type: String, default: '' }, // same {{firstName}} merge-tag syntax as the main email
}, { _id: false });

const CampaignSchema = new mongoose.Schema({
  name:        { type: String, required: [true, 'Campaign name is required'], trim: true },
  status:      { type: String, enum: ['draft', 'scheduled', 'active', 'paused', 'completed'], default: 'draft' },

  subject:     { type: String, default: '' },
  bodyHtml:    { type: String, default: '' }, // supports {{firstName}} {{lastName}} {{email}} merge tags

  settings:    { type: CampaignSettingsSchema, default: () => ({}) },

  // Pacing state — read/written by the dispatcher cron, not user-editable
  lastSentAt:      { type: Date, default: null },
  nextEligibleAt:  { type: Date, default: null },
  lastAccountIndex: { type: Number, default: -1 },

  // Scheduled send — see cron/campaignDispatcher.js's promoteScheduledCampaigns().
  // Only meaningful while status === 'scheduled'; cleared whenever the
  // campaign leaves that state (started manually, unscheduled, deleted) so
  // it never lingers stale on a campaign that's since moved on.
  scheduledAt: { type: Date, default: null },
  // Set if the campaign was still 'scheduled' when its time arrived but was
  // no longer actually sendable (e.g. its sending account was removed, or
  // its leads were deleted, after scheduling but before trigger time) — the
  // campaign is reverted to 'draft' rather than silently never firing, and
  // this explains why so it's not a mystery in the UI.
  scheduleFailedReason: { type: String, default: '' },

  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

CampaignSchema.index({ status: 1, isDeleted: 1 });

module.exports = mongoose.model('Campaign', CampaignSchema);
