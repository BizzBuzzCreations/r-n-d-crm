'use strict';
// The one implementation of "turn audited prospects into campaign leads".
//
// Called by BOTH callers so they can never drift:
//   * controllers/prospectAuditController.pushToCampaign  (a human pressing
//     "Push to Campaign")
//   * cron/prospectAuditDispatcher.autoPushCompletedBatch (a batch that just
//     finished crawling, only when someone opted that batch in)
//
// It never throws for an expected condition and it never sends anything: it
// returns a result object. That shape exists because the cron must be able to
// record "skipped, here's why" and carry on — an exception escaping a cron
// tick would stop every other batch in that tick — while the HTTP handler
// needs the same outcomes as status codes and messages.
const ProspectAudit = require('../models/ProspectAudit');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const ProspectAuditBatch = require('../models/ProspectAuditBatch');
const User = require('../models/User');
const { userHasFeature } = require('../middleware/authorizeFeature');
const { fallbackUsable, UNAUDITED_CRAWL_STATUSES } = require('../utils/unauditedFallback');

// Logger is optional so this module can be required by a probe with no
// logging side effects, and so a missing sysLogger never breaks a push.
let sysLog = { info: () => {}, warn: () => {}, error: () => {} };
try { sysLog = require('../utils/sysLogger').logger; } catch { /* no-op */ }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (status, code, message) => ({ ok: false, status, code, message });

/**
 * @param {object} args
 * @param {object} args.batch            a ProspectAuditBatch document
 * @param {string} args.campaignId
 * @param {string[]} [args.tiers]        empty/absent = every tier
 * @param {number} [args.minOpportunity]
 * @param {boolean} [args.requireFindings=true]
 * @returns {Promise<object>} { ok:true, created, skippedDuplicate,
 *   skippedNoFindings, skippedInvalidEmail, campaignId, campaignName }
 *   or { ok:false, status, code, message }
 */
