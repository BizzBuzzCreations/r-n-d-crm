// backend/src/workers/campaignWorker.js
// ── Standalone daemon — run via: npm run campaign-worker  OR  pm2 start ────
// Sends bulk campaign emails. Deliberately separate from emailWorker.js
// (transactional mail) — different reputation risk, different rate limits,
// and supports multiple sender accounts instead of one global SMTP config.
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// Same ENETUNREACH cause as the `family: 4` on the SMTP transporter below,
// but process-wide — covers ImapFlow too, which doesn't expose a direct
// family option but does rely on Node's default DNS resolver.
require('dns').setDefaultResultOrder('ipv4first');

const { Worker } = require('bullmq');
const nodemailer  = require('nodemailer');
const mongoose    = require('mongoose');
const Campaign     = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const EmailAccount = require('../models/EmailAccount');
const { resolveIPv4 } = require('../utils/ipv4');

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => console.log('✅ MongoDB connected (campaign worker)'))
  .catch((e) => console.error('⚠️  MongoDB connection failed:', e.message));

const redisConn = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

console.log('\n══════════════════════════════════════════════════');
console.log('  BizzBuzz CRM — Campaign Worker v1.0');
console.log('══════════════════════════════════════════════════');
console.log(`  Redis   : ${redisConn.host}:${redisConn.port}`);
console.log('══════════════════════════════════════════════════\n');

const ts  = () => new Date().toISOString().replace('T', ' ').slice(0, 23);
const log = (...a) => console.log(`[${ts()}]`, ...a);
const err = (...a) => console.error(`[${ts()}] ❌`, ...a);

let sysLog = { info: () => {}, warn: () => {}, error: () => {} };
try { sysLog = require('../utils/sysLogger').logger; } catch {}

// `family: 4` on the transporter and the process-wide dns.setDefaultResultOrder
// above both *ask* for IPv4, but neither actually guarantees nodemailer's
// internal connection path honors it. `resolveIPv4` (utils/ipv4.js) resolves
// the hostname to a literal IPv4 address ourselves and hands nodemailer that
// IP directly — same reliable public-resolver approach already used for
// MX/SPF/DKIM lookups elsewhere, so it doesn't depend on this host's
// possibly-broken default resolver either.

// ── Per-account transporter cache ────────────────────────────────────────
// Pooled connections reused across sends (same deliverability rationale as
// emailWorker.js), keyed by EmailAccount id so each sender account gets its
// own connection pool and its own ~5msg/sec throttle.
const transporterCache = new Map();

async function getTransporter(account) {
  const key = String(account._id);
  if (transporterCache.has(key)) return transporterCache.get(key);

  const ip = await resolveIPv4(account.smtpHost);
  if (ip) log(`Resolved ${account.smtpHost} -> ${ip} (IPv4)`);
  else log(`Could not resolve an IPv4 address for ${account.smtpHost} — connecting by hostname, may hit ENETUNREACH again if it has an AAAA record`);

  const transporter = nodemailer.createTransport({
    host:   ip || account.smtpHost, // connect via the literal IPv4 address when we have one
    port:   account.smtpPort,
    secure: account.smtpSecure,
    auth:   { user: account.smtpUser, pass: (account.smtpPass || '').replace(/\s/g, '') },
    pool:   true,
    maxConnections: 2,
    maxMessages:    100,
    rateDelta:      1000,
    rateLimit:      5, // max 5 messages/sec per account
    tls: {
      rejectUnauthorized: !account.smtpAllowInsecureTLS,
      minVersion: 'TLSv1.2',
      servername: account.smtpHost, // required for correct cert validation/SNI when connecting by raw IP
    },
    socketTimeout: 10000,
    greetingTimeout: 10000,
    connectionTimeout: 10000,
    family: 4, // belt-and-braces if `ip` resolution above ever falls back to the hostname
  });
  transporterCache.set(key, transporter);
  return transporter;
}

// ── Merge tags ────────────────────────────────────────────────────────────
// Checkbox-style response options — one tracked link per configured option
// (see Campaign.settings.responseOptions), each hitting
// trackingController.trackResponse with its own ?option= value. Plain
// tracked links, not AMP4Email — works in every client immediately, no
// Google domain approval needed.
function buildResponseOptionsHtml(options, token) {
  if (!Array.isArray(options) || !options.length) return '';
  const links = options.map((opt) => {
    const url = `${apiBase}/api/campaigns/track/response/${token}?option=${encodeURIComponent(opt)}`;
    return `<p style="margin:4px 0;"><a href="${url}">${opt}</a></p>`;
  }).join('');
  return `<div style="margin:16px 0;">${links}</div>`;
}

