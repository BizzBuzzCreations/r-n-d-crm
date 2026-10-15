'use strict';
const CampaignLead = require('../models/CampaignLead');
const { usesAuditTags } = require('./auditMergeTags');

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
  // sendable to leads that actually carry an audit snapshot. Without this
  // check those tags render empty and the recipient gets a sentence with a
  // hole in it — the kind of mistake that costs far more than a paused
  // campaign. Blocks on the first pending lead missing a snapshot.
  const needsAudit = usesAuditTags(campaign.bodyHtml) || usesAuditTags(campaign.subject)
    || (campaign.settings?.followUpEnabled
      && (usesAuditTags(campaign.settings.followUpBodyHtml) || usesAuditTags(campaign.settings.followUpSubject)));

  if (needsAudit) {
    const missing = await CampaignLead.countDocuments({
      campaign: campaign._id,
      status: 'pending',
      $or: [
        { 'auditSnapshot.prospectId': null },
        { 'auditSnapshot.prospectId': { $exists: false } },
        { 'auditSnapshot.topFinding': '' },
      ],
    });
    if (missing > 0) {
      return {
        ready: false,
        reason: `${missing} of ${pendingCount} pending leads have no website-audit data, but this email uses audit merge tags (e.g. {{top_finding}}). Push leads in from a Prospect Audit batch, or remove those tags.`,
      };
    }
  }

  return { ready: true, reason: '' };
}

module.exports = { checkCampaignReady };
