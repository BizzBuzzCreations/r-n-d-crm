'use strict';
const CampaignLead = require('../models/CampaignLead');
const { auditTagsUsed, missingAuditDataFilter } = require('./auditMergeTags');
const { fallbackEnabled, fallbackProblem } = require('./unauditedFallback');

// The templates a campaign would actually send, for audit-tag purposes. The
// follow-up pair only counts when the follow-up is switched on — an unused
// follow-up body full of audit tags must not block anything.
function sendableTemplates(campaign) {
  const templates = [campaign.subject, campaign.bodyHtml];
  if (campaign.settings?.followUpEnabled) {
    templates.push(campaign.settings.followUpSubject, campaign.settings.followUpBodyHtml);
  }
  return templates;
}

/**
 * Can every pending lead fill the audit merge tags these templates use?
 *
 * Split out of checkCampaignReady so the two callers can ask for exactly what
 * they need from ONE implementation:
 *   * start / schedule  -> the full checkCampaignReady below (this included)
 *   * updateCampaign    -> this alone
 * The update path must NOT inherit the start preconditions. Reusing the whole
 * check there refused every edit to an active campaign whose leads had all
 * been sent (0 pending) with "Import at least one lead before starting the
 * campaign" — a message about starting, on a campaign already running, for an
 * edit that might be nothing but a rename.
 *
 * Checks each tag against the field it reads rather than asking "does a
 * snapshot exist": a prospect whose PageSpeed pass failed still has a
 * topFinding from Tier 1 while perfMobile/lcpMs/pageWeightKb are null, so a
 * template using {{perf_score}} would otherwise render "Google scores it
 * /100 on mobile" and send.
 */
async function checkAuditTagData(campaign) {
  const templates = sendableTemplates(campaign);
  const missingFilter = missingAuditDataFilter(templates);
  if (!missingFilter) return { ready: true, reason: '' };

  // Standard-email fallback switched on: leads without audit data are not a
  // problem, they get the standard email at send time (see
  // utils/unauditedFallback.js). What IS a problem is a standard email that
  // can't be sent — blank, or itself using audit tags, which those very leads
  // can't fill.
  if (fallbackEnabled(campaign)) {
    const problem = fallbackProblem(campaign);
    return problem ? { ready: false, reason: problem } : { ready: true, reason: '' };
  }

  const [pendingCount, missing] = await Promise.all([
    CampaignLead.countDocuments({ campaign: campaign._id, status: 'pending' }),
    CampaignLead.countDocuments({ campaign: campaign._id, status: 'pending', ...missingFilter }),
  ]);
  // 0 pending and 0 missing is ready by this check: there is no lead left that
  // could receive a half-rendered email. Whether a campaign with nothing
  // pending may be STARTED is a separate question, answered below.
  if (missing === 0) return { ready: true, reason: '' };

  const tags = auditTagsUsed(templates).map((t) => `{{${t}}}`).join(', ');
  return {
    ready: false,
    reason: `${missing} of ${pendingCount} pending leads are missing the website-audit data this email needs (${tags}). `
      + `Push leads in from a Prospect Audit batch, re-crawl the ones whose PageSpeed pass failed, remove those tags, `
      + `or turn on "Standard email for leads without audit data" in Settings.`,
  };
}

// Single source of truth for "is this campaign actually sendable right now" —
// used by the manual Start button, the Schedule action, and the scheduled-
// campaign promotion step in the dispatcher cron. A campaign that passed
// this check at schedule time gets re-checked with the exact same rules at
// trigger time, since accounts/leads can change in between.
async function checkCampaignReady(campaign) {
  if (!campaign.subject?.trim() || !campaign.bodyHtml?.trim()) {
    return { ready: false, reason: 'Add a subject and email body before starting the campaign' };
  }
  if (!campaign.settings.accounts?.length) {
    return { ready: false, reason: 'Select at least one sending account in campaign settings' };
  }
  const pendingCount = await CampaignLead.countDocuments({ campaign: campaign._id, status: 'pending' });
  if (pendingCount === 0) {
    return { ready: false, reason: 'Import at least one lead before starting the campaign' };
  }

  return checkAuditTagData(campaign);
}

module.exports = { checkCampaignReady, checkAuditTagData, sendableTemplates };