// Everything substituted into an email body is HTML-escaped. Lead fields come
// from imported CSVs and public forms, and audit sentences embed values read
// off the prospect's own page — none of it should be able to inject markup
// into the email (or into the campaign preview that renders the same HTML).
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ── Website-audit merge tags ──────────────────────────────────────────────
// Populated only for leads pushed over from a Prospect Audit batch (see
// CampaignLead.auditSnapshot). A campaign body that uses these is refused at
// start time unless its pending leads actually carry a snapshot
// (utils/campaignReadiness.js), and the dispatcher fails any individual lead
// that slipped through — an email reading "takes undefined seconds" is worse
// than no email at all.
function renderAuditTags(template, lead) {
  const a = lead.auditSnapshot || {};
  const findings = Array.isArray(a.findings) ? a.findings : [];
  const lcp = a.lcpMs != null ? (Math.round(a.lcpMs / 100) / 10).toFixed(1) : '';
  const mb  = a.pageWeightKb != null ? (Math.round(a.pageWeightKb / 102.4) / 10).toFixed(1) : '';

  const list = findings.length
    ? `<ul style="margin:12px 0;padding-left:20px;">${findings
      .map((f) => `<li style="margin:4px 0;">${esc(f.sentence)}</li>`).join('')}</ul>`
    : '';

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

function renderMergeTags(template, lead, responseOptions) {
  return renderAuditTags(String(template || ''), lead)
    // businessName wins when present (B2B import format — see
    // CampaignLead.businessName) so a template author writes {{first_name}}
    // exactly once, phrases the greeting however fits both cases (e.g. "Hi
    // team at {{first_name}}," reads correctly whether that resolves to a
    // person's first name or a company name), and never needs to know or
    // care which import format a given lead came from.
    // esc()-wrapped: these arrive from imported CSVs and Google Sheets, so an
    // ampersand or a stray tag in a business name would otherwise land raw in
    // the email HTML.
    .replace(/\{\{\s*first_?name\s*\}\}/gi, esc(lead.businessName || lead.firstName || 'there'))
    .replace(/\{\{\s*last_?name\s*\}\}/gi, esc(lead.lastName || ''))
    .replace(/\{\{\s*email\s*\}\}/gi, esc(lead.email || ''))
    // Generic tracked-CTA redirect tag — lets a campaign's own template
    // design any button wherever it wants (e.g. `<a href="{{redirect_url}}">
    // Request a Call</a>`), not just this one "Request a Call" use case.
    // Resolves to trackingController.requestCall, which logs the click,
    // surfaces the lead into the pipeline as "Call Requested" (today's only
    // use of this tag), then redirects to the campaign's configured
    // destination (Settings tab → "Redirect URL"). `lead` here is the
    // CampaignLead doc, so `.token` (used for open/click/unsubscribe
    // tracking already) is available.
    .replace(/\{\{\s*redirect_url\s*\}\}/gi, `${apiBase}/api/campaigns/track/call-request/${lead.token}`)
    .replace(/\{\{\s*response_options\s*\}\}/gi, buildResponseOptionsHtml(responseOptions, lead.token));
}

// ── Tracking / unsubscribe injection ─────────────────────────────────────
const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
const apiBase   = process.env.CAMPAIGN_TRACK_BASE_URL
  ? process.env.CAMPAIGN_TRACK_BASE_URL.replace(/\/$/, '')
  : clientUrl; // frontend origin proxies /api to the backend in both dev + prod (see app.js SPA fallback)

// This silent fallback is exactly what breaks every open-pixel/click/
// unsubscribe link a recipient actually receives if CLIENT_URL isn't set
// for THIS process specifically (PM2 processes each read their own env —
// it working for the main API process doesn't guarantee it's set here
// too). Recipients obviously can't reach a localhost URL, so make this
// loud instead of a link that just quietly doesn't work.
if (!process.env.CAMPAIGN_TRACK_BASE_URL && (!process.env.CLIENT_URL || apiBase.includes('localhost'))) {
  console.error(`\n🚨 CLIENT_URL is not set (or is localhost) for the campaign-worker process!`);
  console.error(`   Every tracking pixel, click link, and unsubscribe link in outgoing campaign`);
  console.error(`   emails will be built as "${apiBase}/..." — unreachable by real recipients.`);
  console.error(`   Fix: set CLIENT_URL in backend/.env to your public domain and restart this process.\n`);
  sysLog.error('CAMPAIGN', `CLIENT_URL not set for campaign-worker — outgoing links point at ${apiBase}`);
}

function rewriteLinksForClickTracking(html, token) {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (m, url) => {
    // Don't double-wrap a link that's already one of our own tracking
    // endpoints (e.g. {{redirect_url}}, resolved earlier by
    // renderMergeTags) — it's already tracked as its own distinct signal,
    // wrapping it again would just add a redundant hop and inflate
    // clickCount alongside the more specific signal it already recorded.
    if (url.startsWith(apiBase)) return m;
    const redirect = `${apiBase}/api/campaigns/track/click/${token}?url=${encodeURIComponent(url)}`;
    return `href="${redirect}"`;
  });
}

