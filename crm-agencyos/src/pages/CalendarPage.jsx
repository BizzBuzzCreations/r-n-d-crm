import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Video, CheckSquare, ListTodo, X, Calendar, Users } from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import { Page, Tabs, Avatar, Badge } from '../components/ui';
import { getCalendarDays, calEventColor, cn, canManage, getId, sameId, localDateStr } from '../utils/helpers';

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const EVENT_ICONS = {
  task:    CheckSquare,
  todo:    ListTodo,
  meeting: Video,
};

export default function CalendarPage() {
  const { authUser, tasks, todos, meetings } = useAppStore(useShallow((s) => ({
    authUser: s.authUser,
    tasks:    s.tasks,
    todos:    s.todos,
    meetings: s.meetings,
  })));
  const users = useAppStore((s) => s.users);

  const today    = new Date();
  const todayStr = localDateStr(today);
  const role     = authUser?.role;
  const isManager= canManage(role);

  const [year,     setYear]     = useState(today.getFullYear());
  const [month,    setMonth]    = useState(today.getMonth());
  const [view,     setView]     = useState('month');
  const [selected, setSelected] = useState(null);
  // Admin/manager: can pick a user to view their calendar
  const [viewUserId, setViewUserId] = useState(''); // '' = current user's own data
  // Date jump input
  const [jumpDate, setJumpDate] = useState('');

  const days = getCalendarDays(year, month);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); };
  const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelected(todayStr); };

  // Jump to a specific date
  const handleJump = (dateStr) => {
    if (!dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(dateStr);
  };

  // ── Who are we viewing? ─────────────────────────────────────
  const viewUser = isManager && viewUserId
    ? users.find((u) => getId(u) === viewUserId)
    : authUser;

  const viewingOther = isManager && viewUserId && viewUserId && viewUserId !== getId(authUser);

  // ── Role-aware data sets ─────────────────────────────────────
  const myTasks = viewUser
    ? (isManager && viewUserId ? tasks.filter((t) => sameId(t.assignedTo, viewUser)) : (role === 'member' ? tasks.filter((t) => sameId(t.assignedTo, authUser)) : tasks))
    : tasks;

  const myTodos = viewUser
    ? (isManager && viewUserId ? todos.filter((t) => sameId(t.userId, viewUser)) : (role === 'member' ? todos.filter((t) => sameId(t.userId, authUser)) : todos))
    : todos;

  // All events
  const allEvents = [
    ...myTasks.filter((t) => !!t.dueDate).map((t) => ({
      id: `task-${t.id}`, type: 'task', date: t.dueDate,
      title: t.title, status: t.status, priority: t.priority,
    })),
    ...myTodos.filter((t) => !!t.createdAt?.split('T')[0]||t.createdAt).map((t) => ({
      id: `todo-${t.id}`, type: 'todo', date: t.createdAt?.split('T')[0]||t.createdAt,
      title: t.title, status: t.status, eta: t.eta,
    })),
    ...meetings.map((m) => ({
      id: `meeting-${m.id}`, type: 'meeting', date: m.date,
      title: m.title, time: m.time, status: m.status,
    })),
  ];

  const thisMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEvents  = allEvents.filter((e) => e.date?.startsWith(thisMonthStr));
  const taskCount    = monthEvents.filter((e) => e.type === 'task').length;
  const todoCount    = monthEvents.filter((e) => e.type === 'todo').length;
  const meetCount    = monthEvents.filter((e) => e.type === 'meeting').length;

  const statusDot = (s) => ({ completed:'#10b981','in-progress':'#3b82f6','sent-for-approval':'#8b5cf6',upcoming:'#f59e0b',pending:'#94a3b8' }[s] || '#94a3b8');

  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');

  return (
    <Page>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">
            {viewingOther
              ? <span>Viewing <strong className="text-indigo-600 dark:text-indigo-400">{viewUser?.name}'s</strong> calendar</span>
              : 'Tasks, todos & meetings at a glance'
            }
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month stats */}
          <div className="hidden lg:flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400 mr-1">
            <span className="flex items-center gap-1"><CheckSquare size={12} className="text-indigo-500" /> {taskCount}</span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1"><ListTodo size={12} className="text-emerald-500" /> {todoCount}</span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1"><Video size={12} className="text-amber-500" /> {meetCount}</span>
          </div>

          {/* ── Admin/Manager: View any user's calendar ── */}
          {isManager && (
            <div className="flex items-center gap-1.5">
              <select
                className={cn('form-input w-[160px] text-[13px] py-1.5',
                  viewUserId ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : ''
                )}
                value={viewUserId}
                onChange={(e) => setViewUserId(e.target.value)}
              >
                <option value="">My Calendar</option>
                <optgroup label="── View Member ──">
                  {memberUsers.map((u) => (
                    <option key={getId(u)} value={getId(u)}>{u.name.split(' ')[0]}'s Calendar</option>
                  ))}
                </optgroup>
                <optgroup label="── All Users ──">
                  {users.filter((u) => !sameId(u, authUser)).map((u) => (
                    <option key={`all-${getId(u)}`} value={getId(u)}>{u.name}</option>
                  ))}
                </optgroup>
              </select>
              {viewUserId && (
                <button onClick={() => setViewUserId('')} className="btn-icon text-slate-400 hover:text-red-500 p-1.5" title="Back to my calendar">
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {/* Date jump */}
          <div className="relative flex items-center">
            <Calendar size={12} className="absolute left-2.5 text-slate-400 pointer-events-none z-10" />
            <input
              type="date"
              className={cn('form-input pl-8 pr-2 py-1.5 text-[12.5px] w-[150px] cursor-pointer',
                jumpDate ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20' : ''
              )}
              style={{ colorScheme: 'light' }}
              value={jumpDate}
              onChange={(e) => { setJumpDate(e.target.value); handleJump(e.target.value); }}
            />
          </div>

          <Tabs tabs={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} active={view} onChange={setView} />
        </div>
      </div>

      {/* Viewing-other banner */}
      {viewingOther && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
          <Avatar user={viewUser} size="sm" showStatus />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-indigo-800 dark:text-indigo-300">
              Viewing {viewUser?.name}'s calendar
            </p>
            <p className="text-[11.5px] text-indigo-600 dark:text-indigo-400">
              {viewUser?.position} · Showing their tasks, todos &amp; meetings
            </p>
          </div>
          <button onClick={() => setViewUserId('')} className="text-indigo-400 hover:text-indigo-600 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Month View ── */}
      {view === 'month' && (
        <div className="card overflow-hidden">
          {/* Nav */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <button onClick={prevMonth} className="btn-icon"><ChevronLeft size={16} /></button>
            <div className="text-center">
              <h2 className="text-[16px] font-bold text-slate-900 dark:text-white">{MONTHS[month]}</h2>
              <p className="text-[12px] text-slate-500">{year}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={goToday} className="btn-outline btn-sm">Today</button>
              <button onClick={nextMonth} className="btn-icon"><ChevronRight size={16} /></button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7">
            {DAYS.map((d) => (
              <div key={d} className="py-2.5 text-center text-[11.5px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                {d}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {days.map(({ date, current }, i) => {
              const dateStr   = localDateStr(date);
              const dayEvents = allEvents.filter((e) => e.date === dateStr);
              const isToday   = dateStr === todayStr;
              const isWknd    = date.getDay() === 0 || date.getDay() === 6;
              const isSel     = selected === dateStr;
              const tCount    = dayEvents.filter((e) => e.type === 'task').length;
              const dCount    = dayEvents.filter((e) => e.type === 'todo').length;
              const mCount    = dayEvents.filter((e) => e.type === 'meeting').length;

              return (
                <div
                  key={i}
                  onClick={() => setSelected(isSel ? null : dateStr)}
                  className={cn(
                    'min-h-[95px] border-b border-r border-slate-200 dark:border-slate-700 p-2 cursor-pointer transition-colors',
                    !current           && 'bg-slate-50 dark:bg-slate-900/50',
                    isWknd && current  && 'bg-blue-50/20 dark:bg-blue-900/5',
                    isSel              && 'bg-primary-50 dark:bg-primary-900/15',
                    !isSel             && 'hover:bg-slate-100 dark:hover:bg-slate-800/40',
                    i % 7 === 6        && 'border-r-0',
                  )}
                >
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold mb-1',
                    isToday ? 'bg-primary-500 text-white' : current ? 'text-slate-700 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600',
                    isSel && !isToday  && 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                  )}>
                    {date.getDate()}
                  </div>

                  {/* Event pills */}
                  <div className="space-y-[2px]">
                    {dayEvents.slice(0, 3).map((e) => {
                      const cfg  = calEventColor(e.type);
                      const Icon = EVENT_ICONS[e.type] || CheckSquare;
                      return (
                        <div key={e.id}
                          className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-[2.5px] rounded border-l-[2px] truncate"
                          style={{ background: cfg.bg, color: cfg.text, borderLeftColor: cfg.border }}
                        >
                          <Icon size={8} style={{ color: cfg.border, flexShrink: 0 }} />
                          <span className="truncate">{e.time && `${e.time} `}{e.title}</span>
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div className="text-[9.5px] text-slate-400 pl-1.5">+{dayEvents.length - 3} more</div>
                    )}
                  </div>

                  {/* Count badges */}
                  {dayEvents.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {tCount > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#eef2ff', color: '#6366f1' }}>{tCount}T</span>}
                      {dCount > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#ecfdf5', color: '#10b981' }}>{dCount}D</span>}
                      {mCount > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#fffbeb', color: '#f59e0b' }}>{mCount}M</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 flex-wrap gap-2">
            <div className="flex items-center gap-4 flex-wrap">
              {[['task','Task (due date)'],['todo','Todo (created date)'],['meeting','Meeting']].map(([type, label]) => {
                const cfg  = calEventColor(type);
                const Icon = EVENT_ICONS[type];
                return (
                  <div key={type} className="flex items-center gap-1.5 text-[11.5px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border-l-2" style={{ background: cfg.bg, borderLeftColor: cfg.border }}>
                      <Icon size={9} style={{ color: cfg.border }} />
                      <span style={{ color: cfg.text }}>{label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-400">T=Tasks · D=Todos · M=Meetings</span>
          </div>
        </div>
      )}

      {/* ── Agenda View ── */}
      {view === 'agenda' && (
        <div className="card overflow-hidden">
          {allEvents.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Calendar size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-[14px] font-semibold">No events scheduled</p>
              <p className="text-[12px] mt-1">
                {viewingOther ? `${viewUser?.name} has no tasks or todos.` : 'Add tasks, todos or meetings to see them here.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {Object.entries(
                allEvents.reduce((acc, e) => {
                  if (!acc[e.date]) acc[e.date] = [];
                  acc[e.date].push(e);
                  return acc;
                }, {})
              )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, evs]) => {
                const d        = new Date(date + 'T00:00:00');
                const isToday  = date === todayStr;
                const taskEvs  = evs.filter((e) => e.type === 'task');
                const todoEvs  = evs.filter((e) => e.type === 'todo');
                const meetEvs  = evs.filter((e) => e.type === 'meeting');
                return (
                  <div key={date} className="flex gap-5 px-5 py-4">
                    <div className="w-24 flex-shrink-0 text-right">
                      <div className={cn('text-[13px] font-bold', isToday ? 'text-primary-600' : 'text-slate-700 dark:text-slate-300')}>
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {isToday && <span className="block text-[10px] bg-primary-500 text-white px-1.5 py-0.5 rounded-full mt-0.5">Today</span>}
                      </div>
                      <div className="text-[10.5px] text-slate-400 mt-0.5">{d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric' })}</div>
                      <div className="flex justify-end gap-1 mt-1.5 flex-wrap">
                        {taskEvs.length > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#eef2ff', color: '#6366f1' }}>{taskEvs.length}T</span>}
                        {todoEvs.length > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#ecfdf5', color: '#10b981' }}>{todoEvs.length}D</span>}
                        {meetEvs.length > 0 && <span className="text-[9px] font-bold px-1 rounded" style={{ background: '#fffbeb', color: '#f59e0b' }}>{meetEvs.length}M</span>}
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      {[...meetEvs, ...taskEvs, ...todoEvs].map((e) => {
                        const cfg  = calEventColor(e.type);
                        const Icon = EVENT_ICONS[e.type] || CheckSquare;
                        return (
                          <div key={e.id} className="flex items-center gap-2.5 p-2.5 rounded-xl border-l-[3px]"
                            style={{ background: cfg.bg, borderLeftColor: cfg.border }}>
                            <Icon size={13} style={{ color: cfg.border }} className="flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate" style={{ color: cfg.text }}>{e.title}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-[10.5px] capitalize" style={{ color: cfg.border, opacity: 0.8 }}>{e.type}</span>
                                {e.status && (
                                  <span className="flex items-center gap-1 text-[10.5px]" style={{ color: cfg.text, opacity: 0.7 }}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusDot(e.status) }} />
                                    {e.status.replace(/-/g, ' ')}
                                  </span>
                                )}
                                {e.eta && <span className="text-[10.5px]" style={{ color: cfg.text, opacity: 0.6 }}>⏱ {e.eta}</span>}
                              </div>
                            </div>
                            {e.time && <span className="text-[11.5px] font-semibold flex-shrink-0" style={{ color: cfg.border }}>{e.time}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

function statusDot(s) {
  return { completed:'#10b981','in-progress':'#3b82f6','sent-for-approval':'#8b5cf6',upcoming:'#f59e0b',pending:'#94a3b8' }[s] || '#94a3b8';
}