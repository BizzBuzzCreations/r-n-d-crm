'use strict';
const mongoose = require('mongoose');

const ProspectAuditSchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ProspectAuditBatch', required: true },

  // ── Imported fields, preserved as-is from the source CSV ──────────────
  businessName:  { type: String, default: '', trim: true },
  businessType:  { type: String, default: '', trim: true },
  cityLocation:  { type: String, default: '', trim: true },
  phone:         { type: String, default: '', trim: true },
  email:         { type: String, default: '', trim: true, lowercase: true },
  fullAddress:   { type: String, default: '', trim: true },
  website:       { type: String, default: '', trim: true },
  rating:        { type: Number, default: null },
  reviewsCount:  { type: Number, default: 0 },
  // From the CSV's own `status` column — whatever prior manual-outreach
  // status the source data already carried (e.g. a Google Maps scrape tool's
  // own call-tracking). Purely informational — never written by the crawler,
  // named differently from crawlStatus below so the two can never collide.
  priorStatus:   { type: String, default: '', trim: true },
  callNotes:     { type: String, default: '', trim: true },
  calledAt:      { type: Date, default: null },

  // ── Crawl state ─────────────────────────────────────────────────────
  crawlStatus: {
    type: String,
    enum: ['pending', 'crawling', 'ok', 'dead', 'blocked', 'timeout', 'no_url'],
    default: 'pending',
  },
  crawledAt: { type: Date, default: null },
  crawlError: { type: String, default: '' },
  // Real HTTP status of the homepage fetch. A non-2xx body is still parseable
  // HTML, so this is what stops an error/bot-wall page being scored as the
  // prospect's actual site (see runTier1 in workers/prospectAuditWorker.js).
  httpStatus: { type: Number, default: null },

  // ── Tier 1 — structural findings (plain HTTP fetch + cheerio) ─────────
  hasSSL:           { type: Boolean, default: false },
  hasViewportTag:   { type: Boolean, default: false },
  title:            { type: String, default: '' },
  metaDescription:  { type: String, default: '' },
  h1Present:        { type: Boolean, default: false },
  hasAnalytics:     { type: Boolean, default: false }, // GA/GTM/Meta Pixel script tag detected
  hasAdsPixel:       { type: Boolean, default: false }, // Google Ads/Meta Ads conversion tag detected — opportunity signal, separate from analytics
  hasSitemap:       { type: Boolean, default: false },
  hasRobotsTxt:     { type: Boolean, default: false },
  cmsPlatform:      { type: String, default: '' }, // best-effort fingerprint (WordPress, Wix, Squarespace, Shopify, ...), '' = unknown
  hasBlog:          { type: Boolean, default: false },
  hasContactForm:   { type: Boolean, default: false },
  brokenLinksCount: { type: Number, default: 0 },

  // ── Tier 1 — extended SEO checklist findings ──────────────────────────
  // All homepage-only, no extra network requests beyond what's already
  // fetched — same fetch+cheerio pass as the fields above.
  hasCanonicalTag:      { type: Boolean, default: false },
  canonicalMatchesUrl:  { type: Boolean, default: null }, // null = no canonical tag to compare at all
  hasNoindexTag:        { type: Boolean, default: false }, // a real red flag — site is telling Google not to index it
  h2Count:              { type: Number, default: 0 },
  h3Count:              { type: Number, default: 0 },
  imageCount:           { type: Number, default: 0 },
  imagesWithAltCount:   { type: Number, default: 0 },
  hasStructuredData:    { type: Boolean, default: false },
  structuredDataTypes:  { type: [String], default: [] }, // e.g. ['LocalBusiness', 'Organization']
  hasHreflang:          { type: Boolean, default: false },
  hasPrivacyPolicy:     { type: Boolean, default: false },
  hasTermsPage:         { type: Boolean, default: false },
  thirdPartyScriptCount:  { type: Number, default: 0 }, // distinct external script domains — a page-bloat signal
  modernImageFormatCount: { type: Number, default: 0 }, // webp/avif <img> tags found

  // ── Tier 2 — PageSpeed Insights findings ───────────────────────────────
  psiPerformanceScore:    { type: Number, default: null },
  // Second PSI pass, desktop strategy. Only populated when the mobile score
  // is below DESKTOP_PSI_MOBILE_CEILING (see prospectAuditWorker) — a second
  // API call per prospect is not worth spending where no gap can exist.
  psiPerformanceScoreDesktop: { type: Number, default: null },
  // Total page transfer size from Lighthouse's total-byte-weight audit.
  pageWeightKb:           { type: Number, default: null },
  psiSeoScore:            { type: Number, default: null },
  psiAccessibilityScore:  { type: Number, default: null },
  psiBestPracticesScore:  { type: Number, default: null },
  coreWebVitals: {
    lcp: { type: Number, default: null },
    cls: { type: Number, default: null },
    inp: { type: Number, default: null },
  },
  psiFailedAudits: { type: [String], default: [] },
  tti: { type: Number, default: null }, // Time to Interactive — kept under its own name (was wrongly stored as coreWebVitals.inp)
  // Whether the PageSpeed half of the audit actually ran. Without this, a
  // failed PSI call is indistinguishable from a site that scored perfectly:
  // every PSI branch in prospectScoring tests `!= null`, so missing data read
  // as "no problems found" and mis-tiered real prospects as 'skip'.
  psiStatus: { type: String, enum: ['pending', 'ok', 'failed', 'skipped'], default: 'pending' },
  psiError:  { type: String, default: '' },
  needsRecrawl: { type: Boolean, default: false },

  // ── Output ──────────────────────────────────────────────────────────
  // Ranked, human-readable proof points built by utils/auditFindings.js from
  // the measurements above. These are what a campaign email actually quotes
  // (via the {{top_finding}} / {{findings_list}} merge tags), so they are
  // generated once at crawl time and then travel with the lead as a
  // point-in-time snapshot — see CampaignLead.auditSnapshot.
  findings: {
    type: [{
      _id:      false,
      code:     { type: String, default: '' },
      angle:    { type: String, default: '' },
      severity: { type: Number, default: 0 },
      title:    { type: String, default: '' },
      sentence: { type: String, default: '' },
    }],
    default: [],
  },
  // Denormalised highest-ranked sentence, so the common case needs no array
  // access in the sender's hot path.
  topFinding:      { type: String, default: '' },
  topFindingAngle: { type: String, default: '' },

  technicalScore:   { type: Number, default: null },
  opportunityScore: { type: Number, default: null },
  tier:             { type: String, enum: ['hot', 'high', 'medium', 'low', 'skip', 'no_site', null], default: null },
  flags:            { type: [String], default: [] },
}, { timestamps: true });

ProspectAuditSchema.index({ batch: 1, crawlStatus: 1 });
ProspectAuditSchema.index({ batch: 1, tier: 1 });
// No duplicate import within a batch — matched by email when present,
// otherwise by business name + phone (source data doesn't always have an
// email for every scraped listing).
ProspectAuditSchema.index({ batch: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $ne: '' } } });

module.exports = mongoose.model('ProspectAudit', ProspectAuditSchema);
