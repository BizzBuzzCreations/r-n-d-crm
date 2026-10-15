'use strict';
// Merge-tag rendering for campaign email.
//
// Extracted out of workers/campaignWorker.js so it can be required and
// exercised directly — requiring that file starts a BullMQ Worker and opens a
// Redis connection, which made the single most recipient-visible piece of
// logic in the codebase untestable. Nothing here does I/O: the one piece of
// environment it needs (the public base URL for tracking links) is injected
// by the caller via makeRenderer.
const { escHtml, escHeader } = require('./emailRender');

/**
 * @param {object} opts
 * @param {string} opts.apiBase  public origin for tracking links (the worker
 *   derives this from CAMPAIGN_TRACK_BASE_URL / CLIENT_URL and warns loudly
 *   when it is missing, which is why it is passed in rather than read here).
 */
function makeRenderer({ apiBase }) {
  const base = String(apiBase || '').replace(/\/$/, '');

  // Checkbox-style response options — one tracked link per configured option
  // (see Campaign.settings.responseOptions), each hitting
  // trackingController.trackResponse with its own ?option= value. Plain
  // tracked links, not AMP4Email — works in every client immediately, no
  // Google domain approval needed.
  function buildResponseOptionsHtml(options, token) {
    if (!Array.isArray(options) || !options.length) return '';
    const links = options.map((opt) => {
      const url = `${base}/api/campaigns/track/response/${token}?option=${encodeURIComponent(String(opt))}`;
      // The label is author-configured but still escaped — it ends up inside
      // an <a>, and an unescaped '<' there would break the surrounding markup.
      return `<p style="margin:4px 0;"><a href="${url}">${escHtml(opt)}</a></p>`;
    }).join('');
    return `<div style="margin:16px 0;">${links}</div>`;
  }

  // ── Website-audit merge tags ────────────────────────────────────────────
  // Populated only for leads pushed over from a Prospect Audit batch (see
  // CampaignLead.auditSnapshot). A campaign whose subject/body uses these is
  // refused at start time unless every pending lead's snapshot can actually
  // fill the specific tags used (utils/auditMergeTags.missingAuditDataFilter,
  // applied by utils/campaignReadiness.checkCampaignReady, which also re-runs
  // on updateCampaign while a campaign is live). There is deliberately no
  // per-lead check in the worker: a tag with no value renders as an empty
  // string, never the string "undefined".
  //
  // `esc` is the escaper for the surface being rendered — escHtml for a body,
  // escHeader for a subject.
  function renderAuditTags(template, lead, esc) {
    const a = (lead && lead.auditSnapshot) || {};
    const findings = Array.isArray(a.findings) ? a.findings : [];
    const lcp = a.lcpMs != null ? (Math.round(a.lcpMs / 100) / 10).toFixed(1) : '';
    const mb  = a.pageWeightKb != null ? (Math.round(a.pageWeightKb / 102.4) / 10).toFixed(1) : '';

    // A <ul> is meaningless in a subject line, so for the header surface the
    // same findings become a plain sentence run instead of markup.
    const asHeader = esc === escHeader;
    const list = !findings.length
      ? ''
      : asHeader
        ? findings.map((f) => esc(f.sentence)).join(' ')
        : `<ul style="margin:12px 0;padding-left:20px;">${findings
          .map((f) => `<li style="margin:4px 0;">${escHtml(f.sentence)}</li>`).join('')}</ul>`;

    return String(template || '')
      .replace(/\{\{\s*top_finding\s*\}\}/gi, esc(a.topFinding || findings[0]?.sentence || ''))
      .replace(/\{\{\s*finding_2\s*\}\}/gi, esc(findings[1]?.sentence || ''))
      .replace(/\{\{\s*finding_3\s*\}\}/gi, esc(findings[2]?.sentence || ''))
      .replace(/\{\{\s*findings_list\s*\}\}/gi, list)
      .replace(/\{\{\s*perf_score\s*\}\}/gi, a.perfMobile != null ? String(a.perfMobile) : '')
      .replace(/\{\{\s*perf_desktop\s*\}\}/gi, a.perfDesktop != null ? String(a.perfDesktop) : '')
      .replace(/\{\{\s*seo_score\s*\}\}/gi, a.seoScore != null ? String(a.seoScore) : '')
      .replace(/\{\{\s*lcp_seconds\s*\}\}/gi, lcp)
      .replace(/\{\{\s*page_weight_mb\s*\}\}/gi, mb)
      .replace(/\{\{\s*website\s*\}\}/gi, esc(a.website || ''))
      .replace(/\{\{\s*audit_tier\s*\}\}/gi, esc(a.tier || ''));
  }

  /**
   * @param {string} template
   * @param {object} lead     CampaignLead doc (needs .token for tracked links)
   * @param {string[]} responseOptions
   * @param {'html'|'header'} surface  'header' for the subject line.
   *   The subject is a header, not markup: HTML-escaping it shipped
   *   "Joe&#39;s Diner" to recipients. It gets escHeader instead, which keeps
   *   the value on one line so a newline in an imported CSV cell cannot
   *   terminate the Subject header and have the rest parsed as more headers.
   */
  function renderMergeTags(template, lead, responseOptions, surface = 'html') {
    const isHeader = surface === 'header';
    const esc = isHeader ? escHeader : escHtml;
    const token = (lead && lead.token) || '';
    return renderAuditTags(String(template || ''), lead, esc)
      // businessName wins when present (B2B import format — see
      // CampaignLead.businessName) so a template author writes {{first_name}}
      // exactly once, phrases the greeting however fits both cases (e.g. "Hi
      // team at {{first_name}}," reads correctly whether that resolves to a
      // person's first name or a company name), and never needs to know or
      // care which import format a given lead came from.
      // esc()-wrapped: these arrive from imported CSVs and Google Sheets.
      .replace(/\{\{\s*first_?name\s*\}\}/gi, esc((lead && (lead.businessName || lead.firstName)) || 'there'))
      .replace(/\{\{\s*last_?name\s*\}\}/gi, esc((lead && lead.lastName) || ''))
      .replace(/\{\{\s*email\s*\}\}/gi, esc((lead && lead.email) || ''))
      // Generic tracked-CTA redirect tag — lets a campaign's own template
      // design any button wherever it wants (e.g. `<a href="{{redirect_url}}">
      // Request a Call</a>`). Resolves to trackingController.requestCall,
      // which logs the click, surfaces the lead into the pipeline as "Call
      // Requested", then redirects to the campaign's configured destination.
      .replace(/\{\{\s*redirect_url\s*\}\}/gi, `${base}/api/campaigns/track/call-request/${token}`)
      // A block of <a> tags is meaningless in a subject line, so it resolves
      // to nothing there rather than dumping markup into the header.
      .replace(/\{\{\s*response_options\s*\}\}/gi, isHeader ? '' : buildResponseOptionsHtml(responseOptions, token));
  }

  return { renderMergeTags, renderAuditTags, buildResponseOptionsHtml };
}

/**
 * Should this queued follow-up still be sent?
 *
 * Nothing that ends a conversation touches followUpStatus: replySync sets
 * status 'replied', the unsubscribe handler sets 'unsubscribed', and a bounce
 * sets 'bounced' — all leaving followUpStatus on 'queued'. So checking only
 * followUpStatus (as the worker did) still mailed a follow-up to someone who
 * had already replied or opted out in the window between the dispatcher
 * queueing the job and the worker running it.
 *
 * Testing for exactly 'sent' covers every one of those outcomes at once,
 * rather than enumerating them and missing the next one added to the enum.
 *
 * @param {object} lead  a FRESHLY loaded CampaignLead (the worker re-reads it
 *   by id; the dispatcher's copy may be stale by the time the job runs)
 * @returns {{ send: boolean, reason: string }}
 */
function followUpStillValid(lead) {
  const status = lead && lead.status;
  if (status !== 'sent') {
    return { send: false, reason: `lead_status_${status || 'missing'}` };
  }
  return { send: true, reason: '' };
}

module.exports = { makeRenderer, followUpStillValid };
