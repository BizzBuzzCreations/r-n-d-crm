'use strict';
// Turns a crawled ProspectAudit into ranked, human-readable "proof points" —
// the sentences that make a cold email specific to the recipient's own site.
//
// Deterministic by design, no LLM: every sentence is written once, here, by a
// human, with placeholders for MEASURED values only. That means a claim can
// never exceed the data, which matters more here than prose quality — one
// verifiably wrong statement about a stranger's website ends the conversation
// and, at volume, trains people to distrust the sender.
//
// Each finding declares:
//   code       stable id, also stored on the CampaignLead for per-angle reply
//              rate analysis later (see BACKLOG.md §1.4)
//   angle      which sales story this belongs to — several findings can share
//              one angle
//   severity   1-5, how bad it is for the prospect
//   pitchValue 1-10, how compelling it is in a first cold email
//   applies()  whether the measurement actually supports it
//   sentence() the claim, built only from measured values
//
// Ranked by pitchValue * severity, so the strongest, most specific claim
// becomes {{top_finding}}.

// Boolean flags are tested for truthiness rather than `=== false`: these
// objects arrive as real Mongoose documents in the worker but as plain
// objects (or .lean() results) elsewhere, and a strict comparison silently
// drops the finding for anything that isn't a true boolean.
const round1 = (n) => Math.round(n * 10) / 10;
const secs = (ms) => round1(ms / 1000);

