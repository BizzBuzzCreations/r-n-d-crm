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

module.exports = { AUDIT_TAGS, usesAuditTags };
