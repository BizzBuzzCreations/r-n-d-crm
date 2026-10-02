import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Bell, CheckCheck, Trash2, Search, Filter,
  Check, PartyPopper, Eye, Calendar, MessageSquare,
  Building2, ClipboardList, Zap, Info, Target, AtSign,
  Trophy, TrendingDown, Send, AlertCircle, MessageCircle,
  LogIn, Server, BellOff, MailOpen, PhoneCall, Reply, UserPlus, CalendarOff } from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { notificationsAPI } from '../services/api';
import { cn } from '../utils/helpers';

import { AvatarContent } from './ui';
// ── Icon + colour map for every notification type ────────────────────────

const TYPE_MAP = {
  task_assigned:       { icon: Check,         bg: 'bg-indigo-100 dark:bg-indigo-900/40',  color: 'text-indigo-600 dark:text-indigo-400'  },
  task_approved:       { icon: PartyPopper,   bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  task_ready_approval: { icon: Eye,           bg: 'bg-amber-100 dark:bg-amber-900/40',    color: 'text-amber-600 dark:text-amber-400'    },
  meeting_scheduled:   { icon: Calendar,      bg: 'bg-violet-100 dark:bg-violet-900/40',  color: 'text-violet-600 dark:text-violet-400'  },
  message_dm:          { icon: MessageSquare, bg: 'bg-sky-100 dark:bg-sky-900/40',        color: 'text-sky-600 dark:text-sky-400'        },
  client_update:       { icon: Building2,     bg: 'bg-teal-100 dark:bg-teal-900/40',      color: 'text-teal-600 dark:text-teal-400'      },
  todo_submitted:      { icon: ClipboardList, bg: 'bg-orange-100 dark:bg-orange-900/40',  color: 'text-orange-600 dark:text-orange-400'  },
  service_added:       { icon: Zap,           bg: 'bg-indigo-100 dark:bg-indigo-900/40',  color: 'text-indigo-600 dark:text-indigo-400'  },
  lead_assigned:       { icon: Target,        bg: 'bg-amber-100 dark:bg-amber-900/40',    color: 'text-amber-600 dark:text-amber-400'    },
  lead_mentioned:      { icon: AtSign,        bg: 'bg-blue-100 dark:bg-blue-900/40',      color: 'text-blue-600 dark:text-blue-400'      },
  lead_won:            { icon: Trophy,        bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  lead_lost:           { icon: TrendingDown,  bg: 'bg-rose-100 dark:bg-rose-900/40',      color: 'text-rose-600 dark:text-rose-400'      },
  lead_captured:       { icon: UserPlus,      bg: 'bg-amber-100 dark:bg-amber-900/40',    color: 'text-amber-600 dark:text-amber-400'    },
  email_sent:          { icon: Send,          bg: 'bg-cyan-100 dark:bg-cyan-900/40',      color: 'text-cyan-600 dark:text-cyan-400'      },
  email_failed:        { icon: AlertCircle,   bg: 'bg-red-100 dark:bg-red-900/40',        color: 'text-red-600 dark:text-red-400'        },
  email_opened:        { icon: MailOpen,      bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  call_requested:      { icon: PhoneCall,     bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  email_replied:       { icon: Reply,         bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  new_comment:         { icon: MessageCircle, bg: 'bg-sky-100 dark:bg-sky-900/40',        color: 'text-sky-600 dark:text-sky-400'        },
  auth:                { icon: LogIn,         bg: 'bg-indigo-100 dark:bg-indigo-900/40',  color: 'text-indigo-600 dark:text-indigo-400'  },
  leave_requested:     { icon: CalendarOff,   bg: 'bg-amber-100 dark:bg-amber-900/40',    color: 'text-amber-600 dark:text-amber-400'    },
  leave_approved:      { icon: CalendarOff,   bg: 'bg-emerald-100 dark:bg-emerald-900/40',color: 'text-emerald-600 dark:text-emerald-400' },
  leave_rejected:      { icon: CalendarOff,   bg: 'bg-rose-100 dark:bg-rose-900/40',      color: 'text-rose-600 dark:text-rose-400'      },
  system:              { icon: Server,        bg: 'bg-slate-100 dark:bg-slate-700',       color: 'text-slate-600 dark:text-slate-400'    },
  default:             { icon: Info,          bg: 'bg-slate-100 dark:bg-slate-700',       color: 'text-slate-600 dark:text-slate-400'    },
};

// ── Priority → left-border colour ───────────────────────────────────────

const PRIORITY_BORDER = {
  critical: 'border-l-red-600',
  error:    'border-l-red-400',
  warning:  'border-l-yellow-400',
  success:  'border-l-emerald-400',
  info:     'border-l-transparent',
};

// ── Type filter options ──────────────────────────────────────────────────

const TYPE_FILTERS = [
  { label: 'All',      value: ''                },
  { label: 'Tasks',    value: 'task_assigned'    },
  { label: 'Leads',    value: 'lead_assigned'    },
  { label: 'Meetings', value: 'meeting_scheduled'},
  { label: 'Messages', value: 'message_dm'       },
  { label: 'Email',    value: 'email_sent'       },
  { label: 'System',   value: 'system'           },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '';
  const d    = new Date(iso);
  const now  = new Date();
  const diff = (now - d) / 60000; // minutes
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${Math.floor(diff)}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  if (diff < 2880) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getGroup(iso) {
  if (!iso) return 'Older';
  const d    = new Date(iso);
  const now  = new Date();
  const diff = (now - d) / 60000;
  if (diff < 1440) return 'Today';
  if (diff < 2880) return 'Yesterday';
  if (diff < 10080) return 'This Week';
  return 'Older';
}

// ── Notification item ────────────────────────────────────────────────────

function NotifItem({ n, onRead, onDelete }) {
  const navigate     = useNavigate();
  const cfg          = TYPE_MAP[n.type] ?? TYPE_MAP.default;
  const IconComp     = cfg.icon;
  const borderColor  = PRIORITY_BORDER[n.priority] ?? PRIORITY_BORDER.info;

  const handleClick = () => {
    if (!n.read) onRead(n._id);
    if (n.link)  { navigate(n.link); }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        'group relative flex gap-3 px-4 py-3.5 border-l-[3px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 transition-colors',
        borderColor,
        !n.read ? 'bg-primary-50/40 dark:bg-primary-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30',
        n.link && 'cursor-pointer'
      )}
      onClick={handleClick}
    >
      {/* Icon */}
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
        <IconComp size={15} className={cfg.color} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className={cn(
            'text-[13px] leading-snug truncate',
            !n.read ? 'font-semibold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'
          )}>
            {n.title}
          </p>
          {!n.read && (
            <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
          )}
        </div>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
          {n.message}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {n.sender?.name && (
            <>
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0 overflow-hidden"
                style={{ background: n.sender.avatar ? 'transparent' : (n.sender.color || '#6366f1') }}
              >
                <AvatarContent user={n.sender} fallback={n.sender.initials || n.sender.name[0]} />
              </div>
              <span className="text-[11px] text-slate-400">{n.sender.name}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
            </>
          )}
          <span className="text-[11px] text-slate-400">{fmtTime(n.createdAt)}</span>
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(n._id); }}
        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all mt-0.5"
        title="Remove"
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}

// ── Main Drawer Component ────────────────────────────────────────────────

export default function NotificationDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const { notifications, markAllRead, dismissNotification } = useAppStore();

  const [tab,        setTab]        = useState('all');   // 'all' | 'unread'
  const [typeFilter, setTypeFilter] = useState('');
  const [search,     setSearch]     = useState('');
  const searchRef = useRef(null);

  // Reset state when drawer opens
  useEffect(() => {
    if (open) { setTab('all'); setSearch(''); setTypeFilter(''); }
  }, [open]);

  // Derived: filter + group notifications
  const filtered = useMemo(() => {
    let list = notifications;
    if (tab === 'unread')   list = list.filter(n => !n.read);
    if (typeFilter) {
      const group = {
        'task_assigned':     ['task_assigned', 'task_approved', 'task_ready_approval'],
        'lead_assigned':     ['lead_assigned', 'lead_mentioned', 'lead_won', 'lead_lost', 'lead_captured'],
        'meeting_scheduled': ['meeting_scheduled'],
        'message_dm':        ['message_dm', 'new_comment'],
        'email_sent':        ['email_sent', 'email_failed', 'email_opened', 'call_requested', 'email_replied'],
        'system':            ['system', 'auth', 'leave_requested', 'leave_approved', 'leave_rejected'],
      }[typeFilter] ?? [typeFilter];
      list = list.filter(n => group.includes(n.type));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(n =>
        n.title?.toLowerCase().includes(q) ||
        n.message?.toLowerCase().includes(q) ||
        n.sender?.name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [notifications, tab, typeFilter, search]);

  // Group by date
  const grouped = useMemo(() => {
    const map = {};
    const ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];
    filtered.forEach(n => {
      const g = getGroup(n.createdAt);
      if (!map[g]) map[g] = [];
      map[g].push(n);
    });
    return ORDER.filter(g => map[g]?.length).map(g => ({ label: g, items: map[g] }));
  }, [filtered]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleRead = (id) => {
    useAppStore.setState((s) => ({
      notifications: s.notifications.map(n => n._id === id ? { ...n, read: true } : n)
    }));
    notificationsAPI.markRead(id).catch(() => {});
  };

  const handleDelete = (id) => dismissNotification(id);

  const handleMarkAllRead = () => {
    markAllRead();
  };

  const handleClearRead = () => {
    const readIds = notifications.filter(n => n.read).map(n => n._id);
    readIds.forEach(id => dismissNotification(id));
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="notif-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            key="notif-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 w-[420px] max-w-[100vw] bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <Bell size={15} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 dark:text-white leading-tight">Notifications</h2>
                  {unreadCount > 0 && (
                    <p className="text-[11.5px] text-primary-500 font-medium">{unreadCount} unread</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck size={13} /> Mark all read
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div className="flex items-center gap-0 px-5 pt-3 pb-0 flex-shrink-0 border-b border-slate-100 dark:border-slate-800">
              {[
                { value: 'all',    label: `All (${notifications.length})` },
                { value: 'unread', label: `Unread (${unreadCount})` },
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    'px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-px',
                    tab === t.value
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Search ── */}
            <div className="px-4 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  className="w-full pl-8 pr-8 py-2 bg-slate-100 dark:bg-slate-800 border border-transparent rounded-lg text-[13px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-primary-400 transition-all"
                  placeholder="Search notifications…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* ── Type filter chips ── */}
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {TYPE_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setTypeFilter(f.value)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap flex-shrink-0 border transition-all',
                      typeFilter === f.value
                        ? 'bg-primary-600 border-primary-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Notification list ── */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <BellOff size={22} className="text-slate-400" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-300">
                      {tab === 'unread' ? 'All caught up!' : 'No notifications'}
                    </p>
                    <p className="text-[12.5px] text-slate-400 mt-1">
                      {tab === 'unread'
                        ? 'You have no unread notifications.'
                        : search ? 'No notifications match your search.' : 'Notifications will appear here.'
                      }
                    </p>
                  </div>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {grouped.map(group => (
                    <div key={group.label}>
                      <div className="px-4 py-2 text-[10.5px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 select-none">
                        {group.label}
                      </div>
                      {group.items.map(n => (
                        <NotifItem
                          key={n._id}
                          n={n}
                          onRead={handleRead}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* ── Footer ── */}
            {notifications.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 bg-slate-50 dark:bg-slate-900/60">
                <button
                  onClick={handleClearRead}
                  disabled={!notifications.some(n => n.read)}
                  className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  <Trash2 size={12} /> Clear read
                </button>
                <span className="text-[11.5px] text-slate-400">
                  {notifications.length} total · {unreadCount} unread
                </span>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
