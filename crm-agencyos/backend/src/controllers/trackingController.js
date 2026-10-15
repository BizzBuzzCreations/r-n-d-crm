'use strict';
// Public, unauthenticated endpoints — hit directly by email clients
// (tracking pixel image load, link clicks) and by recipients (unsubscribe
// page). No `protect` middleware on this router; identity comes entirely
// from the unguessable per-lead `token`.
const CampaignLead = require('../models/CampaignLead');
const Campaign = require('../models/Campaign');
const { syncCampaignLeadToPipeline } = require('../utils/leadPipelineSync');
const notifService = require('../services/notificationService');
const { notifyMainCrm } = require('../utils/mainCrmNotify');
const { HOT_OPEN_THRESHOLD, SCANNER_UA_PATTERNS, OPEN_NOTIFICATION_DELAY_GATE_MS } = require('../utils/campaignConstants');

// 1x1 transparent PNG
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

// See SCANNER_UA_PATTERNS in campaignConstants.js. A missing/empty UA is
// also treated as suspicious here — a real mail client's image fetch almost
// always sends one, so a bare fetch with none is more consistent with a
// stripped-down proxy/scanner request than a genuine reader.
function isLikelyScannerUA(userAgent) {
  if (!userAgent) return true;
  return SCANNER_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}

// GET /api/campaigns/track/open/:token.png
exports.trackOpen = async (req, res) => {
  const token = String(req.params.token || '').replace(/\.png$/i, '');
  const now = new Date();
  const io = req.app.get('io'); // grabbed before the async tail below, same as every other controller
  const userAgent = req.headers['user-agent'] || '';

  CampaignLead.findOneAndUpdate(
    { token },
    {
      $inc: { openCount: 1 },
      $set: { openedAt: now },
      // Keep a bounded history (last 50) — enough to distinguish a genuine
      // repeat-open pattern from a single prefetch, without unbounded growth.
      $push: { opens: { $each: [{ at: now, ip: req.ip || '', userAgent }], $slice: -50 } },
    },
    { new: true }
  ).then(async (updated) => {
    if (!updated) return;

    // Called on every open past the threshold, not just the first — safe/
    // idempotent by design (see leadPipelineSync.js), so it can't lose count
    // under rapid-fire opens racing each other.
    if (updated.openCount >= HOT_OPEN_THRESHOLD) {
      syncCampaignLeadToPipeline(updated, 'hot').catch(() => {});
    }

    // openCount === 1 right after the atomic increment is the same race-proof
    // "was this the very first" check used for WitSession.pageCount elsewhere
    // in this codebase — fires exactly once per lead, not on every reopen.
    if (updated.openCount === 1) {
      // Gmail Image Proxy, Apple Mail Privacy Protection, and corporate
      // security gateways (Mimecast, Proofpoint, Barracuda, etc.) all fetch
      // every image in an inbound email automatically at/near delivery time
      // — to scan for threats or pre-render a preview — before a human ever
      // opens it. Since the pixel GET fires unconditionally, that automated
      // fetch is otherwise indistinguishable from a genuine read. The open
      // itself is still always recorded above (openCount/opens[]/hot-lead
      // sync); only the human-facing "opened" notification is gated here,
      // on a known scanner/proxy UA or a hit landing suspiciously soon
      // after send (bots fetch near-instantly, real readers don't).
      const scannerUA = isLikelyScannerUA(userAgent);
      const withinDelayGate = !!updated.sentAt && (now - updated.sentAt) < OPEN_NOTIFICATION_DELAY_GATE_MS;

      if (scannerUA || withinDelayGate) {
        const reason = scannerUA ? 'scanner-ua' : 'delay-gate';
        const msSinceSent = updated.sentAt ? now - updated.sentAt : 'n/a';
        console.log(`[trackOpen] Suppressed open notification — token=${token} reason=${reason} ua="${userAgent}" msSinceSent=${msSinceSent}`);
      } else {
        const campaign = await Campaign.findById(updated.campaign).select('name subject').lean().catch(() => null);
        if (campaign) {
          const who = [updated.firstName, updated.lastName].filter(Boolean).join(' ') || updated.email;
          // Recipients are configured in Settings → Notification Routing
          // (defaults to admin+manager until an admin changes it) — see
          // notificationService.dispatchByRouting.
          notifService.dispatchByRouting(io, 'campaign', {
            type: 'email_opened',
            priority: 'success',
            title: 'Email opened',
            message: `${who} opened an email in campaign "${campaign.name}"`,
            link: `/campaigns/${campaign._id}`,
            metadata: { campaignId: String(campaign._id), campaignLeadId: String(updated._id) },
          }).catch(() => {});
          // Also report this to the main CRM (crms.bizzbuzzcreations.com) so
          // its own users get notified — see utils/mainCrmNotify.
          notifyMainCrm({ type: 'email_opened', email: updated.email, phone: updated.phone, subject: campaign.subject, campaignName: campaign.name });
        }
      }
    }
  }).catch(() => {}); // fire-and-forget — never delay/fail the pixel response

  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
  res.send(PIXEL);
};

