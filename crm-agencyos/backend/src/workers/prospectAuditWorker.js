// backend/src/workers/prospectAuditWorker.js
// ── Standalone daemon — run via: npm run prospect-audit-worker ────────────
// Crawls prospect websites (Tier 1: plain HTTP fetch + cheerio, Tier 2:
// Google PageSpeed Insights). No browser/Playwright — that's an explicitly
// deferred Tier 3, not built here. Same skeleton as campaignWorker.js:
// own mongoose connection (separate process), own BullMQ Worker, graceful
// shutdown.
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dns').setDefaultResultOrder('ipv4first');

// cheerio pulls in undici, whose Fetch-API webidl module references the
// global `File` class at require-time (not lazily) — that global only
// exists natively from Node 20 onward, so on older Node this throws
// "ReferenceError: File is not defined" before the worker even starts.
// We never construct File objects ourselves (only cheerio.load() on
// already-fetched HTML, never cheerio's own fetch/File-consuming helpers),
// so a minimal stand-in is enough to satisfy the module-load reference.
if (typeof globalThis.File === 'undefined') {
  try {
    const { File } = require('node:buffer');
    if (File) globalThis.File = File;
  } catch { /* node:buffer has no File export on this Node version either */ }
}
if (typeof globalThis.File === 'undefined' && typeof globalThis.Blob !== 'undefined') {
  globalThis.File = class File extends globalThis.Blob {
    constructor(chunks, name, options = {}) {
      super(chunks, options);
      this.name = name;
      this.lastModified = options.lastModified ?? Date.now();
    }
  };
}

const { Worker } = require('bullmq');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const ProspectAudit = require('../models/ProspectAudit');
const ProspectAuditBatch = require('../models/ProspectAuditBatch');
const { SystemSettings } = require('../models/index');
const { calculateProspectScores } = require('../utils/prospectScoring');
const { buildFindings } = require('../utils/auditFindings');

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => console.log('✅ MongoDB connected (prospect audit worker)'))
  .catch((e) => console.error('⚠️  MongoDB connection failed:', e.message));

const redisConn = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

console.log('\n══════════════════════════════════════════════════');
console.log('  BizzBuzz CRM — Prospect Audit Worker v1.0');
console.log('══════════════════════════════════════════════════');
console.log(`  Redis   : ${redisConn.host}:${redisConn.port}`);
console.log('══════════════════════════════════════════════════\n');

const ts  = () => new Date().toISOString().replace('T', ' ').slice(0, 23);
const log = (...a) => console.log(`[${ts()}]`, ...a);
const err = (...a) => console.error(`[${ts()}] ❌`, ...a);

let sysLog = { info: () => {}, warn: () => {}, error: () => {} };
try { sysLog = require('../utils/sysLogger').logger; } catch {}

const FETCH_TIMEOUT_MS = 10000;
// PageSpeed Insights runs a full Lighthouse pass on Google's side before it
// responds — routinely 10-30s, sometimes more on a slow target site. Sharing
// the 10s page-fetch timeout above meant essentially every PSI call aborted
// (`This operation was aborted` in prospect-audit.log) and the audit silently
// fell back to Tier 1 only. It needs its own, much longer budget.
const PSI_TIMEOUT_MS = 60000;
const PSI_ATTEMPTS = 2;
// Hard cap on how much HTML we'll pull into memory per page. Prospect URLs
// come from imported lists, so the size of what's on the other end is not
// something this worker controls.
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const CMS_SIGNATURES = [
  { pattern: /wp-content|wp-includes/i, name: 'WordPress' },
  { pattern: /cdn\.shopify\.com|shopify/i, name: 'Shopify' },
  { pattern: /static\.wixstatic\.com|wix\.com/i, name: 'Wix' },
  { pattern: /squarespace/i, name: 'Squarespace' },
  { pattern: /webflow/i, name: 'Webflow' },
];
const ANALYTICS_SIGNATURES = /googletagmanager\.com|google-analytics\.com|gtag\(|analytics\.js/i;
const ADS_PIXEL_SIGNATURES = /googleadservices\.com|google_conversion|connect\.facebook\.net|fbevents\.js|fbq\(/i;

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timeout);
  }
}

// Read a response body with a hard size ceiling, so one oversized page can't
// exhaust this worker's memory (concurrency 5 means 5 of these at once).
async function readCappedText(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, MAX_HTML_BYTES);
  const chunks = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_HTML_BYTES).toString('utf8');
}

