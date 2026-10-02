import { clsx } from 'clsx';

// ── ID normalizer (handles both MongoDB _id and numeric id) ──────
// ── ID normalizer — handles both MongoDB _id and numeric id ─────
export const getId  = (ref) => ref?._id || ref?.id || String(ref || '');
export const sameId = (a, b) => String(getId(a)) === String(getId(b));

// ── CSS class merge ──────────────────────────────────────────
export const cn = (...args) => clsx(...args);

// ── Priority config ──────────────────────────────────────────
export const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: '#dc2626', bg: '#fef2f2', dot: '#dc2626', ring: '#fca5a5', tw: 'badge-danger' },
  high:   { label: 'High',   color: '#ea580c', bg: '#fff7ed', dot: '#ea580c', ring: '#fed7aa', tw: 'badge-warning' },
  medium: { label: 'Medium', color: '#d97706', bg: '#fffbeb', dot: '#f59e0b', ring: '#fde68a', tw: 'badge-warning' },
  low:    { label: 'Low',    color: '#16a34a', bg: '#f0fdf4', dot: '#22c55e', ring: '#a7f3d0', tw: 'badge-success' },
};

// ── Status config ─────────────────────────────────────────────
export const STATUS_CONFIG = {
  pending:              { label: 'Pending',       tw: 'badge-warning' },
  'in-progress':        { label: 'In Progress',   tw: 'badge-info'    },
  'sent-for-approval':  { label: 'For Approval',  tw: 'badge-purple'  },
  completed:            { label: 'Completed',     tw: 'badge-success' },
};

// ── Status chart palette (validated colorblind-safe, light/dark) ──
export const STATUS_CHART_COLOR = {
  pending:             { light: '#eb6834', dark: '#d95926', label: 'Pending' },
  'in-progress':       { light: '#2a78d6', dark: '#3987e5', label: 'In Progress' },
  'sent-for-approval': { light: '#eda100', dark: '#c98500', label: 'Approval' },
  completed:           { light: '#1baf7a', dark: '#199e70', label: 'Completed' },
};
export const STATUS_ORDER = ['pending', 'in-progress', 'sent-for-approval', 'completed'];

export function statusDist(items, darkMode) {
  const counts = STATUS_ORDER.map((key) => items.filter((i) => i.status === key).length);
  if (counts.every((c) => c === 0)) return [];
  return STATUS_ORDER.map((key, i) => ({
    name: STATUS_CHART_COLOR[key].label,
    value: counts[i],
    color: STATUS_CHART_COLOR[key][darkMode ? 'dark' : 'light'],
  }));
}

// ── Meeting type config ──────────────────────────────────────
export const MEETING_TYPE_CONFIG = {
  client:   { label: 'Client',   tw: 'badge-primary', color: '#6366f1', bg: '#eef2ff' },
  internal: { label: 'Internal', tw: 'badge-success', color: '#10b981', bg: '#ecfdf5' },
  lead:     { label: 'Lead',     tw: 'badge-warning',  color: '#f59e0b', bg: '#fffbeb' },
};

// ── Role config ───────────────────────────────────────────────
export const ROLE_CONFIG = {
  admin:            { label: 'Admin',            tw: 'badge-purple',  color: '#7c3aed' },
  manager:          { label: 'Manager',          tw: 'badge-info',    color: '#0ea5e9' },
  member:           { label: 'Member',           tw: 'badge-neutral', color: '#64748b' },
  client_relations: { label: 'Client Relations', tw: 'badge-success', color: '#10b981' },
  client:           { label: 'Client',           tw: 'badge-teal',    color: '#0d9488' },
  read_only:        { label: 'Read Only',         tw: 'badge-warning', color: '#d97706' },
};

// ── Payment status config ─────────────────────────────────────
export const PAYMENT_CONFIG = {
  paid:    { label: 'Paid',    tw: 'badge-success' },
  pending: { label: 'Pending', tw: 'badge-warning' },
  overdue: { label: 'Overdue', tw: 'badge-danger'  },
};

// ── Client status config ─────────────────────────────────────
export const CLIENT_STATUS_CONFIG = {
  active:    { label: 'Active',    tw: 'badge-success' },
  'on-hold': { label: 'On Hold',   tw: 'badge-warning' },
  inactive:  { label: 'Inactive',  tw: 'badge-neutral' },
};

// ── Heatmap color ─────────────────────────────────────────────
export const heatColor = (n) => {
  if (n === 0) return '#f1f5f9';
  if (n <= 2)  return '#bbf7d0';
  if (n <= 4)  return '#4ade80';
  if (n <= 6)  return '#16a34a';
  return '#14532d';
};

// ── Timer formatter ────────────────────────────────────────────
export const fmtTimer = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
};

// ── Truncate text ──────────────────────────────────────────────
export const truncate = (str, n = 50) =>
  str && str.length > n ? str.slice(0, n) + '…' : str;

// ── Role access checks ─────────────────────────────────────────
export const canAdmin   = (role) => role === 'admin';
export const canManage  = (role) => role === 'admin' || role === 'manager';
export const isMember   = (role) => role === 'member';

// ── Get user initials ──────────────────────────────────────────
export const getInitials = (name) =>
  name
    ? name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2)
    : '??';

// ── Date helpers ───────────────────────────────────────────────
// YYYY-MM-DD for the *local* calendar day. Never use toISOString() for this: it converts to UTC,
// so in any timezone ahead of UTC (e.g. IST) the date comes out a day early/late around midnight.
export const localDateStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const today = () => localDateStr();
export const isPast = (dateStr) => new Date(dateStr) < new Date();
export const isToday = (dateStr) => dateStr === today();

export const fmtDate = (dateStr, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', opts);
};

// ── Generate calendar days ─────────────────────────────────────
export const getCalendarDays = (year, month) => {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const days  = [];

  // Fill leading empty slots
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(year, month, -first.getDay() + i + 1);
    days.push({ date: d, current: false });
  }

  for (let d = 1; d <= last.getDate(); d++) {
    days.push({ date: new Date(year, month, d), current: true });
  }

  // Fill trailing
  const rem = 42 - days.length;
  for (let i = 1; i <= rem; i++) {
    days.push({ date: new Date(year, month + 1, i), current: false });
  }

  return days;
};

// ── Calendar event color ──────────────────────────────────────
export const calEventColor = (type) => {
  const map = {
    task:    { bg: '#eef2ff', text: '#4338ca', border: '#6366f1' },
    todo:    { bg: '#ecfdf5', text: '#065f46', border: '#10b981' },
    meeting: { bg: '#fffbeb', text: '#92400e', border: '#f59e0b' },
  };
  return map[type] || map.task;
};