function appendOpenPixel(html, token) {
  // No `display:none` — a hidden 1x1 image is a well-known spam-filter
  // signature (real senders don't hide their pixel, spammers do). A plain
  // 1x1 image is already visually negligible without needing to hide it.
  return `${html}<img src="${apiBase}/api/campaigns/track/open/${token}.png" width="1" height="1" alt="" style="border:0;" />`;
}

function appendUnsubscribeFooter(html, token, account) {
  const unsubUrl = `${apiBase}/api/campaigns/unsubscribe/${token}`;
  return `${html}
    <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;">
      You are receiving this because ${account.fromName || account.email} contacted you.
      <a href="${unsubUrl}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>
    </p>`;
}

function stripToPlain(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Stripping tags below would otherwise throw away every href along with
    // its <a> tag, leaving only the visible link text — for text-only sends
    // (settings.textOnly), this is the ONLY copy of the email that goes out,
    // so a "click here" link would silently lose its URL entirely. Inline
    // the URL next to the link text before the generic tag strip runs.
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url, inner) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return label && label !== url ? `${label} (${url})` : url;
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const spamSafeHeaders = (account, unsubUrl) => ({
  'X-Priority':     '3',
  'X-Mailer':       'BizzBuzz CRM Campaign Service',
  'Importance':     'Normal',
  // Only advertise List-Unsubscribe when there's actually an unsubscribe
  // link/mechanism in this send (settings.includeUnsubscribeLink) — omitted
  // entirely otherwise rather than pointing at a link that isn't in the body.
  ...(unsubUrl ? {
    'List-Unsubscribe':      `<${unsubUrl}>, <mailto:${account.smtpUser}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  } : {}),
  'Precedence': 'bulk',
});

// ── Worker ───────────────────────────────────────────────────────────────
// Handles both the original send (job name CAMPAIGN_EMAIL) and the
// auto-follow-up send (CAMPAIGN_FOLLOWUP_EMAIL, see cron/followUpDispatcher.js)
// — same queue, same transporter cache, same SMTP-error classification, but
// the follow-up writes to its own followUpStatus/followUpSentAt/
// followUpAccountUsed/followUpError fields so it never overwrites the
// original send's outcome.
const worker = new Worker('campaign-queue', async (job) => {
  const { campaignLeadId } = job.data;
  const isFollowUp = job.name === 'CAMPAIGN_FOLLOWUP_EMAIL';

  const lead = await CampaignLead.findById(campaignLeadId);
  if (!lead) { log(`Job ${job.id} — lead ${campaignLeadId} not found, discarding`); return { skipped: true }; }

  // Re-check status — the lead may have changed state between the dispatcher
  // scheduling it and the worker picking it up.
  const inFlightStatuses = isFollowUp ? ['queued', 'sending'] : ['scheduled', 'sending'];
  const currentStatus = isFollowUp ? lead.followUpStatus : lead.status;
  if (!inFlightStatuses.includes(currentStatus)) {
    log(`Job ${job.id} — lead ${lead.email} ${isFollowUp ? 'followUpStatus' : 'status'} is "${currentStatus}", skipping send`);
    return { skipped: true, reason: currentStatus };
  }

  const campaign = await Campaign.findById(lead.campaign);
  if (!campaign) {
    if (isFollowUp) { lead.followUpStatus = 'failed'; lead.followUpError = 'Campaign not found'; }
    else { lead.status = 'failed'; lead.error = 'Campaign not found'; }
    await lead.save();
    return { skipped: true };
  }

  const accountId = isFollowUp ? lead.followUpAccountUsed : lead.accountUsed;
  const account = await EmailAccount.findById(accountId).select('+smtpPassEncrypted');
  if (!account) {
    // Don't throw here — throwing would make BullMQ retry, but a retry can
    // never succeed (the account is gone, not temporarily unreachable), and
    // the lead is already 'failed' so the status guard above would just
    // skip it anyway, wasting 2 retries with backoff for nothing.
    if (isFollowUp) { lead.followUpStatus = 'failed'; lead.followUpError = 'Sending account not found'; }
    else { lead.status = 'failed'; lead.error = 'Sending account not found'; }
    await lead.save();
    return { skipped: true, reason: 'account_not_found' };
  }

  if (isFollowUp) lead.followUpStatus = 'sending'; else lead.status = 'sending';
  await lead.save();

  const subject = renderMergeTags(isFollowUp ? campaign.settings.followUpSubject : campaign.subject, lead, campaign.settings.responseOptions);
  let html = renderMergeTags(isFollowUp ? campaign.settings.followUpBodyHtml : campaign.bodyHtml, lead, campaign.settings.responseOptions);
  // Opt-out toggle, defaults true — see Campaign.js for why this isn't
  // off by default. `unsubUrl` stays null (not just an unused string) when
  // disabled so spamSafeHeaders() below can tell there's truly no
  // unsubscribe mechanism in this send, not just skip using it.
  const includeUnsub = campaign.settings.includeUnsubscribeLink !== false;
  const unsubUrl = includeUnsub ? `${apiBase}/api/campaigns/unsubscribe/${lead.token}` : null;

  // Campaigns here send a single email (no multi-step sequence yet), so
  // "first email" and "every email" are the same thing — both settings
  // drive the same text-only decision until sequences exist.
  const sendAsTextOnly = !!(campaign.settings.textOnly || campaign.settings.firstEmailTextOnly);

  if (campaign.settings.linkTracking) html = rewriteLinksForClickTracking(html, lead.token);
  if (includeUnsub) html = appendUnsubscribeFooter(html, lead.token, account);
  if (campaign.settings.openTracking && !sendAsTextOnly) html = appendOpenPixel(html, lead.token);

  const text = stripToPlain(html);

  log(`📨 Job ${job.id}${isFollowUp ? ' [follow-up]' : ''} | campaign="${campaign.name}" → ${lead.email} via ${account.email} | attempt=${job.attemptsMade + 1}/${job.opts?.attempts || 3}`);

  const transporter = await getTransporter(account);
  const mailOptions = {
    from:    `"${account.fromName || account.name}" <${account.email}>`,
    to:      lead.email,
    replyTo: account.replyTo || account.email,
    subject,
    text,
    headers: spamSafeHeaders(account, unsubUrl),
  };
  if (!sendAsTextOnly) mailOptions.html = html;

  try {
    const info = await transporter.sendMail(mailOptions);
    if (isFollowUp) {
      lead.followUpStatus = 'sent';
      lead.followUpSentAt = new Date();
      lead.followUpError = '';
    } else {
      lead.status = 'sent';
      lead.sentAt = new Date();
      lead.error = '';
    }
    await lead.save();
    EmailAccount.updateOne({ _id: account._id }, { $inc: { totalSent: 1 } }).catch(() => {});
    log(`✅ Delivered — job ${job.id}${isFollowUp ? ' [follow-up]' : ''} | msgId=${info.messageId}`);
    sysLog.info('CAMPAIGN', `Campaign "${campaign.name}" ${isFollowUp ? 'follow-up ' : ''}email delivered to ${lead.email} via ${account.email}`);
    return { messageId: info.messageId };
  } catch (smtpErr) {
    const code = smtpErr.responseCode;

    // An SMTP AUTH failure (535/534/530, or nodemailer's own EAUTH code) is
    // NOT a statement about the recipient's mailbox — it happens before the
    // message is even addressed to them, because THIS ACCOUNT'S credentials
    // are wrong. Classifying it as a bounce (as any other 5xx would be)
    // would wrongly brand a perfectly good lead as undeliverable forever,
    // AND — far worse — every other lead the dispatcher subsequently routes
    // through this same broken account would identically "bounce" too,
    // silently mislabeling a whole campaign's worth of good addresses.
    const isAuthFailure = smtpErr.code === 'EAUTH' || (typeof code === 'number' && [530, 534, 535].includes(code));

    if (isAuthFailure) {
      transporterCache.delete(String(account._id)); // cached creds are dead, don't keep reusing them
      // Take the account out of rotation immediately so the dispatcher stops
      // routing more leads through it — surfaces in Connected Mailboxes /
      // Diagnose as "inactive" with the real error, same as a failed Test.
      await EmailAccount.updateOne(
        { _id: account._id },
        { isActive: false, lastSmtpVerifiedAt: new Date(), lastSmtpVerifyError: (smtpErr.message || 'Authentication failed').slice(0, 300) }
      );
      // Not this lead's fault — put it back to pending/none so it's naturally
      // retried (via a different account, or this one once re-enabled)
      // instead of being permanently marked failed/bounced.
      if (isFollowUp) {
        lead.followUpStatus = 'none';
        lead.followUpAccountUsed = null;
        lead.followUpError = '';
      } else {
        lead.status = 'pending';
        lead.accountUsed = null;
        lead.error = '';
      }
      await lead.save();
      err(`SMTP AUTH failed for account ${account.email} — deactivated, lead ${lead.email}${isFollowUp ? ' follow-up' : ''} reverted: ${smtpErr.message}`);
      sysLog.error('CAMPAIGN', `Account ${account.email} deactivated after SMTP AUTH failure: ${smtpErr.message}`);
      return { authFailed: true };
    }

    // 5xx SMTP response = permanent rejection (bad/nonexistent mailbox) —
    // a hard bounce. Retrying won't help, so don't throw (which would make
    // BullMQ retry 3x with backoff) — just record it and move on. Anything
    // else (4xx, connection errors, timeouts) is transient — throw to retry.
    const isHardBounce = typeof code === 'number' && code >= 500 && code < 600;
    const maxAttempts = job.opts?.attempts || 3;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    // Connection-level failures (timeout, refused, unreachable — as opposed
    // to an SMTP protocol response) can mean the pooled connection latched
    // onto an unreachable address (e.g. one bad edge IP behind an anycast
    // host). Drop the cached transporter so the retry re-resolves DNS and
    // gets a fresh connection — possibly to a different, reachable address.
    if (!isHardBounce && ['ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ESOCKET'].includes(smtpErr.code)) {
      transporterCache.delete(String(account._id));
    }

    // Only mark the lead terminally 'failed' once BullMQ has exhausted all
    // retries — a lead left in 'failed' after the first of 3 attempts would
    // never actually be retried, since the status guard above skips any
    // lead that isn't in an in-flight state. Keep it 'sending' in between so
    // the next retry attempt is allowed to run. followUpStatus has no
    // separate 'bounced' state (a hard bounce and a permanently-failed
    // follow-up both just mean "give up, don't retry") — map both to 'failed'.
    const errMessage = smtpErr.message?.slice(0, 500) || 'Unknown SMTP error';
    if (isFollowUp) {
      lead.followUpStatus = (isHardBounce || isLastAttempt) ? 'failed' : 'sending';
      lead.followUpError = errMessage;
    } else {
      lead.status = isHardBounce ? 'bounced' : (isLastAttempt ? 'failed' : 'sending');
      lead.error = errMessage;
    }
    await lead.save();
    err(`SMTP send failed — job ${job.id}${isFollowUp ? ' [follow-up]' : ''} | ${lead.email}: ${smtpErr.message}${isHardBounce ? ' (hard bounce, not retrying)' : ''}`);
    sysLog.error('CAMPAIGN', `Job ${job.id} ${isHardBounce ? 'bounced' : 'failed'} — ${lead.email}: ${smtpErr.message}`);
    if (isHardBounce) return { bounced: true };
    throw smtpErr;
  }
}, { connection: redisConn, concurrency: 5 });

worker.on('ready', () => { log('✅ Worker ready — listening on "campaign-queue"'); sysLog.info('WORKER', 'Campaign worker ready'); });
worker.on('failed', (job, e) => {
  const attempts = job?.attemptsMade ?? '?';
  const max = job?.opts?.attempts ?? 3;
  err(`Job ${job?.id} FAILED (${attempts}/${max}) — ${e.message}`);
});
worker.on('error', (e) => err('Worker error:', e.message));

const shutdown = async (sig) => {
  log(`${sig} — closing worker gracefully…`);
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
