import { useState, useMemo, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import {
  Download, TrendingUp, Users, CheckSquare, Clock,
  Calendar, FileText, FileSpreadsheet, X, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useAppStore from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import { Page, Avatar, Badge, ProgressBar } from '../components/ui';
import { cn, getId, sameId, canManage, ROLE_CONFIG, statusDist, STATUS_CHART_COLOR, PRIORITY_CONFIG, localDateStr } from '../utils/helpers';

// ── Date helpers ─────────────────────────────────────────────
const todayStr   = () => localDateStr();
const fmtDisplay = (ds) => ds ? new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

function getDateRange(period, customDate) {
  const now   = new Date();
  const today = localDateStr(now);

  if (period === 'today') {
    return { from: today, to: today, label: 'Today' };
  }
  if (period === 'week') {
    const day  = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Mon
    const mon  = new Date(now.setDate(diff));
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    return {
      from:  localDateStr(mon),
      to:    localDateStr(sun),
      label: `${mon.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${sun.toLocaleDateString('en-US', { month:'short', day:'numeric' })}`,
    };
  }
  if (period === 'month') {
    const d    = new Date();
    const from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    const to   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${last}`;
    return { from, to, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'custom' && customDate) {
    return { from: customDate, to: customDate, label: fmtDisplay(customDate) };
  }
  return { from: null, to: null, label: 'All Time' };
}

function inRange(dateStr, from, to) {
  if (!from) return true;
  return dateStr >= from && dateStr <= to;
}

// ── CSV Download ─────────────────────────────────────────────
function downloadCSV(rows, filename) {
  const csv  = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Print / PDF ───────────────────────────────────────────────
function printReport(content) {
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(`
    <html><head><title>BBC CRM Report</title>
    <style>
      body { font-family: 'DM Sans', system-ui, sans-serif; color:#1e293b; padding:32px; background:#fff; }
      h1   { font-size:22px; font-weight:700; margin-bottom:4px; }
      h2   { font-size:15px; font-weight:600; margin:20px 0 10px; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:6px; }
      p.sub{ font-size:13px; color:#64748b; margin-bottom:20px; }
      table{ width:100%; border-collapse:collapse; font-size:13px; }
      th   { background:#f1f5f9; padding:8px 12px; text-align:left; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; }
      td   { padding:8px 12px; border-bottom:1px solid #f1f5f9; }
      .kpi { display:inline-block; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 20px; margin:0 8px 8px 0; }
      .kpi-val { font-size:26px; font-weight:700; color:#6366f1; }
      .kpi-lbl { font-size:12px; color:#64748b; margin-top:2px; }
      @media print { body { padding:16px; } }
    </style></head><body>
    ${content}
    <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>
  `);
  win.document.close();
}

// ── Recharts tooltip ─────────────────────────────────────────
const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[12px] shadow-modal">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────
export default function ReportsPage() {
  const { authUser, tasks, todos, clients, meetings, darkMode } = useAppStore(useShallow((s) => ({
    authUser: s.authUser,
    tasks:    s.tasks,
    todos:    s.todos,
    clients:  s.clients,
    meetings: s.meetings,
    darkMode: s.darkMode,
  })));
  const users = useAppStore((s) => s.users);

  const [period,     setPeriod]     = useState('month');    // today | week | month | custom
  const [customDate, setCustomDate] = useState('');
  const [memberId,   setMemberId]   = useState('');         // '' = all, or user id string
  const [showDatePicker, setShowDatePicker] = useState(false);

  const role      = authUser?.role;
  const isManager = canManage(role);

  // Derive active member ID based on role
  const effectiveMemberId = isManager ? memberId : getId(authUser);

  // Date range from selected period
  const { from, to, label: periodLabel } = useMemo(
    () => getDateRange(period, customDate),
    [period, customDate]
  );

  // Member filter
  const selectedMember = effectiveMemberId ? users.find((u) => getId(u) === effectiveMemberId) : null;

  // List of members visible to current user based on roles
  const memberUsers = useMemo(() => {
    if (isManager) {
      return users.filter((u) => u.role === 'member' || u.role === 'client_relations');
    }
    return users.filter((u) => getId(u) === getId(authUser));
  }, [users, isManager, authUser]);

  // ── Compute stats ─────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let t = tasks.filter((t) => inRange(t.createdAt || '', from, to) || inRange(t.dueDate || '', from, to));
    if (effectiveMemberId) t = t.filter((t) => getId(t.assignedTo) === effectiveMemberId);
    return t;
  }, [tasks, from, to, effectiveMemberId]);

  const filteredTodos = useMemo(() => {
    let t = todos.filter((t) => inRange(t.createdAt || '', from, to));
    if (effectiveMemberId) t = t.filter((t) => getId(t.userId) === effectiveMemberId);
    return t;
  }, [todos, from, to, effectiveMemberId]);

  const kpis = [
    { icon: CheckSquare, label: 'Tasks in Period',    value: filteredTasks.length,                                    color: '#6366f1', bg: '#eef2ff' },
    { icon: CheckSquare, label: 'Tasks Completed',    value: filteredTasks.filter((t) => t.status === 'completed').length, color: '#10b981', bg: '#ecfdf5' },
    { icon: CheckSquare, label: 'Todos in Period',    value: filteredTodos.length,                                    color: '#8b5cf6', bg: '#f5f3ff' },
    { icon: CheckSquare, label: 'Todos Completed',    value: filteredTodos.filter((t) => t.status === 'completed').length, color: '#f59e0b', bg: '#fffbeb' },
  ];

  // ── Productivity Chart Data (6-Month Trend) ────────────────
  const productivityData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('en-US', { month: 'short' });
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ label, yearMonth, tasks: 0, todos: 0, meetings: 0 });
    }

    months.forEach((m) => {
      m.tasks = tasks.filter((t) => {
        if (effectiveMemberId && getId(t.assignedTo) !== effectiveMemberId) return false;
        return (t.createdAt || '').startsWith(m.yearMonth);
      }).length;

      m.todos = todos.filter((td) => {
        if (effectiveMemberId && getId(td.userId) !== effectiveMemberId) return false;
        return (td.createdAt || '').startsWith(m.yearMonth);
      }).length;

      m.meetings = meetings.filter((mt) => {
        if (effectiveMemberId && !mt.participants?.some((p) => getId(p) === effectiveMemberId)) return false;
        return (mt.date || '').startsWith(m.yearMonth);
      }).length;
    });

    return months.map((m) => ({
      month: m.label,
      tasks: m.tasks,
      todos: m.todos,
      meetings: m.meetings,
    }));
  }, [tasks, todos, meetings, effectiveMemberId]);

  // ── Revenue Chart Data (Dynamic Onboarded Budgets) ─────────
  const revenueData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('en-US', { month: 'short' });
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ label, yearMonth, revenue: 0 });
    }

    months.forEach((m) => {
      const clientsInMonth = clients.filter((c) => {
        const dateStr = c.onboardingDate || c.createdAt || '';
        return dateStr.startsWith(m.yearMonth);
      });

      m.revenue = clientsInMonth.reduce((acc, c) => {
        const num = parseFloat(String(c.budget || '').replace(/[^0-9.]/g, '')) || 0;
        return acc + num;
      }, 0);
    });

    return months.map((m) => ({
      month: m.label,
      revenue: m.revenue,
    }));
  }, [clients]);

  // ── Task / Todo Status Distribution ────────────────────────
  const taskStatusDist = useMemo(() => statusDist(filteredTasks, darkMode), [filteredTasks, darkMode]);
  const todoStatusDist = useMemo(() => statusDist(filteredTodos, darkMode), [filteredTodos, darkMode]);

  // Per-member breakdown for table
  const memberBreakdown = useMemo(() => {
    const targetUsers = effectiveMemberId
      ? users.filter((u) => getId(u) === effectiveMemberId)
      : memberUsers;

    return targetUsers.map((u) => {
      const uTasks = tasks.filter((t) => sameId(t.assignedTo, u) && (inRange(t.createdAt || '', from, to) || inRange(t.dueDate || '', from, to)));
      const uTodos = todos.filter((t) => sameId(t.userId, u) && inRange(t.createdAt || '', from, to));
      const done   = uTasks.filter((t) => t.status === 'completed').length + uTodos.filter((t) => t.status === 'completed').length;
      const total  = uTasks.length + uTodos.length;
      const rate   = total > 0 ? Math.round((done / total) * 100) : 0;
      return {
        user: u,
        tasks: uTasks.length,
        doneT: uTasks.filter(t => t.status === 'completed').length,
        todos: uTodos.length,
        doneD: uTodos.filter(t => t.status === 'completed').length,
        total,
        done,
        rate
      };
    }).sort((a, b) => b.rate - a.rate);
  }, [tasks, todos, users, memberUsers, effectiveMemberId, from, to]);

  // ── CSV Download ───────────────────────────────────────────
  const handleCSV = () => {
    const header = ['Member', 'Tasks Total', 'Tasks Done', 'Todos Total', 'Todos Done', 'Completion Rate'];
    const rows   = memberBreakdown.map((m) => [
      m.user.name, m.tasks, m.doneT, m.todos, m.doneD, `${m.rate}%`
    ]);
    const taskRows = [
      ['Title', 'Assigned To', 'Status', 'Priority', 'Due Date', 'Created'],
      ...filteredTasks.map((t) => {
        const u = users.find((u) => getId(u) === getId(t.assignedTo));
        return [t.title, u?.name || '—', t.status, t.priority, t.dueDate || '—', t.createdAt || '—'];
      }),
    ];
    const todoRows = [
      ['Title', 'Owner', 'Status', 'Priority', 'Due Date', 'Created'],
      ...filteredTodos.map((t) => {
        const u = users.find((u) => getId(u) === getId(t.userId));
        return [t.title, u?.name || '—', t.status, t.priority, t.dueDate || '—', t.createdAt || '—'];
      }),
    ];
    downloadCSV(
      [
        ['=== MEMBER SUMMARY ==='], header, ...rows,
        [], ['=== TASK DETAIL ==='], ...taskRows,
        [], ['=== TODO DETAIL ==='], ...todoRows,
      ],
      `BBC-CRM-Report-${period}-${todayStr()}.csv`
    );
    toast.success('CSV downloaded!');
  };

  // ── PDF Download ───────────────────────────────────────────
  const handlePDF = () => {
    const memberRows = memberBreakdown.map((m) => `
      <tr>
        <td><strong>${m.user.name}</strong><br><small style="color:#94a3b8">${m.user.position}</small></td>
        <td>${m.tasks} / ${m.doneT} done</td>
        <td>${m.todos} / ${m.doneD} done</td>
        <td>${m.total}</td>
        <td><strong style="color:${m.rate >= 70 ? '#16a34a' : m.rate >= 40 ? '#f59e0b' : '#dc2626'}">${m.rate}%</strong></td>
      </tr>
    `).join('');

    const statusColor = { completed:'#16a34a','in-progress':'#2563eb','sent-for-approval':'#7c3aed',pending:'#d97706' };

    const taskRows = filteredTasks.slice(0, 20).map((t) => {
      const u = users.find((u) => getId(u) === getId(t.assignedTo));
      return `
        <tr>
          <td>${t.title}</td>
          <td>${u?.name || '—'}</td>
          <td style="color:${statusColor[t.status] || '#64748b'}">${t.status}</td>
          <td>${t.priority}</td>
          <td>${t.dueDate || '—'}</td>
        </tr>
      `;
    }).join('');

    const todoRows = filteredTodos.slice(0, 40).map((t) => {
      const u = users.find((u) => getId(u) === getId(t.userId));
      return `
        <tr>
          <td>${t.title}</td>
          <td>${u?.name || '—'}</td>
          <td style="color:${statusColor[t.status] || '#64748b'}">${t.status}</td>
          <td>${t.priority}</td>
          <td>${t.dueDate || '—'}</td>
        </tr>
      `;
    }).join('');

    const filterInfo = selectedMember ? `Member: ${selectedMember.name}` : 'All Members';

    const html = `
      <h1>BBC CRM Performance Report</h1>
      <p class="sub">Period: <strong>${periodLabel}</strong> &nbsp;·&nbsp; ${filterInfo} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</p>

      <div>
        ${kpis.map((k) => `<div class="kpi"><div class="kpi-val">${k.value}</div><div class="kpi-lbl">${k.label}</div></div>`).join('')}
      </div>

      <h2>Team Performance</h2>
      <table>
        <tr><th>Member</th><th>Tasks (Done)</th><th>Todos (Done)</th><th>Total</th><th>Rate</th></tr>
        ${memberRows}
      </table>

      ${filteredTasks.length > 0 ? `
        <h2>Task Details (${filteredTasks.length} tasks)</h2>
        <table>
          <tr><th>Title</th><th>Assigned To</th><th>Status</th><th>Priority</th><th>Due Date</th></tr>
          ${taskRows}
          ${filteredTasks.length > 20 ? `<tr><td colspan="5" style="color:#94a3b8;font-style:italic">... and ${filteredTasks.length - 20} more tasks</td></tr>` : ''}
        </table>
      ` : ''}

      ${filteredTodos.length > 0 ? `
        <h2>Todo Details (${filteredTodos.length} todos)</h2>
        <table>
          <tr><th>Title</th><th>Owner</th><th>Status</th><th>Priority</th><th>Due Date</th></tr>
          ${todoRows}
          ${filteredTodos.length > 40 ? `<tr><td colspan="5" style="color:#94a3b8;font-style:italic">... and ${filteredTodos.length - 40} more todos</td></tr>` : ''}
        </table>
      ` : ''}
    `;
    printReport(html);
    toast.success('Opening PDF print dialog…');
  };

  return (
    <Page>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Reports & Analytics</h1>
          <p className="page-sub">
            {selectedMember
              ? <span>Viewing <strong className="text-slate-700 dark:text-slate-300">{selectedMember.name}'s</strong> report</span>
              : 'Agency performance overview'
            } · <span className="text-primary-500 font-medium">{periodLabel}</span>
          </p>
        </div>

        {/* Download buttons */}
        <div className="flex items-center gap-2">
          <button onClick={handleCSV} className="btn-outline btn-sm flex items-center gap-1.5">
            <FileSpreadsheet size={13} className="text-emerald-500" /> Download CSV
          </button>
          <button onClick={handlePDF} className="btn-primary btn-sm flex items-center gap-1.5">
            <FileText size={13} /> Download PDF
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        {/* Period tabs */}
        <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          {[['today','Today'],['week','This Week'],['month','This Month']].map(([v, l]) => (
            <button key={v} onClick={() => { setPeriod(v); setCustomDate(''); setShowDatePicker(false); }}
              className={cn('px-3 py-1.5 rounded-md text-[13px] font-medium transition-all',
                period === v && !customDate
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
              )}>
              {l}
            </button>
          ))}
        </div>

        {/* Member filter — admin/manager only */}
        {isManager && (
          <select
            className={cn('form-input w-[170px] text-[13px] py-1.5', memberId ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : '')}
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">All Members</option>
            {memberUsers.map((u) => <option key={getId(u)} value={getId(u)}>{u.name.split(' ')[0]}</option>)}
          </select>
        )}

        {/* Date picker */}
        <div className="relative flex items-center">
          <Calendar size={13} className="absolute left-3 text-slate-400 pointer-events-none z-10" />
          <input
            type="date"
            value={customDate}
            onChange={(e) => { setCustomDate(e.target.value); if (e.target.value) setPeriod('custom'); }}
            className={cn('form-input pl-9 pr-8 py-1.5 text-[13px] w-[165px] cursor-pointer appearance-none',
              customDate ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : ''
            )}
            style={{ colorScheme: 'light' }}
          />
          {customDate && (
            <button onClick={() => { setCustomDate(''); setPeriod('month'); }}
              className="absolute right-2 text-slate-400 hover:text-slate-600 z-10">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Active filter indicator */}
        {((isManager && memberId) || customDate) && (
          <button
            className="flex items-center gap-1 text-[12.5px] text-red-500 hover:text-red-700 font-medium border border-red-200 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/10 dark:border-red-800"
            onClick={() => { setMemberId(''); setCustomDate(''); setPeriod('month'); }}
          >
            <X size={12} /> Clear Filters
          </button>
        )}
      </div>

      {/* Member report banner */}
      {selectedMember && (
        <div className="flex items-center gap-4 p-4 mb-5 card border-l-4 border-indigo-500">
          <Avatar user={selectedMember} size="lg" showStatus />
          <div className="flex-1">
            <p className="text-[15px] font-bold text-slate-900 dark:text-white">{selectedMember.name}</p>
            <p className="text-[13px] text-slate-500">{selectedMember.position} · {selectedMember.department}</p>
            <div className="flex gap-2 mt-1">
              <Badge className={ROLE_CONFIG[selectedMember.role]?.tw}>{selectedMember.role}</Badge>
              <Badge variant="neutral">Joined {selectedMember.joinDate}</Badge>
            </div>
          </div>
          {isManager && <button onClick={() => setMemberId('')} className="btn-ghost btn-sm text-slate-400"><X size={14} /></button>}
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {kpis.map((k, i) => (
          <div key={i} className="card p-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: k.bg }}>
              <k.icon size={18} style={{ color: k.color }} />
            </div>
            <div className="text-[28px] font-bold text-slate-900 dark:text-white leading-none">{k.value}</div>
            <div className="text-[13px] text-slate-500 dark:text-slate-400 font-medium mt-1">{k.label}</div>
            <div className="text-[11.5px] text-slate-400 mt-0.5">{periodLabel}</div>
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className={cn("grid grid-cols-1 gap-4 mb-5", isManager ? "lg:grid-cols-2" : "grid-cols-1")}>
        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">6-Month Productivity Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={productivityData} margin={{ left: -20, right: 5, top: 5 }}>
              <defs>
                <linearGradient id="rT" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="tasks"    name="Tasks"    stroke="#6366f1" fill="url(#rT)" strokeWidth={2.5} dot={false} />
              <Area type="monotone" dataKey="todos"    name="Todos"    stroke="#10b981" fill="none"       strokeWidth={2}   dot={false} strokeDasharray="4 3" />
              <Area type="monotone" dataKey="meetings" name="Meetings" stroke="#f59e0b" fill="none"       strokeWidth={2}   dot={false} strokeDasharray="2 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {isManager && (
          <div className="card p-5">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">Revenue — Monthly</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueData} margin={{ left: -20, right: 5, top: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTip />} formatter={(v) => [`$${v.toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Team Performance Table ── */}
      <div className="card overflow-hidden mb-5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">
              {selectedMember ? `${selectedMember.name.split(' ')[0]}'s Performance` : 'Team Performance'}
            </h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Period: {periodLabel}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCSV} className="btn-outline btn-sm flex items-center gap-1"><FileSpreadsheet size={12} className="text-emerald-500" /> CSV</button>
            <button onClick={handlePDF} className="btn-primary btn-sm flex items-center gap-1"><FileText size={12} /> PDF</button>
          </div>
        </div>

        <table className="crm-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Tasks (Total / Done)</th>
              <th>Todos (Total / Done)</th>
              <th>Combined Total</th>
              <th>Completion Rate</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {memberBreakdown.map((m) => (
              <tr key={getId(m.user)}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <Avatar user={m.user} size="sm" showStatus />
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{m.user.name}</p>
                      <p className="text-[11.5px] text-slate-500">{m.user.position}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{m.tasks}</span>
                    <span className="text-slate-400">→</span>
                    <Badge variant="success">{m.doneT} done</Badge>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{m.todos}</span>
                    <span className="text-slate-400">→</span>
                    <Badge variant="success">{m.doneD} done</Badge>
                  </div>
                </td>
                <td className="font-bold text-slate-800 dark:text-slate-200">{m.total}</td>
                <td>
                  <div className="flex items-center gap-2 min-w-[120px]">
                    <ProgressBar
                      value={m.rate}
                      height={6}
                      className="flex-1"
                      color={m.rate >= 70 ? '#16a34a' : m.rate >= 40 ? '#f59e0b' : '#ef4444'}
                    />
                    <span className={cn('text-[12.5px] font-bold w-10 text-right',
                      m.rate >= 70 ? 'text-emerald-600' : m.rate >= 40 ? 'text-amber-600' : 'text-red-500'
                    )}>{m.rate}%</span>
                  </div>
                </td>
                <td>
                  {isManager && String(getId(m.user)) !== effectiveMemberId ? (
                    <button
                      className="btn-outline btn-xs"
                      onClick={() => setMemberId(String(getId(m.user)))}
                    >
                      View Report
                    </button>
                  ) : isManager && String(getId(m.user)) === effectiveMemberId ? (
                    <button className="btn-ghost btn-xs text-slate-400" onClick={() => setMemberId('')}>Clear</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {memberBreakdown.length === 0 && (
          <div className="py-12 text-center text-slate-400">
            <p className="text-[14px] font-medium">No data for this period</p>
            <p className="text-[12px] mt-0.5">Try a different time range</p>
          </div>
        )}
      </div>

      {/* ── Task Breakdown & Status Distribution ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">
            Task Breakdown — {periodLabel}
            {selectedMember && <span className="text-primary-500 ml-1">({selectedMember.name.split(' ')[0]})</span>}
          </h3>
          {filteredTasks.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-6 text-center">No tasks in this period</p>
          ) : (
            <div className="space-y-2.5">
              {filteredTasks.slice(0, 8).map((t) => {
                const u  = users.find((u) => getId(u) === getId(t.assignedTo));
                const sc = STATUS_CHART_COLOR[t.status]?.[darkMode ? 'dark' : 'light'] || '#94a3b8';
                return (
                  <div key={getId(t)} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc }} />
                    <span className="text-[13px] text-slate-700 dark:text-slate-300 flex-1 truncate font-medium">{t.title}</span>
                    <span className="text-[11px] text-slate-400">{t.dueDate || t.createdAt}</span>
                    <Avatar user={u} size="xs" />
                  </div>
                );
              })}
              {filteredTasks.length > 8 && (
                <p className="text-[12px] text-slate-400 text-center py-1">+{filteredTasks.length - 8} more tasks</p>
              )}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">Task Status</h3>
          {taskStatusDist.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-14 text-center">No tasks in this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={taskStatusDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                    {taskStatusDist.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {taskStatusDist.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                      <span className="text-slate-600 dark:text-slate-400">{e.name}</span>
                    </div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{e.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Todo Breakdown & Status Distribution ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">
            Todo Breakdown — {periodLabel}
            {selectedMember && <span className="text-primary-500 ml-1">({selectedMember.name.split(' ')[0]})</span>}
          </h3>
          {filteredTodos.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-6 text-center">No todos in this period</p>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {filteredTodos.map((t) => {
                const u  = users.find((u) => getId(u) === getId(t.userId));
                const sc = STATUS_CHART_COLOR[t.status]?.[darkMode ? 'dark' : 'light'] || '#94a3b8';
                return (
                  <div key={getId(t)} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc }} />
                    <span className="text-[13px] text-slate-700 dark:text-slate-300 flex-1 truncate font-medium">{t.title}</span>
                    <Badge className={PRIORITY_CONFIG[t.priority]?.tw}>{t.priority}</Badge>
                    <span className="text-[11px] text-slate-400 w-[80px] text-right">{t.dueDate || t.createdAt}</span>
                    {!effectiveMemberId && <Avatar user={u} size="xs" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">Todo Status</h3>
          {todoStatusDist.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-14 text-center">No todos in this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={todoStatusDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                    {todoStatusDist.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {todoStatusDist.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
                      <span className="text-slate-600 dark:text-slate-400">{e.name}</span>
                    </div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{e.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}