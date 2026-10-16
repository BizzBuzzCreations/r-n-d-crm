'use strict';
// "Standard email for leads without audit data" — the one place that decides
// which template a given lead gets.
//
// Kept out of workers/campaignWorker.js on purpose: requiring that file starts
// a BullMQ Worker as a side effect, so nothing in it can be unit-tested or
// shared with the API process. This module is pure apart from one Mongo read.
//
// Design rule, same as the rest of the audit work: refuse rather than send
// something wrong. A lead that cannot fill the audit tags NEVER receives the
// audit email; it receives the standard one, or (follow-up only) nothing.
const CampaignLead = require('../models/CampaignLead');
const { auditTagsUsed, missingAuditDataFilter } = require('./auditMergeTags');

// Prospect crawl outcomes that are FINAL and not 'ok': there is no audit data
// and there never will be without a re-crawl. 'pending'/'crawling' are
// deliberately absent — a prospect still being crawled may yet gain data, and
// pushing it now would lock it into the standard email.
const UNAUDITED_CRAWL_STATUSES = ['dead', 'blocked', 'timeout', 'no_url'];

const fallbackEnabled = (campaign) => campaign?.settings?.fallbackEnabled === true;

/**
 * Why the standard email can't be used as configured, or null when it can.
 * Only meaningful while enabled.
 *
 * It must not use audit tags: it is sent precisely to the leads that have no
 * audit data, so any such tag would render empty — the exact failure this
 * feature exists to prevent.
 */
function fallbackProblem(campaign) {
  const s = campaign?.settings || {};
  if (!String(s.fallbackSubject || '').trim() || !String(s.fallbackBodyHtml || '').trim()) {
    return 'Add a subject and body for the standard email sent to leads without audit data';
  }
  const tags = auditTagsUsed([s.fallbackSubject, s.fallbackBodyHtml]);
  if (tags.length) {
    return `The standard email can't use website-audit tags (${tags.map((t) => `{{${t}}}`).join(', ')}) `
      + 'because it is sent to leads that have no audit data';
  }
  return null;
}

const fallbackUsable = (campaign) => fallbackEnabled(campaign) && !fallbackProblem(campaign);

/**
 * Would any audit tag used by `templates` render empty for this lead?
 * Uses the SAME Mongo filter the start/update gate uses (missingAuditDataFilter),
 * so "can this lead fill the tags" has exactly one definition.
 */
async function leadHasAuditGap(templates, leadId) {
  const filter = missingAuditDataFilter(templates);
  if (!filter) return false;
  return !!(await CampaignLead.exists({ _id: leadId, ...filter }));
}

/**
 * Which subject/body to send this lead.
 *
 * @returns {Promise<{send:true, variant:'standard'|'fallback', subject:string, bodyHtml:string}
 *                 | {send:false, reason:string}>}
 */
async function chooseEmailContent(campaign, lead, { isFollowUp = false } = {}) {
  const s = campaign.settings || {};

  if (isFollowUp) {
    const subject = s.followUpSubject;
    const bodyHtml = s.followUpBodyHtml;
    // No fallback follow-up exists: a follow-up written around audit facts
    // cannot be sent to a lead that has none. Skipped, not sent half-blank.
    if (await leadHasAuditGap([subject, bodyHtml], lead._id)) {
      return { send: false, reason: 'follow-up uses website-audit tags this lead has no data for' };
    }
    return { send: true, variant: 'standard', subject, bodyHtml };
  }

  const standard = { send: true, variant: 'standard', subject: campaign.subject, bodyHtml: campaign.bodyHtml };
  // Opt-in only. With it off this is exactly the previous behaviour — the
  // start/update/import gates are what keep gap leads out, as before.
  if (!fallbackUsable(campaign)) return standard;
  if (!(await leadHasAuditGap([campaign.subject, campaign.bodyHtml], lead._id))) return standard;
  return { send: true, variant: 'fallback', subject: s.fallbackSubject, bodyHtml: s.fallbackBodyHtml };
}

module.exports = {
  UNAUDITED_CRAWL_STATUSES,
  fallbackEnabled,
  fallbackProblem,
  fallbackUsable,
  leadHasAuditGap,
  chooseEmailContent,
};
