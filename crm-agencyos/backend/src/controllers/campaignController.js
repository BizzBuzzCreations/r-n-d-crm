'use strict';
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const Campaign     = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const EmailAccount = require('../models/EmailAccount');
const audit = require('../services/auditService');
const { verifyEmail, verifyBatch } = require('../utils/emailVerify');
const { fetchGoogleSheetCsv } = require('../utils/googleSheet');
const { effectiveDailyLimit } = require('../utils/warmup');
const { isWithinSendingWindow } = require('../utils/sendingWindow');
const { checkCampaignReady } = require('../utils/campaignReadiness');
const { syncCampaignLeadToPipeline } = require('../utils/leadPipelineSync');
const notifService = require('../services/notificationService');
const { notifyMainCrm } = require('../utils/mainCrmNotify');

const STUCK_THRESHOLD_MS = 15 * 60000; // scheduled/sending longer than this = likely a queue/worker problem
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const STATS_STATUSES = ['pending', 'scheduled', 'sending', 'sent', 'failed', 'bounced', 'replied', 'unsubscribed'];

async function statsFor(campaignId) {
  const rows = await CampaignLead.aggregate([
    { $match: { campaign: campaignId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = Object.fromEntries(STATS_STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => { stats[r._id] = r.count; });
  stats.total = Object.values(stats).reduce((a, b) => a + b, 0);

  const [opens, clicks] = await Promise.all([
    CampaignLead.countDocuments({ campaign: campaignId, openCount: { $gt: 0 } }),
    CampaignLead.countDocuments({ campaign: campaignId, clickCount: { $gt: 0 } }),
  ]);
  stats.opened = opens;
  stats.clicked = clicks;
  return stats;
}

// POST /api/campaigns/upload-image — embeds an image in the rich-text email body.
// Returned via /api/media because prod nginx serves /uploads/*.png as the SPA index.html (broken image).
exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
    res.status(201).json({ success: true, data: { url: `/api/media?d=files&f=${encodeURIComponent(req.file.filename)}` } });
  } catch (err) { next(err); }
};

// GET /api/campaigns
exports.getCampaigns = async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ isDeleted: { $ne: true } })
      .populate('settings.accounts', 'name email')
      .populate('createdBy', 'name email avatar color initials')
      .sort({ createdAt: -1 })
      .lean();

    const withStats = await Promise.all(campaigns.map(async (c) => ({ ...c, stats: await statsFor(c._id) })));
    res.json({ success: true, data: withStats });
  } catch (err) { next(err); }
};

// GET /api/campaigns/:id
exports.getCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('settings.accounts', 'name email isActive')
      .populate('createdBy', 'name email avatar color initials');
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const stats = await statsFor(campaign._id);
    res.json({ success: true, data: { ...campaign.toObject(), stats } });
  } catch (err) { next(err); }
};

// POST /api/campaigns
exports.createCampaign = async (req, res, next) => {
  try {
    const { name, subject, bodyHtml, settings } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Campaign name is required' });

    const campaign = await Campaign.create({
      name, subject: subject || '', bodyHtml: bodyHtml || '',
      settings: settings || {},
      createdBy: req.user?._id,
    });

    audit.log(req, { action: 'create', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: name });
    res.status(201).json({ success: true, data: { ...campaign.toObject(), stats: Object.fromEntries(STATS_STATUSES.map((s) => [s, 0])) } });
  } catch (err) { next(err); }
};

// PUT /api/campaigns/:id
exports.updateCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const { name, subject, bodyHtml, settings } = req.body;
    if (name !== undefined) campaign.name = name;
    if (subject !== undefined) campaign.subject = subject;
    if (bodyHtml !== undefined) campaign.bodyHtml = bodyHtml;
    if (settings !== undefined) {
      // dailyLimit=0 isn't "unlimited" to the dispatcher — it reads as an
      // already-reached cap and the campaign silently never sends again.
      if (settings.dailyLimit !== undefined && !(Number(settings.dailyLimit) > 0)) {
        return res.status(400).json({ success: false, message: 'Daily Limit must be at least 1' });
      }
      campaign.settings = { ...campaign.settings.toObject(), ...settings };
    }

    await campaign.save();
    audit.log(req, { action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name });

    const populated = await Campaign.findById(campaign._id).populate('settings.accounts', 'name email isActive');
    const stats = await statsFor(campaign._id);
    res.json({ success: true, data: { ...populated.toObject(), stats } });
  } catch (err) { next(err); }
};

