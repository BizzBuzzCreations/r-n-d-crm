import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Eye, Trash2, Download, Check, ChevronUp, ChevronDown,
  Filter, Columns, X, AlertTriangle, TrendingUp, Target,
  DollarSign, Flame, Thermometer, Snowflake, Archive, RotateCcw, AlertCircle, Undo2, ArrowRightCircle,
} from 'lucide-react';
import { cn } from '../utils/helpers';

import { AvatarContent } from '../components/ui';
// ── Confirm Dialog ─────────────────────────────────────────────
function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', confirmClass = 'bg-red-500 hover:bg-red-600 text-white', onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: '28px 28px 22px',
          maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          border: '1.5px solid #e2e8f0', colorScheme: 'light',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertCircle size={18} color="#ef4444" />
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</p>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0', lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8,
              background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#475569', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={confirmClass}
            style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────
const STAGES = ['New Lead', 'First Contact', 'Proposal Sent', 'Won', 'Lost'];
// Must match Lead.source's actual schema enum (models/Lead.js) exactly —
// this used to list values ('LinkedIn', 'Referral', 'Website', 'Cold
// Outreach', 'Event') the backend has never accepted (any save would 400)
// and was missing 'Web Form'/'Meta Ads', which it does accept.
const SOURCES = ['Manual', 'Import', 'Web Form', 'Campaign', 'Meta Ads'];

const STAGE_CFG = {
  'New Lead': { bg: '#eff6ff', color: '#3b82f6' },
  'First Contact': { bg: '#fffbeb', color: '#f59e0b' },
  'Proposal Sent': { bg: '#f5f3ff', color: '#8b5cf6' },
  'Won': { bg: '#ecfdf5', color: '#10b981' },
  'Lost': { bg: '#fef2f2', color: '#ef4444' },
};

// Column definitions — width in px. A function of `variant` because this
// grid is shared by both the B2B Leads Pipeline and External Form Leads
// (see ExternalFormLeadsView.jsx) — the two need slightly different
// columns in the same slot (B2B "Deal Value" makes no sense for a
// consumer debt-advice lead, and vice versa "Debt Amount" up front makes
// no sense for a B2B deal), rather than showing both awkwardly stacked.
function buildColumns(variant) {
  return [
    { key: 'leadId', label: 'Lead ID', width: 110, type: 'readonly', sortable: false },
    { key: 'companyName', label: 'Company', width: 190, type: 'text', sortable: true },
    { key: 'contactPerson', label: 'Contact Person', width: 155, type: 'text', sortable: true },
    { key: 'email', label: 'Email', width: 195, type: 'text', sortable: true },
    { key: 'phone', label: 'Phone', width: 140, type: 'text', sortable: false },
    // Same column slot, different field depending on variant — see comment above.
    variant === 'externalForm'
      ? { key: 'debtAmount', label: 'Debt Amount', width: 150, type: 'text', sortable: true }
      : { key: 'dealValue', label: 'Deal Value', width: 125, type: 'number', sortable: true },
    { key: 'status', label: 'Stage', width: 150, type: 'stage', sortable: true },
    { key: 'source', label: 'Lead Source', width: 135, type: 'source', sortable: true },
    // Which tracked site/campaign form actually produced this lead (see
    // witPublicController.captureLead / external-api/leadCapture) — captured
    // on every form-sourced lead already, this is just the first place it's
    // ever displayed.
    { key: 'utmSource', label: 'Source Website', width: 150, type: 'text', sortable: true },
    { key: 'assignedTo', label: 'Assigned To', width: 155, type: 'assignee', sortable: true },
    // Consumer debt-advice intake fields (see models/Lead.js) — populated by
    // public lead-capture forms like DebtFreePath's. Plain 'text' type, same
    // as any other column: full inline-edit/toggle/sort support for free.
    // debtAmount itself is already up top for the externalForm variant, so
    // it's skipped here to avoid showing it twice.
    ...(variant === 'externalForm' ? [] : [
      { key: 'debtAmount', label: 'Debt Amount', width: 150, type: 'text', sortable: true },
    ]),
    { key: 'contactPreference', label: 'Preferred Contact', width: 155, type: 'text', sortable: false },
    { key: 'situation', label: 'Situation', width: 220, type: 'text', sortable: false },
    { key: 'healthScore', label: 'Health', width: 120, type: 'health', sortable: true },
    { key: 'nextFollowUpDate', label: 'Next Follow-up', width: 140, type: 'date', sortable: true },
    { key: 'lastActivity', label: 'Last Activity', width: 135, type: 'lastact', sortable: false },
    { key: 'createdAt', label: 'Created', width: 115, type: 'created', sortable: true },
    { key: 'tags', label: 'Tags', width: 175, type: 'tags', sortable: false },
  ];
}
const FIXED_LEFT_W = 50 + 46;  // checkbox + row#
// Wide enough for the base 3 icons (view/archive/delete) plus up to 2
// conditional "move back" icons on rows that need them (see renderCell).
const ACTIONS_W = 116;

