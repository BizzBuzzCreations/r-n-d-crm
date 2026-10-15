const mongoose = require('mongoose');

const LeadContactSchema = new mongoose.Schema({
  name:  { type: String, required: true },
  role:  { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' }
}, { _id: false });

const LeadNoteSchema = new mongoose.Schema({
  text:       { type: String, required: true },
  author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: 'System' },
  createdAt:  { type: Date, default: Date.now }
});

const LeadActivitySchema = new mongoose.Schema({
  type:        { type: String, default: 'general' }, // 'create', 'status_change', 'assign', 'note', 'watcher', 'sla'
  text:        { type: String, required: true },
  performedBy: { type: String, default: 'System' },
  createdAt:   { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
  companyName:   { type: String, required: [true, 'Company name is required'], trim: true },
  contactPerson: { type: String, required: [true, 'Contact person is required'], trim: true },
  email:         { type: String, default: '' },
  phone:         { type: String, default: '' },
  website:       { type: String, default: '' },
  dealValue:     { type: Number, default: 0 },

  // Consumer debt-advice intake fields — populated by public lead-capture
  // forms (external-api/leadCapture, e.g. DebtFreePath's site) whose
  // fields don't map onto the B2B-shaped fields above. Kept as their own
  // top-level fields rather than customFields so they get full inline
  // editing/sorting/column-toggle support in the Leads table for free,
  // same as every other column. String, not Number, for debtAmount — the
  // capture form uses a range dropdown ("£5,000–£10,000"), not a precise
  // figure.
  debtAmount:         { type: String, default: '' },
  contactPreference:  { type: String, default: '' },
  situation:          { type: String, default: '' },
  status: {
    type: String,
    enum: ['New Lead', 'First Contact', 'Proposal Sent', 'Won', 'Lost'],
    default: 'New Lead'
  },
  source: {
    type: String,
    enum: ['Manual', 'Import', 'Web Form', 'Campaign', 'Meta Ads'],
    default: 'Manual'
  },
  assignedTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  watchers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  contacts:     [LeadContactSchema],
  notes:        [LeadNoteSchema],
  activities:   [LeadActivitySchema],
  
  // Scoring parameters
  interactionsCount: { type: Number, default: 0 },
  websiteVisits:     { type: Number, default: 0 },
  emailOpens:        { type: Number, default: 0 },
  proposalViews:     { type: Number, default: 0 },
  lastContactDate:   { type: Date, default: Date.now },

  // SLA fields
  slaDeadline: { type: Date },
  slaBreached: { type: Boolean, default: false },

  // Enterprise additions
  leadId:           { type: String, unique: true },
  nextFollowUpDate: { type: Date },
  tags:             [{ type: String }],
  archived:         { type: Boolean, default: false },
  customFields:     { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

  // Website Intelligence attribution — set once, at creation, by
  // witPublicController.js when a lead form on a tracked site submits.
  // Never touched again afterward, so it always reflects the ORIGINAL
  // acquisition touchpoint even if the lead's other fields get edited later.
  websiteId:        { type: mongoose.Schema.Types.ObjectId, ref: 'TrackedWebsite', default: null },
  websiteVisitorId: { type: String, default: '' },
  websiteSessionId: { type: String, default: '' },
  landingPageUrl:   { type: String, default: '' },
  utmSource:        { type: String, default: '' },
  utmMedium:        { type: String, default: '' },
  utmCampaign:      { type: String, default: '' },

  // Ad-platform attribution (Meta Ads today, same shape reusable for Google/
  // LinkedIn later) — set once, at creation, same "never touched again"
  // rule as the Website Intelligence fields above. IDs drive the join
  // against MetaAdEntity/MetaAdInsight in metaAdsController.js; names are
  // denormalized copies so the CRM can display "came from campaign X"
  // without a live lookup, even if that campaign gets deleted in Meta later.
  adAttribution: {
    platform:     { type: String, enum: ['', 'meta', 'google'], default: '' },
    campaignId:   { type: String, default: '' },
    campaignName: { type: String, default: '' },
    adsetId:      { type: String, default: '' },
    adsetName:    { type: String, default: '' },
    adId:         { type: String, default: '' },
    adName:       { type: String, default: '' },
  },

  // Which email Campaign (see models/Campaign.js) originally made this a
  // "Hot"/"Replied" lead — set once, at creation, by leadPipelineSync.js's
  // doSync(), same "never touched again" rule as adAttribution above. Lets
  // the Email Leads tab filter/group by campaign instead of mixing every
  // campaign's engaged leads into one flat list.
  campaignAttribution: {
    id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    name: { type: String, default: '' },
  },

  // This lead's own ID in the separate "main CRM" agents actually work
  // leads in — rndCRM doesn't own lead lifecycle, it's a reporting copy fed
  // once at creation. Set by whatever created this lead (e.g. the n8n
  // workflow) so a later status-sync webhook from the main CRM
  // (POST /api/lead-sync/status, see leadController.syncLeadStatus) can
  // find the right record to update. Empty for leads created directly in
  // rndCRM, which have no external counterpart.
  // No `default: ''` deliberately — sparse only excludes documents where
  // the field is genuinely absent, not ones where it's an empty string; a
  // default would make every lead without one collide on "" under the
  // unique index below.
  externalLeadId: { type: String, unique: true, sparse: true },

  // The main CRM's own raw status name at last sync (e.g. "IVA Agreed",
  // "Full Docs Back") — kept verbatim alongside the collapsed 5-value
  // `status` above, which stays coarse on purpose (Kanban columns, Won/Lost
  // metrics elsewhere in the app depend on exactly those 5 values). This
  // field is display-only, so a rep can see exactly where a synced lead
  // stands without losing any of that existing logic. Set by
  // leadController.syncLeadStatus; empty for leads with no externalLeadId.
  externalStatusLabel: { type: String, default: '' },

  // The main CRM's own assigned agent name at last sync (e.g. "DebtFree
  // Path") — display-only, same reasoning as externalStatusLabel above.
  // `assignedTo` (ObjectId, below) refers to an rndCRM User and is never
  // set automatically for synced leads (nobody in rndCRM actually owns
  // them), so without this the Salesperson column would just say
  // "Unassigned" even though someone in the main CRM is actively working
  // the lead. Set by leadController.createLead / syncLeadStatus.
  externalAssignedToName: { type: String, default: '' },
}, { timestamps: true });

/**
 * Reserve `count` consecutive lead numbers and return the FIRST one.
 *
 * A bulk import used to call this once (bumping the counter by 1) and then
 * hand out `LD-${n + index}` for every row — so a 500-row import consumed
 * 500 numbers while the counter only knew about one. The next 499 single
 * creates then collided with numbers the import had already used and failed
 * on the unique `leadId` index. Reserving the whole block atomically keeps
 * the counter and reality in step.
 */
LeadSchema.statics.getNextLeadNumber = async function (count = 1) {
  // Atomic $inc on the shared Counter model (already used the same way by
  // Task.taskNumber and Invoice.invoiceNumber — see models/index.js).
  // Replaces the previous "scan all leads, compute max, use max+1"
  // approach, which raced under concurrent creates (e.g. an n8n batch
  // import creating several leads within milliseconds of each other) and
  // could hand out the same "next" number to two requests, failing the
  // second one's save with a duplicate-key error on leadId.
  const Counter = mongoose.model('Counter');
  const n = Math.max(1, Number(count) || 1);
  const counter = await Counter.findOneAndUpdate(
    { id: 'leadId' },
    { $inc: { seq: n } },
    { new: true, upsert: true }
  );
  // counter.seq is now the LAST number of the reserved block; return the first.
  return counter.seq - n + 1;
};

// Pre-save to auto-initialize SLA Response Deadline and generate sequential Lead ID
LeadSchema.pre('save', async function (next) {
  if (this.isNew && !this.slaDeadline) {
    this.slaDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours SLA
  }
  if (!this.leadId) {
    try {
      const LeadModel = this.constructor;
      const nextNum = await LeadModel.getNextLeadNumber();
      this.leadId = `LD-${nextNum}`;
    } catch (err) {
      this.leadId = `LD-${Date.now().toString().slice(-4)}`;
    }
  }
  next();
});

module.exports = mongoose.model('Lead', LeadSchema);
