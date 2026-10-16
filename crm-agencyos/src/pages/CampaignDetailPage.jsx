import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft, Play, Pause, Trash2, Upload, Send, MailOpen, MousePointerClick,
  Users, XCircle, AlertTriangle, Ban, MessageSquareOff, MessageSquareText, Settings2, ListChecks,
  FileSpreadsheet, UserPlus, ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw, Loader2,
  BarChart3, MailX, ExternalLink, FileText, Code2, Info, Stethoscope, CheckCircle2, Wrench, CalendarClock, Download, Flame, PhoneCall, Phone,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { Page, Button, Tabs, Input, Toggle, Select, StatCard, EmptyState, ConfirmDialog, Modal } from '../components/ui';
import EmailAccountsModal from '../components/campaigns/EmailAccountsModal';
import EmailTemplatesModal from '../components/campaigns/EmailTemplatesModal';
import RichTextEditor from '../components/campaigns/RichTextEditor';
import { cn } from '../utils/helpers';
import { buildDailySeries, buildActivityFeed, buildStepSummary, getBounces, buildResponseBreakdown } from '../utils/campaignAnalytics';
import { checkSpamContent } from '../utils/spamCheck';

// Categorical slots 1/2/3/4 from the app's validated data-viz palette —
// fixed order, not cycled. Light/dark pair per slot.
const SERIES_COLOR = {
  sent:        { light: '#2a78d6', dark: '#3987e5' }, // slot 1 — blue
  totalOpens:  { light: '#eb6834', dark: '#d95926' }, // slot 2 — orange
  uniqueOpens: { light: '#1baf7a', dark: '#199e70' }, // slot 3 — aqua
  replied:     { light: '#eda100', dark: '#c98500' }, // slot 4 — yellow
  totalClicks: { light: '#e87ba4', dark: '#d55181' }, // slot 5 — magenta (only shown if link tracking is on)
};

// A lead that opens a campaign email this many times or more is a strong
// repeat-engagement signal — flagged as "Hot" directly in the leads table.
// Mirrors backend utils/campaignConstants.js (can't share a module across
// the FE/BE boundary here). Counts QUALIFIED opens — see humanOpenCount.
const HOT_OPEN_THRESHOLD = 2;

const LEAD_STATUS_BADGE = {
  pending:      { label: 'Pending',      tw: 'badge-neutral' },
  scheduled:    { label: 'Scheduled',    tw: 'badge-info' },
  sending:      { label: 'Sending',      tw: 'badge-info' },
  sent:         { label: 'Sent',         tw: 'badge-success' },
  failed:       { label: 'Failed',       tw: 'badge-danger' },
  bounced:      { label: 'Bounced',      tw: 'badge-danger' },
  replied:      { label: 'Replied',      tw: 'badge-purple' },
  unsubscribed: { label: 'Unsubscribed', tw: 'badge-warning' },
};

const TABS = [
  { value: 'analytics', label: 'Analytics' },
  { value: 'leads',    label: 'Leads' },
  { value: 'compose',  label: 'Compose' },
  { value: 'settings', label: 'Settings' },
];

// Hover tooltip on the Opens count — newest first, last 50 kept server-side
// Same OR as the backend: qualified opens, or the legacy raw-open rule for
// leads that predate humanOpenCount.
//
// MODULE scope, deliberately: renderLeadCell is a module-level function and
// calls this. It used to live inside LeadsTab, which meant the Opens cell
// threw a ReferenceError the moment the table rendered — and with no error
// boundary above it, that blanked the entire campaign page.
const isHotLead = (l) => (l.humanOpenCount || 0) >= HOT_OPEN_THRESHOLD || (l.openCount || 0) >= 3;

function formatOpenHistory(lead) {
  if (!lead.openCount) return 'Not opened yet';
  const events = lead.opens?.length ? [...lead.opens].reverse() : null;
  if (!events) return `${lead.openCount} open${lead.openCount === 1 ? '' : 's'}`;
  const lines = events.map((o) => new Date(o.at).toLocaleString());
  const suffix = lead.openCount > events.length ? `\n… and ${lead.openCount - events.length} earlier` : '';
  return `${lead.openCount} open${lead.openCount === 1 ? '' : 's'}:\n${lines.join('\n')}${suffix}`;
}