const FINDINGS = [
  {
    code: 'ads_to_slow_site',
    angle: 'wasted_ad_spend',
    severity: 5,
    pitchValue: 10,
    title: 'Ad tracking pointing at a slow page',
    applies: (a) => a.hasAdsPixel && a.psiPerformanceScore != null && a.psiPerformanceScore < 50,
    // What is actually measured is an ad conversion/pixel tag in the page
    // source — NOT that money is being spent today. A pixel outlives the
    // campaign that installed it, so "you're running paid ads" was a claim
    // about the recipient's budget drawn from a script tag. This is the
    // highest-ranked finding, so it becomes {{top_finding}} whenever it
    // fires: it is the single sentence most worth keeping honest. Phrased so
    // it still lands if they are spending, and is simply not wrong if they
    // stopped last year.
    sentence: (a) => `Your site has ad conversion tracking installed, but Google scores the homepage ${a.psiPerformanceScore}/100 for speed on mobile — any paid traffic you send here is largely leaving before the page finishes loading.`,
  },
  {
    code: 'noindex',
    angle: 'invisible_on_google',
    severity: 5,
    pitchValue: 10,
    title: 'Site hidden from Google',
    applies: (a) => !!a.hasNoindexTag,
    sentence: () => `Your site currently carries a "noindex" tag, which tells Google not to list it in search results at all.`,
  },
  {
    code: 'no_ssl',
    angle: 'not_secure',
    severity: 5,
    pitchValue: 9,
    title: 'No HTTPS',
    applies: (a) => !a.hasSSL,
    sentence: () => `Your site loads over plain HTTP, so browsers show visitors a "Not secure" warning before they read anything.`,
  },
  {
    code: 'ads_without_analytics',
    angle: 'flying_blind',
    severity: 4,
    pitchValue: 9,
    title: 'Ad tracking with no analytics',
    applies: (a) => a.hasAdsPixel && !a.hasAnalytics,
    // Scoped to the tools ANALYTICS_SIGNATURES actually detects. The flat
    // claim "no analytics installed" was wrong for every site running
    // Plausible, Fathom, Matomo, Clarity or similar — and telling a business
    // it has no analytics when it is looking at a dashboard ends the
    // conversation on the spot.
    sentence: () => `Your site has ad conversion tracking but no Google Analytics or Tag Manager alongside it, so there's no straightforward way to see which of those clicks turn into enquiries.`,
  },
  {
    code: 'mobile_desktop_gap',
    angle: 'mobile_broken',
    severity: 4,
    pitchValue: 8,
    title: 'Much slower on phones than desktop',
    applies: (a) => a.psiPerformanceScore != null && a.psiPerformanceScoreDesktop != null
      && (a.psiPerformanceScoreDesktop - a.psiPerformanceScore) >= 25,
    sentence: (a) => `Your site scores ${a.psiPerformanceScoreDesktop}/100 on a computer but only ${a.psiPerformanceScore}/100 on a phone, which is where most of your visitors are.`,
  },
  {
    code: 'slow_lcp',
    angle: 'slow_site',
    severity: 4,
    pitchValue: 8,
    title: 'Slow to show main content',
    applies: (a) => a.coreWebVitals?.lcp != null && a.coreWebVitals.lcp > 4000,
    sentence: (a) => `Your homepage takes ${secs(a.coreWebVitals.lcp)}s to show its main content on a phone. Google treats anything over 2.5s as a problem.`,
  },
  {
    code: 'slow_mobile_score',
    angle: 'slow_site',
    severity: 3,
    pitchValue: 7,
    title: 'Low mobile performance score',
    // Fallback for when LCP is unavailable but the score still shows a slow site.
    applies: (a) => a.psiPerformanceScore != null && a.psiPerformanceScore < 50
      && !(a.coreWebVitals?.lcp != null && a.coreWebVitals.lcp > 4000) && !a.hasAdsPixel,
    sentence: (a) => `Google scores your homepage ${a.psiPerformanceScore}/100 for speed on mobile — slow enough that a meaningful share of visitors leave before it loads.`,
  },
  {
    code: 'no_local_schema',
    angle: 'invisible_locally',
    severity: 3,
    pitchValue: 7,
    title: 'No local business markup',
    applies: (a) => (a.reviewsCount || 0) >= 10
      && !(a.structuredDataTypes || []).some((t) => /LocalBusiness|Organization/i.test(t)),
    sentence: (a) => `With ${a.reviewsCount} reviews you clearly have a local presence, but your site has no business markup, so Google can't reliably connect it to that listing.`,
  },
  {
    code: 'no_contact_form',
    angle: 'enquiries_leaking',
    severity: 4,
    pitchValue: 7,
    title: 'No enquiry form',
    applies: (a) => !a.hasContactForm,
    sentence: () => `There's no enquiry form anywhere on your homepage, so anyone who wants to get in touch has to go looking for a phone number.`,
  },
  {
    code: 'missing_meta',
    angle: 'invisible_on_google',
    severity: 3,
    pitchValue: 6,
    title: 'Missing title or description',
    applies: (a) => !String(a.title || '').trim() || !String(a.metaDescription || '').trim(),
    sentence: (a) => !String(a.title || '').trim()
      ? `Your homepage has no title tag, so Google has to invent the headline it shows for you in search results.`
      : `Your homepage has no meta description, so Google picks the text under your search result itself.`,
  },
  {
    code: 'heavy_page',
    angle: 'slow_site',
    severity: 3,
    pitchValue: 6,
    title: 'Very heavy homepage',
    applies: (a) => a.pageWeightKb != null && a.pageWeightKb > 3000,
    sentence: (a) => `Your homepage weighs ${round1(a.pageWeightKb / 1024)}MB. A typical well-built page is under 1MB, so visitors on mobile data pay for the difference in load time.`,
  },
  {
    code: 'images_no_alt',
    angle: 'seo_basics',
    severity: 2,
    pitchValue: 5,
    title: 'Images missing alt text',
    applies: (a) => (a.imageCount || 0) >= 5
      && (a.imagesWithAltCount || 0) / a.imageCount < 0.3,
    sentence: (a) => `${a.imageCount - a.imagesWithAltCount} of your ${a.imageCount} homepage images have no alt text, which costs you image search traffic and fails accessibility checks.`,
  },
  {
    code: 'no_sitemap',
    angle: 'seo_basics',
    severity: 2,
    pitchValue: 4,
    title: 'No sitemap or robots.txt',
    applies: (a) => !a.hasSitemap && !a.hasRobotsTxt,
    sentence: () => `Your site has neither a sitemap nor a robots.txt, so search engines are left to guess which pages matter.`,
  },
];

/**
 * Build the ranked finding list for a crawled prospect.
 * Returns [] for anything that wasn't successfully crawled — there is nothing
 * measured to make a claim from, and a guess is exactly what must not be sent.
 *
 * @param {object} audit  ProspectAudit document or plain object
 * @param {number} limit  max findings to keep
 */
function buildFindings(audit, limit = 5) {
  if (!audit || audit.crawlStatus !== 'ok') return [];

  const hits = [];
  for (const f of FINDINGS) {
    let ok = false;
    try { ok = !!f.applies(audit); } catch { ok = false; }
    if (!ok) continue;
    let sentence = '';
    try { sentence = f.sentence(audit); } catch { continue; }
    if (!sentence) continue;
    hits.push({
      code: f.code,
      angle: f.angle,
      severity: f.severity,
      title: f.title,
      sentence,
      rank: f.pitchValue * f.severity,
    });
  }

  hits.sort((a, b) => b.rank - a.rank);
  return hits.slice(0, limit).map(({ rank, ...rest }) => rest);
}

module.exports = { buildFindings, FINDINGS };
