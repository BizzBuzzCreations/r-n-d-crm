import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Megaphone, DollarSign, Eye, Users2, MousePointerClick, Percent, TrendingUp,
  FileSpreadsheet, FileText, Download, RefreshCw, Lock, Calendar, X,
  Target, UserCheck, Trophy, ArrowLeft,
} from 'lucide-react';
import { Page, Button } from '../components/ui';
import { cn, localDateStr } from '../utils/helpers';
import { metaAdsAPI } from '../services/api';

// ── Date range helpers (mirrors ReportsPage.jsx's convention) ──────────
function fmtISO(d) { return localDateStr(d); }

function getDateRange(period, customFrom, customTo) {
  const today = new Date();
  if (period === 'today') {
    return { from: fmtISO(today), to: fmtISO(today), label: 'Today' };
  }
  if (period === 'week') {
    const from = new Date(today); from.setDate(from.getDate() - 6);
    return { from: fmtISO(from), to: fmtISO(today), label: 'Last 7 Days' };
  }
  if (period === 'month') {
    const from = new Date(today); from.setDate(from.getDate() - 29);
    return { from: fmtISO(from), to: fmtISO(today), label: 'Last 30 Days' };
  }
  if (period === 'custom' && customFrom && customTo) {
    return { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` };
  }
  const from = new Date(today); from.setDate(from.getDate() - 29);
  return { from: fmtISO(from), to: fmtISO(today), label: 'Last 30 Days' };
}

// ── Formatters ───────────────────────────────────────────────────────
function fmtCurrency(v, currency = 'USD') {
  if (v === null || v === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${Number(v).toLocaleString()}`;
  }
}
function fmtNum(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString(); }
function fmtPct(v) { return v === null || v === undefined ? '—' : `${v}%`; }
function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── CSV / Excel / PDF export helpers ────────────────────────────────
function downloadCSV(rows, filename) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function downloadExcel(rows, filename, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
function printPDF(title, rows) {
  const win = window.open('', '_blank', 'width=1000,height=720');
  const [header, ...body] = rows;
  win.document.write(`
    <html><head><title>${title}</title>
    <style>
      body { font-family: 'DM Sans', system-ui, sans-serif; color:#1e293b; padding:32px; background:#fff; }
      h1 { font-size:20px; font-weight:700; margin-bottom:16px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th { background:#f1f5f9; padding:6px 10px; text-align:left; font-weight:600; font-size:10.5px; text-transform:uppercase; color:#64748b; }
      td { padding:6px 10px; border-bottom:1px solid #f1f5f9; }
      @media print { body { padding:16px; } }
    </style></head><body>
    <h1>${title}</h1>
    <table>
      <tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr>
      ${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
    </table>
    <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  win.document.close();
}

// ── Compact KPI tile ─────────────────────────────────────────────────
// ── Metric glossary — full form + plain-English meaning, shown on hover ──
const METRIC_DEFS = {
  spend: 'Total Ad Spend — the amount Meta has actually charged you for this date range.',
  impressions: 'Impressions — how many times your ad was displayed on a screen. The same person can generate several impressions.',
  reach: 'Reach — the number of distinct people who saw your ad at least once. Always ≤ Impressions.',
  clicks: 'Clicks — total clicks anywhere on the ad (image, link, text, etc), not just link clicks.',
  landingPageViews: 'Landing Page Views — of the people who clicked, how many browsers actually finished loading your landing page (tracked via the Meta Pixel).',
  ctr: 'CTR — Click-Through Rate. Clicks ÷ Impressions × 100. The % of times your ad was shown that resulted in a click.',
  cpc: 'CPC — Cost Per Click. Spend ÷ Clicks. The average amount you paid per click.',
  cpm: 'CPM — Cost Per Mille (mille = thousand). Spend ÷ Impressions × 1,000. What it costs to show your ad 1,000 times.',
  conversions: 'Conversions — Meta\'s own count of "lead" actions it detected (e.g. Lead Ads form fills, Pixel events). Self-reported by Meta, not yet verified against your CRM pipeline.',
  totalLeads: 'Total Leads — real leads created in your CRM Leads Pipeline, attributed back to this ad spend. Only counts leads tagged with Meta campaign/adset/ad attribution at creation time.',
  qualifiedLeads: 'Qualified Leads — attributed leads that moved past "New Lead" status in your pipeline.',
  wonCustomers: 'Won Customers — attributed leads that closed as Won deals.',
  cpl: 'CPL — Cost Per Lead. Spend ÷ Total Leads. Average cost to generate one real CRM lead.',
};

// Pure-CSS hover tooltip — no JS state. Named group (group/tip) so it never
// collides with an ancestor's own `group`. placement="top" (default) pops
// upward — fine for KPI tiles, which sit in open page flow. Table headers
// use placement="bottom": they're the first row inside an overflow-x-auto
// scroll wrapper, so a tooltip popping *above* the header gets silently
// clipped by that wrapper's top edge — popping down over the table body
// (well within the wrapper's own bounds) avoids it entirely.
function InfoTip({ text, children, placement = 'top' }) {
  if (!text) return children;
  return (
    <span className="relative inline-flex items-center group/tip cursor-help">
      {children}
      <span className={cn(
        'pointer-events-none absolute left-1/2 -translate-x-1/2 w-max max-w-[240px] opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-opacity duration-150 z-50 text-[11px] leading-snug font-normal normal-case tracking-normal text-white bg-slate-800 dark:bg-slate-700 rounded-lg px-2.5 py-1.5 shadow-lg text-center',
        placement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
      )}>
        {text}
      </span>
    </span>
  );
}

function KpiTile({ icon: Icon, label, value, sub, tip, color = '#2a78d6', bg = '#eff6ff', deferred = false }) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-3.5 py-3 rounded-xl border',
      deferred ? 'border-dashed border-slate-250 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/20' : 'border-slate-200 dark:border-slate-700'
    )} style={deferred ? {} : { background: bg }}>
      <div className={cn('p-2 rounded-lg flex-shrink-0', deferred ? 'bg-slate-200/60 dark:bg-slate-800' : 'bg-white/60 dark:bg-slate-900/40')}>
        {deferred ? <Lock size={15} className="text-slate-400" /> : <Icon size={15} style={{ color }} />}
      </div>
      <div className="min-w-0">
        <InfoTip text={tip}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</p>
        </InfoTip>
        <p className={cn('text-[16px] font-bold leading-tight mt-0.5', deferred ? 'text-slate-400' : '')} style={deferred ? {} : { color }}>
          {deferred ? '—' : value}
        </p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[12px] shadow-modal">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">{p.value?.toLocaleString?.() ?? p.value}</span>
        </div>
      ))}
    </div>
  );
};

const TREND_METRICS = [
  { key: 'spend', label: 'Spend', isCurrency: true },
  { key: 'impressions', label: 'Impressions' },
  { key: 'reach', label: 'Reach' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'landingPageViews', label: 'Landing Page Views' },
  { key: 'conversions', label: 'Conversions' },
];

const FUNNEL_STAGES = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'landingPageViews', label: 'Landing Page Views' },
  { key: 'conversions', label: 'Conversions' },
];
// Ordinal ramp — funnel stages read as magnitude steps of one journey, not
// distinct categories, per the dataviz skill's ordinal-ramp guidance.
const FUNNEL_COLORS_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];
const FUNNEL_COLORS_DARK  = ['#6da7ec', '#3987e5', '#256abf', '#184f95'];

const ENTITY_TABS = [
  { id: 'campaigns', label: 'Campaign Performance' },
  { id: 'adsets', label: 'Ad Set Performance' },
  { id: 'ads', label: 'Ad Performance' },
  { id: 'leads', label: 'Lead Details' },
];

export default function MetaAdsPage() {
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { from, to, label: periodLabel } = useMemo(() => getDateRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [granularity, setGranularity] = useState('daily');
  const [trendMetric, setTrendMetric] = useState('spend');

  const [entityTab, setEntityTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [ads, setAds] = useState([]);
  const [leadDetails, setLeadDetails] = useState([]);
  const [drillCampaign, setDrillCampaign] = useState(null); // { id, name } — filters adsets tab
  const [drillAdset, setDrillAdset] = useState(null);       // { id, name } — filters ads tab
  const [tableLoading, setTableLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark');

  const currency = summary?.currency || 'USD';

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const { data } = await metaAdsAPI.status();
      setStatus(data.data);
    } catch {
      toast.error('Failed to load Meta Ads connection status');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadDashboardData = useCallback(async () => {
    if (!status?.configured) return;
    try {
      const [{ data: sData }, { data: tData }] = await Promise.all([
        metaAdsAPI.summary({ from, to }),
        metaAdsAPI.trends({ from, to, granularity }),
      ]);
      setSummary(sData.data);
      setTrend(tData.data.trend);
    } catch {
      toast.error('Failed to load Meta Ads analytics');
    }
  }, [status?.configured, from, to, granularity]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  const loadEntityTable = useCallback(async () => {
    if (!status?.configured) return;
    setTableLoading(true);
    try {
      if (entityTab === 'campaigns') {
        const { data } = await metaAdsAPI.campaigns({ from, to });
        setCampaigns(data.data.campaigns);
      } else if (entityTab === 'adsets') {
        const { data } = await metaAdsAPI.adsets({ from, to, campaignId: drillCampaign?.id });
        setAdsets(data.data.adsets);
      } else if (entityTab === 'ads') {
        const { data } = await metaAdsAPI.ads({ from, to, adsetId: drillAdset?.id });
        setAds(data.data.ads);
      } else {
        const { data } = await metaAdsAPI.leads({ from, to });
        setLeadDetails(data.data.leads);
      }
    } catch {
      toast.error('Failed to load performance table');
    } finally {
      setTableLoading(false);
    }
  }, [status?.configured, from, to, entityTab, drillCampaign, drillAdset]);

  useEffect(() => { loadEntityTable(); }, [loadEntityTable]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await metaAdsAPI.syncNow();
      toast.success('Synced with Meta Ads');
      await loadStatus();
      await loadDashboardData();
      await loadEntityTable();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDrillIntoCampaign = (row) => {
    setDrillCampaign({ id: row.id, name: row.name });
    setDrillAdset(null);
    setEntityTab('adsets');
  };
  const handleDrillIntoAdset = (row) => {
    setDrillAdset({ id: row.id, name: row.name });
    setEntityTab('ads');
  };

  // ── Export current table ──────────────────────────────────────────
  const activeRows = entityTab === 'campaigns' ? campaigns : entityTab === 'adsets' ? adsets : entityTab === 'ads' ? ads : leadDetails;
  const exportHeader = entityTab === 'leads'
    ? ['Lead', 'Company', 'Contact', 'Email', 'Phone', 'Status', 'Exact Stage', 'Salesperson', 'Campaign', 'Ad Set', 'Ad', 'Created']
    : ['Name', 'Status', 'Budget', 'Spend', 'Impressions', 'Reach', 'Clicks', 'CTR %', 'CPC', 'CPM', 'Landing Page Views', 'Conversions', 'Leads Generated', 'Qualified Leads', 'Customers Acquired'];
  const exportRows = () => [
    exportHeader,
    ...(entityTab === 'leads'
      ? leadDetails.map((l) => [
          l.leadRef, l.companyName, l.contactPerson, l.email, l.phone, l.status, l.externalStatusLabel || '',
          l.salesperson, l.campaignName, l.adsetName, l.adName,
          new Date(l.createdAt).toLocaleString(),
        ])
      : activeRows.map((r) => [
          r.name, r.status,
          r.dailyBudget ? `${fmtCurrency(r.dailyBudget, currency)}/day` : r.lifetimeBudget ? `${fmtCurrency(r.lifetimeBudget, currency)} lifetime` : '—',
          r.spend, r.impressions, r.reach, r.clicks, r.ctr, r.cpc, r.cpm, r.landingPageViews, r.conversions,
          r.totalLeads ?? 'N/A', r.qualifiedLeads ?? 'N/A', r.wonCustomers ?? 'N/A',
        ])),
  ];
  const exportFilenameBase = `meta-ads-${entityTab}-${from}_to_${to}`;
  const handleExportCSV = () => { downloadCSV(exportRows(), `${exportFilenameBase}.csv`); toast.success('CSV downloaded'); };
  const handleExportExcel = () => { downloadExcel(exportRows(), `${exportFilenameBase}.xlsx`, entityTab); toast.success('Excel file downloaded'); };
  const handleExportPDF = () => { printPDF(`Meta Ads — ${ENTITY_TABS.find((t) => t.id === entityTab).label}`, exportRows()); toast.success('Opening PDF print dialog…'); };

  // ── Not configured state ────────────────────────────────────────
  if (!statusLoading && !status?.configured) {
    return (
      <Page>
        <div className="flex items-center gap-2 mb-2">
          <Megaphone className="text-indigo-500" />
          <h1 className="page-title">Meta Ads Analytics</h1>
        </div>
        <div className="card p-10 text-center max-w-lg mx-auto mt-8">
          <Megaphone size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          <h3 className="text-[16px] font-bold text-slate-800 dark:text-slate-200 mb-2">Meta Ads isn't connected yet</h3>
          <p className="text-[13px] text-slate-500 mb-5">
            Add your Meta Marketing API credentials in <strong>Settings → Meta Ads</strong> to start pulling campaign
            spend, impressions, clicks, and conversions into this dashboard.
          </p>
          <a href="/settings?tab=meta_ads">
            <Button variant="primary">Go to Settings</Button>
          </a>
        </div>
      </Page>
    );
  }

  const funnelColors = darkMode ? FUNNEL_COLORS_DARK : FUNNEL_COLORS_LIGHT;
  const funnelMax = summary ? Math.max(1, ...FUNNEL_STAGES.map((s) => summary[s.key] || 0)) : 1;

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Megaphone className="text-indigo-500" /> Meta Ads Analytics
          </h1>
          <p className="page-sub">
            {status?.account?.accountName ? `Connected: ${status.account.accountName}` : 'Ad performance & lead attribution'}
            {' · '}<span className="text-primary-500 font-medium">{periodLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-slate-400">
            {status?.account?.lastSyncedAt ? `Last synced ${new Date(status.account.lastSyncedAt).toLocaleTimeString()}` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={handleSync} loading={syncing} className="flex items-center gap-1.5">
            <RefreshCw size={13} /> Sync Now
          </Button>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          {[['today', 'Today'], ['week', 'Last 7 Days'], ['month', 'Last 30 Days']].map(([v, l]) => (
            <button key={v} onClick={() => { setPeriod(v); setCustomFrom(''); setCustomTo(''); }}
              className={cn('px-3 py-1.5 rounded-md text-[13px] font-medium transition-all',
                period === v ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar size={13} className="text-slate-400" />
          <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); if (e.target.value && customTo) setPeriod('custom'); }}
            className="form-input py-1.5 text-[13px] w-[145px]" style={{ colorScheme: 'light' }} />
          <span className="text-slate-400 text-[12px]">to</span>
          <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); if (customFrom && e.target.value) setPeriod('custom'); }}
            className="form-input py-1.5 text-[13px] w-[145px]" style={{ colorScheme: 'light' }} />
        </div>
        {period === 'custom' && (
          <button onClick={() => { setPeriod('month'); setCustomFrom(''); setCustomTo(''); }}
            className="flex items-center gap-1 text-[12.5px] text-red-500 hover:text-red-700 font-medium border border-red-200 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/10 dark:border-red-800">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* KPI Cards — real Meta Ads data */}
      <h3 className="text-[13px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2.5">Ad Performance</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiTile icon={DollarSign} label="Total Ad Spend" value={fmtCurrency(summary?.spend, currency)} tip={METRIC_DEFS.spend} color="#2a78d6" bg="#eff6ff" />
        <KpiTile icon={Eye} label="Impressions" value={fmtNum(summary?.impressions)} tip={METRIC_DEFS.impressions} color="#eb6834" bg="#fff4ed" />
        <KpiTile icon={Users2} label="Reach" value={fmtNum(summary?.reach)} tip={METRIC_DEFS.reach} color="#1baf7a" bg="#effaf5" />
        <KpiTile icon={MousePointerClick} label="Clicks" value={fmtNum(summary?.clicks)} tip={METRIC_DEFS.clicks} color="#eda100" bg="#fff8e8" />
        <KpiTile icon={Target} label="Landing Page Views" value={fmtNum(summary?.landingPageViews)} tip={METRIC_DEFS.landingPageViews} color="#4a3aa7" bg="#f3f1fc" />
        <KpiTile icon={Percent} label="CTR" value={fmtPct(summary?.ctr)} tip={METRIC_DEFS.ctr} color="#2a78d6" bg="#eff6ff" />
        <KpiTile icon={DollarSign} label="CPC" value={fmtCurrency(summary?.cpc, currency)} tip={METRIC_DEFS.cpc} color="#eb6834" bg="#fff4ed" />
        <KpiTile icon={DollarSign} label="CPM" value={fmtCurrency(summary?.cpm, currency)} tip={METRIC_DEFS.cpm} color="#1baf7a" bg="#effaf5" />
        <KpiTile icon={TrendingUp} label="Conversions" sub="Meta-reported leads" value={fmtNum(summary?.conversions)} tip={METRIC_DEFS.conversions} color="#eda100" bg="#fff8e8" />
      </div>

      {/* KPI Cards — lead & revenue attribution */}
      <h3 className="text-[13px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2.5">Lead Attribution</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile icon={Users2} label="Total Leads" value={fmtNum(summary?.totalLeads)} tip={METRIC_DEFS.totalLeads} color="#2a78d6" bg="#eff6ff" />
        <KpiTile icon={UserCheck} label="Qualified Leads" value={fmtNum(summary?.qualifiedLeads)} tip={METRIC_DEFS.qualifiedLeads} color="#eb6834" bg="#fff4ed" />
        <KpiTile icon={Trophy} label="Won Customers" value={fmtNum(summary?.wonCustomers)} tip={METRIC_DEFS.wonCustomers} color="#1baf7a" bg="#effaf5" />
        <KpiTile icon={DollarSign} label="Cost per Lead (CPL)" value={fmtCurrency(summary?.costPerLead, currency)} tip={METRIC_DEFS.cpl} color="#eda100" bg="#fff8e8" />
      </div>

      {/* Marketing Funnel + Trend chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">Marketing Funnel</h3>
          <div className="space-y-3">
            {FUNNEL_STAGES.map((s, i) => {
              const val = summary?.[s.key] || 0;
              const widthPct = Math.max(6, (val / funnelMax) * 100);
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between mb-1 text-[12px]">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">{s.label}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{fmtNum(val)}</span>
                  </div>
                  <div className="h-6 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-lg flex items-center transition-all" style={{ width: `${widthPct}%`, background: funnelColors[i] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Trends</h3>
            <div className="flex items-center gap-2">
              <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} className="form-input text-[12.5px] py-1 w-[170px]">
                {TREND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                {[['daily', 'D'], ['weekly', 'W'], ['monthly', 'M']].map(([v, l]) => (
                  <button key={v} onClick={() => setGranularity(v)}
                    className={cn('px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition-all',
                      granularity === v ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ left: -20, right: 5, top: 5 }}>
              <defs>
                <linearGradient id="metaTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={darkMode ? '#3987e5' : '#2a78d6'} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={darkMode ? '#3987e5' : '#2a78d6'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey={trendMetric} name={TREND_METRICS.find((m) => m.key === trendMetric)?.label}
                stroke={darkMode ? '#3987e5' : '#2a78d6'} fill="url(#metaTrendGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Entity performance tables */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-wrap gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {ENTITY_TABS.map((t) => (
              <button key={t.id} onClick={() => { setEntityTab(t.id); if (t.id === 'campaigns') { setDrillCampaign(null); setDrillAdset(null); } }}
                className={cn('px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all',
                  entityTab === t.id ? 'bg-white dark:bg-slate-900 text-indigo-650 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350')}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleExportCSV} className="flex items-center gap-1"><FileSpreadsheet size={12} className="text-emerald-500" /> CSV</Button>
            <Button size="sm" variant="outline" onClick={handleExportExcel} className="flex items-center gap-1"><Download size={12} className="text-emerald-600" /> Excel</Button>
            <Button size="sm" variant="primary" onClick={handleExportPDF} className="flex items-center gap-1"><FileText size={12} /> PDF</Button>
          </div>
        </div>

        {/* Drill-down breadcrumb */}
        {(entityTab === 'adsets' && drillCampaign) && (
          <div className="px-5 py-2 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/30 flex items-center gap-2 text-[12.5px]">
            <button onClick={() => { setDrillCampaign(null); setEntityTab('campaigns'); }} className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
              <ArrowLeft size={12} /> All Campaigns
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">{drillCampaign.name}</span>
          </div>
        )}
        {(entityTab === 'ads' && drillAdset) && (
          <div className="px-5 py-2 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/30 flex items-center gap-2 text-[12.5px]">
            <button onClick={() => { setDrillAdset(null); setEntityTab('adsets'); }} className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
              <ArrowLeft size={12} /> {drillCampaign ? drillCampaign.name : 'All Ad Sets'}
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">{drillAdset.name}</span>
          </div>
        )}

        {entityTab === 'leads' ? (
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Campaign</th>
                  <th>Ad Set</th>
                  <th>Ad</th>
                  <th>Salesperson</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading…</td></tr>
                ) : leadDetails.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-slate-400">No leads for this period yet — leads show up here once n8n starts sending adAttribution.</td></tr>
                ) : (
                  leadDetails.map((l) => (
                    <tr key={l.leadId}>
                      <td className="max-w-[200px]">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{l.companyName}</p>
                        <p className="text-[11.5px] text-slate-450 truncate">{l.contactPerson}</p>
                      </td>
                      <td>
                        <span className={cn('badge',
                          l.status === 'Won' ? 'badge-success' : l.status === 'Lost' ? 'badge-danger' :
                          l.status === 'Proposal Sent' ? 'badge-warning' : l.status === 'First Contact' ? 'badge-info' : 'badge-neutral')}>
                          {l.status}
                        </span>
                        {l.externalStatusLabel && (
                          <p className="text-[11px] text-slate-450 mt-0.5" title="Exact stage in main CRM">{l.externalStatusLabel}</p>
                        )}
                      </td>
                      <td className="text-[12.5px]">{l.email || '—'}</td>
                      <td className="text-[12.5px]">{l.phone || '—'}</td>
                      <td className="text-[12.5px] max-w-[160px] truncate">{l.campaignName || '—'}</td>
                      <td className="text-[12.5px] max-w-[160px] truncate">{l.adsetName || '—'}</td>
                      <td className="text-[12.5px] max-w-[160px] truncate">{l.adName || '—'}</td>
                      <td className="text-[12.5px]">{l.salesperson}</td>
                      <td className="text-[12.5px] whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.spend}>Spend</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.ctr}>CTR</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.cpc}>CPC</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.cpm}>CPM</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.totalLeads}>Leads</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.qualifiedLeads}>Qualified</InfoTip></th>
                  <th><InfoTip placement="bottom" text={METRIC_DEFS.wonCustomers}>Customers</InfoTip></th>
                  {entityTab !== 'ads' && <th></th>}
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  <tr><td colSpan={11} className="text-center py-8 text-slate-400">Loading…</td></tr>
                ) : activeRows.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-slate-400">No {entityTab} data for this period yet — try Sync Now, or widen the date range.</td></tr>
                ) : (
                  activeRows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold text-slate-800 dark:text-slate-200 max-w-[220px] truncate">{r.name}</td>
                      <td>
                        <span className={cn('badge', r.status === 'ACTIVE' ? 'badge-success' : r.status === 'PAUSED' ? 'badge-warning' : 'badge-neutral')}>
                          {r.status}
                        </span>
                      </td>
                      <td className="text-[12.5px]">{r.dailyBudget ? `${fmtCurrency(r.dailyBudget, currency)}/day` : r.lifetimeBudget ? `${fmtCurrency(r.lifetimeBudget, currency)} total` : '—'}</td>
                      <td className="font-semibold">{fmtCurrency(r.spend, currency)}</td>
                      <td>{fmtPct(r.ctr)}</td>
                      <td>{fmtCurrency(r.cpc, currency)}</td>
                      <td>{fmtCurrency(r.cpm, currency)}</td>
                      <td>{fmtNum(r.totalLeads)}</td>
                      <td>{fmtNum(r.qualifiedLeads)}</td>
                      <td>{fmtNum(r.wonCustomers)}</td>
                      {entityTab === 'campaigns' && (
                        <td><button onClick={() => handleDrillIntoCampaign(r)} className="text-[11.5px] font-semibold text-indigo-600 hover:underline">View Ad Sets →</button></td>
                      )}
                      {entityTab === 'adsets' && (
                        <td><button onClick={() => handleDrillIntoAdset(r)} className="text-[11.5px] font-semibold text-indigo-600 hover:underline">View Ads →</button></td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
}
