'use strict';
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const ProspectAuditBatch = require('../models/ProspectAuditBatch');
const ProspectAudit = require('../models/ProspectAudit');
const { fetchGoogleSheetCsv } = require('../utils/googleSheet');
const audit = require('../services/auditService');
const { pushProspectsToCampaign } = require('../services/prospectPushService');

// ── Batches ─────────────────────────────────────────────────────────────

// GET /api/prospect-audits
exports.getBatches = async (req, res, next) => {
  try {
    const batches = await ProspectAuditBatch.find({ isDeleted: { $ne: true } })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: batches });
  } catch (err) { next(err); }
};

// POST /api/prospect-audits
exports.createBatch = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Batch name is required' });
    const batch = await ProspectAuditBatch.create({ name: name.trim(), createdBy: req.user._id });
    res.status(201).json({ success: true, data: batch });
  } catch (err) { next(err); }
};

// GET /api/prospect-audits/:id
exports.getBatch = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).populate('createdBy', 'name email');
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    res.json({ success: true, data: batch });
  } catch (err) { next(err); }
};

// DELETE /api/prospect-audits/:id
exports.deleteBatch = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { isDeleted: true },
      { new: true }
    );
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    audit.log(req, { action: 'delete', category: 'prospect_audit', targetId: batch._id, targetModel: 'ProspectAuditBatch', targetTitle: batch.name });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── Import ──────────────────────────────────────────────────────────────

// Flexible column matching, same convention as campaignController.js's
// HEADER_ALIASES/mapRow — tolerant of case/spacing variations, matches your
// actual export columns (business_name, business_type, city_location,
// phone_number, email, full_address, website, rating, reviews_count,
// status, call_notes, called_at) directly.
const HEADER_ALIASES = {
  businessName: ['business_name', 'businessname', 'business name', 'name'],
  businessType: ['business_type', 'businesstype', 'business type', 'category', 'type'],
  cityLocation: ['city_location', 'citylocation', 'city location', 'city', 'location'],
  phone:        ['phone_number', 'phonenumber', 'phone number', 'phone', 'number'],
  email:        ['email', 'e-mail', 'emailaddress'],
  fullAddress:  ['full_address', 'fulladdress', 'full address', 'address'],
  website:      ['website', 'url', 'site', 'web'],
  rating:       ['rating', 'stars'],
  reviewsCount: ['reviews_count', 'reviewscount', 'reviews count', 'reviews', 'review_count'],
  priorStatus:  ['status'],
  callNotes:    ['call_notes', 'callnotes', 'call notes', 'notes'],
  calledAt:     ['called_at', 'calledat', 'called at', 'call_date'],
};

function normalizeHeader(h) { return String(h || '').trim().toLowerCase(); }

function mapRow(row) {
  const keys = Object.keys(row);
  const find = (aliases) => {
    const key = keys.find((k) => aliases.includes(normalizeHeader(k)));
    return key ? String(row[key] ?? '').trim() : '';
  };
  const ratingRaw = find(HEADER_ALIASES.rating);
  const reviewsRaw = find(HEADER_ALIASES.reviewsCount);
  const calledAtRaw = find(HEADER_ALIASES.calledAt);
  return {
    businessName: find(HEADER_ALIASES.businessName),
    businessType: find(HEADER_ALIASES.businessType),
    cityLocation: find(HEADER_ALIASES.cityLocation),
    phone:        find(HEADER_ALIASES.phone),
    email:        find(HEADER_ALIASES.email).toLowerCase(),
    fullAddress:  find(HEADER_ALIASES.fullAddress),
    website:      find(HEADER_ALIASES.website),
    rating:       ratingRaw && !Number.isNaN(Number(ratingRaw)) ? Number(ratingRaw) : null,
    reviewsCount: reviewsRaw && !Number.isNaN(Number(reviewsRaw)) ? Number(reviewsRaw) : 0,
    priorStatus:  find(HEADER_ALIASES.priorStatus),
    callNotes:    find(HEADER_ALIASES.callNotes),
    calledAt:     calledAtRaw && !Number.isNaN(Date.parse(calledAtRaw)) ? new Date(calledAtRaw) : null,
  };
}

function normalizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// POST /api/prospect-audits/:id/import — same 3-shape convention as
// campaignController.importLeads (multipart CSV / googleSheetUrl / JSON array).
exports.importProspects = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    let rows = [];
    if (req.file) {
      const csvText = fs.readFileSync(req.file.path, 'utf8');
      fs.unlink(req.file.path, () => {});
      const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
      rows = records.map(mapRow);
    } else if (req.body.googleSheetUrl) {
      let csvText;
      try {
        csvText = await fetchGoogleSheetCsv(req.body.googleSheetUrl);
      } catch (sheetErr) {
        return res.status(400).json({ success: false, message: sheetErr.message });
      }
      const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
      rows = records.map(mapRow);
    } else if (Array.isArray(req.body.prospects)) {
      rows = req.body.prospects.map((p) => mapRow(p));
    } else {
      return res.status(400).json({ success: false, message: 'Upload a CSV file, a Google Sheet link, or provide a prospects array' });
    }

    rows = rows.filter((r) => r.businessName || r.email || r.phone);
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No valid rows found' });
    }

    // Dedup within this batch — by email when present, else by
    // businessName+phone (source data doesn't always have an email for
    // every scraped listing, so a DB-level unique index alone isn't enough).
    const existing = await ProspectAudit.find({ batch: batch._id }, 'email businessName phone').lean();
    const existingEmails = new Set(existing.filter((e) => e.email).map((e) => e.email));
    const existingNamePhone = new Set(existing.map((e) => `${e.businessName}|${e.phone}`));

    const seenEmails = new Set();
    const seenNamePhone = new Set();
    let skippedDuplicates = 0;
    const toInsert = [];
    for (const r of rows) {
      const namePhoneKey = `${r.businessName}|${r.phone}`;
      if (r.email) {
        if (existingEmails.has(r.email) || seenEmails.has(r.email)) { skippedDuplicates++; continue; }
        seenEmails.add(r.email);
      } else {
        if (existingNamePhone.has(namePhoneKey) || seenNamePhone.has(namePhoneKey)) { skippedDuplicates++; continue; }
        seenNamePhone.add(namePhoneKey);
      }
      const website = normalizeUrl(r.website);
      toInsert.push({
        batch: batch._id,
        ...r,
        website,
        crawlStatus: website ? 'pending' : 'no_url',
      });
    }

    let created = [];
    if (toInsert.length) {
      created = await ProspectAudit.insertMany(toInsert, { ordered: false });
    }

    await ProspectAuditBatch.updateOne({ _id: batch._id }, { $inc: { totalCount: created.length } });

    audit.log(req, {
      action: 'update', category: 'prospect_audit', targetId: batch._id, targetModel: 'ProspectAuditBatch', targetTitle: batch.name,
      metadata: { imported: created.length, skippedDuplicates },
    });

    res.status(201).json({ success: true, data: { imported: created.length, skippedDuplicates } });
  } catch (err) { next(err); }
};

// GET /api/prospect-audits/:id/prospects
exports.getProspects = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    const prospects = await ProspectAudit.find({ batch: batch._id }).sort({ createdAt: 1 });
    res.json({ success: true, data: prospects });
  } catch (err) { next(err); }
};

// DELETE /api/prospect-audits/:id/prospects/:prospectId
exports.deleteProspect = async (req, res, next) => {
  try {
    const prospect = await ProspectAudit.findOneAndDelete({ _id: req.params.prospectId, batch: req.params.id });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found' });
    await ProspectAuditBatch.updateOne({ _id: req.params.id }, { $inc: { totalCount: -1 } });
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── Crawl control ───────────────────────────────────────────────────────

// POST /api/prospect-audits/:id/start — flips the batch to 'crawling'; the
// dispatcher cron (cron/prospectAuditDispatcher.js) picks up 'pending'
// prospects from any batch in this state. Does not enqueue anything
// directly, same "controller only flips status, cron does the releasing"
// split already used by campaigns.
exports.startCrawl = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    const pendingCount = await ProspectAudit.countDocuments({ batch: batch._id, crawlStatus: 'pending' });
    if (!pendingCount) return res.status(400).json({ success: false, message: 'No pending prospects to crawl — import some first.' });
    batch.status = 'crawling';
    await batch.save();
    res.json({ success: true, data: batch });
  } catch (err) { next(err); }
};