async function checkPathExists(baseUrl, path) {
  try {
    const res = await fetchWithTimeout(new URL(path, baseUrl).toString(), { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// Cheap, bounded broken-link check — following EVERY internal link would be
// far too slow at scale, so this samples a handful and calls it a day. Good
// enough as a signal, not meant to be exhaustive.
async function countBrokenLinks(baseUrl, links) {
  const sample = links.slice(0, 5);
  let broken = 0;
  for (const href of sample) {
    try {
      const res = await fetchWithTimeout(href, { method: 'GET' });
      if (!res.ok) broken++;
    } catch {
      broken++;
    }
  }
  return broken;
}

async function runTier1(website) {
  const res = await fetchWithTimeout(website, { method: 'GET' });
  const finalUrl = res.url || website;

  // A 403/404/500 body is still perfectly parseable HTML, so without this
  // check an error page (or a bot wall) got scored as if it were the real
  // site — producing confident findings like "no title tag" or "no SSL" that
  // describe Cloudflare's block page, not the prospect's homepage. Those
  // findings are destined for a cold email, so a wrong one is worse than
  // none: fail the crawl instead, and let the status say why.
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.httpStatus = res.status;
    throw e;
  }

  const html = await readCappedText(res);
  const $ = cheerio.load(html);

  const hasSSL = finalUrl.startsWith('https://');
  const hasViewportTag = $('meta[name="viewport"]').length > 0;
  const title = ($('title').first().text() || '').trim().slice(0, 300);
  const metaDescription = ($('meta[name="description"]').attr('content') || '').trim().slice(0, 500);
  const h1Present = $('h1').length > 0;

  const scripts = $('script[src]').map((_, el) => $(el).attr('src') || '').get().join(' ')
    + ' ' + $('script:not([src])').map((_, el) => $(el).html() || '').get().join(' ');
  const hasAnalytics = ANALYTICS_SIGNATURES.test(scripts);
  const hasAdsPixel = ADS_PIXEL_SIGNATURES.test(scripts);

  let cmsPlatform = '';
  const generator = ($('meta[name="generator"]').attr('content') || '').trim();
  const pageSignature = html.slice(0, 20000); // cap — full HTML can be large, signatures live near the top/head
  for (const sig of CMS_SIGNATURES) {
    if (sig.pattern.test(generator) || sig.pattern.test(pageSignature)) { cmsPlatform = sig.name; break; }
  }

  const internalLinks = $('a[href]')
    .map((_, el) => $(el).attr('href') || '')
    .get()
    .filter((href) => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:'))
    .map((href) => { try { return new URL(href, finalUrl).toString(); } catch { return null; } })
    .filter((href) => href && new URL(href).hostname === new URL(finalUrl).hostname);

  const hasBlog = internalLinks.some((l) => /\/(blog|news|articles)\b/i.test(l));
  const hasContactForm = $('form').toArray().some((f) => {
    const $f = $(f);
    return $f.find('input[type="email"]').length > 0
      || /contact/i.test($f.attr('id') || '')
      || /contact/i.test($f.attr('action') || '')
      || /contact/i.test($f.attr('class') || '');
  });

  const [hasSitemap, hasRobotsTxt, brokenLinksCount] = await Promise.all([
    checkPathExists(finalUrl, '/sitemap.xml'),
    checkPathExists(finalUrl, '/robots.txt'),
    countBrokenLinks(finalUrl, [...new Set(internalLinks)]),
  ]);

  // ── Extended SEO checklist findings — all from the same fetched HTML,
  // no extra network requests beyond what's already made above. ──────────
  const canonicalHref = $('link[rel="canonical"]').attr('href') || '';
  const hasCanonicalTag = !!canonicalHref;
  let canonicalMatchesUrl = null;
  if (hasCanonicalTag) {
    try {
      const canonicalAbs = new URL(canonicalHref, finalUrl).toString().replace(/\/$/, '');
      canonicalMatchesUrl = canonicalAbs === finalUrl.replace(/\/$/, '');
    } catch { canonicalMatchesUrl = null; }
  }

  const robotsMeta = `${$('meta[name="robots"]').attr('content') || ''} ${$('meta[name="googlebot"]').attr('content') || ''}`;
  const hasNoindexTag = /noindex/i.test(robotsMeta);

  const h2Count = $('h2').length;
  const h3Count = $('h3').length;

  const images = $('img').toArray();
  const imageCount = images.length;
  const imagesWithAltCount = images.filter((img) => ($(img).attr('alt') || '').trim().length > 0).length;
  const modernImageFormatCount = images.filter((img) => /\.(webp|avif)(\?|$)/i.test($(img).attr('src') || '')).length;

  const structuredDataScripts = $('script[type="application/ld+json"]').toArray();
  const hasStructuredData = structuredDataScripts.length > 0;
  const structuredDataTypes = [];
  for (const el of structuredDataScripts) {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const type = item?.['@type'];
        if (type) structuredDataTypes.push(...(Array.isArray(type) ? type : [type]));
      }
    } catch { /* malformed JSON-LD — skip rather than fail the whole crawl over it */ }
  }

  const hasHreflang = $('link[rel="alternate"][hreflang]').length > 0;

  const allAnchors = $('a[href]').toArray();
  const hasPrivacyPolicy = allAnchors.some((a) => /privacy/i.test($(a).attr('href') || '') || /privacy/i.test($(a).text() || ''));
  const hasTermsPage = allAnchors.some((a) => /terms/i.test($(a).attr('href') || '') || /terms/i.test($(a).text() || ''));

  const thirdPartyDomains = new Set();
  for (const src of $('script[src]').map((_, el) => $(el).attr('src') || '').get()) {
    try {
      const u = new URL(src, finalUrl);
      if (u.hostname !== new URL(finalUrl).hostname) thirdPartyDomains.add(u.hostname);
    } catch { /* relative/invalid src — not a third party, skip */ }
  }

  return {
    httpStatus: res.status,
    hasSSL, hasViewportTag, title, metaDescription, h1Present,
    hasAnalytics, hasAdsPixel, cmsPlatform, hasBlog, hasContactForm,
    hasSitemap, hasRobotsTxt, brokenLinksCount,
    hasCanonicalTag, canonicalMatchesUrl, hasNoindexTag, h2Count, h3Count,
    imageCount, imagesWithAltCount, modernImageFormatCount,
    hasStructuredData, structuredDataTypes: [...new Set(structuredDataTypes)],
    hasHreflang, hasPrivacyPolicy, hasTermsPage,
    thirdPartyScriptCount: thirdPartyDomains.size,
  };
}

async function runTier2(website, apiKey) {
  const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(website)}&key=${encodeURIComponent(apiKey)}&category=performance&category=seo&category=accessibility&category=best-practices&strategy=mobile`;

  // PSI is independently flaky (transient 429/500s, Lighthouse timing out on
  // the target site) and a single failure used to mean no performance data at
  // all for that prospect, which in turn silently skewed scoring. One cheap
  // retry recovers most of those.
  let res, lastErr;
  for (let attempt = 1; attempt <= PSI_ATTEMPTS; attempt++) {
    try {
      res = await fetchWithTimeout(url, { method: 'GET' }, PSI_TIMEOUT_MS);
      if (res.ok) break;
      const body = await res.text().catch(() => '');
      lastErr = new Error(`PSI HTTP ${res.status}: ${body.slice(0, 200)}`);
      res = null;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error(`PSI timed out after ${PSI_TIMEOUT_MS}ms`) : e;
      res = null;
    }
    if (attempt < PSI_ATTEMPTS) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!res) throw lastErr || new Error('PSI failed');

  const data = await res.json();
  const categories = data?.lighthouseResult?.categories || {};
  const audits = data?.lighthouseResult?.audits || {};
  const pct = (v) => (v?.score != null ? Math.round(v.score * 100) : null);

  const failedAudits = Object.values(audits)
    .filter((a) => a && typeof a.score === 'number' && a.score < 0.9 && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative')
    .map((a) => a.id)
    .slice(0, 20);

  return {
    psiPerformanceScore: pct(categories.performance),
    psiSeoScore: pct(categories.seo),
    psiAccessibilityScore: pct(categories.accessibility),
    psiBestPracticesScore: pct(categories['best-practices']),
    coreWebVitals: {
      lcp: audits['largest-contentful-paint']?.numericValue ?? null,
      cls: audits['cumulative-layout-shift']?.numericValue ?? null,
      // `interactive` is Time to Interactive, a different (and deprecated)
      // metric — storing it as INP mislabelled the number and would have put
      // a wrong figure in front of a prospect. Lighthouse only reports INP
      // for real-user (field) data, so in a lab run this is usually absent:
      // leave it null rather than substituting an unrelated metric, and keep
      // TTI under its own name.
      inp: audits['experimental-interaction-to-next-paint']?.numericValue ?? null,
    },
    tti: audits['interactive']?.numericValue ?? null,
    psiFailedAudits: failedAudits,
    psiStatus: 'ok',
    psiError: '',
  };
}

async function getPsiKey(psiKeyLabel) {
  const settings = await SystemSettings.findOne().select('+pageSpeedIntegration.apiKeyEncrypted +pageSpeedIntegration.apiKey2Encrypted');
  const cfg = settings?.pageSpeedIntegration;
  return psiKeyLabel === 'key2' ? cfg?.apiKey2 : cfg?.apiKey;
}

// ── Worker ───────────────────────────────────────────────────────────────
const worker = new Worker('prospect-audit-queue', async (job) => {
  const { prospectId, psiKey: psiKeyLabel } = job.data;

  const prospect = await ProspectAudit.findById(prospectId);
  if (!prospect) { log(`Job ${job.id} — prospect ${prospectId} not found, discarding`); return { skipped: true }; }
  if (prospect.crawlStatus !== 'crawling') {
    log(`Job ${job.id} — prospect ${prospect.businessName} crawlStatus is "${prospect.crawlStatus}", skipping`);
    return { skipped: true, reason: prospect.crawlStatus };
  }

  log(`🔎 Job ${job.id} | ${prospect.businessName || prospect.email || prospect._id} → ${prospect.website} | attempt=${job.attemptsMade + 1}/${job.opts?.attempts || 3}`);

  try {
    const tier1 = await runTier1(prospect.website);

    let tier2 = {};
    try {
      const apiKey = await getPsiKey(psiKeyLabel);
      if (apiKey) {
        tier2 = await runTier2(prospect.website, apiKey);
      } else {
        tier2 = { psiStatus: 'skipped', psiError: 'No PageSpeed Insights API key configured' };
      }
    } catch (psiErr) {
      // PSI failing (rate-limited, site refuses Lighthouse, transient) isn't
      // fatal to the whole audit — Tier 1 findings alone still produce a
      // usable (if less complete) score. Logged, not thrown.
      //
      // But it must be RECORDED, not just logged: every PSI-dependent branch
      // in prospectScoring reads `psiPerformanceScore != null`, so a failed
      // run used to be indistinguishable from a site with perfect scores —
      // silently dragging technicalScore down and tiering real prospects as
      // 'skip'. needsRecrawl marks them for another pass.
      tier2 = {
        psiStatus: 'failed',
        psiError: String(psiErr.message || 'Unknown PSI error').slice(0, 300),
        needsRecrawl: true,
      };
      err(`PSI failed for ${prospect.website}: ${psiErr.message}`);
      sysLog.error('PROSPECT_AUDIT', `PSI failed for ${prospect.website}: ${psiErr.message}`);
    }

    Object.assign(prospect, tier1, tier2, { crawlStatus: 'ok', crawledAt: new Date(), crawlError: '' });
    const scores = calculateProspectScores(prospect);
    Object.assign(prospect, scores);

    // Built here, at crawl time, from the measurements just taken — so the
    // sentences a campaign email will quote are always derived from the same
    // data that produced the score shown in the UI.
    const findings = buildFindings(prospect);
    prospect.findings = findings;
    prospect.topFinding = findings[0]?.sentence || '';
    prospect.topFindingAngle = findings[0]?.angle || '';

    await prospect.save();

    await ProspectAuditBatch.updateOne({ _id: prospect.batch }, { $inc: { crawledCount: 1 } });
    log(`✅ Audited — job ${job.id} | tier=${scores.tier} technical=${scores.technicalScore} opportunity=${scores.opportunityScore}`);
    sysLog.info('PROSPECT_AUDIT', `Audited ${prospect.businessName || prospect.website} — tier=${scores.tier} technical=${scores.technicalScore} opportunity=${scores.opportunityScore}`);
    return { tier: scores.tier };
  } catch (crawlErr) {
    const isTimeout = crawlErr.name === 'AbortError';
    // 401/403/429 and Cloudflare-style walls are a *reachable* site refusing
    // us, which is a different outreach decision than a dead domain — now
    // driven by the real status code that runTier1 attaches, with the old
    // message-regex kept as a fallback for errors thrown without one.
    const code = crawlErr.httpStatus;
    const isBlocked = code === 401 || code === 403 || code === 429
      || /403|Forbidden|blocked/i.test(crawlErr.message || '');
    const status = isTimeout ? 'timeout' : isBlocked ? 'blocked' : 'dead';

    prospect.crawlStatus = status;
    if (code) prospect.httpStatus = code;
    prospect.crawledAt = new Date();
    prospect.crawlError = String(crawlErr.message || 'Unknown error').slice(0, 500);
    const scores = calculateProspectScores(prospect); // crawlStatus !== 'ok' → 'no_site' bucket
    Object.assign(prospect, scores);
    await prospect.save();

    await ProspectAuditBatch.updateOne({ _id: prospect.batch }, { $inc: { crawledCount: 1, failedCount: 1 } });
    err(`Crawl failed — job ${job.id} | ${prospect.website}: ${crawlErr.message} (${status}, not retrying)`);
    sysLog.error('PROSPECT_AUDIT', `Job ${job.id} ${status} — ${prospect.website}: ${crawlErr.message}`);
    return { failed: true, status };
  }
}, { connection: redisConn, concurrency: 5 });

worker.on('ready', () => { log('✅ Worker ready — listening on "prospect-audit-queue"'); sysLog.info('PROSPECT_AUDIT', 'Worker started and listening for jobs'); });
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
