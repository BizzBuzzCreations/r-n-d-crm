'use strict';
// Pure, deterministic, no-LLM scoring — same style as
// controllers/leadController.js's calculateHealthScore. Two independent
// axes: how much a business's website needs technical/SEO help, and how
// much evidence there is that they already invest in marketing (worth
// pitching vs. not). Combined into a single tier that decides the outreach
// approach, not just a raw number.

function calculateTechnicalScore(audit) {
  let score = 0;
  if (!audit.hasSSL) score += 15;
  if (audit.psiPerformanceScore != null && audit.psiPerformanceScore < 50) score += 15;
  if (!audit.hasViewportTag) score += 10;
  if (audit.psiSeoScore != null && audit.psiSeoScore < 70) score += 10;
  if (!audit.title?.trim() || !audit.metaDescription?.trim()) score += 10;
  if (!audit.h1Present) score += 8;
  if (!audit.hasAnalytics) score += 8;
  if (!audit.cmsPlatform) score += 10; // no recognizable/modern CMS signature detected
  if (!audit.hasSitemap && !audit.hasRobotsTxt) score += 6;
  // A noindex tag means Google won't show this site in search results at
  // all, regardless of anything else being fine — the single worst finding
  // this crawler can make, weighted accordingly. Missing canonical tag is
  // real but much more common/minor on small sites, so it's a light touch.
  if (audit.hasNoindexTag) score += 25;
  if (!audit.hasCanonicalTag) score += 5;
  // Hard floor, same pattern as leadController's healthScore override: +25
  // alone isn't guaranteed to cross the "skip" threshold (30) if every
  // other factor is otherwise clean, which would wrongly tier a noindexed
  // site as "fine, don't bother" — exactly backwards, since "your site is
  // invisible to Google" is one of the strongest pitches there is.
  if (audit.hasNoindexTag) score = Math.max(score, 40);
  return Math.min(100, score);
}

function calculateOpportunityScore(audit) {
  let score = 0;
  if (audit.hasAdsPixel) score += 30;
  if (audit.hasAnalytics) score += 15;
  if (audit.hasBlog) score += 15;
  if (audit.hasContactForm) score += 15;
  if (audit.crawlStatus === 'ok') score += 15; // site is live and reachable at all
  if ((audit.reviewsCount || 0) >= 20) score += 10; // proxy for "actively getting found/customers"
  return Math.min(100, score);
}

// Findings that directly contradict "technically_sound" — if any of these is
// present, the site is not sound no matter how the points happened to add up.
const PROBLEM_FLAGS = ['no_ssl', 'slow_load', 'not_mobile_friendly', 'noindex_detected'];

function buildFlags(audit, technicalScore, opportunityScore) {
  const flags = [];
  if (!audit.hasSSL) flags.push('no_ssl');
  if (audit.psiPerformanceScore != null && audit.psiPerformanceScore < 50) flags.push('slow_load');
  if (!audit.hasViewportTag) flags.push('not_mobile_friendly');
  if (!audit.hasAnalytics) flags.push('no_analytics');
  if (audit.hasAdsPixel) flags.push('running_ads');
  if ((audit.reviewsCount || 0) >= 20) flags.push('established_reviews');
  if (audit.hasNoindexTag) flags.push('noindex_detected');
  if (!audit.hasCanonicalTag) flags.push('no_canonical');
  // Was `technicalScore < 30`, which let a site be flagged 'slow_load' and
  // 'technically_sound' simultaneously — the UI then showed a green
  // "technically sound" badge next to a red "slow page load" one. Requires a
  // genuinely clean result now: a low score AND no disqualifying finding.
  // Scoring ran without the PageSpeed half, so performance/SEO problems
  // simply weren't measured — surfaced so nobody reads a low technicalScore
  // here as "this site is fine".
  const incomplete = !!(audit.psiStatus && audit.psiStatus !== 'ok');
  // Claiming a clean bill of health requires having actually looked: a low
  // score with no PageSpeed data means "not measured", not "sound".
  if (technicalScore < 10 && !incomplete && !flags.some((f) => PROBLEM_FLAGS.includes(f))) {
    flags.push('technically_sound');
  }
  if (opportunityScore >= 50) flags.push('high_opportunity');
  if (incomplete) flags.push('incomplete_audit');
  return flags;
}

/**
 * @param {object} audit - a ProspectAudit document (or plain object with the same fields)
 * @returns {{ technicalScore: number, opportunityScore: number, tier: string, flags: string[] }}
 */
function calculateProspectScores(audit) {
  if (audit.crawlStatus !== 'ok') {
    return { technicalScore: null, opportunityScore: null, tier: 'no_site', flags: ['no_site'] };
  }

  const technicalScore = calculateTechnicalScore(audit);
  const opportunityScore = calculateOpportunityScore(audit);
  const flags = buildFlags(audit, technicalScore, opportunityScore);

  // technicalScore is a NEED score — higher means MORE problems found, not
  // fewer. opportunityScore is the BUDGET/evidence-of-investment signal
  // (running ads, analytics installed, a blog, real review volume).
  //
  // The tier used to be decided by need alone: `technicalScore < 30 → skip`,
  // whatever the opportunity. That inverted the sales value of the list. A
  // site with the basics right (SSL, viewport, title, known CMS, analytics)
  // can only pass 30 by being fundamentally broken, so the single best
  // prospect type — an established business actively spending on ads whose
  // site merely underperforms (need 25, opportunity 100) — came out as
  // 'skip', flagged 'technically_sound', and was passed over in the UI's
  // tier filter. Meanwhile a neglected site with no budget signal at all
  // (need 72, opportunity 15) ranked above it.
  //
  // Now both axes decide, and evidence of spending can never be skipped:
  // the pitch for a high-opportunity prospect whose site is genuinely fine
  // is a different conversation, not an absent one.
  const incomplete = audit.psiStatus && audit.psiStatus !== 'ok';
  let tier;
  if (opportunityScore >= 50) {
    tier = technicalScore >= 20 ? 'hot' : 'high';
  } else if (opportunityScore >= 25 && technicalScore >= 15) {
    tier = 'medium';
  } else if (technicalScore >= 10) {
    tier = 'low';
  } else if (incomplete) {
    // Nothing much found, but the PageSpeed half never ran — that's "not
    // measured", not "nothing wrong". Park it as low and let it be re-crawled
    // rather than writing it off.
    tier = 'low';
  } else {
    tier = 'skip';
  }

  return { technicalScore, opportunityScore, tier, flags };
}

module.exports = { calculateProspectScores, calculateTechnicalScore, calculateOpportunityScore };
