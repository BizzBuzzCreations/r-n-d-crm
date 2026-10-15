'use strict';
// Shared between the sender (workers/campaignWorker.js, a separate daemon
// process) and the readiness check (utils/campaignReadiness.js, which runs in
// the API process). Lives in its own module so the API can ask "does this
// template need audit data?" without requiring the worker file — doing that
// would spin up a BullMQ Worker as a side effect.

// Merge tags that resolve from CampaignLead.auditSnapshot, i.e. only have a
// value for leads pushed over from a Prospect Audit batch.
const AUDIT_TAGS = [
  'top_finding', 'finding_2', 'finding_3', 'findings_list',
  'perf_score', 'perf_desktop', 'seo_score', 'lcp_seconds', 'page_weight_mb',
  'website', 'audit_tier',
];

/**
 * True if the template references any audit merge tag.
 * Used to refuse starting a campaign whose body promises prospect-specific
 * facts while its leads carry no audit data — the failure mode otherwise is
 * an email that reads "Your homepage takes  seconds to load".
 */
function usesAuditTags(template) {
  const s = String(template || '');
  return AUDIT_TAGS.some((t) => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`, 'i').test(s));
}

const tagUsed = (template, tag) =>
  new RegExp(`\\{\\{\\s*${tag}\\s*\\}\\}`, 'i').test(String(template || ''));

// Which snapshot field each tag actually reads, and what counts as "that field
// has no value to render".
//
// Checking only that a snapshot exists is not enough, which is the hole this
// closes: a prospect whose PageSpeed pass failed still gets a topFinding from
// the Tier-1 checks, so `topFinding !== ''` passes — while perfMobile, lcpMs
// and pageWeightKb are all null. A template using {{perf_score}} then renders
// "Google scores it /100 on mobile" and sends.
//
// `missing` is a Mongo condition that matches a lead for which this tag would
// render empty. Numeric fields test null/absent; strings also test ''; the
// positional finding tags test array length via a dotted index.
const TAG_FIELDS = {
  top_finding:    { field: 'topFinding',   missing: (p) => ({ $or: [{ [p]: '' }, { [p]: null }, { [p]: { $exists: false } }] }) },
  finding_2:      { field: 'findings.1',   missing: (p) => ({ [p]: { $exists: false } }) },
  finding_3:      { field: 'findings.2',   missing: (p) => ({ [p]: { $exists: false } }) },
  findings_list:  { field: 'findings.0',   missing: (p) => ({ [p]: { $exists: false } }) },
  perf_score:     { field: 'perfMobile',   missing: (p) => ({ $or: [{ [p]: null }, { [p]: { $exists: false } }] }) },
  perf_desktop:   { field: 'perfDesktop',  missing: (p) => ({ $or: [{ [p]: null }, { [p]: { $exists: false } }] }) },
  seo_score:      { field: 'seoScore',     missing: (p) => ({ $or: [{ [p]: null }, { [p]: { $exists: false } }] }) },
  lcp_seconds:    { field: 'lcpMs',        missing: (p) => ({ $or: [{ [p]: null }, { [p]: { $exists: false } }] }) },
  page_weight_mb: { field: 'pageWeightKb', missing: (p) => ({ $or: [{ [p]: null }, { [p]: { $exists: false } }] }) },
  website:        { field: 'website',      missing: (p) => ({ $or: [{ [p]: '' }, { [p]: null }, { [p]: { $exists: false } }] }) },
  audit_tier:     { field: 'tier',         missing: (p) => ({ $or: [{ [p]: '' }, { [p]: null }, { [p]: { $exists: false } }] }) },
};

/**
 * The audit tags actually present across the given templates.
 * @param {string[]} templates  subject/body/follow-up subject/follow-up body
 * @returns {string[]} tag names, in AUDIT_TAGS order
 */
function auditTagsUsed(templates) {
  const list = (Array.isArray(templates) ? templates : [templates]).filter(Boolean);
  return AUDIT_TAGS.filter((t) => list.some((tpl) => tagUsed(tpl, t)));
}

/**
 * Mongo filter matching a CampaignLead for which at least one of the audit
 * tags used by these templates would render empty.
 *
 * Returns null when the templates use no audit tags, so the caller can skip
 * the query entirely.
 *
 * @param {string[]} templates
 * @param {string} prefix  snapshot path prefix (default 'auditSnapshot')
 */
function missingAuditDataFilter(templates, prefix = 'auditSnapshot') {
  const tags = auditTagsUsed(templates);
  if (!tags.length) return null;

  const conditions = tags.map((t) => {
    const spec = TAG_FIELDS[t];
    return spec.missing(`${prefix}.${spec.field}`);
  });

  // A lead with no snapshot at all fails every one of these anyway (the paths
  // don't exist), so this needs no separate "snapshot missing" clause.
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

module.exports = { AUDIT_TAGS, usesAuditTags, auditTagsUsed, missingAuditDataFilter, TAG_FIELDS };