async function pushProspectsToCampaign({ batch, campaignId, tiers, minOpportunity, requireFindings = true }) {
  if (!campaignId) return fail(400, 'no_campaign_id', 'campaignId is required');

  const campaign = await Campaign.findOne({ _id: campaignId, isDeleted: { $ne: true } });
  if (!campaign) return fail(404, 'campaign_not_found', 'Campaign not found');

  // Pushing into a live campaign would start mailing the new leads within a
  // minute, before anyone has reviewed the segment or the copy. This is also
  // the guarantee that the automation can only ever fill a DRAFT — it never
  // starts a campaign, and it refuses to touch one that is already running.
  if (!['draft', 'paused'].includes(campaign.status)) {
    return fail(400, 'campaign_not_editable', `Campaign is ${campaign.status}. Pause it before pushing new leads in.`);
  }

  // With the standard-email fallback on, prospects that could not be audited
  // (no website, dead/blocked/timed-out site) are pushed too — they will be
  // sent the standard email instead of being silently dropped. 'pending' and
  // 'crawling' are never included: they may still gain audit data.
  const includeUnaudited = fallbackUsable(campaign);
  const query = {
    batch: batch._id,
    crawlStatus: includeUnaudited ? { $in: ['ok', ...UNAUDITED_CRAWL_STATUSES] } : 'ok',
    email: { $nin: ['', null] },
  };
  if (Array.isArray(tiers) && tiers.length) query.tier = { $in: tiers.map(String) };
  if (minOpportunity != null && Number.isFinite(Number(minOpportunity))) {
    query.opportunityScore = { $gte: Number(minOpportunity) };
  }

  // Only 'ok' crawls are eligible unless the standard-email fallback is on
  // (the query above): a dead/blocked/timeout prospect has no measured
  // findings, and buildFindings returns [] for it, so a partially-crawled batch
  // contributes only the prospects actually audited.
  const prospects = await ProspectAudit.find(query).lean();

  // Everything the query filtered out — failed crawls, blank emails, or a
  // tier/opportunity filter excluding them. Counted so the recorded result
  // adds up against the batch size: without it a report reading "pushed 1"
  // for a 50-prospect batch looks like a bug rather than 49 dead crawls.
  // Nobody clicked the automatic push, so the record has to explain itself.
  const totalInBatch = await ProspectAudit.countDocuments({ batch: batch._id });
  const skippedNotEligible = Math.max(0, totalInBatch - prospects.length);
  if (!prospects.length) {
    return fail(400, 'no_matching_prospects',
      `No crawled prospects with an email address match those filters`
      + (totalInBatch ? ` (${totalInBatch} in the batch, none eligible)` : ''));
  }

  // Skip prospects with nothing measured worth saying. Sending a
  // "personalised" email whose personalised part is blank is worse than not
  // sending — opt out with requireFindings: false for a generic template.
  const seen = new Set();
  const candidates = [];
  let skippedNoFindings = 0;
  let skippedInvalidEmail = 0;

  for (const p of prospects) {
    const email = String(p.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) { skippedInvalidEmail++; continue; }
    // With the fallback on, "nothing to say" is not a reason to drop the
    // prospect — it simply gets the standard email.
    if (requireFindings && !includeUnaudited && !(p.findings || []).length) { skippedNoFindings++; continue; }
    seen.add(email);
    candidates.push({ p, email });
  }

  if (!candidates.length) {
    return fail(400, 'no_candidates', requireFindings
      ? 'No prospects had any audit findings to personalise with. Re-crawl the batch, or push with requireFindings disabled.'
      : 'No prospects had a valid email address.');
  }

  // Don't duplicate leads already in this campaign (the campaign+email unique
  // index would reject the whole insertMany otherwise).
  const existing = await CampaignLead.find(
    { campaign: campaign._id, email: { $in: candidates.map((c) => c.email) } }, 'email',
  ).lean();
  const existingSet = new Set(existing.map((e) => e.email));

  const fresh = candidates.filter((c) => !existingSet.has(c.email));
  // How many of the new leads have no audit data and will therefore be sent
  // the standard email (always 0 when the fallback is off).
  const withoutAuditData = fresh.filter(({ p }) => p.crawlStatus !== 'ok' || !(p.findings || []).length).length;
  const toInsert = fresh
    .map(({ p, email }) => ({
      campaign: campaign._id,
      email,
      businessName: p.businessName || '',
      businessType: p.businessType || '',
      cityLocation: p.cityLocation || '',
      phone: p.phone || '',
      auditSnapshot: {
        prospectId:       p._id,
        auditedAt:        p.crawledAt || null,
        website:          p.website || '',
        tier:             p.tier || '',
        technicalScore:   p.technicalScore ?? null,
        opportunityScore: p.opportunityScore ?? null,
        perfMobile:       p.psiPerformanceScore ?? null,
        perfDesktop:      p.psiPerformanceScoreDesktop ?? null,
        seoScore:         p.psiSeoScore ?? null,
        lcpMs:            p.coreWebVitals?.lcp ?? null,
        pageWeightKb:     p.pageWeightKb ?? null,
        topFinding:       p.topFinding || '',
        primaryAngle:     p.topFindingAngle || '',
        findings: (p.findings || []).map((f) => ({
          code: f.code, angle: f.angle, sentence: f.sentence,
        })),
      },
    }));

  let created = 0;
  let duplicateRace = 0;
  if (toInsert.length) {
    try {
      const docs = await CampaignLead.insertMany(toInsert, { ordered: false });
      created = docs.length;
    } catch (err) {
      // insertMany with ordered:false still THROWS a BulkWriteError when any
      // document violates the campaign+email unique index, even though the
      // rest inserted fine. Previously that escaped as a 500 and the caller
      // lost the counts entirely, while the leads really had been created.
      //
      // It is reachable in normal use: the pre-filter above and the insert are
      // two separate round trips, so a concurrent manual push (or a second
      // cron tick) can insert the same email in between. Duplicates are the
      // expected outcome here, not an error — anything else is re-thrown.
      const writeErrors = err?.writeErrors || err?.result?.result?.writeErrors || [];
      const nonDuplicate = writeErrors.filter((e) => (e?.code ?? e?.err?.code) !== 11000);
      if (!writeErrors.length || nonDuplicate.length) throw err;

      created = err.insertedDocs?.length
        ?? err.result?.insertedCount
        ?? Math.max(0, toInsert.length - writeErrors.length);
      duplicateRace = writeErrors.length;
    }
  }

  return {
    ok: true,
    created,
    skippedDuplicate: (candidates.length - toInsert.length) + duplicateRace,
    skippedNoFindings,
    skippedInvalidEmail,
    skippedNotEligible,
    withoutAuditData,
    totalInBatch,
    campaignId: String(campaign._id),
    campaignName: campaign.name,
  };
}