// POST /api/prospect-audits/:id/pause
exports.pauseCrawl = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { status: 'paused' },
      { new: true }
    );
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    res.json({ success: true, data: batch });
  } catch (err) { next(err); }
};

// ── Bridge: Prospect Audit → Email Campaign ─────────────────────────────
// POST /api/prospect-audits/:id/push-to-campaign
// Body: { campaignId, tiers?: ['hot','high'], minOpportunity?, requireFindings? }
//
// This is the link that was missing entirely: audits collected ~28 facts per
// site and campaigns could read none of them, because the only route between
// the two was a CSV export whose importer keeps 7 columns. Each created
// CampaignLead carries an embedded auditSnapshot (point-in-time by design —
// see the model comment) which the sender's merge tags read, so an email can
// quote measured facts about that prospect's own website.
exports.pushToCampaign = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    const { campaignId, tiers, minOpportunity, requireFindings = true } = req.body || {};

    // All of the real work lives in services/prospectPushService so the cron's
    // auto-push and this button cannot drift apart. The service returns a
    // result instead of throwing, which this handler maps back to the exact
    // status codes and messages it returned before the extraction.
    const result = await pushProspectsToCampaign({ batch, campaignId, tiers, minOpportunity, requireFindings });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    audit.log(req, {
      action: 'create', category: 'campaign',
      targetId: result.campaignId, targetModel: 'Campaign', targetTitle: result.campaignName,
      metadata: {
        pushedFromBatch: String(batch._id),
        created: result.created,
        skippedDuplicate: result.skippedDuplicate,
        skippedNoFindings: result.skippedNoFindings,
      },
    });

    res.json({
      success: true,
      data: {
        created: result.created,
        skippedDuplicate: result.skippedDuplicate,
        skippedNoFindings: result.skippedNoFindings,
        skippedInvalidEmail: result.skippedInvalidEmail,
        campaignId: result.campaignId,
        campaignName: result.campaignName,
      },
    });
  } catch (err) { next(err); }
};

// PUT /api/prospect-audits/:id/auto-push
// Configure (or switch off) the optional auto-push for one batch.
//
// Opt-in by construction: a batch nobody calls this for keeps
// autoPushEnabled=false and behaves exactly as batches always have. Gated by
// BOTH prospect_audit and campaigns in routes/index.js, and the caller is
// recorded as the authority the cron later runs under.
exports.setAutoPush = async (req, res, next) => {
  try {
    const batch = await ProspectAuditBatch.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    const { enabled, campaignId, tiers, requireFindings } = req.body || {};

    if (enabled === false) {
      batch.autoPushEnabled = false;
      // Target and filters are kept, so switching back on doesn't mean
      // re-picking everything; only the switch itself changes.
      await batch.save();
      return res.json({ success: true, data: batch });
    }

    if (!campaignId) {
      return res.status(400).json({ success: false, message: 'Choose a campaign to push into' });
    }
    const Campaign = require('../models/Campaign');
    const campaign = await Campaign.findOne({ _id: campaignId, isDeleted: { $ne: true } }).select('status name').lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    // Checked here too, not only at push time, so the mistake surfaces while
    // someone is looking at the screen rather than silently an hour later.
    if (!['draft', 'paused'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: `"${campaign.name}" is ${campaign.status}. Auto-push can only fill a draft or paused campaign.`,
      });
    }

    batch.autoPushEnabled = true;
    batch.autoPushCampaign = campaign._id;
    batch.autoPushTiers = Array.isArray(tiers) ? tiers.map(String) : [];
    batch.autoPushRequireFindings = requireFindings !== false;
    batch.autoPushEnabledBy = req.user._id;
    // Re-arm: turning it on again after a previous run should push the next
    // time this batch completes, rather than being blocked by the old marker.
    batch.autoPushedAt = null;
    await batch.save();

    audit.log(req, {
      action: 'update', category: 'campaign',
      targetId: batch._id, targetModel: 'ProspectAuditBatch', targetTitle: batch.name,
      metadata: { autoPushEnabled: true, campaign: campaign.name, tiers: batch.autoPushTiers },
    });

    res.json({ success: true, data: batch });
  } catch (err) { next(err); }
};
