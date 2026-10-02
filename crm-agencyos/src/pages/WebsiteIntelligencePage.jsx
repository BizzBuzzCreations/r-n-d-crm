import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Globe, Users2, UserCheck, Repeat, Layers, Clock, LogOut, Target, Percent, DollarSign,
  FileSpreadsheet, FileText, Download, Calendar, X, ChevronDown, ChevronRight, TrendingUp, BarChart3,
} from 'lucide-react';
import { Page, Button, Badge } from '../components/ui';
import { cn, localDateStr } from '../utils/helpers';
import { witAPI } from '../services/api';

// ── Date range helpers ──────────────────────────────────────────────
function fmtISO(d) { return localDateStr(d); }
function getDateRange(period, customFrom, customTo) {
  const today = new Date();
  if (period === 'today') return { from: fmtISO(today), to: fmtISO(today), label: 'Today' };
  if (period === 'week') { const f = new Date(today); f.setDate(f.getDate() - 6); return { from: fmtISO(f), to: fmtISO(today), label: 'Last 7 Days' }; }
  if (period === 'month') { const f = new Date(today); f.setDate(f.getDate() - 29); return { from: fmtISO(f), to: fmtISO(today), label: 'Last 30 Days' }; }
  if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` };
  const f = new Date(today); f.setDate(f.getDate() - 29);
  return { from: fmtISO(f), to: fmtISO(today), label: 'Last 30 Days' };
}

function fmtNum(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString(); }
function fmtPct(v) { return v === null || v === undefined ? '—' : `${v}%`; }
function fmtCurrency(v) { return v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN')}`; }
function fmtDuration(sec) {
  if (sec === null || sec === undefined) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Export helpers ───────────────────────────────────────────────────
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
    <table><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>
    <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  win.document.close();
}

// ── KPI tile ─────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, color = '#2a78d6', bg = '#eff6ff' }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700" style={{ background: bg }}>
      <div className="p-2 rounded-lg bg-white/60 dark:bg-slate-900/40 flex-shrink-0">
        <Icon size={15} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className="text-[16px] font-bold leading-tight mt-0.5" style={{ color }}>{value}</p>
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
  { key: 'visitors', label: 'Visitors' }, { key: 'sessions', label: 'Sessions' },
  { key: 'leads', label: 'Leads' }, { key: 'revenue', label: 'Revenue' },
];

const DETAIL_TABS = [
  { id: 'traffic', label: 'Traffic Sources' },
  { id: 'countries', label: 'Countries' },
  { id: 'devices', label: 'Devices' },
  { id: 'pages', label: 'Page Analytics' },
  { id: 'landing', label: 'Landing Pages' },
  { id: 'forms', label: 'Form Analytics' },
  { id: 'funnel', label: 'Funnel' },
  { id: 'attribution', label: 'Lead Attribution' },
  { id: 'repeat', label: 'Repeat Visitors' },
];

