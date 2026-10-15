import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft, Upload, FileSpreadsheet, Play, Pause, Download, XCircle, Flame,
  ShieldCheck, ShieldAlert, ShieldQuestion, ShieldOff, Check, X, Eye, Lock, Smartphone,
  Gauge, FileText, Heading, BarChart3, Megaphone, Map, Rss, Mail as MailIcon, Star, Link2, Globe2, Send, Repeat,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { Page, Button, Select, StatCard, EmptyState, Modal } from '../components/ui';
import { cn } from '../utils/helpers';

const CRAWL_STATUS_BADGE = {
  pending:  { label: 'Pending',   tw: 'text-slate-400' },
  crawling: { label: 'Crawling',  tw: 'text-blue-500' },
  ok:       { label: 'OK',        tw: 'text-emerald-600 dark:text-emerald-400' },
  dead:     { label: 'Dead',      tw: 'text-red-500' },
  blocked:  { label: 'Blocked',   tw: 'text-amber-500' },
  timeout:  { label: 'Timeout',   tw: 'text-amber-500' },
  no_url:   { label: 'No URL',    tw: 'text-slate-400' },
};

const TIER_BADGE = {
  // 'hot' = evidence of real marketing spend AND fixable problems — the
  // strongest pitch in the list (see utils/prospectScoring.js).
  hot:     { label: 'Hot Lead',      icon: Flame,          tw: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' },
  high:    { label: 'High Priority', icon: Flame,          tw: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' },
  medium:  { label: 'Medium',        icon: ShieldAlert,     tw: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  low:     { label: 'Low',           icon: ShieldQuestion,  tw: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  skip:    { label: 'Skip',          icon: ShieldCheck,     tw: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  no_site: { label: 'No Site',       icon: ShieldOff,       tw: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500' },
};

const FLAG_LABELS = {
  no_ssl:              { label: 'No SSL/HTTPS — insecure connection',        good: false },
  slow_load:           { label: 'Slow page load (PageSpeed < 50)',            good: false },
  not_mobile_friendly: { label: 'Not mobile-friendly (no viewport tag)',      good: false },
  no_analytics:        { label: 'No analytics installed',                    good: false },
  running_ads:         { label: 'Currently running ads (Google/Meta)',       good: true  },
  established_reviews: { label: '20+ Google reviews — established business', good: true  },
  noindex_detected:    { label: 'Noindex tag found — invisible to Google!',   good: false },
  no_canonical:        { label: 'No canonical tag',                          good: false },
  technically_sound:   { label: 'Technically sound — few issues found',      good: true  },
  high_opportunity:    { label: 'High marketing opportunity',                good: true  },
  // Neutral, not good/bad: the PageSpeed half of the audit didn't run, so
  // performance and SEO problems were never measured for this prospect.
  incomplete_audit:    { label: 'Incomplete audit — PageSpeed data missing', good: null  },
  no_site:             { label: 'No live website found',                    good: false },
};

// One row of a technical/marketing checklist item — shared by every row in
// the detail modal below, so each check renders identically (icon + label +
// yes/no) regardless of which section it's in.
function CheckRow({ icon: Icon, label, ok, detail }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-400">
        <Icon size={14} className="text-slate-400 flex-shrink-0" /> {label}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {detail && <span className="text-[11.5px] text-slate-500 dark:text-slate-400 max-w-[220px] truncate">{detail}</span>}
        {ok === true && <Check size={15} className="text-emerald-500" />}
        {ok === false && <X size={15} className="text-red-500" />}
        {ok == null && <span className="text-[11px] text-slate-400">—</span>}
      </div>
    </div>
  );
}

function ScoreBar({ label, value }) {
  if (value == null) return null;
  const color = value >= 90 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
        <span>{label}</span><span>{value}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ProspectDetailModal({ prospect, onClose }) {
  if (!prospect) return null;
  const tierBadge = prospect.tier ? TIER_BADGE[prospect.tier] : null;
  const crawlBadge = CRAWL_STATUS_BADGE[prospect.crawlStatus] || CRAWL_STATUS_BADGE.pending;
  const notCrawled = prospect.crawlStatus !== 'ok';

  return (
    <Modal open={!!prospect} onClose={onClose} title={prospect.businessName || prospect.website || 'Prospect details'} size="xl">
      <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {prospect.website && (
              <a href={prospect.website} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline text-[13px] flex items-center gap-1">
                <Link2 size={13} /> {prospect.website}
              </a>
            )}
            <span className={cn('text-[12px] font-semibold', crawlBadge.tw)}>· {crawlBadge.label}</span>
          </div>
          {tierBadge && (
            <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold', tierBadge.tw)}>
              <tierBadge.icon size={13} /> {tierBadge.label}
            </span>
          )}
        </div>

        {notCrawled ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-[12.5px] text-slate-500 dark:text-slate-400">
            {prospect.crawlStatus === 'no_url' ? "No website on file for this business — nothing to audit." :
             prospect.crawlStatus === 'pending' || prospect.crawlStatus === 'crawling' ? 'Not crawled yet.' :
             `Crawl did not complete (${crawlBadge.label}). ${prospect.crawlError || ''}`}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Technical Need</p>
                <p className="text-[22px] font-bold text-slate-800 dark:text-slate-100">{prospect.technicalScore}<span className="text-[13px] text-slate-400 font-normal">/100</span></p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Higher = more problems found</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Marketing Opportunity</p>
                <p className="text-[22px] font-bold text-slate-800 dark:text-slate-100">{prospect.opportunityScore}<span className="text-[13px] text-slate-400 font-normal">/100</span></p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Higher = worth pitching</p>
              </div>
            </div>

            {(prospect.flags || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {prospect.flags.map((f) => {
                  const cfg = FLAG_LABELS[f] || { label: f, good: null };
                  return (
                    <span key={f} className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium',
                      cfg.good === true ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                        : cfg.good === false ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    )}>
                      {cfg.good === true ? <Check size={11} /> : cfg.good === false ? <X size={11} /> : null} {cfg.label}
                    </span>
                  );
                })}
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Technical & SEO</p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 px-3">
                <CheckRow icon={Lock} label="SSL / HTTPS" ok={prospect.hasSSL} />
                <CheckRow icon={Smartphone} label="Mobile-friendly (viewport tag)" ok={prospect.hasViewportTag} />
                <CheckRow icon={FileText} label="Page title" ok={!!prospect.title} detail={prospect.title || 'Missing'} />
                <CheckRow icon={FileText} label="Meta description" ok={!!prospect.metaDescription} detail={prospect.metaDescription || 'Missing'} />
                <CheckRow icon={Heading} label="H1 heading present" ok={prospect.h1Present} />
                <CheckRow icon={Map} label="Sitemap.xml reachable" ok={prospect.hasSitemap} />
                <CheckRow icon={Map} label="Robots.txt reachable" ok={prospect.hasRobotsTxt} />
                <CheckRow icon={Gauge} label="CMS/platform detected" ok={!!prospect.cmsPlatform} detail={prospect.cmsPlatform || 'Unknown'} />
                <CheckRow icon={Link2} label="Broken internal links (sampled)" ok={prospect.brokenLinksCount === 0} detail={String(prospect.brokenLinksCount ?? 0)} />
                <CheckRow icon={Link2} label="Canonical tag present" ok={prospect.hasCanonicalTag} detail={prospect.hasCanonicalTag && prospect.canonicalMatchesUrl === false ? 'Points elsewhere' : undefined} />
                <CheckRow icon={ShieldOff} label="Noindex tag (should NOT be present)" ok={!prospect.hasNoindexTag} />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Content & Structure</p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 px-3">
                <CheckRow icon={Heading} label="H2/H3 heading structure" ok={prospect.h2Count > 0} detail={`${prospect.h2Count || 0} H2, ${prospect.h3Count || 0} H3`} />
                <CheckRow icon={FileText} label="Image alt-text coverage" ok={prospect.imageCount ? prospect.imagesWithAltCount === prospect.imageCount : null} detail={prospect.imageCount ? `${prospect.imagesWithAltCount}/${prospect.imageCount} images` : 'No images found'} />
                <CheckRow icon={Gauge} label="Modern image formats (WebP/AVIF)" ok={prospect.imageCount ? prospect.modernImageFormatCount > 0 : null} detail={prospect.imageCount ? `${prospect.modernImageFormatCount}/${prospect.imageCount} images` : undefined} />
                <CheckRow icon={FileText} label="Structured data (Schema.org)" ok={prospect.hasStructuredData} detail={prospect.structuredDataTypes?.length ? prospect.structuredDataTypes.join(', ') : undefined} />
                <CheckRow icon={Globe2} label="Hreflang tags" ok={prospect.hasHreflang ? true : null} detail={prospect.hasHreflang ? undefined : 'Not applicable for single-language sites'} />
                <CheckRow icon={ShieldCheck} label="Privacy policy page" ok={prospect.hasPrivacyPolicy} />
                <CheckRow icon={ShieldCheck} label="Terms & conditions page" ok={prospect.hasTermsPage} />
                <CheckRow icon={Link2} label="Third-party scripts (page bloat)" ok={null} detail={`${prospect.thirdPartyScriptCount || 0} external domain(s)`} />
              </div>
            </div>

            {(prospect.psiPerformanceScore != null || prospect.psiSeoScore != null || prospect.psiAccessibilityScore != null || prospect.psiBestPracticesScore != null) && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">PageSpeed Insights</p>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <ScoreBar label="Performance" value={prospect.psiPerformanceScore} />
                  <ScoreBar label="SEO" value={prospect.psiSeoScore} />
                  <ScoreBar label="Accessibility" value={prospect.psiAccessibilityScore} />
                  <ScoreBar label="Best Practices" value={prospect.psiBestPracticesScore} />
                </div>
                {prospect.psiFailedAudits?.length > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                    Failed checks: {prospect.psiFailedAudits.join(', ')}
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Marketing Signals</p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 px-3">
                <CheckRow icon={BarChart3} label="Analytics installed (GA/GTM)" ok={prospect.hasAnalytics} />
                <CheckRow icon={Megaphone} label="Running ads (Google Ads/Meta Pixel)" ok={prospect.hasAdsPixel} />
                <CheckRow icon={Rss} label="Blog/content section" ok={prospect.hasBlog} />
                <CheckRow icon={MailIcon} label="Contact form" ok={prospect.hasContactForm} />
                <CheckRow icon={Star} label="Google reviews" ok={(prospect.reviewsCount || 0) > 0} detail={prospect.reviewsCount ? `${prospect.reviewsCount}${prospect.rating ? ` (${prospect.rating}★)` : ''}` : 'None on file'} />
              </div>
            </div>
          </>
        )}

        {(prospect.priorStatus || prospect.callNotes) && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Prior Outreach (from import)</p>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-[12.5px] text-slate-600 dark:text-slate-400 space-y-1">
              {prospect.priorStatus && <p><span className="text-slate-400">Status:</span> {prospect.priorStatus}</p>}
              {prospect.callNotes && <p><span className="text-slate-400">Notes:</span> {prospect.callNotes}</p>}
              {prospect.calledAt && <p><span className="text-slate-400">Called:</span> {new Date(prospect.calledAt).toLocaleDateString()}</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Client-side CSV export — same pattern as CampaignDetailPage's downloadLeadsCSV.
// Values here can come from anonymous public forms and scraped listings, so a
// cell starting with = + - @ (or a control char) would be executed as a
// formula when the export is opened in Excel/Sheets. Prefixing with an
// apostrophe forces it to be read as text.
const csvCell = (c) => {
  const s = String(c ?? '').replace(/"/g, '""');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

function downloadProspectsCSV(prospects, filename) {
  const headers = [
    'Business Name', 'Business Type', 'City', 'Phone', 'Email', 'Website', 'Rating', 'Reviews',
    'Prior Status', 'Call Notes', 'Crawl Status', 'Technical Score', 'Opportunity Score', 'Tier', 'Flags',
  ];
  const rows = prospects.map((p) => [
    p.businessName, p.businessType, p.cityLocation, p.phone, p.email, p.website, p.rating ?? '', p.reviewsCount || 0,
    p.priorStatus, p.callNotes, p.crawlStatus, p.technicalScore ?? '', p.opportunityScore ?? '', p.tier || '', (p.flags || []).join('; '),
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${csvCell(c)}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ProspectAuditDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    batches, prospects, loadBatch, loadProspects, importCsv, importSheet, startCrawl, pauseCrawl, deleteProspect,
    campaigns, loadCampaigns, pushToCampaign, setAutoPush,
  } = useAppStore(useShallow((s) => ({
    batches: s.prospectAuditBatches,
    prospects: s.prospectAudits,
    loadBatch: s.loadProspectAuditBatch,
    loadProspects: s.loadProspectAudits,
    importCsv: s.importProspectAuditsCsv,
    importSheet: s.importProspectAuditsSheet,
    startCrawl: s.startProspectAuditCrawl,
    pauseCrawl: s.pauseProspectAuditCrawl,
    deleteProspect: s.deleteProspectAudit,
    campaigns: s.campaigns,
    loadCampaigns: s.loadCampaigns,
    pushToCampaign: s.pushProspectsToCampaign,
    setAutoPush: s.setProspectAutoPush,
  })));

  const batch = batches.find((b) => b._id === id);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [importingSheet, setImportingSheet] = useState(false);
  const [tierFilter, setTierFilter] = useState('all');
  const [showPush, setShowPush] = useState(false);
  const [pushCampaignId, setPushCampaignId] = useState('');
  const [pushTiers, setPushTiers] = useState(['hot', 'high']);
  const [pushing, setPushing] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [autoCampaignId, setAutoCampaignId] = useState('');
  const [autoTiers, setAutoTiers] = useState(['hot', 'high']);
  const [autoRequireFindings, setAutoRequireFindings] = useState(true);
  const [savingAuto, setSavingAuto] = useState(false);
  // Store just the id, not the object — re-derived from the live `prospects`
  // list on every render, so the modal reflects a re-crawl or refresh
  // instead of showing a frozen snapshot from the moment it was opened.
  const [detailProspectId, setDetailProspectId] = useState(null);
  const detailProspect = prospects.find((p) => p._id === detailProspectId) || null;
  const fileInputRef = useRef(null);

  useEffect(() => {
    Promise.all([loadBatch(id), loadProspects(id)]).finally(() => setLoading(false));
  }, [id, loadBatch, loadProspects]);

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importCsv(id, file);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSheetSubmit = async (e) => {
    e.preventDefault();
    if (!sheetUrl.trim()) return;
    setImportingSheet(true);
    try {
      await importSheet(id, sheetUrl.trim());
      setSheetUrl('');
    } finally {
      setImportingSheet(false);
    }
  };

  const handleToggleStatus = () => {
    if (batch.status === 'crawling') pauseCrawl(id);
    else startCrawl(id);
  };

  const stats = useMemo(() => {
    const s = { total: prospects.length, crawled: 0, high: 0, medium: 0, low: 0, skip: 0, no_site: 0 };
    for (const p of prospects) {
      if (p.crawlStatus !== 'pending' && p.crawlStatus !== 'crawling') s.crawled++;
      if (p.tier) s[p.tier] = (s[p.tier] || 0) + 1;
    }
    return s;
  }, [prospects]);

  // Mirrors the backend's own filter in pushToCampaign: crawled OK, has an
  // email, and has at least one finding to personalise with.
  const isPushable = (p) => p.crawlStatus === 'ok' && !!p.email && (p.findings || []).length > 0;
  const pushableCount = useMemo(() => prospects.filter(isPushable).length, [prospects]);
  const pushSelectedCount = useMemo(
    () => prospects.filter((p) => isPushable(p) && (!pushTiers.length || pushTiers.includes(p.tier))).length,
    [prospects, pushTiers],
  );

  const filtered = tierFilter === 'all' ? prospects : prospects.filter((p) => p.tier === tierFilter);

  const exportSlug = (batch?.name || 'prospects').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (loading || !batch) {
    return (
      <Page>
        <p className="text-[13px] text-slate-400">Loading…</p>
      </Page>
    );
  }

  return (
    <Page>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/prospect-audits" className="btn-icon text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <h1 className="page-title truncate">{batch.name}</h1>
            <p className="page-sub">{batch.totalCount || 0} businesses · {batch.crawledCount || 0} crawled</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {(batch.status === 'draft' || batch.status === 'paused') && (
            <Button variant="outline" onClick={handleToggleStatus}><Play size={14} /> Start Crawl</Button>
          )}
          {batch.status === 'crawling' && (
            <Button variant="outline" onClick={handleToggleStatus}><Pause size={14} /> Pause</Button>
          )}
          <Button
            disabled={!pushableCount}
            onClick={() => { loadCampaigns(); setShowPush(true); }}
            title={pushableCount
              ? `${pushableCount} audited prospect(s) with an email address and at least one finding`
              : 'No audited prospects with an email address and findings yet'}
          >
            <Send size={14} /> Push to Campaign
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              loadCampaigns();
              setAutoCampaignId(batch.autoPushCampaign ? String(batch.autoPushCampaign) : '');
              setAutoTiers(batch.autoPushTiers?.length ? batch.autoPushTiers : ['hot', 'high']);
              setAutoRequireFindings(batch.autoPushRequireFindings !== false);
              setShowAuto(true);
            }}
            title="Optionally push this batch into a campaign automatically when the crawl finishes"
          >
            <Repeat size={14} /> Auto-push: {batch.autoPushEnabled ? 'On' : 'Off'}
          </Button>
          <Button
            variant="outline"
            disabled={!prospects.length}
            onClick={() => downloadProspectsCSV(prospects, `${exportSlug}-scored.csv`)}
          >
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <StatCard icon={Flame} label="Total" value={stats.total} color="#6366f1" bg="#eef2ff" />
        <StatCard icon={ShieldCheck} label="Crawled" value={stats.crawled} color="#1baf7a" bg="#ecfdf5" />
        <StatCard icon={Flame} label="High Priority" value={stats.high} color="#dc2626" bg="#fef2f2" />
        <StatCard icon={ShieldAlert} label="Medium" value={stats.medium} color="#d97706" bg="#fffbeb" />
        <StatCard icon={ShieldQuestion} label="Low" value={stats.low} color="#64748b" bg="#f1f5f9" />
        <StatCard icon={ShieldOff} label="No Site" value={stats.no_site} color="#94a3b8" bg="#f8fafc" />
      </div>

      <div className="card p-5 mb-5">
        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 mb-3">Import businesses</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label
            htmlFor="prospect-csv-upload"
            className={cn(
              'flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
              importing ? 'opacity-60 pointer-events-none' : 'hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10',
              'border-slate-300 dark:border-slate-600'
            )}
          >
            <Upload size={20} className="text-slate-400" />
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
              {importing ? 'Importing…' : 'Click to upload a CSV file'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center px-4">
              Columns: business_name, business_type, city_location, phone_number, email, full_address, website, rating, reviews_count, status, call_notes, called_at
            </p>
            <input id="prospect-csv-upload" ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileSelected} disabled={importing} />
          </label>

          <form onSubmit={handleSheetSubmit} className="flex flex-col justify-center gap-2 p-4 border border-slate-200 dark:border-slate-700 rounded-xl">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600 dark:text-slate-300">
              <FileSpreadsheet size={14} /> Google Sheet
            </div>
            <input
              type="url"
              className="form-input text-[13px]"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Sheet must be shared as "Anyone with the link can view"</p>
            <Button type="submit" variant="outline" size="sm" loading={importingSheet} disabled={!sheetUrl.trim()}>Import from Sheet</Button>
          </form>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">Prospects</p>
          <div className="w-44">
            <Select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
              <option value="all">All tiers</option>
              <option value="hot">Hot Lead</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="skip">Skip</option>
              <option value="no_site">No Site</option>
            </Select>
          </div>
        </div>

        {!prospects.length ? (
          <EmptyState icon={Upload} title="No prospects imported yet" description="Upload a CSV or import from a Google Sheet above to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Business</th>
                  <th className="px-4 py-2.5 font-medium">Website</th>
                  <th className="px-4 py-2.5 font-medium">Crawl</th>
                  <th className="px-4 py-2.5 font-medium text-center">Technical</th>
                  <th className="px-4 py-2.5 font-medium text-center">Opportunity</th>
                  <th className="px-4 py-2.5 font-medium">Tier</th>
                  <th className="px-4 py-2.5 font-medium">Reviews</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const crawlBadge = CRAWL_STATUS_BADGE[p.crawlStatus] || CRAWL_STATUS_BADGE.pending;
                  const tierBadge = p.tier ? TIER_BADGE[p.tier] : null;
                  return (
                    <tr
                      key={p._id}
                      className="border-b border-slate-100 dark:border-slate-800 last:border-0 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      onClick={() => setDetailProspectId(p._id)}
                    >
                      <td className="px-4 py-2.5">
                        <p className="text-slate-800 dark:text-slate-200 font-medium truncate max-w-[220px]">{p.businessName || '—'}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">{p.phone || p.email || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate text-slate-600 dark:text-slate-400" onClick={(e) => e.stopPropagation()}>
                        {p.website ? <a href={p.website} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline truncate block">{p.website}</a> : '—'}
                      </td>
                      <td className={cn('px-4 py-2.5 font-medium', crawlBadge.tw)}>{crawlBadge.label}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600 dark:text-slate-400">{p.technicalScore ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600 dark:text-slate-400">{p.opportunityScore ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {tierBadge ? (
                          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold', tierBadge.tw)}>
                            <tierBadge.icon size={11} /> {tierBadge.label}
                          </span>
                        ) : <span className="text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        {p.reviewsCount ? `${p.reviewsCount}${p.rating ? ` (${p.rating}★)` : ''}` : '—'}
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setDetailProspectId(p._id)} className="btn-icon text-slate-400 hover:text-primary-500" title="View full details">
                            <Eye size={13} />
                          </button>
                          <button onClick={() => deleteProspect(id, p._id)} className="btn-icon text-slate-400 hover:text-red-500">
                            <XCircle size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProspectDetailModal prospect={detailProspect} onClose={() => setDetailProspectId(null)} />

      <Modal open={showPush} onClose={() => setShowPush(false)} title="Push prospects to an email campaign">
        <div className="px-6 py-5 space-y-4">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Adds these prospects to a campaign as leads, each carrying its website-audit findings.
            The campaign's email can then quote them with merge tags like{' '}
            <code className="text-[12px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{'{{top_finding}}'}</code>{' '}
            and <code className="text-[12px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{'{{perf_score}}'}</code>.
          </p>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Campaign</label>
            <Select value={pushCampaignId} onChange={(e) => setPushCampaignId(e.target.value)}>
              <option value="">Select a campaign…</option>
              {campaigns
                // Only draft/paused: pushing into a live campaign would start
                // mailing the new leads within the minute (backend enforces this too).
                .filter((c) => ['draft', 'paused'].includes(c.status))
                .map((c) => <option key={c._id} value={c._id}>{c.name} ({c.status})</option>)}
            </Select>
            {!campaigns.some((c) => ['draft', 'paused'].includes(c.status)) && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-1.5">
                No draft or paused campaign available — create one, or pause a running campaign first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Tiers to include</label>
            <div className="flex flex-wrap gap-2">
              {['hot', 'high', 'medium', 'low'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPushTiers((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors',
                    pushTiers.includes(t)
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300',
                  )}
                >
                  {TIER_BADGE[t]?.label || t} ({stats[t] || 0})
                </button>
              ))}
            </div>
          </div>

          <div className="text-[13px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
            <strong>{pushSelectedCount}</strong> prospect{pushSelectedCount === 1 ? '' : 's'} will be added.
            Prospects with no email address, no audit findings, or already in the campaign are skipped.
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowPush(false)}>Cancel</Button>
            <Button
              disabled={!pushCampaignId || !pushSelectedCount || pushing}
              onClick={async () => {
                setPushing(true);
                try {
                  await pushToCampaign(id, { campaignId: pushCampaignId, tiers: pushTiers });
                  setShowPush(false);
                } catch { /* store already surfaced the error */ } finally {
                  setPushing(false);
                }
              }}
            >
              <Send size={14} /> {pushing ? 'Adding…' : `Add ${pushSelectedCount} lead${pushSelectedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showAuto} onClose={() => setShowAuto(false)} title="Auto-push when this batch finishes crawling">
        <div className="px-6 py-5 space-y-4">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Optional. Leave this off and nothing changes — you crawl, review the tiers, press
            <strong> Push to Campaign</strong>, then press <strong>Start</strong> as usual.
            Switched on, the audited prospects are added to a campaign the moment the crawl finishes.
            The campaign is <strong>never started automatically</strong>: it stays a draft until you press Start.
          </p>

          {batch.autoPushResult?.status && (
            <div className="text-[12.5px] rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300">
              <strong>Last run:</strong>{' '}
              {batch.autoPushResult.status === 'pushed'
                ? `added ${batch.autoPushResult.created} lead(s) to "${batch.autoPushResult.campaignName}"`
                  + ` — of ${batch.autoPushResult.totalInBatch ?? '?'} in the batch,`
                  + ` ${batch.autoPushResult.skippedNotEligible ?? 0} not audited/no email,`
                  + ` ${batch.autoPushResult.skippedDuplicate ?? 0} already in the campaign`
                : `${batch.autoPushResult.status} — ${batch.autoPushResult.reason}`}
            </div>
          )}

          <div>
            <label className="block text-[12px] font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Campaign to fill</label>
            <Select value={autoCampaignId} onChange={(e) => setAutoCampaignId(e.target.value)}>
              <option value="">Select a draft or paused campaign…</option>
              {campaigns.filter((c) => ['draft', 'paused'].includes(c.status))
                .map((c) => <option key={c._id} value={c._id}>{c.name} ({c.status})</option>)}
            </Select>
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Tiers to include</label>
            <div className="flex flex-wrap gap-2">
              {['hot', 'high', 'medium', 'low'].map((tr) => (
                <button key={tr} type="button"
                  onClick={() => setAutoTiers((prev) => prev.includes(tr) ? prev.filter((x) => x !== tr) : [...prev, tr])}
                  className={cn('px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors',
                    autoTiers.includes(tr) ? 'bg-primary-600 text-white border-primary-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300')}>
                  {TIER_BADGE[tr]?.label || tr}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={autoRequireFindings} onChange={(e) => setAutoRequireFindings(e.target.checked)} />
            Only push prospects that have at least one audit finding
          </label>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {batch.autoPushEnabled && (
                <Button variant="outline" disabled={savingAuto}
                  onClick={async () => {
                    setSavingAuto(true);
                    try { await setAutoPush(id, { enabled: false }); setShowAuto(false); }
                    catch { /* store surfaced it */ } finally { setSavingAuto(false); }
                  }}>
                  Turn off
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowAuto(false)}>Cancel</Button>
              <Button disabled={!autoCampaignId || savingAuto}
                onClick={async () => {
                  setSavingAuto(true);
                  try {
                    await setAutoPush(id, { enabled: true, campaignId: autoCampaignId, tiers: autoTiers, requireFindings: autoRequireFindings });
                    setShowAuto(false);
                  } catch { /* store surfaced it */ } finally { setSavingAuto(false); }
                }}>
                <Repeat size={14} /> {savingAuto ? 'Saving…' : 'Enable auto-push'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </Page>
  );
}