// Push a just-completed batch's prospects into its configured campaign.
//
// Every exit path either pushes exactly once or records why it did not. It
// never starts a campaign (the service refuses anything that is not draft or
// paused), never sends mail, and never throws to the caller.
async function autoPushCompletedBatch(batch) {
  if (!batch.autoPushEnabled || !batch.autoPushCampaign) return;

  // Atomic claim. The dispatcher runs every minute and autoCompleteFinishedBatches
  // re-evaluates batches, and two ticks can overlap on a slow Mongo, so the
  // guard has to be the write itself rather than a read-then-write: only the
  // tick that successfully moves autoPushedAt from null gets to push. Any
  // later tick finds it set and returns above/here without pushing.
  const claimed = await ProspectAuditBatch.findOneAndUpdate(
    { _id: batch._id, autoPushEnabled: true, autoPushedAt: null },
    { $set: { autoPushedAt: new Date() } },
    { new: true },
  );
  if (!claimed) return; // another tick already claimed it, or it was turned off

  const record = async (status, reason, extra = {}) => {
    await ProspectAuditBatch.updateOne({ _id: batch._id }, {
      $set: { autoPushResult: { status, reason, ...extra } },
    });
    const line = `Auto-push ${status} for batch "${batch.name}": ${reason || JSON.stringify(extra)}`;
    if (status === 'pushed') sysLog.info('PROSPECT_AUDIT', line);
    else sysLog.warn('PROSPECT_AUDIT', line);
    console.log(`[ProspectAuditDispatcher] ${line}`);
  };

  // The cron has no request user, so authority comes from whoever enabled the
  // automation — re-checked now, not trusted from when it was switched on. If
  // their access to either feature has since been removed, the automation
  // stops instead of acting on stale permissions.
  const enabledBy = claimed.autoPushEnabledBy;
  if (!enabledBy) {
    return record('skipped', 'No enabling user recorded — re-save the auto-push settings to authorise it');
  }
  const user = await User.findById(enabledBy).select('role name').lean();
  if (!user) {
    return record('skipped', 'The user who enabled auto-push no longer exists');
  }
  const [canAudit, canCampaigns] = await Promise.all([
    userHasFeature(user, 'prospect_audit', ['admin', 'manager']),
    userHasFeature(user, 'campaigns', ['admin', 'manager']),
  ]);
  if (!canAudit || !canCampaigns) {
    return record('skipped', `${user.name} no longer has access to ${!canAudit ? 'Prospect Audits' : 'Campaigns'}`);
  }

  try {
    const result = await pushProspectsToCampaign({
      batch: claimed,
      campaignId: claimed.autoPushCampaign,
      tiers: claimed.autoPushTiers,
      requireFindings: claimed.autoPushRequireFindings,
    });

    if (!result.ok) {
      // Expected refusals: campaign deleted, no longer draft/paused, nothing
      // eligible to push. Recorded, not retried — a human can still use the
      // manual button once they have fixed whatever it was.
      return record('skipped', result.message);
    }

    return record('pushed', '', {
      created: result.created,
      skippedDuplicate: result.skippedDuplicate,
      skippedNoFindings: result.skippedNoFindings,
      skippedInvalidEmail: result.skippedInvalidEmail,
      skippedNotEligible: result.skippedNotEligible,
      withoutAuditData: result.withoutAuditData,
      totalInBatch: result.totalInBatch,
      campaignId: result.campaignId,
      campaignName: result.campaignName,
    });
  } catch (err) {
    return record('error', String(err.message || err).slice(0, 300));
  }
}

module.exports = { pushProspectsToCampaign, autoPushCompletedBatch };
