import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Plus, Search, Grid, List, ArrowLeft, Building2, Mail, Phone,
  Globe, Calendar, Users, FileText, ChevronLeft, ChevronRight,
  CheckSquare, ListTodo, Clock, TrendingUp, Briefcase,
  Edit2, X, Save, Trash2, KeyRound, ShieldOff, ShieldCheck, Copy, RefreshCw,
} from 'lucide-react';
import { clientsAPI } from '../services/api';
import useAppStore from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import {
  Page, Button, Badge, Avatar, AvatarGroup, StatusBadge,
  ViewToggle, EmptyState, Input, Textarea, Select, Modal, ProgressBar,
  PriorityBadge, ConfirmDialog, AvatarContent } from '../components/ui';
import { cn, getId, sameId, CLIENT_STATUS_CONFIG, PAYMENT_CONFIG, canManage } from '../utils/helpers';

// ── Calendar helpers ──────────────────────────────────────────
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_MON_FIRST = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; // Mon-first like screenshot

// Build calendar grid (Mon-first)
function buildMonthGrid(year, month) {
  const firstDate = new Date(year, month, 1);
  const lastDate  = new Date(year, month + 1, 0);
  // Mon=0 offset
  let startDow = firstDate.getDay() - 1; // 0=Mon … 6=Sun
  if (startDow < 0) startDow = 6;       // Sunday -> index 6

  const grid = [];
  // leading nulls from prev month
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -(startDow - i - 1));
    grid.push({ date: d, current: false });
  }
  for (let d = 1; d <= lastDate.getDate(); d++) {
    grid.push({ date: new Date(year, month, d), current: true });
  }
  // trailing nulls
  const rem = 42 - grid.length;
  for (let i = 1; i <= rem; i++) {
    grid.push({ date: new Date(year, month + 1, i), current: false });
  }
  return grid;
}

