'use strict';
const CampaignLead = require('../models/CampaignLead');
const { auditTagsUsed, missingAuditDataFilter } = require('./auditMergeTags');

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

  // A body (or follow-up body) that quotes website-audit facts is only
  // sendable to leads whose snapshot can actually fill the tags it uses.
  //
  // This checks each tag against the field it reads, rather than just asking
  // "does a snapshot exist". The earlier version tested prospectId and
  // topFinding only, which a prospect whose PageSpeed pass failed passes
  // happily — Tier 1 still produced a topFinding, while perfMobile, lcpMs and
  // pageWeightKb are all null. A template using {{perf_score}} then rendered
  // "Google scores it /100 on mobile" and sent it.
  const templates = [campaign.subject, campaign.bodyHtml];
  if (campaign.settings?.followUpEnabled) {
    templates.push(campaign.settings.followUpSubject, campaign.settings.followUpBodyHtml);
  }

  const missingFilter = missingAuditDataFilter(templates);
  if (missingFilter) {
    const missing = await CampaignLead.countDocuments({
      campaign: campaign._id,
      status: 'pending',
      ...missingFilter,
    });
    if (missing > 0) {
      const tags = auditTagsUsed(templates).map((t) => `{{${t}}}`).join(', ');
      return {
        ready: false,
        reason: `${missing} of ${pendingCount} pending leads are missing the website-audit data this email needs (${tags}). `
          + `Push leads in from a Prospect Audit batch, re-crawl the ones whose PageSpeed pass failed, or remove those tags.`,
      };
    }
  }

  return { ready: true, reason: '' };
}

module.exports = { checkCampaignReady };