// Client-side CSV export for the leads table — data's already loaded in the
// browser, no need for a round trip to build a download.
function downloadLeadsCSV(leads, filename) {
  const headers = ['Email', 'Phone', 'First Name', 'Last Name', 'Business Name', 'Business Type', 'City / Location', 'Status', 'Verification', 'Provider', 'Opens', 'Clicks', 'Sent At', 'Error', 'Follow-up Status', 'Follow-up Sent At', 'Response', 'Responded At'];
  const rows = leads.map((l) => [
    l.email, l.phone || '', l.firstName || '', l.lastName || '',
    l.businessName || '', l.businessType || '', l.cityLocation || '',
    l.status, l.verificationStatus || '',
    l.provider || '', l.openCount || 0, l.clickCount || 0,
    l.sentAt ? new Date(l.sentAt).toLocaleString() : '', l.error || '',
    l.followUpStatus || 'none', l.followUpSentAt ? new Date(l.followUpSentAt).toLocaleString() : '',
    l.responseOption || '', l.respondedAt ? new Date(l.respondedAt).toLocaleString() : '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const VERIFICATION_BADGE = {
  valid:      { label: 'Valid',      icon: ShieldCheck,    tw: 'text-emerald-600 dark:text-emerald-400' },
  invalid:    { label: 'Invalid',    icon: ShieldAlert,    tw: 'text-red-500' },
  risky:      { label: 'Risky',      icon: ShieldAlert,    tw: 'text-amber-500' },
  unverified: { label: 'Unverified', icon: ShieldQuestion, tw: 'text-slate-400' },
};

// Follow-up status column in the leads table — 'none' renders nothing (the
// common case: most leads never go hot), so this only shows up for leads
// where there's actually something to report.
const FOLLOW_UP_LABEL = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed' };
const FOLLOW_UP_TW = {
  queued:  'text-amber-600 dark:text-amber-400',
  sending: 'text-blue-600 dark:text-blue-400',
  sent:    'text-emerald-600 dark:text-emerald-400',
  failed:  'text-red-500',
};
const FOLLOW_UP_BADGE = Object.fromEntries(
  Object.keys(FOLLOW_UP_LABEL).map((status) => [
    status,
    <span key={status} className={cn('inline-flex items-center gap-1 text-[12px] font-medium', FOLLOW_UP_TW[status])}>
      <Send size={12} /> {FOLLOW_UP_LABEL[status]}
    </span>,
  ])
);

// Quick hover hint next to the status badge — a cheap, client-side-only
// guess (no API call) to explain the current state at a glance. The
// "Diagnose" button does the real, thorough check against the backend.
function statusHint(campaign) {
  if (campaign.status === 'draft') return 'Draft — not sending. Add a subject/body, leads, and a sending account, then hit Start.';
  if (campaign.status === 'scheduled') {
    const when = campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString() : '';
    return `Scheduled — will start automatically at ${when}.`;
  }
  if (campaign.status === 'paused') return 'Paused — sending is stopped until you hit Start again.';
  if (campaign.status === 'completed') return 'Completed — every lead has been sent to, failed, or bounced.';
  if (campaign.status === 'active') {
    if (campaign.nextEligibleAt && new Date(campaign.nextEligibleAt) > new Date()) {
      const secs = Math.max(0, Math.round((new Date(campaign.nextEligibleAt) - Date.now()) / 1000));
      return `Active — waiting ~${secs}s before the next send (sending-pattern gap). Click Diagnose for the full picture.`;
    }
    return 'Active — should be sending within its configured pace. Click Diagnose if nothing seems to be happening.';
  }
  return '';
}

const FINDING_STYLE = {
  ok:      { icon: CheckCircle2,  tw: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900' },
  info:    { icon: Info,          tw: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700' },
  warning: { icon: AlertTriangle, tw: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/50' },
  error:   { icon: XCircle,       tw: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50' },
};

function DiagnoseModal({ open, onClose, campaignId, onDiagnose, onResolveStuck }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [fixing, setFixing] = useState(false);

  const runDiagnosis = async () => {
    setLoading(true);
    try {
      const data = await onDiagnose(campaignId);
      setResult(data);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) runDiagnosis(); else setResult(null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFixStuck = async () => {
    setFixing(true);
    try {
      await onResolveStuck(campaignId);
      await runDiagnosis(); // re-check immediately so the fix is reflected
    } finally {
      setFixing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Campaign Diagnosis" size="lg">
      <div className="px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : result ? (
          <div className="space-y-2.5">
            {result.findings.map((f, i) => {
              const style = FINDING_STYLE[f.level] || FINDING_STYLE.info;
              return (
                <div key={i} className={cn('flex items-start gap-2.5 p-3 rounded-xl border', style.bg)}>
                  <style.icon size={15} className={cn('flex-shrink-0 mt-0.5', style.tw)} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px]', style.tw)}>{f.message}</p>
                    {Array.isArray(f.detail) && f.detail.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                        {f.detail.map((d, j) => (
                          <li key={j} className="truncate">
                            {d.email}{d.status && ` — ${d.status}`}{d.error && `: ${d.error}`}{d.since && ` (since ${new Date(d.since).toLocaleTimeString()})`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-slate-400">Checked {new Date(result.checkedAt).toLocaleTimeString()}</p>
              <div className="flex gap-2">
                {result.hasStuckLeads && (
                  <Button variant="danger" size="sm" onClick={handleFixStuck} loading={fixing}>
                    <Wrench size={13} /> Fix stuck leads
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={runDiagnosis}>
                  <RefreshCw size={13} /> Re-check
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// Converts a Date to the value <input type="datetime-local"> expects
// (local time, no timezone suffix) — a plain toISOString() would show UTC
// and silently shift the displayed time from what the user actually typed.
function toLocalDatetimeInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ScheduleModal({ open, onClose, campaign, onSchedule }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Default to campaign's existing schedule if it has one, else now + 1 hour.
    const base = campaign.scheduledAt ? new Date(campaign.scheduledAt) : new Date(Date.now() + 60 * 60000);
    setValue(toLocalDatetimeInputValue(base));
  }, [open, campaign.scheduledAt]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!value) return;
    const when = new Date(value); // interpreted in the browser's local timezone, same as the input's display
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('Pick a time in the future');
      return;
    }
    setSaving(true);
    try {
      await onSchedule(campaign._id, when.toISOString());
      onClose();
    } catch {
      // toast already shown by the store action
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule Campaign" size="sm">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
          The campaign will automatically switch to Active at this time and start sending on its usual pace. It's re-checked (subject/body/accounts/leads) right before it fires, so if something's missing by then it'll fall back to Draft with an explanation instead of silently failing.
        </p>
        <Input
          label="Start date & time"
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={toLocalDatetimeInputValue(new Date(Date.now() + 60000))}
          required
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Schedule</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    campaigns, campaignLeads, emailAccounts, darkMode,
    loadCampaign, loadCampaignLeads, loadEmailAccounts,
    updateCampaign, deleteCampaign, startCampaign, pauseCampaign, scheduleCampaign, unscheduleCampaign,
    importCampaignLeadsCsv, importCampaignLeadsSheet, addCampaignLeadManual,
    updateCampaignLeadPhonesCsv,
    deleteCampaignLead, markCampaignLeadReplied, verifyCampaignLead, verifyAllCampaignLeads,
    diagnoseCampaign, resolveStuckCampaignLeads,
  } = useAppStore(useShallow((s) => ({
    campaigns: s.campaigns,
    campaignLeads: s.campaignLeads,
    emailAccounts: s.emailAccounts,
    darkMode: s.darkMode,
    loadCampaign: s.loadCampaign,
    loadCampaignLeads: s.loadCampaignLeads,
    loadEmailAccounts: s.loadEmailAccounts,
    updateCampaign: s.updateCampaign,
    deleteCampaign: s.deleteCampaign,
    startCampaign: s.startCampaign,
    pauseCampaign: s.pauseCampaign,
    scheduleCampaign: s.scheduleCampaign,
    unscheduleCampaign: s.unscheduleCampaign,
    importCampaignLeadsCsv: s.importCampaignLeadsCsv,
    importCampaignLeadsSheet: s.importCampaignLeadsSheet,
    addCampaignLeadManual: s.addCampaignLeadManual,
    updateCampaignLeadPhonesCsv: s.updateCampaignLeadPhonesCsv,
    deleteCampaignLead: s.deleteCampaignLead,
    markCampaignLeadReplied: s.markCampaignLeadReplied,
    verifyCampaignLead: s.verifyCampaignLead,
    verifyAllCampaignLeads: s.verifyAllCampaignLeads,
    diagnoseCampaign: s.diagnoseCampaign,
    resolveStuckCampaignLeads: s.resolveStuckCampaignLeads,
  })));

  const campaign = campaigns.find((c) => c._id === id);
  const [tab, setTab] = useState('analytics');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [unscheduling, setUnscheduling] = useState(false);
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const phoneFileInputRef = useRef(null);
  const [updatingPhones, setUpdatingPhones] = useState(false);

  useEffect(() => {
    loadCampaign(id);
    loadCampaignLeads(id);
    loadEmailAccounts();
  }, [id, loadCampaign, loadCampaignLeads, loadEmailAccounts]);

  if (!campaign) {
    return (
      <Page>
        <Link to="/campaigns" className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={14} /> Back to Campaigns
        </Link>
        <div className="card p-10 text-center text-slate-400 text-[13px]">Loading campaign…</div>
      </Page>
    );
  }

  const stats = campaign.stats || {};

  const handleToggleStatus = async () => {
    if (campaign.status === 'active') pauseCampaign(campaign._id);
    else await startCampaign(campaign._id);
  };

  const handleUnschedule = async () => {
    setUnscheduling(true);
    try { await unscheduleCampaign(campaign._id); } finally { setUnscheduling(false); }
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importCampaignLeadsCsv(campaign._id, file);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhoneFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpdatingPhones(true);
    try {
      await updateCampaignLeadPhonesCsv(campaign._id, file);
    } finally {
      setUpdatingPhones(false);
      if (phoneFileInputRef.current) phoneFileInputRef.current.value = '';
    }
  };

  return (
    <Page>
      <Link to="/campaigns" className="flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4">
        <ArrowLeft size={14} /> Back to Campaigns
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="page-title truncate">{campaign.name}</h1>
            <span className={cn('badge', {
              draft: 'badge-neutral', scheduled: 'badge-purple', active: 'badge-success', paused: 'badge-warning', completed: 'badge-info',
            }[campaign.status])}>
              {campaign.status}
            </span>
            <span title={statusHint(campaign)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help">
              <Info size={14} />
            </span>
          </div>
          <p className="page-sub">Created {new Date(campaign.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" onClick={() => setDiagnoseOpen(true)}>
            <Stethoscope size={14} /> Diagnose
          </Button>
          {campaign.status === 'scheduled' ? (
            <>
              <Button variant="outline" onClick={handleUnschedule} loading={unscheduling}>
                <XCircle size={14} /> Cancel schedule
              </Button>
              <Button variant="primary" onClick={handleToggleStatus}>
                <Play size={14} /> Start now
              </Button>
            </>
          ) : (
            <>
              {/* "completed" isn't necessarily terminal — the backend's startCampaign
                  has no status guard, so adding new leads to a completed campaign
                  and starting it again genuinely resumes sending. Only hide the
                  button once there's truly nothing left to send. */}
              {(campaign.status !== 'completed' || (stats.pending || 0) > 0) && (
                <>
                  {campaign.status !== 'active' && (
                    <Button variant="outline" onClick={() => setScheduleOpen(true)}>
                      <CalendarClock size={14} /> Schedule
                    </Button>
                  )}
                  <Button variant={campaign.status === 'active' ? 'outline' : 'primary'} onClick={handleToggleStatus}>
                    {campaign.status === 'active' ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Start</>}
                  </Button>
                </>
              )}
            </>
          )}
          <Button variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <DiagnoseModal
        open={diagnoseOpen}
        onClose={() => setDiagnoseOpen(false)}
        campaignId={campaign._id}
        onDiagnose={diagnoseCampaign}
        onResolveStuck={resolveStuckCampaignLeads}
      />

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        campaign={campaign}
        onSchedule={scheduleCampaign}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <StatCard icon={Users} label="Total Leads" value={stats.total || 0} color="#6366f1" bg="#eef2ff" />
        <StatCard icon={Send} label="Sent" value={stats.sent || 0} color="#0ea5e9" bg="#f0f9ff" />
        <StatCard icon={MailOpen} label="Opened" value={stats.opened || 0} color="#10b981" bg="#ecfdf5" />
        <StatCard icon={MousePointerClick} label="Clicked" value={stats.clicked || 0} color="#7c3aed" bg="#f5f3ff" />
        <StatCard icon={MessageSquareOff} label="Replied" value={stats.replied || 0} color="#d97706" bg="#fffbeb" />
        <StatCard icon={Ban} label="Unsubscribed" value={stats.unsubscribed || 0} color="#dc2626" bg="#fef2f2" />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'analytics' && (
        <AnalyticsTab campaign={campaign} leads={campaignLeads} darkMode={darkMode} />
      )}

      {tab === 'leads' && (
        <LeadsTab
          campaign={campaign}
          leads={campaignLeads}
          importing={importing}
          fileInputRef={fileInputRef}
          onFileSelected={handleFileSelected}
          onImportSheet={(url) => importCampaignLeadsSheet(campaign._id, url)}
          onAddManual={(lead) => addCampaignLeadManual(campaign._id, lead)}
          phoneFileInputRef={phoneFileInputRef}
          onPhoneFileSelected={handlePhoneFileSelected}
          updatingPhones={updatingPhones}
          onDeleteLead={(leadId) => deleteCampaignLead(campaign._id, leadId)}
          onMarkReplied={(leadId) => markCampaignLeadReplied(campaign._id, leadId)}
          onVerifyLead={(leadId) => verifyCampaignLead(campaign._id, leadId)}
          onVerifyAll={() => verifyAllCampaignLeads(campaign._id)}
        />
      )}

      {tab === 'compose' && (
        <ComposeTab campaign={campaign} onSave={(body) => updateCampaign(campaign._id, body)} />
      )}

      {tab === 'settings' && (
        <SettingsTab
          campaign={campaign}
          emailAccounts={emailAccounts}
          onSave={(body) => updateCampaign(campaign._id, { settings: body })}
          onManageAccounts={() => setAccountsModalOpen(true)}
        />
      )}

      <EmailAccountsModal open={accountsModalOpen} onClose={() => setAccountsModalOpen(false)} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { await deleteCampaign(campaign._id); navigate('/campaigns'); }}
        title="Delete campaign?"
        message={`This will permanently remove "${campaign.name}" and stop any in-progress sending.`}
        confirmLabel="Delete"
      />
    </Page>
  );
}

// ── Analytics Tab ──────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { value: '7',   label: 'Last 7 days' },
  { value: '14',  label: 'Last 14 days' },
  { value: '30',  label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const ANALYTICS_SUBTABS = [
  { value: 'step',     label: 'Step Analytics' },
  { value: 'activity', label: 'Activity' },
  { value: 'bounces',  label: 'Bounces' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-modal px-3 py-2 text-[12px]">
      <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsTab({ campaign, leads, darkMode }) {
  const [range, setRange] = useState('7');
  const [subTab, setSubTab] = useState('step');

  const days = range === 'all' ? 'all' : Number(range);
  const series = buildDailySeries(leads, days);
  const stepSummary = buildStepSummary(leads);
  const activity = buildActivityFeed(leads);
  const bounces = getBounces(leads);
  const responseBreakdown = buildResponseBreakdown(leads);
  const linkTrackingOn = !!campaign.settings?.linkTracking;

  const total = leads.length;
  const done = leads.filter((l) => l.status !== 'pending').length;
  const progressPct = total ? Math.round((done / total) * 100) : 0;

  const color = (key) => SERIES_COLOR[key][darkMode ? 'dark' : 'light'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-slate-500 dark:text-slate-400">Status:</span>
          <span className={cn('badge', {
            draft: 'badge-neutral', scheduled: 'badge-purple', active: 'badge-success', paused: 'badge-warning', completed: 'badge-info',
          }[campaign.status])}>
            {campaign.status}
          </span>
          <div className="flex items-center gap-2 w-32">
            <div className="h-1.5 flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full bg-primary-500" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{progressPct}%</span>
          </div>
        </div>
        <div className="w-40">
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard icon={Send} label="Sequence Started" value={stepSummary.sent} color="#6366f1" bg="#eef2ff" />
        <StatCard icon={MailOpen} label="Open Rate" value={`${stepSummary.openRate.toFixed(1)}%`} color="#1baf7a" bg="#ecfdf5" />
        <StatCard
          icon={MousePointerClick}
          label="Click Rate"
          value={linkTrackingOn ? `${stepSummary.clickRate.toFixed(1)}%` : 'Disabled'}
          color={linkTrackingOn ? '#e87ba4' : '#94a3b8'}
          bg={linkTrackingOn ? '#fdf2f8' : '#f1f5f9'}
        />
        <StatCard icon={PhoneCall} label="Call Requested" value={stepSummary.callRequested} color="#2563eb" bg="#eff6ff" />
        <StatCard icon={MessageSquareText} label="Responses" value={stepSummary.responded} color="#9333ea" bg="#faf5ff" />
        <StatCard icon={MailX} label="Bounced" value={bounces.length} color="#dc2626" bg="#fef2f2" />
      </div>

      {responseBreakdown.length > 0 && (
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Response breakdown</p>
          <div className="flex flex-wrap gap-2">
            {responseBreakdown.map(({ option, count }) => (
              <span key={option} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-[12px] font-medium">
                {option} <span className="text-purple-500 dark:text-purple-400">· {count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        {series.length === 0 ? (
          <EmptyState icon={BarChart3} title="No activity yet" description="Once this campaign starts sending, activity will show up here." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? '#334155' : '#e2e8f0'} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: darkMode ? '#94a3b8' : '#64748b' }} axisLine={false} tickLine={false} width={28} />
              <RTooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              <Area type="monotone" dataKey="sent" name="Sent" stroke={color('sent')} fill={color('sent')} fillOpacity={0.18} strokeWidth={2} />
              <Area type="monotone" dataKey="totalOpens" name="Total opens" stroke={color('totalOpens')} fill={color('totalOpens')} fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="uniqueOpens" name="Unique opens" stroke={color('uniqueOpens')} fill={color('uniqueOpens')} fillOpacity={0.12} strokeWidth={2} />
              <Area type="monotone" dataKey="replied" name="Replies" stroke={color('replied')} fill={color('replied')} fillOpacity={0.12} strokeWidth={2} />
              {linkTrackingOn && (
                <Area type="monotone" dataKey="totalClicks" name="Total clicks" stroke={color('totalClicks')} fill={color('totalClicks')} fillOpacity={0.12} strokeWidth={2} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-2 pt-2">
          <Tabs tabs={ANALYTICS_SUBTABS} active={subTab} onChange={setSubTab} />
        </div>

        {subTab === 'step' && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Step</th>
                  <th className="px-4 py-2.5 font-medium">Sent</th>
                  <th className="px-4 py-2.5 font-medium">Opened</th>
                  <th className="px-4 py-2.5 font-medium">Replied</th>
                  <th className="px-4 py-2.5 font-medium">Clicked</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Step 1</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{stepSummary.sent}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{stepSummary.opened} | {stepSummary.openRate.toFixed(0)}%</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{stepSummary.replied} | {stepSummary.replyRate.toFixed(0)}%</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {linkTrackingOn ? `${stepSummary.clicked} | ${stepSummary.clickRate.toFixed(0)}%` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11.5px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
              Campaigns here send a single email (no multi-step sequences yet), so there's one step to report on.
            </p>
          </div>
        )}

        {subTab === 'activity' && (
          activity.length === 0 ? (
            <EmptyState icon={BarChart3} title="No activity yet" />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
              {activity.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ActivityIcon type={e.type} />
                    <span className="text-slate-700 dark:text-slate-300 truncate">{e.email}</span>
                    {e.type === 'clicked' && e.url && (
                      <a href={e.url} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline flex items-center gap-0.5 flex-shrink-0">
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  <span className="text-[11.5px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{timeAgo(e.at)}</span>
                </div>
              ))}
            </div>
          )
        )}

        {subTab === 'bounces' && (
          bounces.length === 0 ? (
            <EmptyState icon={MailX} title="No bounces" description="Hard-bounced addresses (permanent SMTP rejections) will show up here." />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {bounces.map((l) => (
                <div key={l._id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="text-slate-700 dark:text-slate-300">{l.email}</span>
                  <span className="text-[11.5px] text-red-500 truncate max-w-xs" title={l.error}>{l.error || 'Bounced'}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

const ACTIVITY_ICON = {
  sent:         { icon: Send,             tw: 'text-primary-500' },
  opened:       { icon: MailOpen,         tw: 'text-amber-500' },
  clicked:      { icon: MousePointerClick, tw: 'text-pink-500' },
  replied:      { icon: MessageSquareOff, tw: 'text-yellow-600' },
  bounced:      { icon: MailX,            tw: 'text-red-500' },
  unsubscribed: { icon: Ban,              tw: 'text-slate-400' },
};

function ActivityIcon({ type }) {
  const cfg = ACTIVITY_ICON[type] || ACTIVITY_ICON.sent;
  return <cfg.icon size={14} className={cn('flex-shrink-0', cfg.tw)} />;
}

function timeAgo(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

// ── Leads Tab ──────────────────────────────────────────────────────────
const ADD_MODES = [
  { value: 'csv',    label: 'Upload CSV',        icon: Upload },
  { value: 'manual', label: 'Add Manually',      icon: UserPlus },
  { value: 'sheet',  label: 'Google Sheet',      icon: FileSpreadsheet },
  // Backfills phone numbers onto leads ALREADY in the campaign, matched by
  // email — separate from Upload CSV, which is insert-only and silently
  // skips any email already present (so it can't be used to add phone
  // numbers to a campaign that's already running).
  { value: 'update-phones', label: 'Update Phones', icon: Phone },
];

// One cell's contents. Split out of the table so the markup for a column
// lives in exactly one place regardless of whether that column is visible.
function renderLeadCell(key, l, { badge, vBadge }) {
  const dash = <span className="text-slate-300 dark:text-slate-700">—</span>;
  switch (key) {
    case 'email':    return <span className="text-slate-800 dark:text-slate-200">{l.email}</span>;
    case 'phone':    return <span className="text-slate-600 dark:text-slate-400">{l.phone || '—'}</span>;
    case 'name':     return <span className="text-slate-600 dark:text-slate-400">{l.businessName || l.firstName || '—'}</span>;
    case 'lastName': return <span className="text-slate-600 dark:text-slate-400">{l.lastName || '—'}</span>;

    // The reason this column exists: before pressing Start you can see which
    // leads carry website-audit data and which do not. A lead with no
    // snapshot is the one that will block a template using audit merge tags,
    // and it is otherwise indistinguishable from the rest.
    case 'audit': {
      const a = l.auditSnapshot;
      if (!a || !a.prospectId) return dash;
      const tier = TIER_BADGE_SMALL[a.tier] || null;
      const detail = [
        a.topFinding || '',
        a.perfMobile != null ? `Mobile speed ${a.perfMobile}/100` : '',
        a.seoScore != null ? `SEO ${a.seoScore}/100` : '',
        a.lcpMs != null ? `Loads main content in ${(Math.round(a.lcpMs / 100) / 10).toFixed(1)}s` : '',
        a.website || '',
      ].filter(Boolean).join('\n');
      return (
        <span title={detail} className="inline-flex items-center gap-1.5 cursor-help">
          {tier && <span className={cn('badge', tier.tw)}>{tier.label}</span>}
          {a.perfMobile != null
            ? <span className={cn('text-[12px] font-medium', a.perfMobile < 50 ? 'text-red-600 dark:text-red-400' : 'text-slate-500')}>{a.perfMobile}/100</span>
            : <span className="text-[12px] text-amber-600 dark:text-amber-400">no speed data</span>}
        </span>
      );
    }

    case 'verification': return (
      <span title={l.verificationDetail || vBadge.label} className={cn('inline-flex items-center gap-1 font-medium', vBadge.tw)}>
        <vBadge.icon size={13} /> {vBadge.label}
      </span>
    );
    case 'provider': return <span className="text-slate-600 dark:text-slate-400">{l.provider || '—'}</span>;
    case 'status': return (
      <>
        <span className={cn('badge', badge.tw)}>{badge.label}</span>
        {l.error && <span title={l.error}><AlertTriangle size={12} className="inline ml-1.5 text-red-400" /></span>}
      </>
    );
    case 'opens': return (
      <span
        title={formatOpenHistory(l) + (isHotLead(l) ? `\n🔥 Hot lead — ${HOT_OPEN_THRESHOLD}+ real opens` : '')}
        className={cn('inline-flex items-center gap-1 text-slate-600 dark:text-slate-400', l.openCount ? 'underline decoration-dotted cursor-help' : '')}
      >
        {l.openCount || 0}
        {isHotLead(l) && <Flame size={12} className="text-orange-500" />}
      </span>
    );
    case 'lastOpened': return <span className="text-slate-500 dark:text-slate-400">{l.openedAt ? new Date(l.openedAt).toLocaleString() : '—'}</span>;
    case 'clicks': return <span className="text-slate-600 dark:text-slate-400">{l.clickCount || 0}</span>;
    case 'callReq': return l.callRequested ? (
      <span
        title={l.callRequestedAt ? `Requested a call — ${new Date(l.callRequestedAt).toLocaleString()}` : 'Requested a call'}
        className="inline-flex items-center text-blue-600 dark:text-blue-400 cursor-help"
      >
        <PhoneCall size={13} />
      </span>
    ) : dash;
    case 'response': return l.responseOption ? (
      <span
        title={l.respondedAt ? `${l.responseOption} — ${new Date(l.respondedAt).toLocaleString()}` : l.responseOption}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-purple-600 dark:text-purple-400 cursor-help"
      >
        <MessageSquareText size={12} /> {l.responseOption}
      </span>
    ) : dash;
    case 'sent': return <span className="text-slate-500 dark:text-slate-400">{l.sentAt ? new Date(l.sentAt).toLocaleDateString() : '—'}</span>;
    case 'followUp': return FOLLOW_UP_BADGE[l.followUpStatus] || null;
    default: return null;
  }
}

// Compact tier badges for the Audit cell — the prospect-audit page has its own
// fuller set; these are sized for a dense table row.
// Mirrors backend utils/auditMergeTags.AUDIT_TAGS. Kept here only to give an
// instant message in the Settings form; the server enforces the real rule.
const FALLBACK_FORBIDDEN_TAGS = [
  'top_finding', 'finding_2', 'finding_3', 'findings_list',
  'perf_score', 'perf_desktop', 'seo_score', 'lcp_seconds', 'page_weight_mb',
  'website', 'audit_tier',
];

const TIER_BADGE_SMALL = {
  hot:     { label: 'Hot',    tw: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' },
  high:    { label: 'High',   tw: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' },
  medium:  { label: 'Medium', tw: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  low:     { label: 'Low',    tw: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  skip:    { label: 'Skip',   tw: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  no_site: { label: 'No Site', tw: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500' },
};

// ── Leads table columns ───────────────────────────────────────────────────
// ONE definition list drives both the header and the body, so a column can
// never appear in one and not the other. Visibility is per-campaign
// (settings.leadColumns); a campaign that has never been configured shows
// DEFAULT_LEAD_COLUMNS, which is exactly what the table showed before this
// was configurable.
//
// `always: true` means the column cannot be hidden — email identifies the row
// and status is the thing the whole page is about, so hiding either would
// leave a table nobody can read.
const LEAD_COLUMN_DEFS = [
  { key: 'email',        label: 'Email',        always: true },
  { key: 'phone',        label: 'Phone' },
  { key: 'name',         label: 'Name' },
  { key: 'lastName',     label: 'Last Name' },
  { key: 'audit',        label: 'Audit' },
  { key: 'verification', label: 'Verification' },
  { key: 'provider',     label: 'Provider' },
  { key: 'status',       label: 'Status',       always: true },
  { key: 'opens',        label: 'Opens',        align: 'center' },
  { key: 'lastOpened',   label: 'Last Opened' },
  { key: 'clicks',       label: 'Clicks',       align: 'center' },
  { key: 'callReq',      label: 'Call Req.',    align: 'center' },
  { key: 'response',     label: 'Response' },
  { key: 'sent',         label: 'Sent' },
  { key: 'followUp',     label: 'Follow-up' },
];

// What a campaign shows when nobody has configured it — every column the
// table had before, plus Audit. Keeping Audit on by default means a pushed
// batch is legible immediately; a plain mail-merge campaign can switch it off
// in Settings, which is the whole point of making this configurable.
const DEFAULT_LEAD_COLUMNS = LEAD_COLUMN_DEFS.map((c) => c.key);

// Resolve a campaign's saved preference into the set actually rendered.
// Unknown keys (a column removed in a later version) are ignored rather than
// crashing, and `always` columns are forced back in even if a stale saved
// list omits them.
function visibleLeadColumns(campaign) {
  const saved = campaign?.settings?.leadColumns;
  const chosen = Array.isArray(saved) && saved.length ? saved : DEFAULT_LEAD_COLUMNS;
  return LEAD_COLUMN_DEFS.filter((c) => c.always || chosen.includes(c.key));
}

function LeadsTab({
  campaign, leads, importing, fileInputRef, onFileSelected, onImportSheet, onAddManual, onDeleteLead, onMarkReplied, onVerifyLead, onVerifyAll,
  phoneFileInputRef, onPhoneFileSelected, updatingPhones,
}) {
  const [mode, setMode] = useState('csv');
  const [manualLeadType, setManualLeadType] = useState('individual'); // 'individual' | 'business'
  const [manualForm, setManualForm] = useState({
    email: '', firstName: '', lastName: '', phone: '',
    businessName: '', businessType: '', cityLocation: '',
  });
  const [addingManual, setAddingManual] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [importingSheet, setImportingSheet] = useState(false);
  const [verifyingId, setVerifyingId] = useState(null);
  const cols = visibleLeadColumns(campaign);
  const [verifyingAll, setVerifyingAll] = useState(false);

  const unverifiedCount = leads.filter((l) => l.verificationStatus === 'unverified').length;
  const sentLeads = leads.filter((l) => l.status === 'sent');
  const pendingLeads = leads.filter((l) => l.status === 'pending');
  const sentOrPendingLeads = leads.filter((l) => l.status === 'sent' || l.status === 'pending');
  const hotLeads = leads.filter(isHotLead);
  const callRequestedLeads = leads.filter((l) => l.callRequested);

  const exportSlug = (campaign.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const handleExport = (list, tag) => downloadLeadsCSV(list, `${exportSlug}-${tag}-leads.csv`);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.email.trim()) return;
    setAddingManual(true);
    try {
      await onAddManual(manualForm);
      setManualForm({ email: '', firstName: '', lastName: '', phone: '', businessName: '', businessType: '', cityLocation: '' });
    } finally {
      setAddingManual(false);
    }
  };

  const handleSheetSubmit = async (e) => {
    e.preventDefault();
    if (!sheetUrl.trim()) return;
    setImportingSheet(true);
    try {
      await onImportSheet(sheetUrl.trim());
      setSheetUrl('');
    } finally {
      setImportingSheet(false);
    }
  };

  const handleVerify = async (leadId) => {
    setVerifyingId(leadId);
    await onVerifyLead(leadId);
    setVerifyingId(null);
  };

  const handleVerifyAll = async () => {
    setVerifyingAll(true);
    await onVerifyAll();
    setVerifyingAll(false);
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex gap-1.5 mb-4">
          {ADD_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors',
                mode === m.value
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <m.icon size={13} /> {m.label}
            </button>
          ))}
        </div>

        {mode === 'csv' && (
          <label
            htmlFor="campaign-csv-upload"
            className={cn(
              'flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
              importing ? 'opacity-60 pointer-events-none' : 'hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10',
              'border-slate-300 dark:border-slate-600'
            )}
          >
            <Upload size={22} className="text-slate-400" />
            <p className="text-[13.5px] font-medium text-slate-700 dark:text-slate-300">
              {importing ? 'Importing…' : 'Click to upload a CSV file'}
            </p>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400 text-center space-y-0.5">
              <p>Individuals: <code className="font-mono">email, first_name, last_name, phone</code> (phone optional)</p>
              <p>Businesses: <code className="font-mono">email, business_name, phone, business_type, city_location</code> (only email required)</p>
            </div>
            <input
              id="campaign-csv-upload"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFileSelected}
              disabled={importing}
            />
          </label>
        )}

        {mode === 'manual' && (
          <div className="max-w-2xl space-y-3">
            <div className="flex gap-1.5">
              {[{ value: 'individual', label: 'Individual' }, { value: 'business', label: 'Business' }].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setManualLeadType(t.value)}
                  className={cn(
                    'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
                    manualLeadType === t.value
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row items-end gap-3">
              <div className="flex-[2] w-full">
                <Input
                  label="Email" type="email" required placeholder="lead@company.com"
                  value={manualForm.email} onChange={(e) => setManualForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              {manualLeadType === 'individual' ? (
                <>
                  <div className="flex-1 w-full">
                    <Input
                      label="First name" placeholder="Jane"
                      value={manualForm.firstName} onChange={(e) => setManualForm((f) => ({ ...f, firstName: e.target.value }))}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <Input
                      label="Last name" placeholder="Doe"
                      value={manualForm.lastName} onChange={(e) => setManualForm((f) => ({ ...f, lastName: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-[2] w-full">
                    <Input
                      label="Business name" placeholder="Resolve Home Energy"
                      value={manualForm.businessName} onChange={(e) => setManualForm((f) => ({ ...f, businessName: e.target.value }))}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <Input
                      label="Business type" placeholder="Optional"
                      value={manualForm.businessType} onChange={(e) => setManualForm((f) => ({ ...f, businessType: e.target.value }))}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <Input
                      label="City / Location" placeholder="Optional"
                      value={manualForm.cityLocation} onChange={(e) => setManualForm((f) => ({ ...f, cityLocation: e.target.value }))}
                    />
                  </div>
                </>
              )}
              <div className="flex-1 w-full">
                <Input
                  label="Phone" placeholder="Optional"
                  value={manualForm.phone} onChange={(e) => setManualForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <Button type="submit" variant="primary" loading={addingManual} disabled={!manualForm.email.trim()}>
                <UserPlus size={14} /> Add Lead
              </Button>
            </form>
          </div>
        )}

        {mode === 'sheet' && (
          <form onSubmit={handleSheetSubmit} className="max-w-2xl space-y-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 w-full">
                <Input
                  label="Google Sheet link"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
                />
              </div>
              <Button type="submit" variant="primary" loading={importingSheet} disabled={!sheetUrl.trim()}>
                <FileSpreadsheet size={14} /> Import
              </Button>
            </div>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
              Sheet must be shared as <strong>"Anyone with the link can view"</strong> (Share → General access), with column headers in the first sheet tab —
              individuals: <code className="font-mono mx-1">email, first_name, last_name, phone</code> (phone optional), or
              businesses: <code className="font-mono mx-1">email, business_name, phone, business_type, city_location</code> (only email required).
            </p>
          </form>
        )}

        {mode === 'update-phones' && (
          <label
            htmlFor="campaign-phone-upload"
            className={cn(
              'flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
              updatingPhones ? 'opacity-60 pointer-events-none' : 'hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10',
              'border-slate-300 dark:border-slate-600'
            )}
          >
            <Phone size={22} className="text-slate-400" />
            <p className="text-[13.5px] font-medium text-slate-700 dark:text-slate-300">
              {updatingPhones ? 'Updating…' : 'Click to upload a CSV of phone numbers'}
            </p>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 text-center px-6">
              Columns: <code className="font-mono">email, phone</code> — only updates leads already in this campaign
              (matched by email); safe to run while it's actively sending. Doesn't add new leads.
            </p>
            <input
              id="campaign-phone-upload"
              ref={phoneFileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onPhoneFileSelected}
              disabled={updatingPhones}
            />
          </label>
        )}
      </div>

      <div className="card overflow-hidden">
        {leads.length === 0 ? (
          <EmptyState icon={ListChecks} title="No leads imported yet" description="Add leads above to get this campaign started." />
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-[12px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                {leads.length} lead{leads.length === 1 ? '' : 's'}
                {hotLeads.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-orange-600 dark:text-orange-400">
                    <Flame size={12} /> {hotLeads.length} hot
                  </span>
                )}
                {callRequestedLeads.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 dark:text-blue-400">
                    <PhoneCall size={12} /> {callRequestedLeads.length} requested a call
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" disabled={!hotLeads.length} onClick={() => handleExport(hotLeads, 'hot')}>
                  <Flame size={12} className="text-orange-500" /> Hot ({hotLeads.length})
                </Button>
                <Button variant="ghost" size="sm" disabled={!callRequestedLeads.length} onClick={() => handleExport(callRequestedLeads, 'call-requested')}>
                  <PhoneCall size={12} className="text-blue-500" /> Call Requested ({callRequestedLeads.length})
                </Button>
                <Button variant="ghost" size="sm" disabled={!sentLeads.length} onClick={() => handleExport(sentLeads, 'sent')}>
                  <Download size={12} /> Sent ({sentLeads.length})
                </Button>
                <Button variant="ghost" size="sm" disabled={!pendingLeads.length} onClick={() => handleExport(pendingLeads, 'pending')}>
                  <Download size={12} /> Pending ({pendingLeads.length})
                </Button>
                <Button variant="ghost" size="sm" disabled={!sentOrPendingLeads.length} onClick={() => handleExport(sentOrPendingLeads, 'sent-and-pending')}>
                  <Download size={12} /> Sent + Pending ({sentOrPendingLeads.length})
                </Button>
              </div>
            </div>
            {unverifiedCount > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/50">
                <span className="text-[12px] text-amber-700 dark:text-amber-400">{unverifiedCount} lead{unverifiedCount === 1 ? '' : 's'} not yet verified</span>
                <Button variant="ghost" size="sm" onClick={handleVerifyAll} loading={verifyingAll}>
                  <RefreshCw size={12} /> Verify all
                </Button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                    {cols.map((c) => (
                      <th key={c.key} className={cn('px-4 py-2.5 font-medium', c.align === 'center' && 'text-center')}>{c.label}</th>
                    ))}
                    <th className="px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const badge = LEAD_STATUS_BADGE[l.status] || LEAD_STATUS_BADGE.pending;
                    const vBadge = VERIFICATION_BADGE[l.verificationStatus] || VERIFICATION_BADGE.unverified;
                    return (
                      <tr key={l._id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        {cols.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-4 py-2.5',
                              c.align === 'center' && 'text-center',
                              c.key === 'response' && 'max-w-[160px] truncate',
                              ['lastOpened', 'sent'].includes(c.key) && 'whitespace-nowrap',
                            )}
                          >
                            {renderLeadCell(c.key, l, { badge, vBadge })}
                          </td>
                        ))}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleVerify(l._id)}
                              title="Re-verify email"
                              disabled={verifyingId === l._id}
                              className="btn-icon text-slate-400 hover:text-primary-500"
                            >
                              {verifyingId === l._id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                            </button>
                            {l.status === 'sent' && (
                              <button
                                onClick={() => onMarkReplied(l._id)}
                                title="Mark as replied (stops further sends to this lead)"
                                className="btn-icon text-slate-400 hover:text-purple-500"
                              >
                                <MessageSquareOff size={13} />
                              </button>
                            )}
                            <button onClick={() => onDeleteLead(l._id)} className="btn-icon text-slate-400 hover:text-red-500">
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
          </>
        )}
      </div>
    </div>
  );
}

// ── Compose Tab ────────────────────────────────────────────────────────
function ComposeTab({ campaign, onSave }) {
  const uploadCampaignImage = useAppStore((s) => s.uploadCampaignImage);
  const [subject, setSubject] = useState(campaign.subject || '');
  const [body, setBody] = useState(campaign.bodyHtml || '');
  const [saving, setSaving] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => { setSubject(campaign.subject || ''); setBody(campaign.bodyHtml || ''); }, [campaign._id]);

  const spamCheck = useMemo(() => checkSpamContent(subject, body), [subject, body]);

  const insertTag = (tag) => editorRef.current?.insertText(tag);

  const handleApplyTemplate = (t) => {
    setSubject(t.subject || '');
    setBody(t.bodyHtml || '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ subject, bodyHtml: body });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6 space-y-4 max-w-5xl">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input label="Subject line" placeholder="e.g. Quick question about {{first_name}}'s finances" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
          <FileText size={14} /> Templates
        </Button>
      </div>

      <div>
        <label className="form-label">Email body</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {['{{first_name}}', '{{last_name}}', '{{email}}', '{{redirect_url}}', '{{response_options}}'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTag(tag)}
              title={tag === '{{redirect_url}}'
                ? 'A click on any link using this as its href flows into Email Leads as \'Call Requested\' and redirects to this campaign\'s configured Redirect URL'
                : tag === '{{response_options}}'
                  ? 'Inserts one tracked link per checkbox-style option configured in Settings — each click is recorded and visible on the lead'
                  : undefined}
              className="text-[11px] font-mono px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
        <RichTextEditor
          ref={editorRef}
          value={body}
          onChange={setBody}
          onUploadImage={uploadCampaignImage}
          placeholder="Hi {{first_name}}, write your message here…"
        />
        <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5">
          Merge tags are replaced per-recipient at send time. Unsubscribe footer is added automatically.
          Use the <Code2Inline /> button in the toolbar to edit raw HTML directly.
          Type <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">;</code> to browse your saved snippets (Settings → Communication), or type a snippet's trigger and press space to expand it instantly.
        </p>
      </div>

      {spamCheck.warnings.length > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/50">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">Possible spam-filter triggers</p>
            <ul className="text-[12px] text-amber-700 dark:text-amber-400 mt-1 space-y-0.5 list-disc pl-4">
              {spamCheck.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 mt-1.5">
              This is a heuristic, not a guarantee — real spam filters weigh many signals we can't see. Not a hard block on sending.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving}>Save Email</Button>
      </div>

      <EmailTemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSelect={handleApplyTemplate}
        currentSubject={subject}
        currentBody={body}
      />
    </div>
  );
}

function Code2Inline() {
  return <Code2 size={11} className="inline -mt-0.5 mx-0.5" />;
}

// ── Settings Tab ───────────────────────────────────────────────────────
function SettingsTab({ campaign, emailAccounts, onSave, onManageAccounts }) {
  const uploadCampaignImage = useAppStore((s) => s.uploadCampaignImage);
  const s = campaign.settings || {};
  const [accounts, setAccounts] = useState((s.accounts || []).map((a) => a._id || a));
  const [stopOnReply, setStopOnReply] = useState(s.stopOnReply ?? true);
  const [openTracking, setOpenTracking] = useState(s.openTracking ?? true);
  const [linkTracking, setLinkTracking] = useState(s.linkTracking ?? false);
  const [includeUnsubscribeLink, setIncludeUnsubscribeLink] = useState(s.includeUnsubscribeLink ?? true);
  const [redirectUrl, setRedirectUrl] = useState(s.redirectUrl ?? '');
  const [responseOptions, setResponseOptions] = useState(s.responseOptions ?? []);
  // Visible Leads-table columns. An empty saved list means "never configured",
  // which renders the default set — so this initialises to the defaults rather
  // than to empty, otherwise unticking everything and saving would be
  // indistinguishable from never having touched it.
  const [leadColumns, setLeadColumns] = useState(
    Array.isArray(s.leadColumns) && s.leadColumns.length ? s.leadColumns : DEFAULT_LEAD_COLUMNS,
  );
  const [textOnly, setTextOnly] = useState(s.textOnly ?? false);
  const [firstEmailTextOnly, setFirstEmailTextOnly] = useState(s.firstEmailTextOnly ?? false);
  const [dailyLimit, setDailyLimit] = useState(s.dailyLimit ?? 30);
  const [minGapMinutes, setMinGapMinutes] = useState(s.minGapMinutes ?? 9);
  const [randomGapMinutes, setRandomGapMinutes] = useState(s.randomGapMinutes ?? 5);
  const [maxNewLeadsPerDay, setMaxNewLeadsPerDay] = useState(s.maxNewLeadsPerDay ?? '');
  const [sendingHoursEnabled, setSendingHoursEnabled] = useState(s.sendingHoursEnabled ?? false);
  const [sendingHourStart, setSendingHourStart] = useState(s.sendingHourStart ?? 9);
  const [sendingHourEnd, setSendingHourEnd] = useState(s.sendingHourEnd ?? 18);
  const [sendingDays, setSendingDays] = useState(s.sendingDays ?? [1, 2, 3, 4, 5]);
  const [timezone, setTimezone] = useState(s.timezone ?? 'Asia/Kolkata');
  const [followUpEnabled, setFollowUpEnabled] = useState(s.followUpEnabled ?? false);
  const [followUpDelayHours, setFollowUpDelayHours] = useState(s.followUpDelayHours ?? 48);
  const [followUpSubject, setFollowUpSubject] = useState(s.followUpSubject ?? '');
  const [followUpBodyHtml, setFollowUpBodyHtml] = useState(s.followUpBodyHtml ?? '');
  const [fallbackEnabled, setFallbackEnabled] = useState(s.fallbackEnabled ?? false);
  const [fallbackSubject, setFallbackSubject] = useState(s.fallbackSubject ?? '');
  const [fallbackBodyHtml, setFallbackBodyHtml] = useState(s.fallbackBodyHtml ?? '');
  const [saving, setSaving] = useState(false);
  const followUpEditorRef = useRef(null);
  const fallbackEditorRef = useRef(null);

  useEffect(() => {
    setAccounts((s.accounts || []).map((a) => a._id || a));
    setStopOnReply(s.stopOnReply ?? true);
    setOpenTracking(s.openTracking ?? true);
    setLinkTracking(s.linkTracking ?? false);
    setIncludeUnsubscribeLink(s.includeUnsubscribeLink ?? true);
    setRedirectUrl(s.redirectUrl ?? '');
    setResponseOptions(s.responseOptions ?? []);
    setTextOnly(s.textOnly ?? false);
    setFirstEmailTextOnly(s.firstEmailTextOnly ?? false);
    setDailyLimit(s.dailyLimit ?? 30);
    setMinGapMinutes(s.minGapMinutes ?? 9);
    setRandomGapMinutes(s.randomGapMinutes ?? 5);
    setMaxNewLeadsPerDay(s.maxNewLeadsPerDay ?? '');
    setSendingHoursEnabled(s.sendingHoursEnabled ?? false);
    setSendingHourStart(s.sendingHourStart ?? 9);
    setSendingHourEnd(s.sendingHourEnd ?? 18);
    setSendingDays(s.sendingDays ?? [1, 2, 3, 4, 5]);
    setTimezone(s.timezone ?? 'Asia/Kolkata');
    setFollowUpEnabled(s.followUpEnabled ?? false);
    setFollowUpDelayHours(s.followUpDelayHours ?? 48);
    setFollowUpSubject(s.followUpSubject ?? '');
    setFollowUpBodyHtml(s.followUpBodyHtml ?? '');
    setFallbackEnabled(s.fallbackEnabled ?? false);
    setFallbackSubject(s.fallbackSubject ?? '');
    setFallbackBodyHtml(s.fallbackBodyHtml ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign._id]);

  const toggleDay = (d) => {
    setSendingDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const toggleAccount = (id) => {
    setAccounts((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    // A blank/zero Daily Limit isn't "unlimited" here — dispatchOne() treats
    // 0 as an already-reached cap and stops sending entirely with no
    // obvious error. Guard against clearing the field by accident.
    if (!(Number(dailyLimit) > 0)) {
      toast.error('Daily Limit must be at least 1 — leave it blank and the campaign will never send.');
      return;
    }
    // Same trap, different field: this one is optional (blank = no limit),
    // but an explicit 0 is the lower of the two caps and silently stops the
    // campaign dead.
    if (maxNewLeadsPerDay !== '' && !(Number(maxNewLeadsPerDay) > 0)) {
      toast.error('Max new leads per day must be at least 1 — clear the field for no limit.');
      return;
    }
    if (followUpEnabled && !(Number(followUpDelayHours) > 0)) {
      toast.error('Follow-up delay must be at least 1 hour.');
      return;
    }
    if (followUpEnabled && (!followUpSubject.trim() || !followUpBodyHtml.trim())) {
      toast.error('Follow-up subject and body are required while auto follow-up is on.');
      return;
    }
    if (fallbackEnabled && (!fallbackSubject.trim() || !fallbackBodyHtml.trim())) {
      toast.error('Add a subject and body for the standard email, or turn that option off.');
      return;
    }
    // Same list the server enforces (utils/auditMergeTags.AUDIT_TAGS): the
    // standard email goes to leads with NO audit data, so these would be blank.
    const auditTagInFallback = FALLBACK_FORBIDDEN_TAGS.find((t) =>
      new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`, 'i').test(`${fallbackSubject} ${fallbackBodyHtml}`));
    if (fallbackEnabled && auditTagInFallback) {
      toast.error(`The standard email can't use {{${auditTagInFallback}}} — those leads have no audit data.`);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        accounts, stopOnReply, openTracking, linkTracking, includeUnsubscribeLink, textOnly, firstEmailTextOnly,
        redirectUrl: redirectUrl.trim(),
        responseOptions: responseOptions.map((o) => o.trim()).filter(Boolean),
        dailyLimit: Number(dailyLimit),
        minGapMinutes: Number(minGapMinutes) || 0,
        randomGapMinutes: Number(randomGapMinutes) || 0,
        maxNewLeadsPerDay: maxNewLeadsPerDay === '' ? null : Number(maxNewLeadsPerDay),
        sendingHoursEnabled, sendingHourStart: Number(sendingHourStart), sendingHourEnd: Number(sendingHourEnd),
        sendingDays, timezone,
        followUpEnabled, followUpDelayHours: Number(followUpDelayHours) || 48,
        followUpSubject: followUpSubject.trim(), followUpBodyHtml,
        fallbackEnabled, fallbackSubject: fallbackSubject.trim(), fallbackBodyHtml,
        leadColumns,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">Accounts to use</p>
          <Button variant="ghost" size="sm" onClick={onManageAccounts}><Settings2 size={13} /> Manage accounts</Button>
        </div>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">Select one or more accounts to send emails from</p>
        {emailAccounts.length === 0 ? (
          <p className="text-[12.5px] text-amber-600 dark:text-amber-400">No sending accounts configured — add one to enable sending.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {emailAccounts.map((a) => (
              <button
                key={a._id}
                type="button"
                onClick={() => toggleAccount(a._id)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors',
                  accounts.includes(a._id)
                    ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:border-primary-700 dark:text-primary-300'
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                )}
              >
                {a.email}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 divide-y divide-slate-100 dark:divide-slate-800">
        <Toggle checked={stopOnReply} onChange={setStopOnReply} label="Stop sending emails on reply" description="Stop sending emails to a lead if a response has been received (manual — see note below)" />
        <Toggle checked={openTracking} onChange={setOpenTracking} label="Open Tracking" description="Track email opens via an invisible tracking pixel" />
        <div className="flex items-center gap-2 py-2 pl-4">
          <input type="checkbox" checked={linkTracking} onChange={(e) => setLinkTracking(e.target.checked)} className="rounded border-slate-300" />
          <span className="text-[12.5px] text-slate-600 dark:text-slate-400">Link tracking (rewrites links to track clicks)</span>
        </div>
        <div className="py-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeUnsubscribeLink} onChange={(e) => setIncludeUnsubscribeLink(e.target.checked)} className="rounded border-slate-300" />
            <span className="text-[12.5px] text-slate-600 dark:text-slate-400">Include unsubscribe link in every email</span>
          </label>
          {!includeUnsubscribeLink && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 pl-6">
              Commercial email is legally required to include an opt-out mechanism in most jurisdictions (e.g. CAN-SPAM). Turning this off is your call to make, not a deliverability trick — Gmail/Yahoo also penalize bulk senders that lack it.
            </p>
          )}
        </div>
        <div className="py-2">
          <Input
            label="Redirect URL"
            placeholder="https://debtfreepath.co.uk/request-a-call-thankyou.html?src=email-cta"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Where recipients land after clicking a tracked CTA button ({'{{redirect_url}}'}) in this campaign's email — not limited to "Request a Call," any button using that tag redirects here. Leave blank to use the server default.
          </p>
        </div>
        <div className="py-2">
          <label className="form-label">Checkbox-style response options</label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            e.g. "Still interested — call me" / "Not interested". Each becomes its own tracked link — insert {'{{response_options}}'} anywhere in the email body (Compose tab) to place them. Not real inline checkboxes (that needs AMP4Email, Gmail-only, Google approval required) — a click here is recorded instantly and works in every inbox.
          </p>
          <div className="space-y-2">
            {responseOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={opt}
                  onChange={(e) => setResponseOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                  placeholder="e.g. Still interested — call me"
                />
                <button
                  type="button"
                  onClick={() => setResponseOptions((prev) => prev.filter((_, j) => j !== i))}
                  className="btn-icon text-slate-400 hover:text-red-500 flex-shrink-0"
                >
                  <XCircle size={15} />
                </button>
              </div>
            ))}
            {responseOptions.length < 5 && (
              <Button variant="outline" size="sm" onClick={() => setResponseOptions((prev) => [...prev, ''])}>
                <UserPlus size={13} /> Add option
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 mb-3">Delivery Optimization</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={textOnly} onChange={(e) => setTextOnly(e.target.checked)} className="rounded border-slate-300" />
            <span className="text-[12.5px] text-slate-600 dark:text-slate-400">Send emails as text-only (no HTML)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={firstEmailTextOnly} onChange={(e) => setFirstEmailTextOnly(e.target.checked)} className="rounded border-slate-300" />
            <span className="text-[12.5px] text-slate-600 dark:text-slate-400">Send first email as text-only</span>
          </label>
        </div>
      </div>

      <div className="card p-5">
        <Input
          label="Daily Limit"
          type="number" min="1"
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
        <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">Max number of emails to send per day for this campaign</p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">Leads table columns</p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
            Choose what the Leads tab shows for this campaign. A plain mail-merge campaign can hide
            Audit and anything else it doesn't use; an audit-driven one can keep it. Email and Status
            are always shown.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
          {LEAD_COLUMN_DEFS.map((c) => {
            const on = c.always || leadColumns.includes(c.key);
            return (
              <label
                key={c.key}
                className={cn('flex items-center gap-2', c.always ? 'opacity-60 cursor-default' : 'cursor-pointer')}
                title={c.always ? 'Always shown' : undefined}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={c.always}
                  onChange={(e) => setLeadColumns((prev) => (
                    e.target.checked ? [...new Set([...prev, c.key])] : prev.filter((k) => k !== c.key)
                  ))}
                  className="rounded border-slate-300"
                />
                <span className="text-[12.5px] text-slate-600 dark:text-slate-400">
                  {c.label}{c.key === 'audit' && <span className="text-slate-400"> (website audit)</span>}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setLeadColumns(DEFAULT_LEAD_COLUMNS)}>Show all</Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setLeadColumns(['email', 'name', 'status', 'opens', 'clicks', 'sent'])}
            title="A minimal set for a campaign that does not use website-audit data"
          >
            Essentials only
          </Button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">Sending Pattern</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Minimum time between emails (min)" type="number" min="0" value={minGapMinutes} onChange={(e) => setMinGapMinutes(e.target.value)} />
          <Input label="Random additional time (min)" type="number" min="0" value={randomGapMinutes} onChange={(e) => setRandomGapMinutes(e.target.value)} />
        </div>
        <Input
          label="Max new leads per day"
          type="number" min="1"
          placeholder="No limit"
          value={maxNewLeadsPerDay}
          onChange={(e) => setMaxNewLeadsPerDay(e.target.value)}
        />
      </div>

      <div className="card p-5 space-y-4">
        <Toggle
          checked={followUpEnabled}
          onChange={setFollowUpEnabled}
          label="Auto follow-up to hot leads"
          description={`Automatically sends this one-time follow-up once a lead goes "hot" — ${HOT_OPEN_THRESHOLD}+ real opens (automated scanner/prefetch hits don't count) or a Request a Call click — sent once per lead, never repeated`}
        />
        {followUpEnabled && (
          <div className="space-y-3 pt-1">
            <Input
              label="Send after (hours)"
              type="number" min="1"
              value={followUpDelayHours}
              onChange={(e) => setFollowUpDelayHours(e.target.value)}
            />
            <Input
              label="Follow-up subject"
              placeholder="e.g. Following up on {{first_name}}'s question"
              value={followUpSubject}
              onChange={(e) => setFollowUpSubject(e.target.value)}
            />
            <div>
              <label className="form-label">Follow-up email body</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {['{{first_name}}', '{{last_name}}', '{{email}}', '{{redirect_url}}', '{{response_options}}'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => followUpEditorRef.current?.insertText(tag)}
                    className="text-[11px] font-mono px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <RichTextEditor
                ref={followUpEditorRef}
                value={followUpBodyHtml}
                onChange={setFollowUpBodyHtml}
                onUploadImage={uploadCampaignImage}
                placeholder="Hi {{first_name}}, just following up…"
              />
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5">
                Sent through the same accounts, sending hours, and unsubscribe/tracking setup as the main email above — only the delay and content differ.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <Toggle
          checked={fallbackEnabled}
          onChange={setFallbackEnabled}
          label="Standard email for leads without audit data"
          description="Leads with no website, an unreachable site, or no audit results get this email instead of the audit one. Leave it off and the campaign refuses to start while any lead is missing the audit data your email uses."
        />
        {fallbackEnabled && (
          <div className="space-y-3 pt-1">
            <Input
              label="Standard email subject"
              placeholder="e.g. A quick hello from BizzBuzzCreations"
              value={fallbackSubject}
              onChange={(e) => setFallbackSubject(e.target.value)}
            />
            <div>
              <label className="form-label">Standard email body</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {['{{first_name}}', '{{last_name}}', '{{email}}', '{{redirect_url}}', '{{response_options}}'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => fallbackEditorRef.current?.insertText(tag)}
                    className="text-[11px] font-mono px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <RichTextEditor
                ref={fallbackEditorRef}
                value={fallbackBodyHtml}
                onChange={setFallbackBodyHtml}
                onUploadImage={uploadCampaignImage}
                placeholder="Hi {{first_name}}, a short email that doesn't rely on any website audit…"
              />
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5">
                Don't use website-audit tags here ({'{{perf_score}}'}, {'{{top_finding}}'}, {'{{website}}'} …) — these leads have no audit data, so they'd be blank.
                Prospects that couldn't be audited are added to this campaign when you push a batch, and receive this email.
                An auto follow-up that uses audit tags is skipped for these leads.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <Toggle
          checked={sendingHoursEnabled}
          onChange={setSendingHoursEnabled}
          label="Restrict sending hours"
          description="Only send during specific hours/days — avoids the robotic look of off-hours sends"
        />
        {sendingHoursEnabled && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-3 gap-3">
              <Select label="Start hour" value={sendingHourStart} onChange={(e) => setSendingHourStart(e.target.value)}>
                {[...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </Select>
              <Select label="End hour" value={sendingHourEnd} onChange={(e) => setSendingHourEnd(e.target.value)}>
                {[...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </Select>
              <Select label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New York (ET)</option>
                <option value="America/Los_Angeles">America/Los Angeles (PT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
              </Select>
            </div>
            <div>
              <label className="form-label">Days</label>
              <div className="flex gap-1.5">
                {[{ v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' }].map((d) => (
                  <button
                    key={d.v} type="button" onClick={() => toggleDay(d.v)}
                    className={cn(
                      'w-10 h-8 rounded-lg border text-[12px] font-medium transition-colors',
                      sendingDays.includes(d.v)
                        ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:border-primary-700 dark:text-primary-300'
                        : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    )}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving}>Save Settings</Button>
      </div>
    </div>
  );
}