// DELETE /api/campaigns/:id  (soft delete)
exports.deleteCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, { isDeleted: true, status: 'paused', scheduledAt: null }, { new: true });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    audit.log(req, { action: 'delete', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name });
    res.json({ success: true, data: { _id: campaign._id } });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/start   (draft|scheduled|paused|completed → active)
exports.startCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const { ready, reason } = await checkCampaignReady(campaign);
    if (!ready) return res.status(400).json({ success: false, message: reason });

    campaign.status = 'active';
    campaign.nextEligibleAt = null; // send the first one on the very next dispatcher tick
    campaign.scheduledAt = null;    // starting manually supersedes any pending schedule
    campaign.scheduleFailedReason = '';
    await campaign.save();

    audit.log(req, { action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name, metadata: { status: 'active' } });
    res.json({ success: true, data: campaign });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/schedule   { scheduledAt: ISO datetime }
// Validated the same way Start is — no point scheduling something that
// can't actually send. Re-validated again at trigger time by the dispatcher
// (see campaignReadiness.js) since accounts/leads can change before then.
exports.scheduleCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const { scheduledAt } = req.body;
    const when = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(when.getTime())) {
      return res.status(400).json({ success: false, message: 'A valid scheduled date/time is required' });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'Scheduled time must be in the future' });
    }

    const { ready, reason } = await checkCampaignReady(campaign);
    if (!ready) return res.status(400).json({ success: false, message: reason });

    campaign.status = 'scheduled';
    campaign.scheduledAt = when;
    campaign.scheduleFailedReason = '';
    await campaign.save();

    audit.log(req, { action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name, metadata: { status: 'scheduled', scheduledAt: when } });
    res.json({ success: true, data: campaign });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/unschedule   (scheduled → draft)
exports.unscheduleCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (campaign.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: `Campaign is "${campaign.status}", not scheduled` });
    }

    campaign.status = 'draft';
    campaign.scheduledAt = null;
    campaign.scheduleFailedReason = '';
    await campaign.save();

    audit.log(req, { action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name, metadata: { status: 'draft' } });
    res.json({ success: true, data: campaign });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/pause
exports.pauseCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      // Clears any pending schedule too — a paused campaign shouldn't have a
      // stale scheduledAt sitting underneath it from before it was paused.
      { status: 'paused', scheduledAt: null, scheduleFailedReason: '' },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, data: campaign });
  } catch (err) { next(err); }
};