// GET /api/campaigns/track/call-request/:token — a dedicated "Request a
// Call" button recipients click when they want a callback, instead of
// replying "CALL" to the email (the previous, reply-only way to signal
// this). Deliberately a separate endpoint from trackClick: a generic link
// click only bumps clickCount/clicks, it never surfaces the lead into the
// B2B pipeline — this one does, at the same "fires meaningfully once" tier
// as an actual reply, so sales can see exactly who wants to be called.
exports.requestCall = async (req, res) => {
  const token = String(req.params.token || '');
  const now = new Date();
  const io = req.app.get('io');

  // Mail security scanners (Safe Links, Proofpoint, Mimecast) and image/link
  // prefetchers hit every URL in an email with a plain GET before a human
  // sees it — the exact reason unsubscribe is split into a confirm page plus
  // a POST. This endpoint mutates on GET, so an unguarded scan manufactured a
  // "call requested" flag, a pipeline sync, a sales notification AND an
  // outbound report to the main CRM for someone who never clicked anything.
  // Gate the side effects (not the redirect) on the same UA heuristic the
  // open pixel already uses.
  const isScanner = isLikelyScannerUA(req.headers['user-agent'] || '');

  // Unlike trackOpen's pixel (which can't wait on anything before
  // responding), the redirect destination here genuinely depends on which
  // campaign the click belongs to, so this lookup has to be awaited.
  const updated = isScanner
    ? await CampaignLead.findOne({ token }).catch(() => null)
    : await CampaignLead.findOneAndUpdate(
      { token },
      { $set: { callRequested: true, callRequestedAt: now } },
      { new: true }
    ).catch(() => null);

  if (updated && !isScanner) syncCampaignLeadToPipeline(updated, 'call_requested').catch(() => {});

  // The public destination page recipients actually land on — a separate
  // site (e.g. debtfreepath), not this CRM. Per-campaign setting first
  // (Settings tab → "Redirect URL" — different campaigns/sending sites can
  // point at different destination pages with no server .env edit or
  // restart needed), then CALL_REQUEST_REDIRECT_URL in .env as a fallback
  // for campaigns that haven't set one, then this app's own URL as a last
  // resort so a misconfiguration never errors the recipient's click.
  let dest = '';
  if (updated) {
    const campaign = await Campaign.findById(updated.campaign).select('name subject settings.redirectUrl').lean().catch(() => null);
    dest = campaign?.settings?.redirectUrl?.trim() || '';

    // Fire-and-forget — a real visitor is waiting on this redirect, so the
    // notification must never be awaited/delay it (same principle as trackOpen).
    // Recipients are configured in Settings → Notification Routing — see
    // notificationService.dispatchByRouting.
    if (campaign && !isScanner) {
      const who = [updated.firstName, updated.lastName].filter(Boolean).join(' ') || updated.email;
      notifService.dispatchByRouting(io, 'campaign', {
        type: 'call_requested',
        priority: 'success',
        title: 'Call requested',
        message: `${who} requested a call in campaign "${campaign.name}"`,
        link: `/campaigns/${campaign._id}`,
        metadata: { campaignId: String(campaign._id), campaignLeadId: String(updated._id) },
      }).catch(() => {});
      // Also report this to the main CRM — see utils/mainCrmNotify.
      notifyMainCrm({ type: 'call_requested', email: updated.email, phone: updated.phone, subject: campaign.subject, campaignName: campaign.name });
    }
  }
  if (!dest) {
    dest = process.env.CALL_REQUEST_REDIRECT_URL
      || (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  }
  res.redirect(302, dest);
};

// GET /api/campaigns/track/response/:token?option=... — one of the
// checkbox-style response links from {{response_options}} (see
// workers/campaignWorker.js). Plain tracked link, not a redirect-to-a-site
// CTA like requestCall — the recipient just gets a thank-you page.
exports.trackResponse = async (req, res) => {
  const token = String(req.params.token || '');
  const option = String(req.query.option || '').slice(0, 200);
  const now = new Date();
  const io = req.app.get('io');

  res.set('Content-Type', 'text/html');
  if (!option) {
    return res.send(PAGE('Link no longer valid', `<h1>Link no longer valid</h1><p>No response option was specified.</p>`));
  }

  // Same scanner gate as requestCall — a prefetched response link used to
  // record an answer (and notify sales) that the recipient never chose.
  const isScanner = isLikelyScannerUA(req.headers['user-agent'] || '');
  if (isScanner) {
    return res.send(PAGE('Thanks!', `<h1>Thanks for letting us know</h1><p>We've recorded your response.</p>`));
  }

  const updated = await CampaignLead.findOneAndUpdate(
    { token },
    {
      $set: { responseOption: option, respondedAt: now },
      $push: { responses: { $each: [{ at: now, option }], $slice: -50 } },
    },
    { new: true }
  ).catch(() => null);

  if (updated) {
    syncCampaignLeadToPipeline(updated, 'response', { responseOption: option }).catch(() => {});

    const campaign = await Campaign.findById(updated.campaign).select('name subject').lean().catch(() => null);
    if (campaign) {
      const who = [updated.firstName, updated.lastName].filter(Boolean).join(' ') || updated.email;
      // Recipients configured in Settings → Notification Routing — see
      // notificationService.dispatchByRouting. Fire-and-forget, same
      // principle as every other tracking endpoint in this file.
      notifService.dispatchByRouting(io, 'campaign', {
        type: 'campaign_response',
        priority: 'success',
        title: 'Email response received',
        message: `${who} responded "${option}" in campaign "${campaign.name}"`,
        link: `/campaigns/${campaign._id}`,
        metadata: { campaignId: String(campaign._id), campaignLeadId: String(updated._id), option },
      }).catch(() => {});
      // IVA CRM's activity_type enum has no generic "responded" type — only
      // report this when the option text itself signals a callback request,
      // rather than mis-tagging every response (e.g. "Not interested") as one.
      if (/call/i.test(option)) {
        notifyMainCrm({ type: 'call_requested', email: updated.email, phone: updated.phone, subject: campaign.subject, campaignName: campaign.name });
      }
    }
  }

  res.send(PAGE('Thanks!', `<h1>Thanks for letting us know</h1><p>We've recorded your response${updated ? '' : ' link, though it looks like it may have already expired'}.</p>`));
};

// GET /api/campaigns/track/click/:token?url=...
exports.trackClick = async (req, res) => {
  const { token } = req.params;
  const rawUrl = req.query.url || '';

  let dest = null;
  try {
    const parsed = new URL(rawUrl);
    if (['http:', 'https:'].includes(parsed.protocol)) dest = parsed.toString();
  } catch { /* invalid URL — fall through to safe fallback below */ }

  const now = new Date();
  // Store ONLY the validated http(s) destination, never the raw param. The
  // protocol check above already keeps a `javascript:` URL out of the
  // redirect, but persisting `dest || rawUrl` still wrote it to the DB, and
  // CampaignDetailPage renders each click as <a href={e.url}> — so a
  // recipient could use their own tracking link to store an executable URL
  // that fires for whoever opens that campaign's click history.
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

  // Require the token to resolve before honouring an arbitrary ?url=. This
  // endpoint previously redirected anywhere on request regardless of whether
  // the token existed, which made the sending domain a free open redirect
  // for phishing. See BACKLOG.md — signing the url param at generation time
  // is the complete fix, but it needs a transition plan for emails already
  // sitting in inboxes with unsigned links.
  const lead = await CampaignLead.findOneAndUpdate(
    { token },
    {
      $inc: { clickCount: 1 },
      $set: { clickedAt: now },
      $push: { clicks: { $each: [{ at: now, url: dest || '' }], $slice: -50 } },
    }
  ).catch(() => null);

  res.redirect(302, (lead && dest) ? dest : clientUrl);
};

const PAGE = (title, body) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${title}</title>
<style>body{font-family:Arial,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.07);padding:40px;max-width:420px;text-align:center;}
h1{font-size:18px;color:#0f172a;margin:0 0 8px;}p{font-size:13.5px;color:#64748b;margin:0 0 16px;}
button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 24px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:Arial,sans-serif;}
button:hover{background:#4338ca;}</style></head>
<body><div class="card">${body}</div></body></html>`;

// GET /api/campaigns/unsubscribe/:token — shows a confirmation page WITHOUT
// unsubscribing yet. Email security scanners (Microsoft Safe Links,
// Proofpoint, Mimecast, Gmail's own link-checker) pre-fetch every link in
// an email with a plain GET before a human ever opens it — if GET itself
// mutated state, those automated scans would silently unsubscribe every
// recipient who never clicked anything. Only the POST below (a real form
// submit, or Gmail/Yahoo's RFC 8058 one-click header) actually unsubscribes.
exports.unsubscribeConfirm = async (req, res) => {
  const { token } = req.params;
  const lead = await CampaignLead.findOne({ token }).select('email status').lean().catch(() => null);

  res.set('Content-Type', 'text/html');
  if (!lead) {
    return res.send(PAGE('Link no longer valid', `<h1>Link no longer valid</h1><p>This unsubscribe link has already been used or has expired.</p>`));
  }
  if (lead.status === 'unsubscribed') {
    return res.send(PAGE('Already unsubscribed', `<h1>You're already unsubscribed</h1><p>${lead.email} will not receive further emails from this campaign.</p>`));
  }
  res.send(PAGE('Unsubscribe', `
    <h1>Unsubscribe ${lead.email}?</h1>
    <p>You will stop receiving emails from this campaign.</p>
    <form method="POST" action="/api/campaigns/unsubscribe/${token}">
      <button type="submit">Confirm unsubscribe</button>
    </form>`));
};

// POST /api/campaigns/unsubscribe/:token — performs the actual unsubscribe.
// Reached two ways: the confirm page's form submit (human clicked the
// button above), or an RFC 8058 one-click POST sent directly by Gmail/
// Yahoo when the recipient clicks their native "Unsubscribe" button next
// to the sender name — enabled by the List-Unsubscribe-Post header set in
// campaignWorker.js, which requires this endpoint to actually accept POST.
exports.unsubscribe = async (req, res) => {
  const { token } = req.params;
  const lead = await CampaignLead.findOneAndUpdate(
    { token },
    { status: 'unsubscribed', unsubscribedAt: new Date() },
    { new: true }
  ).catch(() => null);

  res.set('Content-Type', 'text/html');
  res.send(PAGE('Unsubscribed', `
    <h1>${lead ? "You've been unsubscribed" : 'Link no longer valid'}</h1>
    <p>${lead ? `${lead.email} will not receive further emails from this campaign.` : 'This unsubscribe link has already been used or has expired.'}</p>`));
};