function ds(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function fmtContractDuration(durationStr) {
  if (!durationStr) return '—';
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(durationStr);
  if (isDate) {
    return `Contract Ends: ${new Date(durationStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return `Contract: ${durationStr}`;
}

// ── Client Calendar Component ─────────────────────────────────
function ClientCalendar({ client, tasks, todos, users }) {
  const today     = new Date();
  const todayStr  = ds(today);

  const [year,     setYear]     = useState(today.getFullYear());
  const [month,    setMonth]    = useState(today.getMonth());
  const [selected, setSelected] = useState(todayStr); // default to today

  // Tasks for THIS client only, by dueDate
  const clientTasks = useMemo(
    () => tasks.filter((t) => sameId(t.clientId, client) && t.dueDate),
    [tasks, client]
  );

  // Todos for this client only, by createdAt
  const clientTodos = useMemo(
    () => todos.filter((t) => sameId(t.clientId, client) && t.createdAt),
    [todos, client]
  );

  // Build lookup: date -> { tasks[], todos[] }
  const eventMap = useMemo(() => {
    const map = {};
    clientTasks.forEach((t) => {
      if (!map[t.dueDate]) map[t.dueDate] = { tasks: [], todos: [] };
      map[t.dueDate].tasks.push(t);
    });
    clientTodos.forEach((t) => {
      const dateStr = t.createdAt?.split('T')[0] || t.createdAt;
      if (dateStr) {
        if (!map[dateStr]) map[dateStr] = { tasks: [], todos: [] };
        map[dateStr].todos.push(t);
      }
    });
    return map;
  }, [clientTasks, clientTodos]);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };
  const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelected(todayStr); };

  // Selected day data
  const selData   = selected ? (eventMap[selected] || { tasks: [], todos: [] }) : null;
  const selDate   = selected ? new Date(selected + 'T00:00:00') : null;

  // Month summary stats
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
  const monthTaskCount = clientTasks.filter(t => t.dueDate?.startsWith(monthStr)).length;
  const monthTodoCount = clientTodos.filter(t => t.createdAt?.startsWith(monthStr)).length;
  const completedCount = clientTasks.filter(t => t.dueDate?.startsWith(monthStr) && t.status === 'completed').length;

  return (
    <div className="card overflow-hidden">
      {/* ── Calendar header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <Calendar size={15} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-slate-900 dark:text-white">Client Work Calendar</h3>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Tasks &amp; team todos for {client.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Month stats */}
          <div className="hidden lg:flex items-center gap-3 text-[12px] mr-2">
            <span className="flex items-center gap-1 text-indigo-600 font-medium"><CheckSquare size={12} /> {monthTaskCount} tasks</span>
            <span className="flex items-center gap-1 text-emerald-600 font-medium"><ListTodo size={12} /> {monthTodoCount} todos</span>
            {completedCount > 0 && <span className="flex items-center gap-1 text-slate-500"><TrendingUp size={12} /> {completedCount} done</span>}
          </div>
          <button onClick={prevMonth} className="btn-icon w-8 h-8"><ChevronLeft size={16} /></button>
          <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200 min-w-[110px] text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="btn-icon w-8 h-8"><ChevronRight size={16} /></button>
          <button onClick={goToday} className="btn-outline btn-sm ml-1">Today</button>
        </div>
      </div>

      <div className="flex">
        {/* ── Left: Month grid ── */}
        <div className="flex-1 min-w-0 border-r border-slate-200 dark:border-slate-700">
          {/* Day-of-week headers (Mon first) */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
            {DOW_MON_FIRST.map((d) => (
              <div key={d} className="py-2.5 text-center text-[11.5px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                {d}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {grid.map(({ date, current }, i) => {
              const dateStr  = ds(date);
              const events   = eventMap[dateStr];
              const isToday  = dateStr === todayStr;
              const isSel    = dateStr === selected;
              const tCount   = events?.tasks.length || 0;
              const dCount   = events?.todos.length || 0;
              const hasEvents = tCount > 0 || dCount > 0;
              const lastCol  = i % 7 === 6;

              return (
                <div
                  key={i}
                  onClick={() => setSelected(dateStr)}
                  className={cn(
                    'border-b border-r border-slate-100 dark:border-slate-800 cursor-pointer transition-colors',
                    !current   && 'bg-slate-50/60 dark:bg-slate-900/40',
                    isSel      && 'bg-indigo-50 dark:bg-indigo-900/20',
                    !isSel && current && 'hover:bg-slate-100 dark:hover:bg-slate-800/40',
                    lastCol    && 'border-r-0',
                  )}
                  style={{ minHeight: 90 }}
                >
                  {/* Date number */}
                  <div className="flex items-start justify-between p-2">
                    <span className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold transition-colors',
                      isToday ? 'bg-indigo-600 text-white' : isSel ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : current ? 'text-slate-700 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600',
                    )}>
                      {date.getDate()}
                    </span>
                  </div>

                  {/* Event pills */}
                  {hasEvents && (
                    <div className="px-2 pb-2 space-y-[3px]">
                      {events?.tasks.slice(0, 2).map((t) => (
                        <div key={t.id}
                          className="text-[10px] font-medium px-1.5 py-[2px] rounded border-l-[2px] truncate text-indigo-700 dark:text-indigo-300"
                          style={{ background: '#eef2ff', borderLeftColor: '#6366f1' }}
                        >
                          {t.title}
                        </div>
                      ))}
                      {events?.todos.slice(0, tCount >= 2 ? 0 : 2 - tCount).map((t) => (
                        <div key={t.id}
                          className="text-[10px] font-medium px-1.5 py-[2px] rounded border-l-[2px] truncate text-emerald-700 dark:text-emerald-300"
                          style={{ background: '#ecfdf5', borderLeftColor: '#10b981' }}
                        >
                          {t.title}
                        </div>
                      ))}
                      {(tCount + dCount) > 2 && (
                        <div className="text-[9.5px] text-slate-400 pl-1">+{tCount + dCount - 2} more</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
            <div className="flex items-center gap-1.5 text-[11.5px] text-slate-600 dark:text-slate-400">
              <span className="w-3 h-2.5 rounded-sm" style={{ background: '#eef2ff', borderLeft: '2px solid #6366f1', display:'inline-block' }} />
              Tasks
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-slate-600 dark:text-slate-400">
              <span className="w-3 h-2.5 rounded-sm" style={{ background: '#ecfdf5', borderLeft: '2px solid #10b981', display:'inline-block' }} />
              Todos
            </div>
          </div>
        </div>

        {/* ── Right: Day detail panel ── */}
        <div className="w-[320px] flex-shrink-0 flex flex-col overflow-y-auto" style={{ maxHeight: 620 }}>
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-16">
              <Calendar size={32} className="mb-3 opacity-30" />
              <p className="text-[13.5px] font-semibold">Select a date to see work</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={selected}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex-1"
              >
                {/* Panel header */}
                <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[14px] font-bold text-slate-900 dark:text-white">
                        {selDate?.toLocaleDateString('en-US', { weekday: 'long' })}
                      </p>
                      <p className="text-[12px] text-slate-500">
                        {selDate?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        {ds(selDate) === todayStr && <span className="ml-2 badge badge-primary text-[10px]">Today</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-[18px] font-bold text-slate-900 dark:text-white leading-none">
                        {(selData?.tasks.length || 0) + (selData?.todos.length || 0)}
                      </div>
                      <div className="text-[10.5px] text-slate-400">items</div>
                    </div>
                  </div>

                  {/* Mini summary */}
                  {((selData?.tasks.length || 0) + (selData?.todos.length || 0)) > 0 && (
                    <div className="flex gap-2 mt-2">
                      {selData.tasks.length > 0 && (
                        <span className="badge badge-primary text-[10.5px]">
                          <CheckSquare size={10} /> {selData.tasks.length} task{selData.tasks.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {selData.todos.length > 0 && (
                        <span className="badge badge-success text-[10.5px]">
                          <ListTodo size={10} /> {selData.todos.length} todo{selData.todos.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Panel body */}
                <div className="p-4 space-y-4">
                  {selData?.tasks.length === 0 && selData?.todos.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-slate-400 text-center">
                      <Calendar size={28} className="mb-2 opacity-30" />
                      <p className="text-[13px] font-medium">No work scheduled</p>
                      <p className="text-[11.5px] mt-0.5 opacity-70">No tasks or todos on this date</p>
                    </div>
                  ) : (
                    <>
                      {/* Tasks section */}
                      {selData?.tasks.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2.5">
                            <CheckSquare size={13} className="text-indigo-500" />
                            <span className="text-[12px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              Tasks ({selData.tasks.length})
                            </span>
                          </div>
                          <div className="space-y-2">
                            {selData.tasks.map((t) => {
                              const assignee = users.find((u) => sameId(u, t.assignedTo));
                              return (
                                <div key={getId(t)} className="rounded-xl border border-indigo-100 dark:border-indigo-800/40 bg-indigo-50/60 dark:bg-indigo-900/10 p-3">
                                  <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 leading-snug">{t.title}</p>
                                    <StatusBadge status={t.status} />
                                  </div>
                                  {t.description && (
                                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-2 leading-relaxed line-clamp-2">{t.description}</p>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <PriorityBadge priority={t.priority} />
                                    {t.eta && <span className="text-[10.5px] text-slate-400 flex items-center gap-0.5"><Clock size={9} />{t.eta}</span>}
                                    {t.progress > 0 && (
                                      <div className="flex items-center gap-1.5 flex-1 min-w-[80px]">
                                        <ProgressBar value={t.progress} height={4} className="flex-1" />
                                        <span className="text-[10px] text-slate-400">{t.progress}%</span>
                                      </div>
                                    )}
                                  </div>
                                  {assignee && (
                                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-indigo-100 dark:border-indigo-800/30">
                                      <Avatar user={assignee} size="xs" />
                                      <span className="text-[11px] text-slate-500">{assignee.name}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Todos section */}
                      {selData?.todos.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2.5">
                            <ListTodo size={13} className="text-emerald-500" />
                            <span className="text-[12px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                              Team Todos ({selData.todos.length})
                            </span>
                          </div>
                          <div className="space-y-2">
                            {selData.todos.map((t) => {
                              const member = users.find((u) => sameId(u, t.userId));
                              return (
                                <div key={getId(t)} className="rounded-xl border border-emerald-100 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-900/10 p-3">
                                  <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 leading-snug">{t.title}</p>
                                    <StatusBadge status={t.status} />
                                  </div>
                                  {t.description && (
                                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-2 leading-relaxed line-clamp-2">{t.description}</p>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <PriorityBadge priority={t.priority} />
                                    {t.eta && <span className="text-[10.5px] text-slate-400 flex items-center gap-0.5"><Clock size={9} />{t.eta}</span>}
                                  </div>
                                  {member && (
                                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-emerald-100 dark:border-emerald-800/30">
                                      <Avatar user={member} size="xs" />
                                      <span className="text-[11px] text-slate-500">{member.name}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Edit Project Modal ────────────────────────────────────────
function EditProjectModal({ open, onClose, project, users, onSave }) {
  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const [form, setForm]           = useState({});
  const [selectedTeam, setSelectedTeam] = useState([]);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (project && open) {
      setForm({
        name:        project.name        || '',
        endDate:     project.endDate     || '',
        description: project.description || '',
        status:      project.status      || 'in-progress',
      });
      setSelectedTeam(
        (project.assignedTeam || []).map((u) => (typeof u === 'object' ? u._id : u))
      );
    }
  }, [project, open]);

  const handleToggleTeam = (id) => setSelectedTeam((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  );

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error('Project name is required'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, assignedTeam: selectedTeam });
      onClose();
      toast.success('Project updated!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Project" size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : <><Save size={14} /> Save Changes</>}
          </Button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Project Name *</label>
          <input
            className="form-input text-[14px] py-2"
            value={form.name || ''}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Status</label>
            <select
              className="form-input text-[14px] py-2"
              value={form.status || 'in-progress'}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="on-hold">On Hold</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">End Date</label>
            <input
              type="date"
              className="form-input text-[14px] py-2"
              value={form.endDate || ''}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
          <textarea
            className="form-input text-[14px] py-2 resize-none"
            rows={3}
            placeholder="Project scope and deliverables…"
            value={form.description || ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Assigned Team</label>
          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 max-h-[120px] overflow-y-auto">
            {memberUsers.map((u) => {
              const isChecked = selectedTeam.includes(u._id);
              return (
                <label key={u._id} className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-all select-none',
                  isChecked
                    ? 'border-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300'
                    : 'border-transparent bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-650 dark:text-slate-400'
                )}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleTeam(u._id)}
                    className="rounded text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                  />
                  <span className="truncate">{u.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Client Modal ─────────────────────────────────────────
const DEFAULT_INDUSTRIES = ['Technology','Retail','Marketing','Finance','Healthcare','Education','Real Estate','Other'];

function EditClientModal({ open, onClose, client, users, services = [], industries = DEFAULT_INDUSTRIES, onSave }) {
  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const [form, setForm]                   = useState({});
  const [selectedServices, setSelectedServices] = useState([]);
  const [clientTeam,       setClientTeam]       = useState([]);
  const [clientTeamSearch, setClientTeamSearch] = useState('');
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    if (client && open) {
      setForm({
        name:             client.name             || '',
        contact:          client.contact          || '',
        email:            client.email            || '',
        phone:            client.phone            || '',
        website:          client.website          || '',
        industry:         client.industry         || '',
        contractDuration: client.contractDuration || '',
        address:          client.address          || '',
        status:           client.status           || 'active',
        paymentStatus:    client.paymentStatus    || 'pending',
      });
      setSelectedServices(client.services || []);
      setClientTeam((client.assignedTeam || []).map((m) => typeof m === 'object' ? String(m._id) : String(m)));
      setClientTeamSearch('');
    }
  }, [client, open]);

  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleToggleService = (name) => setSelectedServices((prev) =>
    prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
  );

  const handleToggleClientTeam = (id) => setClientTeam((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  );

  const handleSave = async () => {
    if (!form.name?.trim())    { toast.error('Company name is required'); return; }
    if (!form.contact?.trim()) { toast.error('Contact person is required'); return; }
    if (selectedServices.length === 0) { toast.error('Select at least one service'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, services: selectedServices, assignedTeam: clientTeam });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'form-input text-[14px] py-2';
  const labelCls = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

  return (
    <Modal open={open} onClose={onClose} title="Edit Client" size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : <><Save size={14} /> Save Changes</>}
          </Button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company Name *</label>
            <input className={inputCls} value={form.name || ''} onChange={(e) => field('name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Contact Person *</label>
            <input className={inputCls} value={form.contact || ''} onChange={(e) => field('contact', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" className={inputCls} value={form.email || ''} onChange={(e) => field('email', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} value={form.phone || ''} onChange={(e) => field('phone', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Website</label>
            <input className={inputCls} value={form.website || ''} onChange={(e) => field('website', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <select className={inputCls} value={form.industry || ''} onChange={(e) => field('industry', e.target.value)}>
              <option value="">Select industry…</option>
              {industries.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={labelCls}>Contract End Date</label>
            <input type="date" className={inputCls} value={form.contractDuration || ''} onChange={(e) => field('contractDuration', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={form.status || 'active'} onChange={(e) => field('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="on-hold">On Hold</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Payment Status</label>
            <select className={inputCls} value={form.paymentStatus || 'pending'} onChange={(e) => field('paymentStatus', e.target.value)}>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Office Address</label>
          <input className={inputCls} placeholder="123 Main St, City, State" value={form.address || ''} onChange={(e) => field('address', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Services *</label>
          {services.length === 0 ? (
            <p className="text-[12px] text-slate-450 dark:text-slate-500 italic">No services in database. Add them via Settings → Services.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 max-h-[130px] overflow-y-auto">
              {services.map((sv) => {
                const isChecked = selectedServices.includes(sv.name);
                return (
                  <label key={sv._id} className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-all select-none',
                    isChecked
                      ? 'border-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300'
                      : 'border-transparent bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-650 dark:text-slate-400'
                  )}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleService(sv.name)}
                      className="rounded text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                    />
                    <span className="truncate">{sv.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls}>Assign Team Members</label>
            <div className="relative w-44">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-450 pointer-events-none" />
              <input
                type="text"
                placeholder="Search member…"
                value={clientTeamSearch}
                onChange={(e) => setClientTeamSearch(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2 py-1 text-[11.5px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-slate-700 dark:text-slate-300 transition-colors"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 min-h-[40px] max-h-[120px] overflow-y-auto p-1.5 border border-slate-200 dark:border-slate-700/50 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
            {memberUsers
              .filter((u) =>
                !clientTeamSearch ||
                u.name?.toLowerCase().includes(clientTeamSearch.toLowerCase()) ||
                u.position?.toLowerCase().includes(clientTeamSearch.toLowerCase())
              )
              .map((u) => {
                const uid = getId(u);
                const selected = clientTeam.includes(uid);
                return (
                  <button key={uid} type="button" onClick={() => handleToggleClientTeam(uid)}
                    className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[12.5px] font-medium transition-all',
                      selected
                        ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                        : 'border-transparent bg-slate-100 dark:bg-slate-800/40 text-slate-650 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    )}>
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden"
                      style={{ background: u.avatar ? 'transparent' : (u.color || '#6366f1') }}>
                      <AvatarContent user={u} fallback={u.initials || u.name?.[0]} />
                    </div>
                    {u.name.split(' ')[0]}
                  </button>
                );
              })}
            {memberUsers.filter((u) =>
              !clientTeamSearch ||
              u.name?.toLowerCase().includes(clientTeamSearch.toLowerCase()) ||
              u.position?.toLowerCase().includes(clientTeamSearch.toLowerCase())
            ).length === 0 && (
              <p className="text-[11.5px] text-slate-400 dark:text-slate-500 py-1.5 px-2">No members found</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Portal Access Card ────────────────────────────────────────
// Lets admins see the portal login email, reset the password,
// and understand that inactive status blocks login.
function PortalAccessCard({ client, role }) {
  const [newPwd,   setNewPwd]   = useState('');
  const [result,   setResult]   = useState(null);   // { email, newPassword, emailSent }
  const [saving,   setSaving]   = useState(false);
  const [copied,   setCopied]   = useState(false);

  const isInactive  = client.status === 'inactive';
  const portalEmail = client.email;
  const isAdmin     = role === 'admin';

  const handleReset = async () => {
    if (saving) return;
    setSaving(true);
    setResult(null);
    try {
      const { data } = await clientsAPI.resetPortalPassword(getId(client), newPwd.trim() || undefined);
      setResult(data);
      setNewPwd('');
      toast.success('Portal password reset successfully');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset portal password');
    } finally {
      setSaving(false);
    }
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!portalEmail) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={15} className="text-slate-400" />
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Portal Access</h3>
        </div>
        <p className="text-[13px] text-slate-400 italic">No email on file — portal account cannot be created.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-slate-400" />
          <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Portal Access</h3>
        </div>
        {isInactive ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 rounded-full">
            <ShieldOff size={11} /> Login Blocked
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
            <ShieldCheck size={11} /> Active
          </span>
        )}
      </div>

      {/* Login email */}
      <div className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-700/50 mb-3">
        <Mail size={13} className="text-slate-400 flex-shrink-0" />
        <span className="text-[13px] text-slate-500 min-w-[80px]">Login email</span>
        <span className="text-[13.5px] font-medium text-slate-800 dark:text-slate-200 truncate">{portalEmail}</span>
      </div>

      {isInactive && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-[12px] rounded-lg px-3 py-2 mb-3">
          Client status is <strong>inactive</strong> — the portal user cannot log in until the status is changed back to <em>active</em>.
        </div>
      )}

      {/* Result panel after successful reset */}
      {result && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 mb-3">
          <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">Password reset — share with client:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[13px] font-mono bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-slate-800 dark:text-slate-200 select-all">
              {result.newPassword}
            </code>
            <button
              onClick={() => copy(result.newPassword)}
              className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Copy size={11} />{copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {result.emailSent
            ? <p className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-1.5">Email with new credentials sent to {result.email}</p>
            : <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Email could not be sent — share the password manually.</p>
          }
        </div>
      )}

      {/* Reset form (admin only) */}
      {isAdmin && (
        <div className="space-y-2">
          <p className="text-[11.5px] text-slate-400">Leave blank to auto-generate a secure password.</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="New password (optional)"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="form-input text-[13px] py-1.5 flex-1"
            />
            <button
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white transition-colors flex-shrink-0"
            >
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <KeyRound size={12} />}
              {saving ? 'Resetting…' : 'Reset Password'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Detail Drawer ─────────────────────────────────────
const PROJECT_STATUS = {
  'in-progress': { label: 'In Progress', bg: 'bg-amber-100 dark:bg-amber-900/30',   text: 'text-amber-700 dark:text-amber-400',   dot: 'bg-amber-400' },
  'completed':   { label: 'Completed',   bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  'on-hold':     { label: 'On Hold',     bg: 'bg-slate-100 dark:bg-slate-700',       text: 'text-slate-600 dark:text-slate-400',    dot: 'bg-slate-400' },
};

function ProjectDetailDrawer({ project, users, onClose, onEdit, onDelete, canEdit }) {
  const projTeam = users.filter((u) =>
    project.assignedTeam?.some((tm) => sameId(tm, u))
  );

  const sc = PROJECT_STATUS[project.status] || PROJECT_STATUS['in-progress'];

  const fmtDate = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—';

  const fmtCreated = (d) => d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <AnimatePresence>
      <div key="backdrop" className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40" onClick={onClose} />
      <motion.div
        key="drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        className="fixed right-0 top-0 bottom-0 w-[460px] max-w-[95vw] bg-white dark:bg-slate-800 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-700"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                <Briefcase size={13} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <span className="text-[10.5px] font-bold uppercase tracking-widest text-indigo-500">Project</span>
            </div>
            <h2 className="text-[19px] font-bold text-slate-900 dark:text-white leading-tight">{project.name}</h2>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canEdit && (
              <button
                onClick={onEdit}
                className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
                title="Edit project"
              >
                <Edit2 size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Status strip ── */}
        <div className="flex items-center gap-2.5 px-6 py-3.5 border-b border-slate-100 dark:border-slate-700/50 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold', sc.bg, sc.text)}>
            <span className={cn('w-2 h-2 rounded-full', sc.dot)} />
            {sc.label}
          </span>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">

            {/* Description */}
            {project.description && (
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-2">Description</p>
                <p className="text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed">{project.description}</p>
              </div>
            )}

            {/* Key details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Deadline</p>
                <div className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">
                  <Calendar size={13} className="text-indigo-400 flex-shrink-0" />
                  {fmtDate(project.endDate)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Created</p>
                <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{fmtCreated(project.createdAt)}</p>
              </div>
            </div>

            {/* Team */}
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                Assigned Team · {projTeam.length} {projTeam.length === 1 ? 'member' : 'members'}
              </p>
              {projTeam.length === 0 ? (
                <p className="text-[13px] text-slate-400 italic">No team members assigned yet</p>
              ) : (
                <div className="space-y-2">
                  {projTeam.map((u) => (
                    <div key={getId(u)} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-700/50">
                      <Avatar user={u} size="sm" showStatus />
                      <div>
                        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">{u.name}</p>
                        <p className="text-[12px] text-slate-400">{u.position}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer: delete ── */}
        {canEdit && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={onDelete}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 dark:border-red-900/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-[13px] font-semibold transition-all"
            >
              <Trash2 size={14} /> Delete Project
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ── Add Client Modal ──────────────────────────────────────────
function AddClientModal({ open, onClose, users, services = [], industries = DEFAULT_INDUSTRIES, onSave }) {
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm({
    defaultValues: { status: 'active', paymentStatus: 'pending', contractDuration: '' },
  });

  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const [selectedServices, setSelectedServices] = useState([]);
  const [clientTeam,       setClientTeam]       = useState([]);
  const [clientTeamSearch, setClientTeamSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState([]);
  const [createInitialProject, setCreateInitialProject] = useState(false);

  const handleToggleService = (name) => {
    setSelectedServices((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  };

  const handleToggleClientTeam = (id) => {
    setClientTeam((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleToggleTeam = (id) => {
    setSelectedTeam((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const onSubmit = (data) => {
    if (selectedServices.length === 0) {
      toast.error('Please select at least one service');
      return;
    }
    if (createInitialProject) {
      if (!data.projectName?.trim()) {
        toast.error('Project Name is required');
        return;
      }
      if (!data.projectEndDate) {
        toast.error('Project End Date is required');
        return;
      }
    }
    const newClient = {
      ...data,
      assignedTeam:  clientTeam,
      services:      selectedServices,
      onboardingDate: data.onboardingDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      projectCount:  createInitialProject ? 1 : 0,
      notes:         [],
      // Project fields:
      createInitialProject,
      projectName: createInitialProject ? data.projectName : undefined,
      projectDesc: createInitialProject ? data.projectDesc : undefined,
      projectEndDate: createInitialProject ? data.projectEndDate : undefined,
      projectAssignedTeam: createInitialProject ? selectedTeam : [],
    };
    onSave(newClient);
    setSelectedServices([]);
    setClientTeam([]);
    setClientTeamSearch('');
    setSelectedTeam([]);
    setCreateInitialProject(false);
    reset();
  };

  return (
    <Modal
      open={open}
      onClose={() => { setSelectedServices([]); setSelectedTeam([]); setCreateInitialProject(false); reset(); onClose(); }}
      title="Add New Client"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => { setSelectedServices([]); setSelectedTeam([]); setCreateInitialProject(false); reset(); onClose(); }}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit(onSubmit)}>
            <Plus size={14} /> Add Client
          </Button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Company Name *"
            placeholder="e.g. TechCorp Inc."
            error={errors.name?.message}
            {...register('name', { required: 'Company name is required' })}
          />
          <Input
            label="Contact Person *"
            placeholder="e.g. David Mitchell"
            error={errors.contact?.message}
            {...register('contact', { required: 'Contact name is required' })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" type="email" placeholder="client@company.com" {...register('email')} />
          <Input label="Phone" placeholder="+1 (555) 000-0000" {...register('phone')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Website" placeholder="www.company.com" {...register('website')} />
          <Select label="Industry" {...register('industry')}>
            <option value="">Select industry…</option>
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Input
            label="Contract End Date *"
            type="date"
            error={errors.contractDuration?.message}
            {...register('contractDuration', { required: 'Contract end date is required' })}
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Select Services *
          </label>
          {services.length === 0 ? (
            <p className="text-[12px] text-slate-450 dark:text-slate-500 italic">
              No services found in database. Please go to Settings &gt; Services to add services.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 max-h-[135px] overflow-y-auto">
              {services.map((sv) => {
                const isChecked = selectedServices.includes(sv.name);
                return (
                  <label
                    key={sv._id}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-all select-none",
                      isChecked
                        ? "border-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300"
                        : "border-transparent bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-650 dark:text-slate-400"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleService(sv.name)}
                      className="rounded text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                    />
                    <span className="truncate">{sv.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <Input label="Office Address" placeholder="123 Main St, City, State" {...register('address')} />

        <div className="grid grid-cols-2 gap-4">
          <Select label="Status" {...register('status')}>
            <option value="active">Active</option>
            <option value="on-hold">On Hold</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select label="Payment Status" {...register('paymentStatus')}>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[12.5px] font-semibold text-slate-750 dark:text-slate-350">Assign Team Members</label>
            <div className="relative w-44">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-450 pointer-events-none" />
              <input
                type="text"
                placeholder="Search member…"
                value={clientTeamSearch}
                onChange={(e) => setClientTeamSearch(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2 py-1 text-[11.5px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-slate-700 dark:text-slate-300 transition-colors"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 min-h-[40px] max-h-[120px] overflow-y-auto p-1.5 border border-slate-200 dark:border-slate-700/50 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
            {memberUsers
              .filter((u) =>
                !clientTeamSearch ||
                u.name?.toLowerCase().includes(clientTeamSearch.toLowerCase()) ||
                u.position?.toLowerCase().includes(clientTeamSearch.toLowerCase())
              )
              .map((u) => {
                const uid = getId(u);
                const selected = clientTeam.includes(uid);
                return (
                  <button key={uid} type="button" onClick={() => handleToggleClientTeam(uid)}
                    className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[12.5px] font-medium transition-all',
                      selected
                        ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                        : 'border-transparent bg-slate-100 dark:bg-slate-800/40 text-slate-650 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    )}>
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden"
                      style={{ background: u.avatar ? 'transparent' : (u.color || '#6366f1') }}>
                      <AvatarContent user={u} fallback={u.initials || u.name?.[0]} />
                    </div>
                    {u.name.split(' ')[0]}
                  </button>
                );
              })}
            {memberUsers.filter((u) =>
              !clientTeamSearch ||
              u.name?.toLowerCase().includes(clientTeamSearch.toLowerCase()) ||
              u.position?.toLowerCase().includes(clientTeamSearch.toLowerCase())
            ).length === 0 && (
              <p className="text-[11.5px] text-slate-400 dark:text-slate-500 py-1.5 px-2">No members found</p>
            )}
          </div>
        </div>

        {/* ── Create Initial Project Section ── */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
          <label className="flex items-center gap-2 px-1 py-0.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={createInitialProject}
              onChange={(e) => setCreateInitialProject(e.target.checked)}
              className="rounded text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
            <span className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200">
              Create Initial Project for this Client
            </span>
          </label>
          
          {createInitialProject && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-4 border border-indigo-100 dark:border-indigo-950 bg-indigo-50/20 dark:bg-indigo-950/10 rounded-xl p-4"
            >
              <div className="grid grid-cols-1 gap-4">
                <Input
                  label="Project Name *"
                  placeholder="e.g. Website Redesign"
                  {...register('projectName')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Project End Date *"
                  type="date"
                  {...register('projectEndDate')}
                />
              </div>

              <Textarea
                label="Project Description"
                placeholder="Describe the initial project deliverables..."
                rows={3}
                {...register('projectDesc')}
              />

              <div>
                <label className="block text-[12.5px] font-semibold text-slate-750 dark:text-slate-350 mb-2">
                  Assign Project Team Members
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 max-h-[120px] overflow-y-auto">
                  {memberUsers.map((u) => {
                    const isChecked = selectedTeam.includes(u._id);
                    return (
                      <label
                        key={u._id}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-all select-none",
                          isChecked
                            ? "border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300"
                            : "border-transparent bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-650 dark:text-slate-400"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTeam(u._id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                        />
                        <span className="truncate">{u.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Add Project Modal ──────────────────────────────────────────
function AddProjectModal({ open, onClose, users, onSave, clientId }) {
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm({
    defaultValues: { status: 'in-progress' },
  });

  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const [selectedTeam, setSelectedTeam] = useState([]);

  const handleToggleTeam = (id) => {
    setSelectedTeam((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const onSubmit = (data) => {
    onSave({
      ...data,
      clientId,
      assignedTeam: selectedTeam,
    });
    setSelectedTeam([]);
    reset();
  };

  return (
    <Modal
      open={open}
      onClose={() => { setSelectedTeam([]); reset(); onClose(); }}
      title="Add New Project"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => { setSelectedTeam([]); reset(); onClose(); }}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit(onSubmit)}>
            <Plus size={14} /> Add Project
          </Button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <Input
          label="Project Name *"
          placeholder="e.g. Brand Refresh"
          error={errors.name?.message}
          {...register('name', { required: 'Project name is required' })}
        />
        
        <div className="grid grid-cols-1 gap-4">
          <Input
            label="End Date *"
            type="date"
            error={errors.endDate?.message}
            {...register('endDate', { required: 'End date is required' })}
          />
        </div>

        <Textarea
          label="Description"
          placeholder="Enter project details and scope..."
          rows={4}
          {...register('description')}
        />

        <div>
          <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">
            Assign Team Members
          </label>
          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 max-h-[120px] overflow-y-auto">
            {memberUsers.map((u) => {
              const isChecked = selectedTeam.includes(u._id);
              return (
                <label
                  key={u._id}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-all select-none",
                    isChecked
                      ? "border-primary-500/30 bg-primary-50/50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300"
                      : "border-transparent bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-650 dark:text-slate-400"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleTeam(u._id)}
                    className="rounded text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                  />
                  <span className="truncate">{u.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Main ClientsPage ──────────────────────────────────────────
export default function ClientsPage() {
  const { authUser, clients, tasks, todos, addClientNote, addClient, deleteClient, projects, addProject, deleteProject, updateProject, updateClient } = useAppStore(useShallow((s) => ({
    authUser:       s.authUser,
    clients:        s.clients,
    tasks:          s.tasks,
    todos:          s.todos,
    addClientNote:  s.addClientNote,
    addClient:      s.addClient,
    deleteClient:   s.deleteClient,
    projects:       s.projects,
    addProject:     s.addProject,
    deleteProject:  s.deleteProject,
    updateProject:  s.updateProject,
    updateClient:   s.updateClient,
  })));
  const users          = useAppStore((s) => s.users);
  const services       = useAppStore((s) => s.services);
  const systemSettings = useAppStore((s) => s.systemSettings);
  const industries     = systemSettings?.industries?.length ? systemSettings.industries : DEFAULT_INDUSTRIES;

  const [view,     setView]     = useState('grid');
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [showNote,      setShowNote]      = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showEditProject, setShowEditProject] = useState(null);
  const [showEditClient, setShowEditClient] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(null);
  const [confirmDeleteClient,  setConfirmDeleteClient]  = useState(null);
  const [deletingClient,       setDeletingClient]       = useState(false);
  const role = authUser?.role;

  const handleDeleteClient = async () => {
    if (!confirmDeleteClient || deletingClient) return;
    setDeletingClient(true);
    try {
      await deleteClient(getId(confirmDeleteClient));
      setConfirmDeleteClient(null);
      setSelected(null);
    } catch {} finally {
      setDeletingClient(false);
    }
  };

  const filtered = clients.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.contact.toLowerCase().includes(search.toLowerCase())
  );

  const payVariant = (s) => ({ paid: 'success', pending: 'warning', overdue: 'danger' }[s] || 'neutral');

  // ── Client Detail View ────────────────────────────────────────
  if (selected) {
    const client  = clients.find((c) => sameId(c, selected)) || selected;
    const team    = users.filter((u) => client.assignedTeam?.some((tm) => sameId(tm, u)));
    const cTasks  = tasks.filter((t) => sameId(t.clientId, client));
    // Todos for this client specifically
    const cTodos  = todos.filter((t) => sameId(t.clientId, client));
    // Projects for this client
    const cProjects = projects.filter((p) => sameId(p.clientId, client));

    return (
      <Page>
        {/* Back */}
        <button className="btn-outline btn-sm mb-5" onClick={() => setSelected(null)}>
          <ArrowLeft size={13} /> Back to Clients
        </button>

        {/* Hero */}
        <div className="rounded-2xl p-7 mb-5 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute w-64 h-64 rounded-full bg-indigo-600/15 blur-3xl top-0 right-0" />
          </div>
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold mb-1">{client.name}</h1>
              <p className="text-slate-400 text-[14px]">{client.industry} · {client.contact}</p>
              <div className="flex gap-2 mt-3">
                <span className="badge badge-success text-[11px]">{client.status}</span>
                <span className={cn('badge text-[11px]', `badge-${payVariant(client.paymentStatus)}`)}>{client.paymentStatus}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="text-slate-400 text-[12.5px] font-medium">{fmtContractDuration(client.contractDuration)}</div>
              </div>
              {canManage(role) && (
                <div className="flex items-center gap-2">
                {role === 'admin' && (
                  <button
                    onClick={() => setConfirmDeleteClient(client)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-300 hover:text-red-200 text-[12px] font-medium transition-all backdrop-blur-sm border border-red-500/30"
                  >
                    <Trash2 size={12} /> Delete Client
                  </button>
                )}
                <button
                  onClick={() => setShowEditClient(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-[12px] font-medium transition-all backdrop-blur-sm border border-white/10"
                >
                  <Edit2 size={12} /> Edit Client
                </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="relative flex gap-6 mt-5 pt-5 border-t border-white/10 flex-wrap">
            {[
              { icon: CheckSquare, label: 'Total Tasks',   value: cTasks.length,                                          color: '#818cf8' },
              { icon: CheckSquare, label: 'Completed',     value: cTasks.filter(t => t.status === 'completed').length,    color: '#34d399' },
              { icon: CheckSquare, label: 'In Progress',   value: cTasks.filter(t => t.status === 'in-progress').length,  color: '#fbbf24' },
              { icon: ListTodo,    label: 'Team Todos',    value: cTodos.length,                                          color: '#a78bfa' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label}>
                <div className="text-[22px] font-bold" style={{ color }}>{value}</div>
                <div className="text-[11.5px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>


        {/* ── Overview ── */}
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Contact info */}
              <div className="card p-5">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-4">Contact Information</h3>
                {[
                  [Mail,      'Email',      client.email],
                  [Phone,     'Phone',      client.phone],
                  [Globe,     'Website',    client.website],
                  [Building2, 'Industry',   client.industry],
                  [Calendar,  'Onboarding', client.onboardingDate],
                  [FileText,  'Contract',   fmtContractDuration(client.contractDuration)],
                ].map(([Icon, label, val]) => (
                  <div key={label} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                    <Icon size={14} className="text-slate-400 flex-shrink-0" />
                    <span className="text-[13px] text-slate-500 min-w-[100px]">{label}</span>
                    <span className="text-[13.5px] font-medium text-slate-800 dark:text-slate-200">{val || '—'}</span>
                  </div>
                ))}
                <div className="mt-4">
                  <p className="text-[13px] text-slate-500 mb-2">Services</p>
                  <div className="flex gap-2 flex-wrap">
                    {client.services.map((s) => <Badge key={s} variant="primary">{s}</Badge>)}
                  </div>
                </div>
              </div>

              {/* Team + Tasks */}
              <div className="space-y-4">
                <div className="card p-5">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-3">Assigned Team ({team.length})</h3>
                  <div className="space-y-2.5">
                    {team.map((u) => (
                      <div key={getId(u)} className="flex items-center gap-3">
                        <Avatar user={u} size="md" showStatus />
                        <div>
                          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">{u.name}</p>
                          <p className="text-[12px] text-slate-500">{u.position}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-3">Active Tasks ({cTasks.length})</h3>
                  <div className="space-y-2">
                    {cTasks.slice(0, 5).map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-slate-700 dark:text-slate-300 truncate flex-1">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </div>
                    ))}
                    {cTasks.length === 0 && <p className="text-[13px] text-slate-400">No active tasks</p>}
                  </div>
                </div>
                <div className="card p-5">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 mb-3">Client Todos ({cTodos.length})</h3>
                  <div className="space-y-2">
                    {cTodos.slice(0, 5).map((td) => (
                      <div key={getId(td)} className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-slate-700 dark:text-slate-300 truncate flex-1">{td.title}</span>
                        <StatusBadge status={td.status} />
                      </div>
                    ))}
                    {cTodos.length === 0 && <p className="text-[13px] text-slate-400">No todos</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* Portal Access — admin only */}
            {(role === 'admin') && (
              <div className="mb-4">
                <PortalAccessCard client={client} role={role} />
              </div>
            )}

            {/* Projects Card */}
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                    <Briefcase size={15} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-200">Projects ({cProjects.length})</h3>
                    <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Manage client deliverables &amp; assignments</p>
                  </div>
                </div>
                {canManage(role) && (
                  <Button variant="primary" size="sm" onClick={() => setShowAddProject(true)}>
                    <Plus size={13} /> New Project
                  </Button>
                )}
              </div>

              {cProjects.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-slate-400 text-center">
                  <Briefcase size={28} className="mb-2 opacity-30" />
                  <p className="text-[13px] font-medium">No projects found</p>
                  <p className="text-[11.5px] mt-0.5 opacity-70">Add a project to get started</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cProjects.map((p) => {
                    const projTeam = users.filter((u) => p.assignedTeam?.some((tm) => sameId(tm, u)));
                    const formattedEndDate = p.endDate ? new Date(p.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                    return (
                      <div
                        key={p._id}
                        onClick={() => setSelectedProject(p)}
                        className="relative rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 p-4 hover:border-indigo-500/30 hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h4 className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100 leading-snug">{p.name}</h4>
                            <Badge variant={p.status === 'completed' ? 'success' : p.status === 'in-progress' ? 'warning' : 'neutral'}>
                              {p.status}
                            </Badge>
                          </div>
                          {p.description && (
                            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed line-clamp-2">{p.description}</p>
                          )}
                        </div>
                        
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between flex-wrap gap-2">
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Deadline</span>
                            <div className="flex items-center gap-2 text-[11.5px] font-medium text-slate-700 dark:text-slate-350">
                              <span className="flex items-center gap-0.5"><Calendar size={11} className="text-slate-400" /> {formattedEndDate}</span>
                            </div>
                          </div>
                          
                          <div>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1 text-right">Team</span>
                            <AvatarGroup users={projTeam} max={3} size="xs" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Notes Timeline</h3>
                {canManage(role) && (
                  <Button variant="primary" size="sm" onClick={() => setShowNote(true)}>
                    <Plus size={13} /> Add Note
                  </Button>
                )}
              </div>
              {client.notes.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-4 text-center">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {client.notes.map((n) => (
                    <div key={n.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-semibold text-primary-600">{n.author}</span>
                        <span className="text-[11.5px] text-slate-400">{n.date}</span>
                      </div>
                      <p className="text-[13.5px] text-slate-700 dark:text-slate-300">{n.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          {/* ── Client Work Calendar (always visible at bottom) ── */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-indigo-500" />
              <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-200">Work Calendar</h2>
              <span className="text-[12px] text-slate-500 dark:text-slate-400">— tasks &amp; todos for this client</span>
            </div>
            <ClientCalendar
              client={client}
              tasks={tasks}
              todos={todos}
              users={users}
            />
          </div>
        </>

        {/* Add Note Modal */}
        <Modal open={showNote} onClose={() => { setShowNote(false); setNoteText(''); }} title="Add Note"
          footer={
            <>
              <Button variant="outline" onClick={() => setShowNote(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => {
                if (!noteText.trim()) return;
                addClientNote(getId(client), noteText);
                setShowNote(false);
                setNoteText('');
                toast.success('Note added!');
              }}>Save Note</Button>
            </>
          }
        >
          <div className="px-6 py-5">
            <Textarea label="Note" placeholder="Write your note here..." value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} />
          </div>
        </Modal>

        {/* Add Project Modal */}
        <AddProjectModal
          open={showAddProject}
          onClose={() => setShowAddProject(false)}
          users={users}
          clientId={getId(client)}
          onSave={(data) => {
            addProject(data)
              .then(() => {
                setShowAddProject(false);
                toast.success('Project added successfully!');
              })
              .catch((err) => {
                toast.error(err.response?.data?.message || 'Failed to add project');
              });
          }}
        />

        {/* Project Detail Drawer */}
        {selectedProject && (
          <ProjectDetailDrawer
            project={selectedProject}
            users={users}
            canEdit={canManage(role)}
            onClose={() => setSelectedProject(null)}
            onEdit={() => {
              setShowEditProject(selectedProject);
              setSelectedProject(null);
            }}
            onDelete={() => {
              setConfirmDeleteProject(selectedProject);
              setSelectedProject(null);
            }}
          />
        )}

        {/* Edit Project Modal */}
        <EditProjectModal
          open={!!showEditProject}
          onClose={() => setShowEditProject(null)}
          project={showEditProject}
          users={users}
          onSave={(data) => updateProject(showEditProject._id, data)}
        />

        {/* Edit Client Modal */}
        <EditClientModal
          open={showEditClient}
          onClose={() => setShowEditClient(false)}
          client={client}
          users={users}
          services={services}
          industries={industries}
          onSave={async (data) => {
            await updateClient(getId(client), data);
            toast.success('Client updated!');
          }}
        />

        {/* Confirm Delete Project Dialog */}
        <ConfirmDialog
          open={!!confirmDeleteProject}
          title="Delete Project"
          message={`Are you sure you want to delete "${confirmDeleteProject?.name || ''}"? This action cannot be undone.`}
          confirmLabel="Delete Project"
          variant="danger"
          onConfirm={() => {
            deleteProject(confirmDeleteProject._id)
              .then(() => toast.success('Project deleted!'))
              .catch(() => toast.error('Failed to delete project'));
            setConfirmDeleteProject(null);
          }}
          onClose={() => setConfirmDeleteProject(null)}
        />

        {/* Confirm Delete Client Dialog */}
        <ConfirmDialog
          open={!!confirmDeleteClient}
          title="Delete Client & All Data"
          message={`Permanently delete "${confirmDeleteClient?.name || ''}"? This will also delete the portal user, dedicated channel, all tasks, todos, meetings, and projects. This cannot be undone.`}
          confirmLabel={deletingClient ? 'Deleting…' : 'Delete Everything'}
          variant="danger"
          onConfirm={handleDeleteClient}
          onClose={() => setConfirmDeleteClient(null)}
        />
      </Page>
    );
  }

  // ── Clients List ──────────────────────────────────────────────
  return (
    <Page>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Clients &amp; Projects</h1>
          <p className="page-sub">{clients.length} clients · {clients.filter((c) => c.status === 'active').length} active</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle views={[{value:'grid',icon:Grid,label:'Grid'},{value:'list',icon:List,label:'List'}]} active={view} onChange={setView} />
          {canManage(role) && <Button variant="primary" size="sm" onClick={() => setShowAddClient(true)}><Plus size={13} /> Add Client</Button>}
        </div>
      </div>

      <div className="relative max-w-xs mb-5">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input className="form-input pl-9 py-1.5 text-[13px]" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Grid */}
      {view === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const team   = users.filter((u) => c.assignedTeam?.some((tm) => sameId(tm, u)));
            const cTasks = tasks.filter((t) => sameId(t.clientId, c));
            const done   = cTasks.filter((t) => t.status === 'completed').length;
            const prog   = cTasks.length ? Math.round((done / cTasks.length) * 100) : 0;
            return (
              <motion.div key={getId(c)} whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }} transition={{ duration: 0.15 }}
                className="card p-5 cursor-pointer" onClick={() => setSelected(c)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">{c.name}</h3>
                    <p className="text-[12.5px] text-slate-500 mt-0.5">{c.contact}</p>
                  </div>
                  <Badge variant={CLIENT_STATUS_CONFIG[c.status]?.tw?.replace('badge-','') || 'neutral'}>{c.status}</Badge>
                </div>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {c.services.slice(0, 3).map((s) => <span key={s} className="badge badge-neutral text-[10.5px]">{s}</span>)}
                </div>
                {/* Progress bar */}
                {cTasks.length > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>{done}/{cTasks.length} tasks done</span>
                      <span>{prog}%</span>
                    </div>
                    <ProgressBar value={prog} height={5} />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={payVariant(c.paymentStatus)}>{c.paymentStatus}</Badge>
                  <span className="badge badge-neutral text-[10.5px]">{c.projectCount} projects</span>
                </div>
                <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-700">
                  <AvatarGroup users={team} max={3} size="xs" />
                </div>
              </motion.div>
            );
          })}
          {filtered.length === 0 && <div className="col-span-3"><EmptyState icon={Users} title="No clients found" description="Try a different search term." /></div>}
        </div>
      )}

      {/* List/Table */}
      {view === 'list' && (
        <div className="table-container">
          <table className="crm-table">
            <thead><tr>{['Client','Contact','Industry','Services','Status','Payment','Progress','Team'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((c) => {
                const team   = users.filter((u) => c.assignedTeam?.some((tm) => sameId(tm, u)));
                const cTasks = tasks.filter((t) => sameId(t.clientId, c));
                const done   = cTasks.filter((t) => t.status === 'completed').length;
                const prog   = cTasks.length ? Math.round((done / cTasks.length) * 100) : 0;
                return (
                  <tr key={getId(c)} className="cursor-pointer" onClick={() => setSelected(c)}>
                    <td className="font-semibold">{c.name}</td>
                    <td className="text-slate-500 text-[12px]">{c.contact}</td>
                    <td><Badge variant="neutral">{c.industry}</Badge></td>
                    <td><div className="flex gap-1">{c.services.slice(0,2).map((s) => <Badge key={s} variant="neutral" className="text-[10px]">{s}</Badge>)}</div></td>
                    <td><Badge variant={CLIENT_STATUS_CONFIG[c.status]?.tw?.replace('badge-','') || 'neutral'}>{c.status}</Badge></td>
                    <td><Badge variant={payVariant(c.paymentStatus)}>{c.paymentStatus}</Badge></td>
                    <td>
                      {cTasks.length > 0 ? (
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <ProgressBar value={prog} height={5} className="flex-1" />
                          <span className="text-[11px] text-slate-500">{prog}%</span>
                        </div>
                      ) : <span className="text-slate-400 text-[12px]">—</span>}
                    </td>
                    <td><AvatarGroup users={team} max={3} size="xs" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={Users} title="No clients found" description="Try a different search term." />}
        </div>
      )}
      {/* Add Client Modal */}
      <AddClientModal
        open={showAddClient}
        onClose={() => setShowAddClient(false)}
        users={users}
        services={services}
        industries={industries}
        onSave={(data) => { addClient(data).then(()=>setShowAddClient(false)); toast.success('Client added!'); }}
      />
    </Page>
  );
}