// GET /api/campaigns/:id/diagnose — re-runs the exact same checks the
// dispatcher itself uses to decide whether it's sending right now, and
// reports the answer in plain language. Read-only — changes nothing.
exports.diagnoseCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('settings.accounts', 'name email isActive dailySendLimit warmupEnabled warmupStartDate warmupDays warmupStartLimit lastSmtpVerifiedAt lastSmtpVerifyError');
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const settings = campaign.settings || {};
    const findings = []; // { level: 'ok'|'info'|'warning'|'error', message, detail? }
    const add = (level, message, detail) => findings.push({ level, message, detail });

    if (campaign.status === 'scheduled' && campaign.scheduledAt) {
      const secs = Math.round((new Date(campaign.scheduledAt) - Date.now()) / 1000);
      add('info', secs > 0
        ? `Scheduled to start ${new Date(campaign.scheduledAt).toLocaleString()} (in ~${Math.round(secs / 60)} min). Nothing to fix, this is intentional.`
        : `Scheduled time has passed — will be promoted to active on the next check (within a minute).`);
    } else if (campaign.status !== 'active') {
      add('info', `Campaign is "${campaign.status}", not currently sending.`);
    }

    if (campaign.scheduleFailedReason) {
      add('error', `A previous scheduled send didn't start: ${campaign.scheduleFailedReason}`, null);
    }

    if (settings.sendingHoursEnabled && !isWithinSendingWindow(settings)) {
      add('info', `Outside the allowed sending window (${settings.sendingHourStart}:00–${settings.sendingHourEnd}:00, ${settings.timezone}). Will resume automatically once back in window — nothing to fix.`);
    }

    if (campaign.status === 'active' && campaign.nextEligibleAt && new Date() < campaign.nextEligibleAt) {
      const secs = Math.max(0, Math.round((new Date(campaign.nextEligibleAt) - Date.now()) / 1000));
      add('info', `Pacing gap in effect — next send in ~${secs}s (per Sending Pattern settings). Nothing to fix, this is intentional.`);
    }

    const accounts = settings.accounts || [];
    if (!accounts.length) {
      add('error', 'No sending accounts selected. Go to Settings and pick at least one.');
    } else {
      const inactive = accounts.filter((a) => !a.isActive);
      if (inactive.length) {
        // An account gets auto-deactivated by campaignWorker.js on an SMTP
        // AUTH failure (bad/expired App Password etc.) — surface the actual
        // reason here instead of just "it's off", so there's no separate
        // trip to Connected Mailboxes needed to find out why.
        add('warning', `${inactive.length} selected account(s) are turned off (inactive): ${inactive.map((a) => a.email).join(', ')}`,
          inactive.map((a) => ({ email: a.email, error: a.lastSmtpVerifyError || 'No reason recorded — check Connected Mailboxes' })));
      }

      const active = accounts.filter((a) => a.isActive);
      if (!active.length) {
        add('error', 'None of the selected sending accounts are active.');
      }

      const unverified = active.filter((a) => !a.lastSmtpVerifiedAt || a.lastSmtpVerifyError);
      if (unverified.length) {
        add('warning', `${unverified.length} active account(s) haven't passed a connection test (or the last test failed) — click Test on them in Connected Mailboxes.`,
          unverified.map((a) => ({ email: a.email, error: a.lastSmtpVerifyError || 'Never tested' })));
      }

      if (active.length) {
        const sentTodayByAccount = await CampaignLead.aggregate([
          { $match: { accountUsed: { $in: active.map((a) => a._id) }, status: 'sent', sentAt: { $gte: startOfToday() } } },
          { $group: { _id: '$accountUsed', count: { $sum: 1 } } },
        ]);
        const sentMap = new Map(sentTodayByAccount.map((r) => [String(r._id), r.count]));
        const maxedOut = active.filter((a) => (sentMap.get(String(a._id)) || 0) >= (effectiveDailyLimit(a) || Infinity));
        if (maxedOut.length === active.length) {
          add('warning', `All selected accounts have hit their daily send limit for today — sending will resume tomorrow. ${maxedOut.map((a) => `${a.email} (${sentMap.get(String(a._id)) || 0}/${effectiveDailyLimit(a)})`).join(', ')}`);
        } else if (maxedOut.length) {
          add('info', `${maxedOut.length} of ${active.length} account(s) are maxed out for today; the others will keep sending.`);
        }
      }
    }

    const cap = Math.min(
      Number.isFinite(settings.dailyLimit) ? settings.dailyLimit : Infinity,
      Number.isFinite(settings.maxNewLeadsPerDay) ? settings.maxNewLeadsPerDay : Infinity
    );
    if (Number.isFinite(cap)) {
      // Same counting rule as the dispatcher (see campaignDispatcher.js) —
      // `sentAt` for delivered mail so a stale open/click/unsubscribe on an
      // old send doesn't get miscounted as "sent today".
      const sentToday = await CampaignLead.countDocuments({
        campaign: campaign._id,
        $or: [
          { sentAt: { $gte: startOfToday() } },
          { status: { $in: ['scheduled', 'sending', 'failed', 'bounced'] }, sentAt: null, updatedAt: { $gte: startOfToday() } },
        ],
      });
      if (sentToday >= cap) add('info', `Campaign's own daily limit reached (${sentToday}/${cap}) — resumes tomorrow. Nothing to fix.`);
    }

    const pendingCount = await CampaignLead.countDocuments({ campaign: campaign._id, status: 'pending' });
    const stuckLeads = await CampaignLead.find({
      campaign: campaign._id,
      status: { $in: ['scheduled', 'sending'] },
      updatedAt: { $lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
    }).select('email status updatedAt').lean();

    if (stuckLeads.length) {
      add('error', `${stuckLeads.length} lead(s) stuck in "${stuckLeads[0].status}" for over 15 minutes — the campaign-worker process likely isn't running, or a queue job was lost. Use "Fix stuck leads" to reset them back to pending so they get picked up again.`,
        stuckLeads.map((l) => ({ email: l.email, status: l.status, since: l.updatedAt })));
    }

    if (pendingCount === 0 && !stuckLeads.length && campaign.status === 'active') {
      add('info', 'No leads left to send — campaign will auto-complete on the next check (within a minute).');
    }

    const recentFailures = await CampaignLead.find({ campaign: campaign._id, status: { $in: ['failed', 'bounced'] } })
      .sort({ updatedAt: -1 }).limit(5).select('email status error updatedAt').lean();
    if (recentFailures.length) {
      add('warning', `${recentFailures.length} recent failure(s) — see details for the actual error message from each.`, recentFailures);
    }

    if (!findings.length) add('ok', 'Everything looks normal — actively sending within its configured pace.');

    res.json({ success: true, data: { findings, pendingCount, hasStuckLeads: stuckLeads.length > 0, checkedAt: new Date() } });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/resolve-stuck — resets leads stuck in
// scheduled/sending (no job ever completed for them, likely a lost queue
// job) back to pending so the dispatcher picks them up again.
exports.resolveStuckLeads = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const result = await CampaignLead.updateMany(
      {
        campaign: campaign._id,
        status: { $in: ['scheduled', 'sending'] },
        updatedAt: { $lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
      },
      { status: 'pending', accountUsed: null }
    );

    audit.log(req, { action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name, metadata: { resolvedStuckLeads: result.modifiedCount } });
    res.json({ success: true, data: { reset: result.modifiedCount } });
  } catch (err) { next(err); }
};

