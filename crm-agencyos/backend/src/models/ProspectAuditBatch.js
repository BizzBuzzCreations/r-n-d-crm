'use strict';
const mongoose = require('mongoose');

// One import batch of prospect businesses to audit — mirrors Campaign.js's
// role relative to CampaignLead (this file's counterpart is ProspectAudit.js).
const ProspectAuditBatchSchema = new mongoose.Schema({
  name:   { type: String, required: [true, 'Batch name is required'], trim: true },
  status: { type: String, enum: ['draft', 'crawling', 'paused', 'completed'], default: 'draft' },

  totalCount:   { type: Number, default: 0 },
  crawledCount: { type: Number, default: 0 }, // crawlStatus: 'ok' | 'dead' | 'blocked' | 'timeout'
  failedCount:  { type: Number, default: 0 }, // crawlStatus: 'dead' | 'blocked' | 'timeout' (subset of crawledCount)

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isDeleted: { type: Boolean, default: false },

  // ── Optional auto-push ────────────────────────────────────────────────
  // When this batch finishes crawling, push its audited prospects into a
  // campaign as leads, with no human pressing the button.
  //
  // OFF unless someone deliberately turns it on, and off for every batch that
  // already exists: the normal flow (crawl, review tiers, press "Push to
  // Campaign", then press Start) is completely unchanged when this is unused.
  // The automation only ever fills a DRAFT — it has no path that starts or
  // schedules a campaign, so a human still presses Start and the audit-data
  // readiness gate still guards that Start.
  autoPushEnabled:  { type: Boolean, default: false },
  autoPushCampaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
  // Same two knobs the manual push offers; empty tiers = every tier.
  autoPushTiers:           { type: [String], default: [] },
  autoPushRequireFindings: { type: Boolean, default: true },
  // The cron has no request user, so it runs under whoever enabled this, and
  // re-checks at push time that they still hold both the prospect_audit and
  // campaigns features. Revoking someone's access therefore disables their
  // automation rather than leaving it running on stale authority.
  autoPushEnabledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Idempotency marker AND the visible record of what happened, since nobody
  // clicked anything. Claimed atomically before the push runs, so a second
  // dispatcher tick cannot push the same batch again.
  autoPushedAt: { type: Date, default: null },
  autoPushResult: {
    status:              { type: String, default: '' }, // 'pushed' | 'skipped' | 'error'
    reason:              { type: String, default: '' }, // why, when not pushed
    created:             { type: Number, default: null },
    skippedDuplicate:    { type: Number, default: null },
    skippedNoFindings:   { type: Number, default: null },
    skippedInvalidEmail: { type: Number, default: null },
    // Prospects the eligibility query excluded: failed crawls, blank emails,
    // or a tier filter. Recorded so created + skipped* adds up to totalInBatch.
    skippedNotEligible: { type: Number, default: null },
    // Pushed without audit data (standard-email fallback on): they will get the
    // standard email rather than the audit one.
    withoutAuditData:   { type: Number, default: null },
    totalInBatch:       { type: Number, default: null },
    campaignId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    campaignName:        { type: String, default: '' },
  },
}, { timestamps: true });

ProspectAuditBatchSchema.index({ status: 1, isDeleted: 1 });

module.exports = mongoose.model('ProspectAuditBatch', ProspectAuditBatchSchema);