export default function WebsiteIntelligencePage() {
  const [websites, setWebsites] = useState([]);
  const [websiteId, setWebsiteId] = useState('');
  const [loadingWebsites, setLoadingWebsites] = useState(true);

  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { from, to, label: periodLabel } = useMemo(() => getDateRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [granularity, setGranularity] = useState('daily');
  const [trendMetric, setTrendMetric] = useState('visitors');
  const [chartType, setChartType] = useState('area');
  const [darkMode] = useState(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark');

  const [detailTab, setDetailTab] = useState('traffic');
  const [trafficSources, setTrafficSources] = useState([]);
  const [countries, setCountries] = useState([]);
  const [devices, setDevices] = useState(null);
  const [pages, setPages] = useState([]);
  const [landingPages, setLandingPages] = useState([]);
  const [forms, setForms] = useState([]);
  const [funnel, setFunnel] = useState([]);
  const [leadAttribution, setLeadAttribution] = useState([]);
  const [repeatVisitors, setRepeatVisitors] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const params = useMemo(() => ({ from, to, ...(websiteId ? { websiteId } : {}) }), [from, to, websiteId]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await witAPI.getWebsites();
        setWebsites(data.data);
      } catch { toast.error('Failed to load websites'); }
      finally { setLoadingWebsites(false); }
    })();
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const [{ data: sData }, { data: tData }] = await Promise.all([
        witAPI.summary(params), witAPI.trends({ ...params, granularity }),
      ]);
      setSummary(sData.data);
      setTrend(tData.data.trend);
    } catch { toast.error('Failed to load Website Intelligence data'); }
  }, [params, granularity]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    try {
      if (detailTab === 'traffic') setTrafficSources((await witAPI.trafficSources(params)).data.data.sources);
      else if (detailTab === 'countries') setCountries((await witAPI.countries(params)).data.data.countries);
      else if (detailTab === 'devices') setDevices((await witAPI.devices(params)).data.data);
      else if (detailTab === 'pages') setPages((await witAPI.pages(params)).data.data.pages);
      else if (detailTab === 'landing') setLandingPages((await witAPI.landingPages(params)).data.data.landingPages);
      else if (detailTab === 'forms') setForms((await witAPI.forms(params)).data.data.forms);
      else if (detailTab === 'funnel') setFunnel((await witAPI.funnel(params)).data.data.funnel);
      else if (detailTab === 'attribution') setLeadAttribution((await witAPI.leadAttribution(params)).data.data.leads);
      else if (detailTab === 'repeat') setRepeatVisitors((await witAPI.repeatVisitors(params)).data.data);
    } catch { toast.error('Failed to load detail data'); }
    finally { setDetailLoading(false); }
  }, [detailTab, params]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── Export ──────────────────────────────────────────────────────
  const handleExport = (format) => {
    let header = [], rows = [], title = '';
    if (detailTab === 'traffic') {
      header = ['Source', 'Visitors', 'Sessions', 'Leads', 'Customers', 'Revenue', 'Conversion Rate'];
      rows = trafficSources.map((s) => [s.label, s.visitors, s.sessions, s.leads, s.customers, s.revenue, `${s.conversionRate}%`]);
      title = 'Traffic Sources';
    } else if (detailTab === 'countries') {
      header = ['Country', 'Visitors', 'Sessions', 'Leads', 'Customers', 'Revenue', 'Conversion Rate'];
      rows = countries.map((c) => [c.country, c.visitors, c.sessions, c.leads, c.customers, c.revenue, `${c.conversionRate}%`]);
      title = 'Country Distribution';
    } else if (detailTab === 'pages') {
      header = ['Path', 'Views', 'Unique Visitors', 'Avg Time on Page (s)', 'Avg Scroll Depth', 'Bounce Rate', 'Exit Rate', 'Conversion Rate'];
      rows = pages.map((p) => [p.path, p.views, p.uniqueVisitors, p.avgTimeOnPage, `${p.avgScrollDepth}%`, p.bounceRate ?? 'N/A', `${p.exitRate}%`, p.conversionRate ?? 'N/A']);
      title = 'Page Analytics';
    } else if (detailTab === 'landing') {
      header = ['Path', 'Visitors', 'Sessions', 'Leads', 'Conversion Rate', 'Revenue', 'Bounce Rate', 'Avg Session Duration (s)'];
      rows = landingPages.map((p) => [p.path, p.visitors, p.sessions, p.leads, `${p.conversionRate}%`, p.revenue, `${p.bounceRate}%`, p.avgSessionDuration]);
      title = 'Landing Page Performance';
    } else if (detailTab === 'forms') {
      header = ['Form', 'Views', 'Starts', 'Submissions', 'Abandonment Rate', 'Avg Completion Time (s)'];
      rows = forms.map((f) => [f.formId, f.views, f.starts, f.submissions, `${f.abandonmentRate}%`, f.avgCompletionTime ?? 'N/A']);
      title = 'Form Analytics';
    } else if (detailTab === 'attribution') {
      header = ['Lead', 'Company', 'Status', 'Salesperson', 'Revenue', 'Landing Page', 'UTM Campaign', 'Created', 'Time to Conversion (h)'];
      rows = leadAttribution.map((l) => [l.leadRef, l.companyName, l.status, l.salesperson, l.revenue, l.landingPageUrl, l.utmCampaign, new Date(l.createdAt).toLocaleDateString(), l.timeToConversionHours ?? 'N/A']);
      title = 'Lead Attribution';
    } else if (detailTab === 'repeat') {
      header = ['Visitor', 'Visits in Period', 'Lifetime Visits', 'First Seen', 'Last Seen', 'Device', 'Country', 'Unique IPs', 'IP Addresses', 'Lead'];
      rows = (repeatVisitors?.visitors || []).map((v) => [
        v.lead ? v.lead.companyName : v.visitorId, v.visitsInRange, v.lifetimeVisits,
        v.firstSeenAt ? new Date(v.firstSeenAt).toLocaleString() : '', v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString() : '',
        v.deviceType, v.country || 'Unknown', v.uniqueIps?.length || 0, (v.uniqueIps || []).join('; '),
        v.lead ? `${v.lead.contactPerson} (${v.lead.status})` : 'Not converted',
      ]);
      title = 'Repeat Visitors';
    } else {
      toast.error('Nothing to export for this tab');
      return;
    }
    const allRows = [header, ...rows];
    const filenameBase = `website-intelligence-${detailTab}-${from}_to_${to}`;
    if (format === 'csv') { downloadCSV(allRows, `${filenameBase}.csv`); toast.success('CSV downloaded'); }
    else if (format === 'excel') { downloadExcel(allRows, `${filenameBase}.xlsx`, title); toast.success('Excel file downloaded'); }
    else { printPDF(title, allRows); toast.success('Opening PDF print dialog…'); }
  };

  if (loadingWebsites) return null;

  if (websites.length === 0) {
    return (
      <Page>
        <div className="flex items-center gap-2 mb-2"><Globe className="text-indigo-500" /><h1 className="page-title">Website Intelligence</h1></div>
        <div className="card p-10 text-center max-w-lg mx-auto mt-8">
          <Globe size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          <h3 className="text-[16px] font-bold text-slate-800 dark:text-slate-200 mb-2">No websites configured yet</h3>
          <p className="text-[13px] text-slate-500 mb-5">Add your website in <strong>Settings → Websites</strong> to get a tracking snippet and start collecting visitor analytics.</p>
          <a href="/settings?tab=websites"><Button variant="primary">Go to Settings</Button></a>
        </div>
      </Page>
    );
  }

  const seriesBlue = darkMode ? '#3987e5' : '#2a78d6';
  const seriesOrange = darkMode ? '#d95926' : '#eb6834';
  const surfaceColor = darkMode ? '#1e293b' : '#ffffff'; // matches .card's bg-white/dark:bg-slate-800 — the stacked-bar segment gap draws in this

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="page-title flex items-center gap-2"><Globe className="text-indigo-500" /> Website Intelligence</h1>
          <p className="page-sub">Visitor behavior, lead attribution & revenue from your websites · <span className="text-primary-500 font-medium">{periodLabel}</span></p>
        </div>
        <select className="form-input text-[13px] py-1.5 w-[220px]" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)}>
          <option value="">All Websites</option>
          {websites.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          {[['today', 'Today'], ['week', 'Last 7 Days'], ['month', 'Last 30 Days']].map(([v, l]) => (
            <button key={v} onClick={() => { setPeriod(v); setCustomFrom(''); setCustomTo(''); }}
              className={cn('px-3 py-1.5 rounded-md text-[13px] font-medium transition-all', period === v ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar size={13} className="text-slate-400" />
          <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); if (e.target.value && customTo) setPeriod('custom'); }} className="form-input py-1.5 text-[13px] w-[145px]" style={{ colorScheme: 'light' }} />
          <span className="text-slate-400 text-[12px]">to</span>
          <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); if (customFrom && e.target.value) setPeriod('custom'); }} className="form-input py-1.5 text-[13px] w-[145px]" style={{ colorScheme: 'light' }} />
        </div>
        {period === 'custom' && (
          <button onClick={() => { setPeriod('month'); setCustomFrom(''); setCustomTo(''); }} className="flex items-center gap-1 text-[12.5px] text-red-500 hover:text-red-700 font-medium border border-red-200 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/10 dark:border-red-800">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiTile icon={Users2} label="Total Visitors" value={fmtNum(summary?.totalVisitors)} color="#2a78d6" bg="#eff6ff" />
        <KpiTile icon={Users2} label="Active Visitors" value={fmtNum(summary?.activeVisitors)} color="#1baf7a" bg="#effaf5" />
        <KpiTile icon={UserCheck} label="New Visitors" value={fmtNum(summary?.newVisitors)} color="#eb6834" bg="#fff4ed" />
        <KpiTile icon={Repeat} label="Returning Visitors" value={fmtNum(summary?.returningVisitors)} color="#eda100" bg="#fff8e8" />
        <KpiTile icon={Layers} label="Total Sessions" value={fmtNum(summary?.totalSessions)} color="#4a3aa7" bg="#f3f1fc" />
        <KpiTile icon={Clock} label="Avg. Session Duration" value={fmtDuration(summary?.avgSessionDuration)} color="#2a78d6" bg="#eff6ff" />
        <KpiTile icon={LogOut} label="Bounce Rate" value={fmtPct(summary?.bounceRate)} color="#eb6834" bg="#fff4ed" />
        <KpiTile icon={Target} label="Leads Generated" value={fmtNum(summary?.leadsGenerated)} color="#1baf7a" bg="#effaf5" />
        <KpiTile icon={Percent} label="Conversion Rate" value={fmtPct(summary?.conversionRate)} color="#eda100" bg="#fff8e8" />
        <KpiTile icon={DollarSign} label="Revenue Generated" value={fmtCurrency(summary?.revenueGenerated)} color="#4a3aa7" bg="#f3f1fc" />
      </div>

      {/* Trend chart */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Trends</h3>
          <div className="flex items-center gap-2">
            <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} className="form-input text-[12.5px] py-1 w-[140px]">
              {TREND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              <button onClick={() => setChartType('area')} title="Area chart" className={cn('p-1.5 rounded-md transition-all', chartType === 'area' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400')}>
                <TrendingUp size={13} />
              </button>
              <button onClick={() => setChartType('bar')} title="Bar chart" className={cn('p-1.5 rounded-md transition-all', chartType === 'bar' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400')}>
                <BarChart3 size={13} />
              </button>
            </div>
            <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {[['daily', 'D'], ['weekly', 'W'], ['monthly', 'M']].map(([v, l]) => (
                <button key={v} onClick={() => setGranularity(v)} className={cn('px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition-all', granularity === v ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400')}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          {chartType === 'area' ? (
            <AreaChart data={trend} margin={{ left: -20, right: 5, top: 5 }}>
              <defs>
                <linearGradient id="witTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={seriesBlue} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={seriesBlue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey={trendMetric} name={TREND_METRICS.find((m) => m.key === trendMetric)?.label} stroke={seriesBlue} fill="url(#witTrendGrad)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          ) : (
            <BarChart data={trend} margin={{ left: -20, right: 5, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey={trendMetric} name={TREND_METRICS.find((m) => m.key === trendMetric)?.label} fill={seriesBlue} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Supporting trend comparisons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Visitor Acquisition</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">New vs. returning visitors per period</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend} margin={{ left: -20, right: 5, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="newVisitors" name="New" stackId="visitors" fill={seriesBlue} stroke={surfaceColor} strokeWidth={2} maxBarSize={28} />
              <Bar dataKey="returningVisitors" name="Returning" stackId="visitors" fill={seriesOrange} stroke={surfaceColor} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Visitors vs. Sessions</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Engagement depth — sessions per visitor over time</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ left: -20, right: 5, top: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line type="monotone" dataKey="visitors" name="Visitors" stroke={seriesBlue} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="sessions" name="Sessions" stroke={seriesOrange} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detail tabs */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-wrap gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 flex-wrap">
            {DETAIL_TABS.map((t) => (
              <button key={t.id} onClick={() => setDetailTab(t.id)} className={cn('px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all', detailTab === t.id ? 'bg-white dark:bg-slate-900 text-indigo-650 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350')}>
                {t.label}
              </button>
            ))}
          </div>
          {['traffic', 'countries', 'pages', 'landing', 'forms', 'attribution', 'repeat'].includes(detailTab) && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleExport('csv')} className="flex items-center gap-1"><FileSpreadsheet size={12} className="text-emerald-500" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={() => handleExport('excel')} className="flex items-center gap-1"><Download size={12} className="text-emerald-600" /> Excel</Button>
              <Button size="sm" variant="primary" onClick={() => handleExport('pdf')} className="flex items-center gap-1"><FileText size={12} /> PDF</Button>
            </div>
          )}
        </div>

        <div className="p-5">
          {detailLoading ? (
            <p className="text-center py-8 text-slate-400 text-[13px]">Loading…</p>
          ) : (
            <>
              {detailTab === 'traffic' && <TrafficSourcesTable rows={trafficSources} />}
              {detailTab === 'countries' && <CountriesTable rows={countries} />}
              {detailTab === 'devices' && <DevicesPanel data={devices} />}
              {detailTab === 'pages' && <PagesTable rows={pages} />}
              {detailTab === 'landing' && <LandingPagesTable rows={landingPages} />}
              {detailTab === 'forms' && <FormsTable rows={forms} />}
              {detailTab === 'funnel' && <FunnelPanel rows={funnel} />}
              {detailTab === 'attribution' && <LeadAttributionTable rows={leadAttribution} />}
              {detailTab === 'repeat' && <RepeatVisitorsPanel data={repeatVisitors} />}
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

// ── Detail panels ─────────────────────────────────────────────────

function EmptyState({ label }) {
  return <p className="text-center py-8 text-slate-400 text-[13px]">{label}</p>;
}

function TrafficSourcesTable({ rows }) {
  if (!rows.length) return <EmptyState label="No traffic in this period yet." />;
  return (
    <table className="crm-table">
      <thead><tr><th>Source</th><th>Visitors</th><th>Sessions</th><th>Leads</th><th>Customers</th><th>Revenue</th><th>Conversion Rate</th></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.source}>
            <td className="font-semibold text-slate-800 dark:text-slate-200">{s.label}</td>
            <td>{fmtNum(s.visitors)}</td><td>{fmtNum(s.sessions)}</td><td>{fmtNum(s.leads)}</td><td>{fmtNum(s.customers)}</td>
            <td className="font-semibold">{fmtCurrency(s.revenue)}</td><td>{fmtPct(s.conversionRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountriesTable({ rows }) {
  if (!rows.length) return <EmptyState label="No visitor location data in this period yet." />;
  const max = Math.max(1, ...rows.map((c) => c.visitors));
  return (
    <div>
      <div className="space-y-2 mb-5 max-w-xl">
        {rows.slice(0, 10).map((c) => (
          <div key={c.country}>
            <div className="flex items-center justify-between mb-1 text-[12.5px]">
              <span className={cn('font-medium', c.country === 'Unknown' ? 'text-slate-400 italic' : 'text-slate-600 dark:text-slate-400')}>{c.country}</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{fmtNum(c.visitors)}</span>
            </div>
            <div className="h-4 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className="h-full rounded-lg bg-indigo-500 transition-all" style={{ width: `${Math.max(3, (c.visitors / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <table className="crm-table">
        <thead><tr><th>Country</th><th>Visitors</th><th>Sessions</th><th>Leads</th><th>Customers</th><th>Revenue</th><th>Conversion Rate</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.country}>
              <td className={cn('font-semibold', c.country === 'Unknown' ? 'text-slate-400 italic font-normal' : 'text-slate-800 dark:text-slate-200')}>{c.country}</td>
              <td>{fmtNum(c.visitors)}</td><td>{fmtNum(c.sessions)}</td><td>{fmtNum(c.leads)}</td><td>{fmtNum(c.customers)}</td>
              <td className="font-semibold">{fmtCurrency(c.revenue)}</td><td>{fmtPct(c.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesPanel({ data }) {
  if (!data) return <EmptyState label="No device data yet." />;
  const Block = ({ title, rows }) => (
    <div>
      <h4 className="text-[12.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">{title}</h4>
      {rows.length === 0 ? <p className="text-[12.5px] text-slate-400">—</p> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between text-[13px]">
              <span className="text-slate-600 dark:text-slate-400 capitalize">{r.name}</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{fmtNum(r.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Block title="Device Type" rows={data.devices} />
      <Block title="Browser" rows={data.browsers} />
      <Block title="Operating System" rows={data.operatingSystems} />
    </div>
  );
}

function PagesTable({ rows }) {
  const [sortBy, setSortBy] = useState('views');
  const sorted = useMemo(() => {
    const key = sortBy === 'conversion' ? 'conversionRate' : sortBy === 'bounce' ? 'bounceRate' : 'views';
    return [...rows].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  }, [rows, sortBy]);
  if (!rows.length) return <EmptyState label="No page data in this period yet." />;
  return (
    <div>
      <div className="flex gap-2 mb-3">
        {[['views', 'Most Visited'], ['conversion', 'Highest Conversion'], ['bounce', 'Highest Bounce']].map(([v, l]) => (
          <button key={v} onClick={() => setSortBy(v)} className={cn('px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border', sortBy === v ? 'bg-indigo-50 border-indigo-300 text-indigo-650 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-400' : 'border-slate-200 dark:border-slate-700 text-slate-500')}>{l}</button>
        ))}
      </div>
      <table className="crm-table">
        <thead><tr><th>Path</th><th>Views</th><th>Unique Visitors</th><th>Avg Time</th><th>Scroll Depth</th><th>Bounce Rate</th><th>Exit Rate</th><th>Conversion Rate</th></tr></thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.path}>
              <td className="font-mono text-[12px] text-slate-700 dark:text-slate-300 max-w-[220px] truncate">{p.path}</td>
              <td>{fmtNum(p.views)}</td><td>{fmtNum(p.uniqueVisitors)}</td><td>{fmtDuration(p.avgTimeOnPage)}</td>
              <td>{fmtPct(p.avgScrollDepth)}</td><td>{p.bounceRate === null ? '—' : fmtPct(p.bounceRate)}</td>
              <td>{fmtPct(p.exitRate)}</td><td>{p.conversionRate === null ? '—' : fmtPct(p.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LandingPagesTable({ rows }) {
  if (!rows.length) return <EmptyState label="No landing page data in this period yet." />;
  return (
    <table className="crm-table">
      <thead><tr><th>Path</th><th>Visitors</th><th>Sessions</th><th>Leads</th><th>Conversion Rate</th><th>Revenue</th><th>Bounce Rate</th><th>Avg Duration</th></tr></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.path}>
            <td className="font-mono text-[12px] text-slate-700 dark:text-slate-300 max-w-[220px] truncate">{p.path}</td>
            <td>{fmtNum(p.visitors)}</td><td>{fmtNum(p.sessions)}</td><td>{fmtNum(p.leads)}</td>
            <td>{fmtPct(p.conversionRate)}</td><td className="font-semibold">{fmtCurrency(p.revenue)}</td>
            <td>{fmtPct(p.bounceRate)}</td><td>{fmtDuration(p.avgSessionDuration)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FormsTable({ rows }) {
  if (!rows.length) return <EmptyState label="No tracked forms yet — tag a form with data-wit-form on your site." />;
  return (
    <div className="space-y-4">
      {rows.map((f) => (
        <div key={f.formId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200">{f.formId}</h4>
            <Badge variant={f.abandonmentRate > 50 ? 'danger' : 'success'}>{fmtPct(f.abandonmentRate)} abandonment</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[12.5px] mb-3">
            <div><span className="text-slate-400 block">Views</span><span className="font-semibold text-slate-800 dark:text-slate-200">{fmtNum(f.views)}</span></div>
            <div><span className="text-slate-400 block">Starts</span><span className="font-semibold text-slate-800 dark:text-slate-200">{fmtNum(f.starts)}</span></div>
            <div><span className="text-slate-400 block">Submissions</span><span className="font-semibold text-slate-800 dark:text-slate-200">{fmtNum(f.submissions)}</span></div>
            <div><span className="text-slate-400 block">Avg Completion</span><span className="font-semibold text-slate-800 dark:text-slate-200">{f.avgCompletionTime !== null ? fmtDuration(f.avgCompletionTime) : '—'}</span></div>
          </div>
          {f.fieldDropoffs.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-slate-450 uppercase tracking-wider mb-1.5">Field-Level Drop-offs</p>
              <div className="flex flex-wrap gap-1.5">
                {f.fieldDropoffs.map((d) => (
                  <span key={d.fieldName} className="text-[11.5px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400">{d.fieldName}: {d.count} abandoned here</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FunnelPanel({ rows }) {
  if (!rows.length) return <EmptyState label="No funnel data yet." />;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3 max-w-2xl">
      {rows.map((r) => (
        <div key={r.stage}>
          <div className="flex items-center justify-between mb-1 text-[12.5px]">
            <span className="text-slate-600 dark:text-slate-400 font-medium">{r.stage}</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{fmtNum(r.count)} <span className="text-slate-400 font-normal">({r.pctOfTotal}% of total, {r.pctOfPrevious}% of previous)</span></span>
          </div>
          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-lg bg-indigo-500 transition-all" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadAttributionTable({ rows }) {
  if (!rows.length) return <EmptyState label="No attributed leads in this period yet." />;
  return (
    <table className="crm-table">
      <thead><tr><th>Lead</th><th>Status</th><th>Salesperson</th><th>Revenue</th><th>Landing Page</th><th>UTM Campaign</th><th>Created</th><th>Time to Convert</th></tr></thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.leadId}>
            <td><p className="font-semibold text-slate-800 dark:text-slate-200">{l.companyName}</p><p className="text-[11px] text-slate-450">{l.contactPerson}</p></td>
            <td><Badge variant="neutral">{l.status}</Badge></td>
            <td>{l.salesperson}</td>
            <td className="font-semibold">{fmtCurrency(l.revenue)}</td>
            <td className="font-mono text-[11.5px] max-w-[160px] truncate">{l.landingPageUrl || '—'}</td>
            <td>{l.utmCampaign || '—'}</td>
            <td>{new Date(l.createdAt).toLocaleDateString()}</td>
            <td>{l.timeToConversionHours !== null ? `${l.timeToConversionHours}h` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Ordinal ramp — frequency buckets are magnitude steps (1 visit, 2-3, 4-6,
// 7+), not distinct categories, same reasoning as the marketing funnel.
const FREQUENCY_COLORS_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];
const FREQUENCY_COLORS_DARK  = ['#6da7ec', '#3987e5', '#256abf', '#184f95'];

function RepeatVisitorsPanel({ data }) {
  const darkMode = document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark';
  const colors = darkMode ? FREQUENCY_COLORS_DARK : FREQUENCY_COLORS_LIGHT;
  const [expanded, setExpanded] = useState(null); // visitorId currently expanded

  if (!data || data.visitors.length === 0) return <EmptyState label="No visitor data in this period yet." />;
  const max = Math.max(1, ...data.distribution.map((d) => d.visitors));

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-[12.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Visit Frequency</h4>
        <div className="space-y-2.5 max-w-xl">
          {data.distribution.map((d, i) => (
            <div key={d.bucket}>
              <div className="flex items-center justify-between mb-1 text-[12.5px]">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{d.label}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{d.visitors} visitors ({d.pct}%)</span>
              </div>
              <div className="h-5 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-lg transition-all" style={{ width: `${Math.max(3, (d.visitors / max) * 100)}%`, background: colors[i] }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[12.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Most Frequent Visitors</h4>
        <p className="text-[11.5px] text-slate-400 mb-2">Click a row to see every visit's exact time and IP address.</p>
        <table className="crm-table">
          <thead><tr><th></th><th>Visitor</th><th>Visits in Period</th><th>Lifetime Visits</th><th>First Seen</th><th>Last Seen</th><th>Device</th><th>Country</th><th>IPs</th></tr></thead>
          <tbody>
            {data.visitors.map((v) => {
              const isOpen = expanded === v.visitorId;
              return (
                <Fragment key={v.visitorId}>
                  <tr onClick={() => setExpanded(isOpen ? null : v.visitorId)} className="cursor-pointer">
                    <td className="w-6">{isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}</td>
                    <td>
                      {v.lead ? (
                        <>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{v.lead.companyName}</p>
                          <p className="text-[11px] text-slate-450">{v.lead.contactPerson} · <Badge variant="neutral">{v.lead.status}</Badge></p>
                        </>
                      ) : (
                        <p className="text-slate-500 dark:text-slate-400 italic text-[12.5px]">Anonymous visitor</p>
                      )}
                    </td>
                    <td className="font-bold">{v.visitsInRange}</td>
                    <td>{v.lifetimeVisits}</td>
                    <td className="text-[12px]">{fmtDateTime(v.firstSeenAt)}</td>
                    <td className="text-[12px]">{fmtDateTime(v.lastSeenAt)}</td>
                    <td className="capitalize">{v.deviceType}</td>
                    <td>{v.country || 'Unknown'}</td>
                    <td>{v.uniqueIps?.length || 0}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} className="bg-slate-50 dark:bg-slate-900/30 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-[11px] font-bold text-slate-450 uppercase tracking-wider mb-1.5">Unique IP Addresses ({v.uniqueIps?.length || 0})</p>
                            <div className="flex flex-wrap gap-1.5">
                              {(v.uniqueIps || []).length === 0
                                ? <span className="text-[12px] text-slate-400 italic">No IP recorded</span>
                                : v.uniqueIps.map((ip) => (
                                  <span key={ip} className="font-mono text-[11.5px] px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{ip}</span>
                                ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[11px] font-bold text-slate-450 uppercase tracking-wider mb-1.5">Visit History (most recent first)</p>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                              {(v.visits || []).map((visit, i) => (
                                <div key={i} className="flex items-center justify-between text-[12px] px-2 py-1 rounded-lg bg-white dark:bg-slate-900/60">
                                  <span className="text-slate-700 dark:text-slate-300">{fmtDateTime(visit.at)}</span>
                                  <span className="font-mono text-slate-450">{visit.ip || 'Unknown IP'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