// ── Leads within a campaign ──────────────────────────────────────────────

// GET /api/campaigns/:id/leads
exports.getCampaignLeads = async (req, res, next) => {
  try {
    const leads = await CampaignLead.find({ campaign: req.params.id })
      .populate('accountUsed', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: leads });
  } catch (err) { next(err); }
};

const HEADER_ALIASES = {
  email:     ['email', 'e-mail', 'emailaddress'],
  firstName: ['first_name', 'firstname', 'first name', 'fname'],
  lastName:  ['last_name', 'lastname', 'last name', 'lname'],
  // Optional — see CampaignLead.phone. 'number' included because that's
  // literally the column name asked for alongside email/first/last name.
  phone:     ['phone', 'phone_number', 'phonenumber', 'phone number', 'number', 'mobile', 'mobile_number', 'contact_number', 'contact number'],
  // B2B import format — see CampaignLead.businessName/businessType/cityLocation.
  businessName: ['business_name', 'businessname', 'business name', 'company_name', 'companyname', 'company name', 'company'],
  businessType: ['business_type', 'businesstype', 'business type', 'industry'],
  cityLocation: ['city_location', 'citylocation', 'city location', 'city', 'location'],
};

function normalizeHeader(h) { return String(h || '').trim().toLowerCase(); }

