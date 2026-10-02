import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, CheckSquare, ListTodo, Video, TrendingUp, ArrowUpRight, AlertCircle, Sparkles,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import useAppStore, { sameId } from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import { StatCard, Avatar, Badge, Page } from '../components/ui';
import { PRODUCTIVITY_DATA, TASK_STATUS_DIST, REVENUE_DATA } from '../mockData';
import { MEETING_TYPE_CONFIG, canManage, cn, getId, statusDist, localDateStr } from '../utils/helpers';

// ── Greeting ─────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good morning' };
  if (h < 17) return { text: 'Good afternoon' };
  return            { text: 'Good evening' };
}


// ── Heatmap config ────────────────────────────────────────────
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW      = ['S','M','T','W','T','F','S'];
const CELL_PX  = 13;  // cell size
const CELL_GAP = 3;   // gap between cells

function heatColor(n) {
  if (!n || n <= 0) return '#e9edf2';
  if (n <= 2)  return '#c6efce';
  if (n <= 5)  return '#63c680';
  if (n <= 8)  return '#2da44e';
  return '#1a7f37';
}

// Build full-year data: real completions only
function buildYearData(year, tasks, todos) {
  const today = new Date();
  today.setHours(23, 59, 59);
  const todayStr = localDateStr(today);

  // Real data map
  const realMap = {};
  tasks.filter((t) => t.status === 'completed' && t.dueDate).forEach((t) => {
    if (!realMap[t.dueDate]) realMap[t.dueDate] = { tasks: 0, todos: 0 };
    realMap[t.dueDate].tasks++;
  });
  todos.filter((t) => t.status === 'completed' && t.createdAt).forEach((t) => {
    const ds = t.createdAt.split('T')[0];
    if (!realMap[ds]) realMap[ds] = { tasks: 0, todos: 0 };
    realMap[ds].todos++;
  });

  const months = [];
  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const firstDow    = new Date(year, m, 1).getDay();
    const cells       = Array(firstDow).fill(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const date    = new Date(year, m, d);
      const ds      = `${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isPast  = ds <= todayStr;
      const isWknd  = date.getDay() === 0 || date.getDay() === 6;
      const isToday = ds === todayStr;

      let taskCount = 0, todoCount = 0;
      if (isPast) {
        if (realMap[ds]) {
          taskCount = realMap[ds].tasks;
          todoCount = realMap[ds].todos;
        }
      }

      cells.push({
        date:    ds,
        tasks:   taskCount,
        todos:   todoCount,
        total:   taskCount + todoCount,
        isReal:  !!realMap[ds],
        isPast,
        isToday,
        label:   date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      });
    }
    months.push({ month: m, name: MONTHS[m], cells });
  }
  return months;
}

// ── Heatmap Component ─────────────────────────────────────────
function YearHeatmap({ year, tasks, todos }) {
  const wrapRef    = useRef(null);
  const tipRef     = useRef(null);
  const [hovered, setHovered] = useState(null); // { cell, x, y }

  const yearData = useMemo(() => buildYearData(year, tasks, todos), [year, tasks.length, todos.length]);

  const yearTaskTotal = yearData.reduce((a, m) => a + m.cells.filter(Boolean).reduce((b, c) => b + (c?.tasks || 0), 0), 0);
  const yearTodoTotal = yearData.reduce((a, m) => a + m.cells.filter(Boolean).reduce((b, c) => b + (c?.todos || 0), 0), 0);

  // Single persistent tooltip — no remounting, just update position + content
  const handleEnter = useCallback((e, cell) => {
    if (!cell || !cell.isPast) return;
    const wr = wrapRef.current?.getBoundingClientRect();
    const cr = e.currentTarget.getBoundingClientRect();
    setHovered({
      cell,
      x: cr.left - wr.left + CELL_PX / 2,
      y: cr.top  - wr.top,
    });
  }, []);

  const handleLeave = useCallback(() => setHovered(null), []);

  const tip = hovered;

  return (
    <div ref={wrapRef} className="relative select-none">
      {/* Year totals */}
      <div className="flex items-center gap-5 mb-5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
          <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
          <span className="text-[12.5px] font-medium text-indigo-700 dark:text-indigo-300">
            Tasks completed: <strong>{yearTaskTotal}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          <span className="text-[12.5px] font-medium text-emerald-700 dark:text-emerald-300">
            Todos completed: <strong>{yearTodoTotal}</strong>
          </span>
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <span className="text-[12.5px] font-medium text-slate-600 dark:text-slate-400">
            Total: <strong className="text-slate-800 dark:text-slate-200">{yearTaskTotal + yearTodoTotal}</strong>
          </span>
        </div>
      </div>

      {/* Grid scroll area */}
      <div className="flex overflow-x-auto pb-2" style={{ gap: 0 }}>
        {/* Day-of-week label column */}
        <div
          className="flex flex-col shrink-0 mr-2"
          style={{
            gap: CELL_GAP,
            paddingTop: 22, // align with cells (month label height)
          }}
        >
          {DOW.map((d, i) => (
            <div
              key={i}
              style={{ height: CELL_PX, lineHeight: `${CELL_PX}px`, width: 10 }}
              className="text-[9px] font-medium text-slate-400 text-right"
            >
              {i % 2 === 1 ? d : ''}
            </div>
          ))}
        </div>

        {/* Month columns */}
        {yearData.map(({ month, name, cells }) => {
          const weeks = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

          return (
            <div key={month} style={{ marginRight: 8, flexShrink: 0 }}>
              {/* Month label */}
              <div
                className="text-[10.5px] font-semibold text-slate-400 dark:text-slate-500 mb-1.5"
                style={{ height: 18, lineHeight: '18px', letterSpacing: '0.03em' }}
              >
                {name}
              </div>

              {/* Week columns */}
              <div className="flex" style={{ gap: CELL_GAP }}>
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col" style={{ gap: CELL_GAP }}>
                    {Array.from({ length: 7 }).map((_, di) => {
                      const cell = week[di] || null;
                      const bg   = cell ? heatColor(cell.total) : 'transparent';
                      const isToday = cell?.isToday;

                      return (
                        <div
                          key={di}
                          style={{
                            width:  CELL_PX,
                            height: CELL_PX,
                            background: bg,
                            borderRadius: 3,
                            flexShrink: 0,
                            cursor:  cell?.isPast ? 'pointer' : 'default',
                            transition: 'transform 0.06s ease, filter 0.06s ease',
                            boxShadow: isToday ? '0 0 0 1.5px #6366f1' : 'none',
                          }}
                          onMouseEnter={(e) => {
                            if (cell?.isPast) {
                              e.currentTarget.style.transform = 'scale(1.35)';
                              e.currentTarget.style.filter = 'brightness(0.85)';
                              handleEnter(e, cell);
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.filter = 'brightness(1)';
                            handleLeave();
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Single persistent tooltip — no flicker ── */}
      <div
        ref={tipRef}
        style={{
          position:   'absolute',
          left:       tip ? tip.x : 0,
          top:        tip ? tip.y - 104 : 0,
          transform:  'translateX(-50%)',
          opacity:    tip ? 1 : 0,
          pointerEvents: 'none',
          transition: 'opacity 0.12s ease, left 0.06s ease, top 0.06s ease',
          zIndex:     50,
          willChange: 'left, top, opacity',
        }}
      >
        {tip && (
          <div
            className="bg-slate-900 text-white rounded-xl shadow-2xl"
            style={{ minWidth: 210, padding: '10px 14px', fontSize: 12 }}
          >
            {/* Date */}
            <p className="font-semibold text-[12px] text-white mb-2.5 leading-tight">{tip.cell.label}</p>

            {tip.cell.total === 0 ? (
              <p className="text-slate-400 text-[11.5px]">No activity recorded</p>
            ) : (
              <>
                {/* Tasks row */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#818cf8', flexShrink: 0 }} />
                    <span className="text-slate-300 text-[11.5px]">Tasks completed</span>
                  </div>
                  <span className="font-bold text-indigo-300 text-[12px] ml-6">{tip.cell.tasks}</span>
                </div>

                {/* Todos row */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#34d399', flexShrink: 0 }} />
                    <span className="text-slate-300 text-[11.5px]">Todos completed</span>
                  </div>
                  <span className="font-bold text-emerald-300 text-[12px] ml-6">{tip.cell.todos}</span>
                </div>

                {/* Total */}
                <div
                  className="flex items-center justify-between pt-2"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <span className="text-slate-400 text-[11.5px]">Total activity</span>
                  <span className="font-bold text-white text-[13px]">{tip.cell.total}</span>
                </div>
              </>
            )}

            {/* Arrow */}
            <div
              style={{
                position: 'absolute',
                bottom: -5,
                left: '50%',
                transform: 'translateX(-50%) rotate(45deg)',
                width: 10, height: 10,
                background: '#0f172a',
              }}
            />
          </div>
        )}
      </div>

      {/* Legend row */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="w-2.5 h-2.5 rounded" style={{ background: '#6366f1', display: 'inline-block', outline: '1.5px solid #6366f1', outlineOffset: 1 }} />
          <span>Today</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>Less</span>
          {[0, 2, 5, 8, 10].map((n, i) => (
            <div
              key={i}
              style={{ width: 12, height: 12, background: heatColor(n), borderRadius: 3, display: 'inline-block' }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

// ── Recharts tooltip ──────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-[12px] shadow-modal">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{label}</p>
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
export default function DashboardPage() {
  const navigate = useNavigate();
    const { authUser, tasks, todos, clients, meetings, users, revenueSummary, fetchRevenueSummary, darkMode } = useAppStore(useShallow((s) => ({
    authUser: s.authUser,
    tasks:    s.tasks,
    todos:    s.todos,
    clients:  s.clients,
    meetings: s.meetings,
    users:    s.users,
    revenueSummary: s.revenueSummary,
    fetchRevenueSummary: s.fetchRevenueSummary,
    darkMode: s.darkMode,
  })));

  const role    = authUser?.role;
  const isManager = canManage(role);

  useEffect(() => {
    if (isManager) {
      fetchRevenueSummary();
    }
  }, [isManager]);

  const myTasks = role === 'member' ? tasks.filter((t) => sameId(t.assignedTo, authUser)) : tasks;
  // Was comparing with === against authUser?.id, but todo.userId is usually a
  // populated object (not a bare string) once the backend returns it — that
  // comparison silently failed for every 'member'-role user, always showing 0
  // pending todos on their dashboard regardless of how many they actually had.
  const myTodos = role === 'member' ? todos.filter((t) => sameId(t.userId, authUser)) : todos;
  const upcoming         = meetings.filter((m) => m.status === 'upcoming').slice(0, 4);
  const pendingApprovals = tasks.filter((t) => t.status === 'sent-for-approval');
  const currentYear      = new Date().getFullYear();
  const { text: greetText } = getGreeting();

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // Dynamic growth or loss percentages calculation (100% genuine mathematically correct growth)
  const getStatChange = (type) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    let currentVal = 0;
    let previousVal = 0;

    if (type === 'clients') {
      currentVal = clients.length;
      previousVal = clients.filter(c => {
        const d = c.onboardingDate ? new Date(c.onboardingDate) : null;
        return d && d < thirtyDaysAgo;
      }).length;
    } else if (type === 'tasks') {
      currentVal = myTasks.filter(t => t.status !== 'completed').length;
      previousVal = myTasks.filter(t => {
        const created = t.createdAt ? new Date(t.createdAt) : null;
        if (!created || created >= thirtyDaysAgo) return false;
        if (t.status !== 'completed') return true;
        const updated = t.updatedAt ? new Date(t.updatedAt) : null;
        return updated && updated >= thirtyDaysAgo;
      }).length;
    } else if (type === 'todos') {
      currentVal = myTodos.filter(t => t.status !== 'completed').length;
      previousVal = myTodos.filter(t => {
        const created = t.createdAt ? new Date(t.createdAt) : null;
        if (!created || created >= thirtyDaysAgo) return false;
        if (t.status !== 'completed') return true;
        const updated = t.updatedAt ? new Date(t.updatedAt) : null;
        return updated && updated >= thirtyDaysAgo;
      }).length;
    } else if (type === 'meetings') {
      // Compare meetings scheduled in current 30 days vs previous 30 days
      currentVal = meetings.filter(m => {
        const d = m.date ? new Date(m.date) : null;
        return d && d >= thirtyDaysAgo && d <= now;
      }).length;
      previousVal = meetings.filter(m => {
        const d = m.date ? new Date(m.date) : null;
        return d && d >= sixtyDaysAgo && d < thirtyDaysAgo;
      }).length;
    }

    if (previousVal === 0) {
      return currentVal > 0 ? 100 : 0;
    }

    const percent = ((currentVal - previousVal) / previousVal) * 100;
    return Math.round(percent);
  };

  const stats = [
    { icon: Users,       label: 'Total Clients',    value: clients.length,                                             change: getStatChange('clients'),  color: '#6366f1', bg: '#eef2ff', path: '/clients'  },
    { icon: CheckSquare, label: 'Active Tasks',      value: myTasks.filter((t) => t.status !== 'completed').length,    change: getStatChange('tasks'),    color: '#0ea5e9', bg: '#eff6ff', path: '/tasks'    },
    { icon: ListTodo,    label: 'Pending Todos',     value: myTodos.filter((t) => t.status !== 'completed').length,    change: getStatChange('todos'),    color: '#8b5cf6', bg: '#f5f3ff', path: '/todos'    },
    { icon: Video,       label: 'Upcoming Meetings', value: meetings.filter((m) => m.status === 'upcoming').length, change: getStatChange('meetings'), color: '#f59e0b', bg: '#fffbeb', path: '/meetings' },
  ];

  // Completely dynamic pie chart for Task Status snapshot
  const taskStatusDist = useMemo(() => statusDist(myTasks, darkMode), [myTasks, darkMode]);

  // Completely dynamic pie chart for Todo Status snapshot
  const todoStatusDist = useMemo(() => statusDist(myTodos, darkMode), [myTodos, darkMode]);

  // Active (non-completed) todos grouped by assignee
  const todosByAssignee = useMemo(() => {
    const active = todos.filter((t) => t.status !== 'completed');
    const counts = new Map();
    active.forEach((t) => {
      const owner = users.find((u) => sameId(u, t.userId));
      const key = getId(t.userId) || 'unassigned';
      const name = owner?.name || 'Unassigned';
      counts.set(key, { name, count: (counts.get(key)?.count || 0) + 1 });
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [todos, users]);

  // Completely dynamic revenue aggregates
  const dynamicRevenueData = useMemo(() => {
    if (!revenueSummary?.monthlyTrend || revenueSummary.monthlyTrend.length === 0) {
      const monthsName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const now = new Date();
      const list = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        list.push({
          month: monthsName[d.getMonth()],
          revenue: 0
        });
      }
      return list;
    }
    const monthsName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return revenueSummary.monthlyTrend.map((item) => {
      const [year, month] = item._id.split('-');
      const monthIdx = parseInt(month, 10) - 1;
      const label = monthsName[monthIdx] || item._id;
      return {
        month: label,
        revenue: item.revenue
      };
    });
  }, [revenueSummary]);

  const currentMonthRev = useMemo(() => {
    if (!revenueSummary) return 0;
    const thisMonthStr = localDateStr().slice(0, 7);
    const matched = revenueSummary.monthlyTrend?.find(m => m._id === thisMonthStr);
    return matched ? matched.revenue : (revenueSummary.totalRevenue || 0);
  }, [revenueSummary]);

  const revenueGrowth = useMemo(() => {
    if (!revenueSummary?.monthlyTrend || revenueSummary.monthlyTrend.length < 2) {
      return 0;
    }
    const trend = revenueSummary.monthlyTrend;
    const current = trend[trend.length - 1]?.revenue || 0;
    const previous = trend[trend.length - 2]?.revenue || 0;
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  }, [revenueSummary]);

  // 100% Genuine 6-Month Productivity chart grouped dynamically from live MongoDB completions
  const dynamicProductivityData = useMemo(() => {
    const monthsName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now = new Date();
    const list = [];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = monthsName[d.getMonth()];
      list.push({ label, yearMonth, tasks: 0, todos: 0, meetings: 0 });
    }
    
    tasks.filter(t => t.status === 'completed' && t.dueDate).forEach(t => {
      const ym = t.dueDate.slice(0, 7);
      const match = list.find(m => m.yearMonth === ym);
      if (match) match.tasks++;
    });
    
    todos.filter(t => t.status === 'completed' && t.createdAt).forEach(t => {
      const ym = t.createdAt.split('T')[0].slice(0, 7);
      const match = list.find(m => m.yearMonth === ym);
      if (match) match.todos++;
    });
    
    meetings.filter(m => m.status === 'completed' && m.date).forEach(m => {
      const ym = m.date.slice(0, 7);
      const match = list.find(m => m.yearMonth === ym);
      if (match) match.meetings++;
    });
    
    return list.map(item => ({
      month: item.label,
      tasks: item.tasks,
      todos: item.todos,
      meetings: item.meetings
    }));
  }, [tasks, todos, meetings]);

  return (
    <Page>
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="page-title">
          {greetText}, {authUser?.name?.split(' ')[0]}
        </h1>
        <p className="page-sub">{dateLabel}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <StatCard {...s} onClick={() => navigate(s.path)} />
          </motion.div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">6-Month Productivity</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Tasks, todos &amp; meetings completed</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dynamicProductivityData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area type="monotone" dataKey="tasks"    name="Tasks"    stroke="#6366f1" fill="url(#gT)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="todos"    name="Todos"    stroke="#10b981" fill="url(#gD)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="meetings" name="Meetings" stroke="#f59e0b" fill="none"     strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-1">Task Status</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">Current sprint snapshot</p>
          {myTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <CheckSquare size={18} className="text-slate-400" />
              </div>
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">No tasks found</p>
              <p className="text-[11.5px] text-slate-400 max-w-[160px] mt-0.5">Tasks you create will show up here</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={taskStatusDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {taskStatusDist.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
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

      {/* Todo insight row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-5">
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-1">Todo Status</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">Current daily todo snapshot</p>
          {myTodos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <ListTodo size={18} className="text-slate-400" />
              </div>
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">No todos found</p>
              <p className="text-[11.5px] text-slate-400 max-w-[160px] mt-0.5">Todos you create will show up here</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={todoStatusDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {todoStatusDist.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
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

        <div className="card p-5 lg:col-span-2">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Active Todos by Team Member</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Who is currently carrying open todos</p>
          </div>
          {todosByAssignee.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <ListTodo size={18} className="text-slate-400" />
              </div>
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">No active todos</p>
              <p className="text-[11.5px] text-slate-400 max-w-[160px] mt-0.5">Everything is completed right now</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, todosByAssignee.length * 32)}>
              <BarChart data={todosByAssignee} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Active Todos" fill={darkMode ? '#3987e5' : '#2a78d6'} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Activity Heatmap — full width, fixed tooltip ── */}
      <div className="card p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-200">
              Activity Heatmap — {currentYear}
            </h3>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5">
              Tasks <span className="text-indigo-500 font-semibold">■</span> &amp; Todos <span className="text-emerald-500 font-semibold">■</span> completed by the team · hover any day for details
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">
              <CheckSquare size={12} /> {tasks.filter((t) => t.status === 'completed').length} tasks
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
              <ListTodo size={12} /> {todos.filter((t) => t.status === 'completed').length} todos
            </div>
          </div>
        </div>

        <YearHeatmap year={currentYear} tasks={tasks} todos={todos} />
      </div>

      {/* Bottom row */}
      <div className={cn("grid grid-cols-1 gap-4", isManager ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {/* Upcoming meetings */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Upcoming Meetings</h3>
            <button
              onClick={() => navigate('/meetings')}
              className="text-[12px] text-primary-500 hover:text-primary-600 font-medium flex items-center gap-0.5"
            >
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="space-y-3">
            {upcoming.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-4 text-center">No upcoming meetings</p>
            ) : upcoming.map((m) => {
              const tc = MEETING_TYPE_CONFIG[m.type] || MEETING_TYPE_CONFIG.internal;
              return (
                <div
                  key={m._id || m.id}
                  className="flex gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors cursor-pointer"
                  onClick={() => navigate('/meetings')}
                >
                  <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ background: tc.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate">{m.title}</p>
                    <p className="text-[11.5px] text-slate-500 mt-0.5">{m.date} · {m.time}</p>
                  </div>
                  <span className="badge shrink-0" style={{ background: tc.bg, color: tc.color }}>{tc.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pending approvals */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Pending Approvals</h3>
            {pendingApprovals.length > 0 && <Badge variant="purple">{pendingApprovals.length}</Badge>}
          </div>
          {pendingApprovals.length === 0 ? (
            <div className="text-center py-6">
              <div className="flex justify-center mb-2">
                <Sparkles size={24} className="text-purple-500 animate-pulse" />
              </div>
              <p className="text-[13px] text-slate-500">All caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.slice(0, 4).map((t) => {
                const assignee = users.find((u) => sameId(u, t.assignedTo));
                return (
                  <div
                    key={t._id || t.id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/30 cursor-pointer"
                    onClick={() => navigate('/tasks')}
                  >
                    <AlertCircle size={14} className="text-purple-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Avatar user={assignee} size="xs" />
                        <span className="text-[11.5px] text-slate-500">{assignee?.name?.split(' ')[0]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Revenue */}
        {isManager && (
          <div className="card p-5">
            <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-1">Revenue Trend</h3>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4">Monthly contract revenue</p>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={dynamicRevenueData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} formatter={(v) => [`₹${v.toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <p className="text-[11.5px] text-slate-500">This month</p>
                <p className="text-[18px] font-bold text-slate-900 dark:text-white">₹{currentMonthRev.toLocaleString()}</p>
              </div>
              <div className={`flex items-center gap-1 text-[12px] font-semibold ${revenueGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                <TrendingUp size={13} className={revenueGrowth >= 0 ? '' : 'rotate-180'} /> {revenueGrowth >= 0 ? '+' : ''}{revenueGrowth}%
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}