function getDisplayId(lead) {
  return lead.leadId || `LD-${String(lead._id).slice(-4).toUpperCase()}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtMoney(v) {
  if (!v && v !== 0) return '—';
  return `₹${Number(v).toLocaleString('en-IN')}`;
}

function healthColor(s) {
  if (s >= 75) return '#10b981';
  if (s >= 45) return '#f59e0b';
  return '#ef4444';
}
function healthLabel(s) {
  if (s >= 75) return 'Hot';
  if (s >= 45) return 'Warm';
  return 'Cold';
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Analytics Summary Bar ─────────────────────────────────────
function SummaryBar({ leads }) {
  const stats = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter(l => (l.healthScore || 0) >= 75).length;
    const won = leads.filter(l => l.status === 'Won').length;
    const lost = leads.filter(l => l.status === 'Lost').length;
    const pipeline = leads.filter(l => l.status !== 'Won' && l.status !== 'Lost')
      .reduce((s, l) => s + (l.dealValue || 0), 0);
    const conv = total > 0 ? Math.round((won / total) * 100) : 0;
    return { total, hot, won, lost, pipeline, conv };
  }, [leads]);

  const tiles = [
    { icon: Target, label: 'Total Leads', value: stats.total, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/30' },
    { icon: Flame, label: 'Hot Leads', value: stats.hot, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
    { icon: Check, label: 'Won Deals', value: stats.won, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { icon: X, label: 'Lost', value: stats.lost, color: 'text-red-400', bg: 'bg-red-50/60 dark:bg-red-900/10' },
    { icon: DollarSign, label: 'Pipeline', value: fmtMoney(stats.pipeline), color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
    { icon: TrendingUp, label: 'Conversion', value: `${stats.conv}%`, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {tiles.map(t => {
        const Icon = t.icon;
        return (
          <div key={t.label} className={cn('flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700', t.bg)}>
            <div className={cn('p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/40', t.color)}>
              <Icon size={14} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t.label}</p>
              <p className={cn('text-[15px] font-bold leading-none mt-0.5', t.color)}>{t.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function LeadsTableView({ filteredLeads, allLeads, users, onSelectLead, onDelete, onUpdate, variant = 'pipeline' }) {
  /* ── Columns — depend on variant, so computed once per mount/variant change,
      not on every render (buildColumns allocates a fresh array each call) ── */
  const ALL_COLUMNS = useMemo(() => buildColumns(variant), [variant]);

  /* ── Archive mode toggle (inside table view) ── */
  const [showArchived, setShowArchived] = useState(false);

  /* ── Inline editing ── */
  const [editCell, setEditCell] = useState(null);  // { id, key }
  const [editVal, setEditVal] = useState('');
  const [savedFlash, setSavedFlash] = useState({});
  const inputRef = useRef(null);

  useEffect(() => {
    if (editCell && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch { }
    }
  }, [editCell]);

  /* ── Selection ── */
  const [selectedIds, setSelectedIds] = useState([]);

  /* ── Sorting ── */
  const [sortCol, setSortCol] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  /* ── Pagination ── */
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  /* ── Panels ── */
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showColPanel, setShowColPanel] = useState(false);

  /* ── Column visibility — lazy initializer so it reflects THIS instance's
      variant, not whichever variant happened to mount first ── */
  const [visibleCols, setVisibleCols] = useState(() => new Set(ALL_COLUMNS.map(c => c.key)));

  /* ── Local filters (inside table view, additive to parent search) ── */
  // minVal/maxVal (numeric range) drive the Deal Value filter on the
  // 'pipeline' variant; debtText (contains-match) drives Debt Amount on
  // 'externalForm' — debtAmount is a free-text range label ("20k-50k"),
  // not a number, so it can't reuse the same min/max widget.
  const [lf, setLf] = useState({
    status: '', source: '', assignee: '',
    minVal: '', maxVal: '', debtText: '', healthTier: '',
    dateFrom: '', dateTo: '', tags: '',
  });

  /* ── Bulk actions ── */
  const [bulkStage, setBulkStage] = useState('');
  const [bulkAssignees, setBulkAssignees] = useState([]);   // multi-select array of user IDs
  const [assigneeDropOpen, setAssigneeDropOpen] = useState(false);
  const assigneeDropRef = useRef(null);

  /* ── Confirm dialog state ── */
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, confirmClass, onConfirm }
  const openConfirm = (opts) => new Promise(resolve => {
    setConfirm({ ...opts, onConfirm: () => { setConfirm(null); resolve(true); }, onCancel: () => { setConfirm(null); resolve(false); } });
  });
  useEffect(() => {
    const handler = (e) => {
      if (assigneeDropRef.current && !assigneeDropRef.current.contains(e.target))
        setAssigneeDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* Reset page when filters/sort/archive mode changes */
  useEffect(() => { setPage(1); }, [filteredLeads, sortCol, sortDir, lf, showArchived]);

  /* ── Build the lead pool ──
     Active view: filteredLeads (parent already excludes archived)
     Archive view: allLeads filtered to l.archived === true
  ── */
  const archivePool = useMemo(() => {
    if (showArchived) {
      return (allLeads || []).filter(l => l.archived === true);
    }
    // filteredLeads already excludes archived (done in LeadsPage)
    return filteredLeads;
  }, [showArchived, filteredLeads, allLeads]);

  /* ── Apply local filters on top of the pool ── */
  const localFiltered = useMemo(() => {
    return archivePool.filter(l => {
      if (lf.status && l.status !== lf.status) return false;
      if (lf.source && (l.source || 'Manual') !== lf.source) return false;
      if (lf.assignee && String(l.assignedTo?._id || l.assignedTo || '') !== lf.assignee) return false;
      if (variant === 'externalForm') {
        if (lf.debtText && !(l.debtAmount || '').toLowerCase().includes(lf.debtText.toLowerCase())) return false;
      } else {
        if (lf.minVal && (l.dealValue || 0) < Number(lf.minVal)) return false;
        if (lf.maxVal && (l.dealValue || 0) > Number(lf.maxVal)) return false;
      }
      if (lf.healthTier) {
        const s = l.healthScore || 0;
        if (lf.healthTier === 'hot'  && s < 75)               return false;
        if (lf.healthTier === 'warm' && (s < 45 || s >= 75))  return false;
        if (lf.healthTier === 'cold' && s >= 45)               return false;
      }
      if (lf.dateFrom && new Date(l.createdAt) < new Date(lf.dateFrom)) return false;
      if (lf.dateTo) {
        const end = new Date(lf.dateTo); end.setHours(23, 59, 59);
        if (new Date(l.createdAt) > end) return false;
      }
      if (lf.tags) {
        const needed = lf.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const leadTags = (l.tags || []).map(t => t.toLowerCase());
        if (!needed.some(n => leadTags.some(lt => lt.includes(n)))) return false;
      }
      return true;
    });
  }, [archivePool, lf, variant]);

  /* ── Sort ── */
  const sorted = useMemo(() => {
    if (!sortCol) return localFiltered;
    return [...localFiltered].sort((a, b) => {
      let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
      if (sortCol === 'dealValue' || sortCol === 'healthScore') { va = Number(va); vb = Number(vb); }
      else if (sortCol === 'createdAt' || sortCol === 'nextFollowUpDate') {
        va = new Date(va || 0).getTime(); vb = new Date(vb || 0).getTime();
      } else if (sortCol === 'assignedTo') {
        va = a.assignedTo?.name || ''; vb = b.assignedTo?.name || '';
      } else if (sortCol === 'status') {
        va = STAGES.indexOf(va); vb = STAGES.indexOf(vb);
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [localFiltered, sortCol, sortDir]);

  /* ── Paginate ── */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const s = (page - 1) * PAGE_SIZE;
    return sorted.slice(s, s + PAGE_SIZE);
  }, [sorted, page]);

  /* ── Columns for render (respecting visibility) ── */
  const visibleColumns = ALL_COLUMNS.filter(c => visibleCols.has(c.key));
  const tableW = visibleColumns.reduce((s, c) => s + c.width, 0) + FIXED_LEFT_W + ACTIONS_W;

  /* ── Helpers ── */
  const toggleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('asc'); }
  };

  const activate = (id, key, val) => {
    setEditCell({ id, key });
    setEditVal(String(val ?? ''));
  };

  const commit = useCallback(async (lead, key, value) => {
    setEditCell(null);
    let original;
    if (key === 'tags') original = (lead.tags || []).join(', ');
    else if (key === 'assignedTo') original = String(lead.assignedTo?._id || lead.assignedTo || '');
    else original = String(lead[key] ?? '');

    if (String(value) === original) return;

    let payload = {};
    if (key === 'tags') payload.tags = value.split(',').map(t => t.trim()).filter(Boolean);
    else if (key === 'dealValue') payload.dealValue = Number(value) || 0;
    else payload[key] = value;

    try {
      await onUpdate(lead._id, payload);
      const fk = `${lead._id}-${key}`;
      setSavedFlash(s => ({ ...s, [fk]: true }));
      setTimeout(() => setSavedFlash(s => { const n = { ...s }; delete n[fk]; return n; }), 1400);
    } catch { }
  }, [onUpdate]);

  /* ── Selection ── */
  const allOnPage = paged.every(l => selectedIds.includes(l._id));
  const toggleAll = () => setSelectedIds(prev =>
    allOnPage ? prev.filter(id => !paged.map(l => l._id).includes(id))
      : [...new Set([...prev, ...paged.map(l => l._id)])]
  );
  const toggleRow = id => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  /* ── Bulk ── */
  const handleBulkStage = async () => {
    if (!bulkStage) return;
    await Promise.all(selectedIds.map(id => onUpdate(id, { status: bulkStage })));
    setSelectedIds([]); setBulkStage('');
    toast.success('Stage updated for selected leads');
  };
  const handleBulkAssign = async () => {
    if (!bulkAssignees.length) return;
    // Round-robin: distribute leads evenly across selected reps
    await Promise.all(
      selectedIds.map((id, i) => onUpdate(id, { assignedTo: bulkAssignees[i % bulkAssignees.length] }))
    );
    const repCount = bulkAssignees.length;
    setSelectedIds([]); setBulkAssignees([]); setAssigneeDropOpen(false);
    toast.success(
      repCount > 1
        ? `${selectedIds.length} leads distributed across ${repCount} reps`
        : 'Rep assigned to selected leads'
    );
  };
  const handleBulkArchive = async () => {
    if (showArchived) {
      const ok = await openConfirm({
        title: `Unarchive ${selectedIds.length} lead(s)?`,
        message: 'These leads will be restored to your active pipeline and visible in all views.',
        confirmLabel: 'Unarchive', confirmClass: 'bg-emerald-500 hover:bg-emerald-600 text-white',
      });
      if (!ok) return;
      await Promise.all(selectedIds.map(id => onUpdate(id, { archived: false })));
      setSelectedIds([]);
      toast.success('Leads restored to active pipeline');
    } else {
      const ok = await openConfirm({
        title: `Archive ${selectedIds.length} lead(s)?`,
        message: 'Archived leads are hidden from the active view. You can restore them at any time from the Archive tab.',
        confirmLabel: 'Archive', confirmClass: 'bg-amber-500 hover:bg-amber-600 text-white',
      });
      if (!ok) return;
      await Promise.all(selectedIds.map(id => onUpdate(id, { archived: true })));
      setSelectedIds([]);
      toast.success('Leads archived');
    }
  };
  const handleBulkDelete = async () => {
    const ok = await openConfirm({
      title: `Delete ${selectedIds.length} lead(s) permanently?`,
      message: 'This action cannot be undone. All lead data including notes and history will be permanently removed.',
      confirmLabel: 'Delete permanently', confirmClass: 'bg-red-500 hover:bg-red-600 text-white',
    });
    if (!ok) return;
    await Promise.all(selectedIds.map(id => onDelete(id)));
    setSelectedIds([]);
    toast.success('Leads deleted');
  };

  /* ── Export ── */
  const handleExport = (mode) => {
    const target = mode === 'selected'
      ? sorted.filter(l => selectedIds.includes(l._id))
      : sorted;
    if (!target.length) { toast.error('Nothing to export'); return; }
    const headers = ['Lead ID', 'Company', 'Contact', 'Email', 'Phone', variant === 'externalForm' ? 'Debt Amount' : 'Deal Value', 'Stage', 'Source', 'Assigned', 'Health', 'Next Follow-up', 'Last Activity', 'Created', 'Tags'];
    const rows = [headers, ...target.map(l => [
      getDisplayId(l), l.companyName, l.contactPerson, l.email || '', l.phone || '',
      variant === 'externalForm' ? (l.debtAmount || '') : (l.dealValue || 0), l.status, l.source || 'Manual',
      l.assignedTo?.name || 'Unassigned', l.healthScore || 0,
      l.nextFollowUpDate ? new Date(l.nextFollowUpDate).toISOString().split('T')[0] : '',
      l.updatedAt ? new Date(l.updatedAt).toLocaleDateString() : '',
      l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '',
      (l.tags || []).join(', '),
    ])];
    downloadCSV(rows, `leads_${mode}_${new Date().toISOString().split('T')[0]}.csv`);
    toast.success(`Exported ${target.length} leads`);
  };

  /* ── Cell renderer ── */
  const renderCell = (lead, col) => {
    const { key, type, width } = col;
    const isActive = editCell?.id === lead._id && editCell?.key === key;
    const flashKey = `${lead._id}-${key}`;
    const isFlashing = savedFlash[flashKey];

    const tdClass = cn(
      'border-r border-b border-slate-200 dark:border-slate-700/60 p-0 relative',
      isFlashing && 'bg-emerald-50/60 dark:bg-emerald-900/20',
    );

    /* Readonly: Lead ID */
    if (type === 'readonly') {
      return (
        <td key={key} className={tdClass} style={{ width, minWidth: width }}>
          <div className="flex items-center px-3 h-10">
            <span className="font-mono text-[11.5px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
              {getDisplayId(lead)}
            </span>
          </div>
        </td>
      );
    }

    /* Health score */
    if (type === 'health') {
      const score = lead.healthScore || 0;
      const color = healthColor(score);
      const label = healthLabel(score);
      return (
        <td key={key} className={tdClass} style={{ width, minWidth: width }}>
          <div className="flex flex-col justify-center px-3 h-10 gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold" style={{ color }}>{score}% · {label}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
            </div>
          </div>
        </td>
      );
    }

    /* Last activity (read-only date) */
    if (type === 'lastact') {
      const d = lead.updatedAt || lead.lastContactDate;
      return (
        <td key={key} className={tdClass} style={{ width, minWidth: width }}>
          <div className="flex items-center px-3 h-10">
            <span className="text-[12px] text-slate-500 dark:text-slate-400">{d ? fmtDate(d) : '—'}</span>
          </div>
        </td>
      );
    }

    /* Created (read-only date) */
    if (type === 'created') {
      return (
        <td key={key} className={tdClass} style={{ width, minWidth: width }}>
          <div className="flex items-center px-3 h-10">
            <span className="text-[12px] text-slate-500 dark:text-slate-400">{fmtDate(lead.createdAt)}</span>
          </div>
        </td>
      );
    }

    /* Stage pill */
    if (type === 'stage') {
      const cfg = STAGE_CFG[lead.status] || STAGE_CFG['New Lead'];
      const sla = lead.nextFollowUpDate && new Date(lead.nextFollowUpDate) < new Date() && lead.status !== 'Won' && lead.status !== 'Lost';
      if (isActive) {
        return (
          <td key={key} className={cn(tdClass, 'ring-2 ring-inset ring-indigo-400')} style={{ width, minWidth: width }}>
            <select ref={inputRef} value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={() => commit(lead, key, editVal)}
              onKeyDown={e => { if (e.key === 'Escape') setEditCell(null); }}
              className="w-full h-10 px-2 text-[12.5px] bg-white dark:bg-slate-800 outline-none font-semibold text-slate-800 dark:text-slate-200"
            >
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={key} className={cn(tdClass, 'cursor-cell hover:bg-slate-50/80 dark:hover:bg-slate-800/30')}
          style={{ width, minWidth: width }}
          onClick={() => activate(lead._id, key, lead.status)}>
          <div className="flex items-center gap-1.5 px-3 h-10">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
              {lead.status}
            </span>
            {sla && <AlertTriangle size={11} className="text-red-500 flex-shrink-0" title="Overdue follow-up" />}
          </div>
        </td>
      );
    }

    /* Source select */
    if (type === 'source') {
      const val = lead.source || 'Manual';
      if (isActive) {
        return (
          <td key={key} className={cn(tdClass, 'ring-2 ring-inset ring-indigo-400')} style={{ width, minWidth: width }}>
            <select ref={inputRef} value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={() => commit(lead, key, editVal)}
              onKeyDown={e => { if (e.key === 'Escape') setEditCell(null); }}
              className="w-full h-10 px-2 text-[12.5px] bg-white dark:bg-slate-800 outline-none text-slate-800 dark:text-slate-200"
            >
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={key} className={cn(tdClass, 'cursor-cell hover:bg-slate-50/80 dark:hover:bg-slate-800/30')}
          style={{ width, minWidth: width }}
          onClick={() => activate(lead._id, key, val)}>
          <div className="flex items-center px-3 h-10">
            <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 px-2 py-0.5 rounded-md">
              {val}
            </span>
          </div>
        </td>
      );
    }

    /* Assignee select */
    if (type === 'assignee') {
      const assignee = lead.assignedTo;
      const currentId = String(assignee?._id || assignee || '');
      if (isActive) {
        return (
          <td key={key} className={cn(tdClass, 'ring-2 ring-inset ring-indigo-400')} style={{ width, minWidth: width }}>
            <select ref={inputRef} value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={() => commit(lead, key, editVal)}
              onKeyDown={e => { if (e.key === 'Escape') setEditCell(null); }}
              className="w-full h-10 px-2 text-[12.5px] bg-white dark:bg-slate-800 outline-none text-slate-800 dark:text-slate-200"
            >
              <option value="">Unassigned</option>
              {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={key} className={cn(tdClass, 'cursor-cell hover:bg-slate-50/80 dark:hover:bg-slate-800/30')}
          style={{ width, minWidth: width }}
          onClick={() => activate(lead._id, key, currentId)}>
          <div className="flex items-center gap-2 px-3 h-10">
            {assignee ? (
              <>
                <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold overflow-hidden"
                  style={{ background: assignee.avatar ? 'transparent' : (assignee.color || '#6366f1') }}>
                  <AvatarContent user={assignee} fallback={assignee.initials || assignee.name?.[0]} />
                </span>
                <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300 truncate">{assignee.name}</span>
              </>
            ) : (
              <span className="text-[12px] text-slate-400 italic">Unassigned</span>
            )}
          </div>
        </td>
      );
    }

    /* Text / Number / Date / Tags (all inline-editable) */
    const rawVal = type === 'tags' ? (lead.tags || []).join(', ') : (lead[key] ?? '');

    if (isActive) {
      return (
        <td key={key} className={cn(tdClass, 'ring-2 ring-inset ring-indigo-400')} style={{ width, minWidth: width }}>
          <input ref={inputRef}
            type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={() => commit(lead, key, editVal)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(lead, key, editVal); }
              if (e.key === 'Escape') setEditCell(null);
            }}
            className="w-full h-10 px-3 text-[12.5px] bg-white dark:bg-slate-800 outline-none text-slate-800 dark:text-slate-200"
          />
        </td>
      );
    }

    const display = type === 'number' ? fmtMoney(rawVal)
      : type === 'date' ? fmtDate(rawVal)
        : (rawVal || '');

    return (
      <td key={key}
        className={cn(tdClass, 'cursor-cell hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10')}
        style={{ width, minWidth: width }}
        onClick={() => activate(lead._id, key, rawVal)}
      >
        <div className={cn('flex items-center gap-1.5 px-3 h-10 min-w-0')}>
          <span className={cn(
            'text-[12.5px] truncate',
            !display ? 'text-slate-300 dark:text-slate-600 italic' : '',
            type === 'number' ? 'font-mono font-bold text-slate-800 dark:text-white'
              : type === 'text' && key === 'companyName' ? 'font-semibold text-slate-800 dark:text-slate-100'
                : 'text-slate-700 dark:text-slate-300',
          )}>
            {display || '—'}
          </span>
          {isFlashing && <Check size={11} className="text-emerald-500 flex-shrink-0 ml-auto" />}
        </div>
      </td>
    );
  };

  /* ── Active filter count ── */
  const activeFilterCount = Object.values(lf).filter(Boolean).length;

  /* ── Render ── */
  return (
    <>
      <div className="flex flex-col gap-3">

        {/* Analytics summary bar */}
        <SummaryBar leads={localFiltered} />

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 shadow-sm">

          {/* Archive / Active tab toggle */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => { setShowArchived(false); setSelectedIds([]); }}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-all',
                !showArchived ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              Active
            </button>
            <button
              onClick={() => { setShowArchived(true); setSelectedIds([]); }}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-all',
                showArchived ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Archive size={11} /> Archived
              {showArchived && allLeads && (
                <span className="bg-white/30 text-white text-[9px] font-bold px-1.5 rounded-full">
                  {allLeads.filter(l => l.archived).length}
                </span>
              )}
            </button>
          </div>

          {/* Filter toggle — hide in archive mode (archived leads are read-only) */}
          {!showArchived && (
            <button
              onClick={() => { setShowFilterPanel(v => !v); setShowColPanel(false); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all border',
                showFilterPanel || activeFilterCount > 0
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-400',
              )}
            >
              <Filter size={13} />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}

          {!showArchived && (
            <button
              onClick={() => { setShowColPanel(v => !v); setShowFilterPanel(false); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all border',
                showColPanel
                  ? 'bg-slate-100 dark:bg-slate-700 border-slate-400 text-slate-800 dark:text-slate-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400',
              )}
            >
              <Columns size={13} /> Columns
            </button>
          )}

          {activeFilterCount > 0 && (
            <button onClick={() => setLf({ status: '', source: '', assignee: '', minVal: '', maxVal: '', debtText: '', healthTier: '', dateFrom: '', dateTo: '', tags: '' })}
              className="flex items-center gap-1 text-[12px] text-red-500 hover:text-red-600 font-semibold px-2 py-1.5">
              <X size={12} /> Clear filters
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-slate-500">
              {sorted.length} lead{sorted.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 && ` (filtered from ${filteredLeads.length})`}
            </span>

            <button onClick={() => handleExport('all')}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg transition-all border border-slate-200 dark:border-slate-700">
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilterPanel && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden rounded-xl shadow-sm"
              style={{ colorScheme: 'light' }}>
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 border border-slate-200 rounded-xl"
                style={{ background: '#f8fafc' }}>

                {/* ── helper styles shared by all filter controls ── */}
                {/* bg:#fff, text:#1e293b (slate-800), border:#cbd5e1 (slate-300) */}

                {/* Stage */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Stage</label>
                  <select value={lf.status} onChange={e => setLf(f => ({ ...f, status: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', appearance: 'auto', colorScheme: 'light' }}>
                    <option value="">All Stages</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Source */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Source</label>
                  <select value={lf.source} onChange={e => setLf(f => ({ ...f, source: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', appearance: 'auto', colorScheme: 'light' }}>
                    <option value="">All Sources</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Assigned To */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Assigned To</label>
                  <select value={lf.assignee} onChange={e => setLf(f => ({ ...f, assignee: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', appearance: 'auto', colorScheme: 'light' }}>
                    <option value="">All Reps</option>
                    {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
                  </select>
                </div>

                {/* Deal Value range (pipeline) / Debt Amount (externalForm) —
                    debtAmount is a free-text range label ("20k-50k"), not a
                    number, so it gets a contains-match text field instead of
                    the min/max numeric widget. */}
                {variant === 'externalForm' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Debt Amount</label>
                    <input type="text" placeholder="e.g. 20k-50k" value={lf.debtText} onChange={e => setLf(f => ({ ...f, debtText: e.target.value }))}
                      style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Deal Value (₹)</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" placeholder="Min" value={lf.minVal} onChange={e => setLf(f => ({ ...f, minVal: e.target.value }))}
                        style={{ width: '50%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                      <input type="number" placeholder="Max" value={lf.maxVal} onChange={e => setLf(f => ({ ...f, maxVal: e.target.value }))}
                        style={{ width: '50%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                    </div>
                  </div>
                )}

                {/* Health Tier */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Health</label>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[
                      { value: '',     label: 'All',  Icon: null,        active: '#e2e8f0', activeText: '#475569', inactiveText: '#94a3b8' },
                      { value: 'hot',  label: 'Hot',  Icon: Flame,       active: '#fef2f2', activeText: '#ef4444', inactiveText: '#94a3b8' },
                      { value: 'warm', label: 'Warm', Icon: Thermometer, active: '#fffbeb', activeText: '#f59e0b', inactiveText: '#94a3b8' },
                      { value: 'cold', label: 'Cold', Icon: Snowflake,   active: '#eff6ff', activeText: '#3b82f6', inactiveText: '#94a3b8' },
                    ].map(({ value, label, Icon, active, activeText, inactiveText }) => {
                      const isActive = lf.healthTier === value;
                      return (
                        <button
                          key={value}
                          onClick={() => setLf(f => ({ ...f, healthTier: value }))}
                          style={{
                            flex: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            padding: '6px 4px',
                            border: `1.5px solid ${isActive ? activeText + '55' : '#cbd5e1'}`,
                            borderRadius: 8,
                            background: isActive ? active : '#ffffff',
                            color: isActive ? activeText : inactiveText,
                            fontSize: 11.5,
                            fontWeight: isActive ? 700 : 500,
                            cursor: 'pointer',
                            transition: 'all 0.12s',
                            outline: 'none',
                          }}
                        >
                          {Icon && <Icon size={11} />}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Created From */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Created From</label>
                  <input type="date" value={lf.dateFrom} onChange={e => setLf(f => ({ ...f, dateFrom: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                </div>

                {/* Created To */}
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Created To</label>
                  <input type="date" value={lf.dateTo} onChange={e => setLf(f => ({ ...f, dateTo: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                </div>

                {/* Tags */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>Tags (comma-separated)</label>
                  <input type="text" placeholder="e.g. hot, enterprise" value={lf.tags} onChange={e => setLf(f => ({ ...f, tags: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', border: '1.5px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#1e293b', fontSize: 12.5, outline: 'none', colorScheme: 'light' }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Column visibility panel */}
        <AnimatePresence>
          {showColPanel && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm">
              <div className="p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Toggle Columns</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_COLUMNS.map(col => {
                    const on = visibleCols.has(col.key);
                    return (
                      <button key={col.key}
                        onClick={() => setVisibleCols(prev => {
                          const next = new Set(prev);
                          if (on) next.delete(col.key); else next.add(col.key);
                          return next;
                        })}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all',
                          on ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 line-through opacity-50',
                        )}
                      >
                        {on && <Check size={11} />}
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Archived banner */}
        {showArchived && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-semibold"
            style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', color: '#92400e' }}>
            <Archive size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <span>Viewing archived leads — select rows and click <strong>Unarchive</strong> to restore, or use the <strong>🗑 Delete</strong> button to permanently remove.</span>
            <button onClick={() => setShowArchived(false)}
              style={{ marginLeft: 'auto', fontSize: 11, textDecoration: 'underline', opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
              ← Back to Active
            </button>
          </div>
        )}

        {/* Bulk action bar */}
        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}
              className="flex items-center gap-2.5 flex-wrap px-4 py-2.5 bg-indigo-600 text-white rounded-xl shadow-lg">
              <span className="text-[12.5px] font-bold">{selectedIds.length} selected</span>
              <div className="w-px h-4 bg-white/30" />

              <select value={bulkStage} onChange={e => setBulkStage(e.target.value)}
                style={{
                  fontSize: 12, padding: '6px 8px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)',
                  color: '#ffffff', outline: 'none', colorScheme: 'light',
                }}>
                <option value="" style={{ background: '#fff', color: '#1e293b' }}>Move stage…</option>
                {STAGES.map(s => <option key={s} value={s} style={{ background: '#fff', color: '#1e293b' }}>{s}</option>)}
              </select>
              {bulkStage && (
                <button onClick={handleBulkStage} className="text-[12px] font-bold bg-white text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-50">
                  Apply
                </button>
              )}

              {/* ── Multi-assignee custom dropdown ── */}
              <div ref={assigneeDropRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setAssigneeDropOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, padding: '6px 10px', borderRadius: 8,
                    background: bulkAssignees.length ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)',
                    border: '1px solid rgba(255,255,255,0.35)',
                    color: '#ffffff', outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  <Users size={12} />
                  {bulkAssignees.length === 0
                    ? 'Assign rep…'
                    : bulkAssignees.length === 1
                      ? users.find(u => u._id === bulkAssignees[0])?.name || '1 rep'
                      : `${bulkAssignees.length} reps selected`
                  }
                  {bulkAssignees.length > 0 && (
                    <span style={{
                      background: '#fff', color: '#4f46e5', borderRadius: 999,
                      fontSize: 10, fontWeight: 800, padding: '0 5px', lineHeight: '16px',
                    }}>{bulkAssignees.length}</span>
                  )}
                </button>

                {/* Dropdown panel */}
                {assigneeDropOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
                    background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 12,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.14)', minWidth: 200, padding: '6px 0',
                    colorScheme: 'light',
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8', padding: '4px 12px 6px' }}>
                      Select reps (multi)
                    </p>
                    {users.map(u => {
                      const checked = bulkAssignees.includes(u._id);
                      return (
                        <label key={u._id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 12px', cursor: 'pointer',
                          background: checked ? '#eef2ff' : 'transparent',
                          transition: 'background 0.12s',
                        }}
                          onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#f8fafc'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = checked ? '#eef2ff' : 'transparent'; }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setBulkAssignees(prev =>
                              checked ? prev.filter(id => id !== u._id) : [...prev, u._id]
                            )}
                            style={{ accentColor: '#4f46e5', width: 14, height: 14, cursor: 'pointer' }}
                          />
                          <span style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: u.avatar ? 'transparent' : (u.color || '#6366f1'),
                            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                            color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
                          }}>
                            <AvatarContent user={u} fallback={u.initials || u.name?.[0] || '?'} />
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>{u.name}</span>
                          {checked && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1', fontWeight: 700 }}>✓</span>}
                        </label>
                      );
                    })}
                    {bulkAssignees.length > 0 && (
                      <div style={{ padding: '6px 12px 4px', borderTop: '1px solid #f1f5f9', marginTop: 4 }}>
                        <button
                          onClick={() => setBulkAssignees([])}
                          style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Clear selection
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {bulkAssignees.length > 0 && (
                <button onClick={handleBulkAssign} className="text-[12px] font-bold bg-white text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-50">
                  {bulkAssignees.length > 1 ? `Distribute (${bulkAssignees.length})` : 'Assign'}
                </button>
              )}

              <button onClick={() => handleExport('selected')}
                className="flex items-center gap-1 text-[12px] font-bold bg-white/15 hover:bg-white/25 border border-white/30 px-3 py-1.5 rounded-lg transition-all">
                <Download size={12} /> Export
              </button>
              <button onClick={handleBulkArchive}
                className={cn(
                  'flex items-center gap-1 text-[12px] font-bold border px-3 py-1.5 rounded-lg transition-all',
                  showArchived
                    ? 'bg-emerald-500 hover:bg-emerald-600 border-emerald-400'
                    : 'bg-white/15 hover:bg-white/25 border-white/30',
                )}>
                {showArchived ? <RotateCcw size={12} /> : <Archive size={12} />}
                {showArchived ? 'Unarchive' : 'Archive'}
              </button>
              <button onClick={handleBulkDelete}
                className="flex items-center gap-1 text-[12px] font-bold bg-red-500 hover:bg-red-600 border border-red-400 px-3 py-1.5 rounded-lg transition-all">
                <Trash2 size={12} /> Delete
              </button>
              <button onClick={() => setSelectedIds([])} className="ml-auto opacity-70 hover:opacity-100 transition-all">
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── TABLE ── */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900">

          {/* Scrollable area — both axes */}
          <div
            className="overflow-auto"
            style={{ maxHeight: 'calc(100vh - 340px)', minHeight: '300px' }}
          >
            <table
              style={{
                width: `${tableW}px`,
                minWidth: `${tableW}px`,
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              {/* ── Sticky Header ── */}
              <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
                <tr className="bg-slate-100 dark:bg-slate-800 border-b-2 border-slate-300 dark:border-slate-600 select-none">

                  {/* Checkbox */}
                  <th style={{ width: 50, minWidth: 50 }}
                    className="border-r border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 px-3">
                    <input type="checkbox" checked={allOnPage && paged.length > 0} onChange={toggleAll}
                      className="w-4 h-4 accent-indigo-500 cursor-pointer" />
                  </th>

                  {/* Row # */}
                  <th style={{ width: 46, minWidth: 46 }}
                    className="border-r border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-400 text-center">
                    #
                  </th>

                  {/* Data columns */}
                  {visibleColumns.map(col => (
                    <th key={col.key}
                      style={{ width: col.width, minWidth: col.width }}
                      className={cn(
                        'px-3 py-2.5 border-r border-slate-300 dark:border-slate-600 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 whitespace-nowrap',
                        col.sortable && 'cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors',
                      )}
                      onClick={() => col.sortable && toggleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        <span>{col.label}</span>
                        {sortCol === col.key && (
                          sortDir === 'asc'
                            ? <ChevronUp size={11} className="text-indigo-500" />
                            : <ChevronDown size={11} className="text-indigo-500" />
                        )}
                      </div>
                    </th>
                  ))}

                  {/* Actions */}
                  <th style={{ width: ACTIONS_W, minWidth: ACTIONS_W }}
                    className="px-2 bg-slate-100 dark:bg-slate-800 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-center">
                    Actions
                  </th>
                </tr>
              </thead>

              {/* ── Body ── */}
              <tbody>
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 3}
                      className="py-16 text-center text-[13px] text-slate-400 italic">
                      No leads match your filters.
                    </td>
                  </tr>
                )}

                {paged.map((lead, idx) => {
                  const isSelected = selectedIds.includes(lead._id);
                  const stageColor = STAGE_CFG[lead.status]?.color || '#6366f1';
                  const globalIndex = (page - 1) * PAGE_SIZE + idx + 1;

                  return (
                    <tr key={lead._id}
                      className={cn(
                        'transition-colors',
                        isSelected
                          ? 'bg-indigo-50/70 dark:bg-indigo-900/15'
                          : idx % 2 === 0
                            ? 'bg-white dark:bg-slate-900'
                            : 'bg-slate-50/50 dark:bg-slate-800/20',
                      )}
                      style={{ borderLeft: `3px solid ${stageColor}28` }}
                    >
                      {/* Checkbox */}
                      <td className="border-r border-b border-slate-200 dark:border-slate-700/60 px-3"
                        style={{ width: 50, minWidth: 50 }}
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-center h-10">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRow(lead._id)}
                            className="w-4 h-4 accent-indigo-500 cursor-pointer" />
                        </div>
                      </td>

                      {/* Row # */}
                      <td className="border-r border-b border-slate-200 dark:border-slate-700/60"
                        style={{ width: 46, minWidth: 46 }}>
                        <div className="flex items-center justify-center h-10">
                          <span className="text-[11px] text-slate-400 select-none">{globalIndex}</span>
                        </div>
                      </td>

                      {/* Data cells */}
                      {visibleColumns.map(col => renderCell(lead, col))}

                      {/* Actions */}
                      <td className="border-r border-b border-slate-200 dark:border-slate-700/60 px-2 text-center"
                        style={{ width: ACTIONS_W, minWidth: ACTIONS_W }}>
                        <div className="flex items-center justify-center gap-1 h-10">
                          {!showArchived && (
                            <button onClick={() => onSelectLead(lead)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-slate-500 hover:text-indigo-600 transition-all"
                              title="Open details">
                              <Eye size={13} />
                            </button>
                          )}
                          {/* Same "Move to Pipeline" action Email Leads / External Form
                              Leads each have their own button for — shown here too since
                              those leads land in this exact grid once moved, and this is
                              also just where a Campaign/Web-Form lead ends up if someone
                              browses to it directly (e.g. via search) before moving it out. */}
                          {!showArchived && (lead.source === 'Campaign' || lead.source === 'Web Form') && (
                            <button
                              onClick={() => onUpdate(lead._id, { source: 'Manual' }).then(() => toast.success(`"${lead.companyName}" moved to Pipeline`))}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-slate-500 hover:text-emerald-600 transition-all"
                              title="Move to Pipeline">
                              <ArrowRightCircle size={13} />
                            </button>
                          )}
                          {/* "Move back" — campaignAttribution/utmSource are set once at
                              creation and never cleared (see models/Lead.js), so they're a
                              permanent record of where a lead originally came from even
                              after "Move to Pipeline" changes its current `source` away.
                              Without this, that move was a one-way door — the only way
                              back was manually retyping the Lead Source cell, which most
                              people would never think to do. */}
                          {!showArchived && lead.campaignAttribution?.name && lead.source !== 'Campaign' && (
                            <button
                              onClick={() => onUpdate(lead._id, { source: 'Campaign' }).then(() => toast.success(`"${lead.companyName}" moved back to Email Leads`))}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-slate-500 hover:text-indigo-600 transition-all"
                              title={`Move back to Email Leads (originally from campaign "${lead.campaignAttribution.name}")`}>
                              <Undo2 size={13} />
                            </button>
                          )}
                          {!showArchived && lead.utmSource && lead.source !== 'Web Form' && (
                            <button
                              onClick={() => onUpdate(lead._id, { source: 'Web Form' }).then(() => toast.success(`"${lead.companyName}" moved back to External Form Leads`))}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-slate-500 hover:text-indigo-600 transition-all"
                              title={`Move back to External Form Leads (originally from "${lead.utmSource}")`}>
                              <Undo2 size={13} />
                            </button>
                          )}
                          {showArchived ? (
                            <button
                              onClick={() => onUpdate(lead._id, { archived: false }).then(() => toast.success(`"${lead.companyName}" restored to active`))}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 transition-all"
                              title="Unarchive lead">
                              <RotateCcw size={13} />
                            </button>
                          ) : (
                            <button
                              onClick={() => onUpdate(lead._id, { archived: true }).then(() => toast.success(`"${lead.companyName}" archived`))}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-slate-500 hover:text-amber-600 transition-all"
                              title="Archive lead">
                              <Archive size={13} />
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              const ok = await openConfirm({
                                title: `Delete "${lead.companyName}"?`,
                                message: 'This will permanently remove the lead and all its data. This cannot be undone.',
                                confirmLabel: 'Delete', confirmClass: 'bg-red-500 hover:bg-red-600 text-white',
                              });
                              if (ok) onDelete(lead._id);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-600 transition-all"
                            title="Delete lead">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Footer: pagination + help ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-wrap gap-2">
            <span className="text-[11.5px] text-slate-500 select-none">
              Click any cell to edit ·{' '}
              <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px]">Enter</kbd> to save ·{' '}
              <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px]">Esc</kbd> to cancel
            </span>

            <div className="flex items-center gap-3">
              <span className="text-[12px] text-slate-500 select-none">
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 transition-all">
                  <ChevronDown size={13} className="rotate-90" />
                </button>
                <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 px-1 select-none">
                  {page} / {totalPages}
                </span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 transition-all">
                  <ChevronDown size={13} className="-rotate-90" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirm Dialog ── */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        confirmClass={confirm?.confirmClass}
        onConfirm={confirm?.onConfirm}
        onCancel={confirm?.onCancel}
      />
    </>
  );
}