function mapRow(row) {
  const keys = Object.keys(row);
  const find = (aliases) => {
    const key = keys.find((k) => aliases.includes(normalizeHeader(k)));
    return key ? String(row[key] || '').trim() : '';
  };
  return {
    email: find(HEADER_ALIASES.email).toLowerCase(),
    firstName: find(HEADER_ALIASES.firstName),
    lastName: find(HEADER_ALIASES.lastName),
    phone: find(HEADER_ALIASES.phone),
    businessName: find(HEADER_ALIASES.businessName),
    businessType: find(HEADER_ALIASES.businessType),
    cityLocation: find(HEADER_ALIASES.cityLocation),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/campaigns/:id/leads/import
// Accepts, in priority order: multipart CSV file, { googleSheetUrl }, or
// { leads: [...] } JSON (also how "add a single lead manually" works —
// the frontend just posts a one-item array).
exports.importLeads = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    let rows = [];
    if (req.file) {
      const csvText = fs.readFileSync(req.file.path, 'utf8');
      fs.unlink(req.file.path, () => {}); // temp upload — not needed after parsing
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
    } else if (Array.isArray(req.body.leads)) {
      rows = req.body.leads.map((l) => ({
        email: String(l.email || '').trim().toLowerCase(),
        firstName: String(l.firstName || l.first_name || '').trim(),
        lastName: String(l.lastName || l.last_name || '').trim(),
        phone: String(l.phone || l.number || '').trim(),
        businessName: String(l.businessName || l.business_name || '').trim(),
        businessType: String(l.businessType || l.business_type || '').trim(),
        cityLocation: String(l.cityLocation || l.city_location || '').trim(),
      }));
    } else {
      return res.status(400).json({ success: false, message: 'Upload a CSV file, a Google Sheet link, or provide a leads array' });
    }

    const seen = new Set();
    const valid = [];
    let invalidCount = 0;
    for (const r of rows) {
      if (!r.email || !EMAIL_RE.test(r.email) || seen.has(r.email)) { if (r.email) invalidCount++; continue; }
      seen.add(r.email);
      valid.push({
        campaign: campaign._id, email: r.email, firstName: r.firstName, lastName: r.lastName, phone: r.phone || '',
        businessName: r.businessName || '', businessType: r.businessType || '', cityLocation: r.cityLocation || '',
      });
    }

    if (!valid.length) {
      return res.status(400).json({ success: false, message: 'No valid, unique email rows found' });
    }

    // Skip emails already present in this campaign (insertMany would throw
    // on the unique campaign+email index otherwise).
    const existing = await CampaignLead.find({ campaign: campaign._id, email: { $in: valid.map((v) => v.email) } }, 'email').lean();
    const existingSet = new Set(existing.map((e) => e.email));
    const toInsert = valid.filter((v) => !existingSet.has(v.email));

    let created = [];
    let verifying = false;
    if (toInsert.length) {
      // MX verification is per-DOMAIN, not per-lead (see verifyBatch) — cheap
      // for an individual-format import (a handful of companies sharing a
      // few consumer domains), but a B2B import of thousands of businesses
      // is close to one lookup per lead, since each has its own domain. At
      // LARGE_IMPORT_DOMAIN_THRESHOLD+ unique domains, doing that
      // synchronously before responding can take minutes — long past any
      // reasonable HTTP/proxy timeout, which is exactly what turns a real
      // 23,000-row business import into a flat "failed to import" with no
      // leads actually saved. Past the threshold, insert immediately as
      // unverified/pending (fast — no DNS wait) and verify in the
      // background after responding instead.
      const uniqueDomainCount = new Set(toInsert.map((v) => v.email.split('@')[1])).size;
      const LARGE_IMPORT_DOMAIN_THRESHOLD = 250;
      verifying = uniqueDomainCount > LARGE_IMPORT_DOMAIN_THRESHOLD;

      if (verifying) {
        created = await CampaignLead.insertMany(
          toInsert.map((v) => ({ ...v, verificationStatus: 'unverified', status: 'pending' })),
          { ordered: false }
        );
      } else {
        const verifyResults = await verifyBatch(toInsert.map((v) => v.email));
        const now = new Date();
        const withVerification = toInsert.map((v) => {
          const r = verifyResults.get(v.email) || {};
          const isInvalid = r.status === 'invalid';
          return {
            ...v,
            verificationStatus: r.status || 'unverified', verificationDetail: r.detail || '', provider: r.provider || '', verifiedAt: now,
            // No mail servers = guaranteed bounce. Fail it immediately instead
            // of leaving it "pending" forever (the dispatcher only ever picks
            // pending leads, so it would otherwise just sit unsent, silently
            // never resolving) — a bounce would also hurt the sending
            // account's reputation for nothing, so better to never attempt it.
            status: isInvalid ? 'failed' : 'pending',
            error: isInvalid ? r.detail : '',
          };
        });
        created = await CampaignLead.insertMany(withVerification, { ordered: false });
      }
    }

    audit.log(req, {
      action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name,
      metadata: { imported: created.length, skippedDuplicates: valid.length - toInsert.length, invalidRows: invalidCount, verifying },
    });

    res.status(201).json({
      success: true,
      data: { imported: created.length, skippedDuplicates: valid.length - toInsert.length, invalidRows: invalidCount, verifying },
    });

    // Runs AFTER the response is already sent — the import itself never
    // waits on this. Same verify-then-bulkWrite shape as verifyAllLeads,
    // just scoped to the batch this request just created instead of
    // querying for every unverified lead in the campaign.
    if (verifying && created.length) {
      (async () => {
        try {
          const results = await verifyBatch(created.map((l) => l.email));
          const now = new Date();
          const ops = created.map((l) => {
            const r = results.get(l.email) || {};
            const isInvalid = r.status === 'invalid';
            const update = { verificationStatus: r.status || 'unverified', verificationDetail: r.detail || '', provider: r.provider || '', verifiedAt: now };
            if (isInvalid) { update.status = 'failed'; update.error = r.detail; }
            return { updateOne: { filter: { _id: l._id }, update } };
          });
          await CampaignLead.bulkWrite(ops);
        } catch (err) {
          console.error(`[campaignController] Background verification failed for campaign ${campaign._id}:`, err.message);
        }
      })();
    }
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/leads/update-phones — backfills the `phone` field
// on leads ALREADY in this campaign, matched by email. Deliberately separate
// from importLeads: that endpoint is insert-only and silently skips any
// email already present (so re-uploading the same file with a phone column
// added would import zero of the existing rows — the phone data would just
// be dropped). This is the safe way to add phone numbers to a campaign
// that's already actively sending: it only ever $set's `phone`, never
// touches status/verification/send progress, so it can't disrupt anything
// currently in flight. Accepts the same three input shapes as importLeads.
exports.updateLeadPhones = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

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
    } else if (Array.isArray(req.body.leads)) {
      rows = req.body.leads.map((l) => ({
        email: String(l.email || '').trim().toLowerCase(),
        phone: String(l.phone || l.number || '').trim(),
      }));
    } else {
      return res.status(400).json({ success: false, message: 'Upload a CSV file, a Google Sheet link, or provide a leads array' });
    }

    const seen = new Set();
    const ops = [];
    let skippedNoPhone = 0;
    for (const r of rows) {
      if (!r.email || !EMAIL_RE.test(r.email) || seen.has(r.email)) continue;
      seen.add(r.email);
      if (!r.phone) { skippedNoPhone++; continue; }
      ops.push({
        updateOne: {
          filter: { campaign: campaign._id, email: r.email },
          update: { $set: { phone: r.phone } },
        },
      });
    }

    if (!ops.length) {
      return res.status(400).json({ success: false, message: 'No rows with both a valid email and a phone number found' });
    }

    const result = await CampaignLead.bulkWrite(ops, { ordered: false });
    const updated = result.matchedCount ?? result.nMatched ?? 0;
    const notFound = ops.length - updated;

    audit.log(req, {
      action: 'update', category: 'campaign', targetId: campaign._id, targetModel: 'Campaign', targetTitle: campaign.name,
      metadata: { phonesUpdated: updated, notFoundInCampaign: notFound, skippedNoPhone },
    });

    res.json({ success: true, data: { updated, notFound, skippedNoPhone } });
  } catch (err) { next(err); }
};

// DELETE /api/campaigns/:id/leads/:leadId
exports.deleteCampaignLead = async (req, res, next) => {
  try {
    const lead = await CampaignLead.findOneAndDelete({ _id: req.params.leadId, campaign: req.params.id });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found in this campaign' });
    res.json({ success: true, data: { _id: lead._id } });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/leads/:leadId/verify — re-run verification on one lead
exports.verifyLead = async (req, res, next) => {
  try {
    const lead = await CampaignLead.findOne({ _id: req.params.leadId, campaign: req.params.id });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found in this campaign' });

    const result = await verifyEmail(lead.email);
    lead.verificationStatus = result.status;
    lead.verificationDetail = result.detail;
    lead.provider = result.provider;
    lead.verifiedAt = new Date();
    // Only ever downgrade a still-pending lead — never touch the status of
    // one that's already been sent/replied/etc if someone re-verifies later.
    if (result.status === 'invalid' && lead.status === 'pending') {
      lead.status = 'failed';
      lead.error = result.detail;
    }
    await lead.save();

    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/leads/verify-all — re-run verification on every
// still-unverified lead in the campaign (e.g. after a transient DNS timeout)
exports.verifyAllLeads = async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const leads = await CampaignLead.find({ campaign: campaign._id, verificationStatus: 'unverified' }, 'email status').lean();
    if (!leads.length) return res.json({ success: true, data: { verified: 0 } });

    const results = await verifyBatch(leads.map((l) => l.email));
    const now = new Date();
    const ops = leads.map((l) => {
      const r = results.get(l.email) || {};
      const isInvalid = r.status === 'invalid';
      const update = { verificationStatus: r.status || 'unverified', verificationDetail: r.detail || '', provider: r.provider || '', verifiedAt: now };
      if (isInvalid && l.status === 'pending') {
        update.status = 'failed';
        update.error = r.detail;
      }
      return { updateOne: { filter: { _id: l._id }, update } };
    });
    await CampaignLead.bulkWrite(ops);

    res.json({ success: true, data: { verified: leads.length } });
  } catch (err) { next(err); }
};

// POST /api/campaigns/:id/leads/:leadId/mark-replied
// Manual reply marking for now — no IMAP/inbox polling is wired up yet, so
// this is how "stop sending on reply" actually takes effect until an
// automatic reply-detection integration is built.
exports.markReplied = async (req, res, next) => {
  try {
    const existing = await CampaignLead.findOne({ _id: req.params.leadId, campaign: req.params.id }).select('status');
    if (!existing) return res.status(404).json({ success: false, message: 'Lead not found in this campaign' });
    const wasAlreadyReplied = existing.status === 'replied';

    const lead = await CampaignLead.findOneAndUpdate(
      { _id: req.params.leadId, campaign: req.params.id },
      { status: 'replied', repliedAt: new Date() },
      { new: true }
    );
    if (!wasAlreadyReplied) {
      syncCampaignLeadToPipeline(lead, 'replied').catch(() => {});

      const campaign = await Campaign.findById(req.params.id).select('name subject').lean().catch(() => null);
      if (campaign) {
        const who = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email;
        notifService.dispatchByRouting(req.app.get('io'), 'campaign', {
          type: 'email_replied',
          priority: 'success',
          title: 'Lead replied',
          message: `${who} replied to an email in campaign "${campaign.name}"`,
          link: `/campaigns/${campaign._id}`,
          metadata: { campaignId: String(campaign._id), campaignLeadId: String(lead._id) },
        }).catch(() => {});
        // Also report this to the main CRM — see utils/mainCrmNotify.
        notifyMainCrm({ type: 'email_replied', email: lead.email, phone: lead.phone, subject: campaign.subject, campaignName: campaign.name });
      }
    }
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
};
