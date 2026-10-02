import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, CheckSquare, ListTodo, Users, MessageSquare,
  BarChart3, Video, Calendar, Settings, LogOut, UserCircle,
  Pause, Play, Coffee, ChevronDown, ChevronUp, Timer, Utensils, Pencil, Target, Shield, Terminal,
  Building2, Receipt, Mail, Megaphone, Globe2, KeyRound, Search,
  Share2, PenTool, FileText, ChevronLeft, ChevronRight, Wallet, CalendarOff,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { Avatar } from '../components/ui';
import { cn } from '../utils/helpers';
import { hasFeatureAccess } from '../utils/featureAccess';

// ── Constants ─────────────────────────────────────────────────
const WORK_TARGET_S = 7 * 3600;
const LUNCH_S       = 40 * 60;
const TEA_S         = 20 * 60;

// ── Formatters ────────────────────────────────────────────────
const p2 = (n) => String(Math.floor(Math.max(0, n))).padStart(2, '0');
const fmtHMS = (s) => `${p2(s/3600)}:${p2((s%3600)/60)}:${p2(s%60)}`;
const fmtMS  = (s) => `${p2(s/60)}:${p2(s%60)}`;

// ── Break definitions ─────────────────────────────────────────
const BREAK_DEFS = [
  { type: 'lunch',  label: 'Lunch',   secs: LUNCH_S, icon: Utensils, color: '#f59e0b', time: '40:00' },
  { type: 'tea',    label: 'Tea',     secs: TEA_S,   icon: Coffee,   color: '#10b981', time: '20:00' },
  { type: 'custom', label: 'Custom',  secs: 0,       icon: Pause,    color: '#6366f1', time: null   },
];

// ── Member-only Timer Widget ──────────────────────────────────
function MemberTimer({ open }) {
  const timer    = useAppStore((s) => s.timer);
  const [breakMenuOpen, setBreakMenuOpen] = useState(false);
  const [showCustom,    setShowCustom]    = useState(false);
  const [customMins,    setCustomMins]    = useState('15');
  const [customReason,  setCustomReason]  = useState('');
  const [isEditingTarget, setIsEditingTarget] = useState(false);

  // ── Master tick using getState() to avoid stale closure ──────
  // Elapsed time is computed from the wall clock inside tickTimer/tickBreak, so ticks only
  // need to arrive *eventually*. Browsers aggressively throttle page timers in background
  // tabs (down to ~1/min), so the 1s heartbeat runs in a Web Worker (not throttled the same
  // way) and we also catch up instantly whenever the tab/window becomes visible or focused.
  useEffect(() => {
    const tick = () => {
      const s = useAppStore.getState();
      if (!s.timer) return;
      if (s.timer.breakActive) s.tickBreak?.();
      else if (s.timer.active) s.tickTimer?.();
    };

    let worker = null;
    let workerUrl = null;
    let fallbackId = null;
    const startFallback = () => { if (!fallbackId) fallbackId = setInterval(tick, 1000); };
    try {
      workerUrl = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},1000)'], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
      worker.onmessage = tick;
      worker.onerror = () => { worker?.terminate(); worker = null; startFallback(); }; // e.g. blocked by CSP
    } catch {
      startFallback();
    }

    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    window.addEventListener('pageshow', tick);

    return () => {
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      if (fallbackId) clearInterval(fallbackId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, []); // run once on mount, never restart

  // ── Derived ───────────────────────────────────────────────
  const workSecs    = timer?.workSeconds || 0;
  const targetSecs  = timer?.targetSeconds || (8 * 3600);
  const pct         = Math.min(100, (workSecs / targetSecs) * 100);
  const leftSecs    = Math.max(0, targetSecs - workSecs);
  const leftHrs     = (leftSecs / 3600).toFixed(1);
  const workDone    = workSecs >= targetSecs;

  const brk         = timer?.currentBreak;
  const breakRemain = brk ? Math.max(0, brk.totalSeconds - brk.elapsedSeconds) : 0;
  const breakPct    = brk ? Math.min(100, (brk.elapsedSeconds / brk.totalSeconds) * 100) : 0;
  const breakDef    = brk ? BREAK_DEFS.find((b) => b.type === brk.type) : null;

  const {
    startTimer, pauseTimer, startBreak, endBreak,
  } = useAppStore.getState();

  const handleBreakStart = (type, secs, reason = '') => {
    useAppStore.getState().startBreak(type, secs, reason);
    setBreakMenuOpen(false);
    setShowCustom(false);
    setCustomMins('15');
    setCustomReason('');
  };

  const handleCustomStart = () => {
    const mins = parseInt(customMins, 10);
    if (!mins || mins < 1) return;
    handleBreakStart('custom', mins * 60, customReason || 'Custom break');
  };

  // ── Collapsed ─────────────────────────────────────────────
  if (!open) {
    const dotColor = timer?.breakActive ? '#f59e0b' : timer?.active ? '#10b981' : '#94a3b8';
    return (
      <div className="flex justify-center py-2 border-b border-sidebar-border mb-1">
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: dotColor }}
          title={fmtHMS(workSecs)}
        />
      </div>
    );
  }

  // ── Expanded ──────────────────────────────────────────────
  return (
    <div className="mx-2 mb-2 rounded-xl border border-white/[0.09]" style={{ background: 'rgba(255,255,255,0.045)' }}>

      {/* ── Active break card ── */}
      <AnimatePresence>
        {timer?.breakActive && brk && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="m-2.5 rounded-xl px-3 py-2.5"
              style={{ background: (breakDef?.color || '#6366f1') + '18', border: `1px solid ${breakDef?.color || '#6366f1'}35` }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {breakDef?.icon && <breakDef.icon size={13} style={{ color: breakDef?.color || '#6366f1' }} />}
                  <span className="text-[12px] font-bold" style={{ color: breakDef?.color || '#6366f1' }}>
                    {breakDef?.label || 'Break'} Break
                  </span>
                </div>
                <span className="font-mono text-[15px] font-bold" style={{ color: breakDef?.color || '#6366f1' }}>
                  {fmtMS(breakRemain)}
                </span>
              </div>
              {brk.reason && <p className="text-[10px] text-slate-400 italic mb-1.5">"{brk.reason}"</p>}
              <div className="h-1 rounded-full bg-white/10 overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-1000"
                  style={{ background: breakDef?.color || '#6366f1', width: `${breakPct}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">{Math.ceil(breakRemain / 60)} min left</span>
                <button
                  onClick={() => useAppStore.getState().endBreak()}
                  className="text-[10.5px] font-semibold px-2 py-0.5 rounded border transition-colors"
                  style={{ borderColor: (breakDef?.color || '#6366f1') + '50', color: breakDef?.color || '#6366f1' }}
                >
                  End Early
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main display ── */}
      <div className="px-3 pt-3 pb-2.5">
        {/* Time + left */}
        <div className="flex items-start justify-between mb-1">
          <div className="font-mono text-[22px] font-bold text-white tracking-tight leading-none">
            {fmtHMS(workSecs)}
          </div>
          <div className="text-right flex flex-col items-end justify-center min-h-[34px]">
            {isEditingTarget ? (
              <select
                value={Math.round(targetSecs / 3600)}
                onChange={(e) => {
                  const hrs = parseInt(e.target.value, 10);
                  if (hrs >= 1 && hrs <= 24) {
                    useAppStore.getState().updateTargetSeconds(hrs * 3600);
                  }
                  setIsEditingTarget(false);
                }}
                onBlur={() => setIsEditingTarget(false)}
                autoFocus
                className="bg-slate-800 text-white border border-slate-700/60 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-500 font-semibold cursor-pointer max-w-[90px]"
              >
                {[...Array(24)].map((_, i) => (
                  <option key={i+1} value={i+1}>{i+1}h target</option>
                ))}
              </select>
            ) : (
              <div
                onClick={() => setIsEditingTarget(true)}
                className="group cursor-pointer text-right select-none"
                title="Click to adjust daily target time"
              >
                {workDone ? (
                  <div className="text-[11px] font-bold text-emerald-400 mt-0.5 flex items-center justify-end gap-1">
                    ✓ Goal met!
                    <Pencil size={9} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
                  </div>
                ) : (
                  <>
                    <div className="text-[12px] font-bold text-white transition-colors group-hover:text-indigo-300">{leftHrs}h left</div>
                    <div className="text-[9.5px] text-slate-500 mt-0.5 flex items-center justify-end gap-1 transition-colors group-hover:text-indigo-400 font-medium">
                      of {Math.round(targetSecs / 3600)}h target
                      <Pencil size={8} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status */}
        {!timer?.breakActive && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-1.5 h-1.5 rounded-full"
              style={{ background: timer?.active ? '#10b981' : '#94a3b8' }} />
            <span className="text-[11.5px] font-semibold"
              style={{ color: timer?.active ? '#10b981' : '#94a3b8' }}>
              {timer?.active ? 'Working' : workSecs > 0 ? 'Paused' : 'Not started'}
            </span>
          </div>
        )}

        {/* Progress bar: 0h — % — target */}
        {!timer?.breakActive && (
          <div className="mb-3">
            <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${pct}%`,
                  background: workDone ? '#10b981' : timer?.active ? '#6366f1' : '#4b5563',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>0h</span>
              <span>{pct.toFixed(0)}%</span>
              <span>{Math.round(targetSecs / 3600)}h</span>
            </div>
          </div>
        )}

        {/* Buttons */}
        {!timer?.breakActive && (
          <div className="flex gap-2">
            {timer?.active ? (
              <button
                onClick={() => { setBreakMenuOpen((v) => !v); setShowCustom(false); }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white transition-all',
                  breakMenuOpen ? 'bg-amber-500' : ''
                )}
                style={!breakMenuOpen ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)' } : {}}
              >
                <Coffee size={12} /> Take a Break
                {breakMenuOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            ) : (
              <button
                onClick={() => useAppStore.getState().startTimer()}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-all"
              >
                <Play size={12} /> Start Timer
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Break menu (INLINE — not absolute, avoids overflow clip) ── */}
      <AnimatePresence>
        {breakMenuOpen && !timer?.breakActive && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/[0.07]"
          >
            <div className="p-2 space-y-0.5">
              {/* Lunch */}
              <button
                onClick={() => handleBreakStart('lunch', LUNCH_S)}
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.07] transition-colors text-left group"
              >
                <div className="flex items-center gap-2.5">
                  <Utensils size={14} className="text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-[12px] font-semibold text-slate-200 group-hover:text-amber-300">Lunch</p>
                    <p className="text-[9.5px] text-slate-500">40 min · auto-resumes</p>
                  </div>
                </div>
                <span className="font-mono text-[11px] font-bold text-amber-400">40:00</span>
              </button>

              {/* Tea */}
              <button
                onClick={() => handleBreakStart('tea', TEA_S)}
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.07] transition-colors text-left group"
              >
                <div className="flex items-center gap-2.5">
                  <Coffee size={14} className="text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-[12px] font-semibold text-slate-200 group-hover:text-emerald-300">Tea</p>
                    <p className="text-[9.5px] text-slate-500">20 min · auto-resumes</p>
                  </div>
                </div>
                <span className="font-mono text-[11px] font-bold text-emerald-400">20:00</span>
              </button>

              {/* Custom */}
              <button
                onClick={() => setShowCustom((v) => !v)}
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.07] transition-colors text-left group"
              >
                <div className="flex items-center gap-2.5">
                  <Pause size={14} className="text-indigo-400 flex-shrink-0" />
                  <div>
                    <p className="text-[12px] font-semibold text-slate-200 group-hover:text-indigo-300">Custom</p>
                    <p className="text-[9.5px] text-slate-500">Set your own time</p>
                  </div>
                </div>
                {showCustom ? <ChevronUp size={11} className="text-slate-400" /> : <ChevronDown size={11} className="text-slate-500" />}
              </button>

              {/* Custom form */}
              <AnimatePresence>
                {showCustom && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-1 pt-1 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="number" min="1" max="120"
                          value={customMins}
                          onChange={(e) => setCustomMins(e.target.value)}
                          className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-indigo-500 text-center font-mono"
                          placeholder="mins"
                        />
                        <input
                          type="text"
                          value={customReason}
                          onChange={(e) => setCustomReason(e.target.value)}
                          className="flex-[2] bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-indigo-500 placeholder-slate-500"
                          placeholder="Reason (optional)"
                        />
                      </div>
                      <button
                        onClick={handleCustomStart}
                        className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors"
                      >
                        <Timer size={11} /> Start Break
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Expandable nav group (e.g. "Ads Monitoring" → Meta Ads, Google Ads, …) ──
function NavGroup({ item, authUser, systemSettings, sidebarOpen, isExpanded, onToggle, activePath }) {
  const children = item.children.filter((c) => hasFeatureAccess(authUser, systemSettings, c.featureKey, c.roles));
  if (!children.length) return null;
  const hasActiveChild = children.some((c) => c.path === activePath);

  // Collapsed sidebar has no room for a submenu — link straight to the
  // first child instead, same as any other icon-only nav item.
  if (!sidebarOpen) {
    return (
      <NavLink
        to={children[0].path}
        title={item.label}
        className={cn(
          'relative flex items-center justify-center px-0 py-2 rounded-lg cursor-pointer transition-all duration-150 select-none',
          hasActiveChild ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
        )}
      >
        {hasActiveChild && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-400 rounded-r" />
        )}
        <item.icon size={16} />
      </NavLink>
    );
  }

  return (
    <div>
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150 select-none',
          hasActiveChild ? 'text-indigo-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
        )}
      >
        <item.icon size={16} className="flex-shrink-0" />
        <span className="flex-1 text-[13px] font-medium truncate text-left">{item.label}</span>
        <ChevronDown size={13} className={cn('flex-shrink-0 transition-transform duration-150', !isExpanded && '-rotate-90')} />
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-0.5 space-y-0.5">
              {children.map((child) => (
                <NavLink
                  key={child.path}
                  to={child.path}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 pl-9 pr-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 select-none text-[12.5px] font-medium',
                    isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                  )}
                >
                  <child.icon size={13} className="flex-shrink-0" />
                  <span className="truncate">{child.label}</span>
                </NavLink>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────
const NAV = [
  {
    section: 'PORTAL',
    items: [
      { path: '/portal', label: 'My Portal', icon: Building2, roles: ['client'] },
    ],
  },
  {
    section: 'MENU',
    items: [
      { path: '/dashboard', label: 'Dashboard',            icon: LayoutDashboard, roles: ['admin','manager','member','client_relations'], featureKey: 'dashboard' },
      { path: '/todos',     label: 'Todos',                icon: ListTodo,        roles: ['admin','manager','member','client_relations'], featureKey: 'todos' },
      { path: '/tasks',     label: 'Tasks',                icon: CheckSquare,     roles: ['admin','manager','member','client_relations'], featureKey: 'tasks' },
      { path: '/clients',   label: 'Clients & Projects',   icon: Users,           roles: ['admin','manager','member','client_relations'], featureKey: 'clients' },
      { path: '/leads',     label: 'Leads Pipeline',       icon: Target,          roles: ['admin','manager','client_relations'], featureKey: 'leads' },
      { path: '/campaigns', label: 'Campaigns',            icon: Mail,            roles: ['admin','manager'], featureKey: 'campaigns' },
      {
        key: 'ads-monitoring', label: 'Ads Monitoring', icon: Megaphone, roles: ['admin','manager'],
        // More platforms (Google, LinkedIn, etc.) get added here as sibling
        // entries later — each is its own future page, not built yet.
        children: [
          { path: '/meta-ads', label: 'Meta Ads', icon: Megaphone, roles: ['admin','manager'], featureKey: 'ads_monitoring' },
        ],
      },
      { path: '/website-intelligence', label: 'Website Intelligence', icon: Globe2, roles: ['admin','manager'], featureKey: 'website_intelligence' },
      { path: '/prospect-audits', label: 'Prospect Audits', icon: Search, roles: ['admin','manager'], featureKey: 'prospect_audit' },
      {
        key: 'social-media', label: 'Social Media', icon: Share2, roles: ['admin','manager'],
        children: [
          { path: '/social-media/accounts', label: 'Connected Accounts', icon: Share2,   roles: ['admin','manager'], featureKey: 'social_media' },
          { path: '/social-media/composer', label: 'Composer',           icon: PenTool,  roles: ['admin','manager'], featureKey: 'social_media' },
          { path: '/social-media/calendar', label: 'Calendar',           icon: Calendar, roles: ['admin','manager'], featureKey: 'social_media' },
          { path: '/social-media/posts',    label: 'Posts',              icon: FileText, roles: ['admin','manager'], featureKey: 'social_media' },
        ],
      },
      { path: '/messages',  label: 'Messages',             icon: MessageSquare,   roles: ['admin','manager','member','client_relations','client'], featureKey: 'messages', badge: true },
      { path: '/meetings',  label: 'Meetings',             icon: Video,           roles: ['admin','manager','member','client_relations'], featureKey: 'meetings' },
      { path: '/reports',   label: 'Reports',              icon: BarChart3,       roles: ['admin','manager','member','client_relations'], featureKey: 'reports' },
      {
        // Between Reports and Calendar. Admin/manager get both; everyone else
        // only sees Leaves (Pay Runs is hidden by its own feature rule).
        key: 'payroll', label: 'Payroll', icon: Wallet, roles: ['admin','manager','member','client_relations'],
        children: [
          { path: '/payroll/pay-runs', label: 'Pay Runs', icon: Wallet,      roles: ['admin','manager'], featureKey: 'payroll_pay_runs' },
          { path: '/payroll/leaves',   label: 'Leaves',   icon: CalendarOff, roles: ['admin','manager','member','client_relations'], featureKey: 'payroll_leaves' },
        ],
      },
      { path: '/calendar',  label: 'Calendar',             icon: Calendar,        roles: ['admin','manager','member','client_relations'], featureKey: 'calendar' },
    ],
  },
  {
    section: 'ADMIN',
    items: [
      { path: '/billing',     label: 'Billing',        icon: Receipt,    roles: ['admin', 'manager'], featureKey: 'billing' },
      { path: '/team',        label: 'Team',           icon: UserCircle, roles: ['admin', 'manager'], featureKey: 'team' },
      { path: '/logs',        label: 'Audit Logs',     icon: Shield,     roles: ['admin'], featureKey: 'audit_logs' },
      { path: '/system-logs', label: 'System Monitor', icon: Terminal,   roles: ['admin'], featureKey: 'system_monitor' },
      { path: '/api-keys',    label: 'API Keys',       icon: KeyRound,   roles: ['admin'], featureKey: 'api_keys' },
    ],
  },
  {
    section: 'ACCOUNT',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings, roles: ['admin','manager','member','client_relations','client'] },
    ],
  },
];

// ── Main Sidebar ──────────────────────────────────────────────
export default function Sidebar() {
  const authUser    = useAppStore((s) => s.authUser);
  const systemSettings = useAppStore((s) => s.systemSettings);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const messages    = useAppStore((s) => s.messages);
  const logout      = useAppStore((s) => s.logout);
  const location    = useLocation();

  const role        = authUser?.role;
  const isMember    = role === 'member';
  const isClient    = role === 'client';
  const totalUnread = [...messages.channels, ...messages.dms].reduce((a, c) => a + (c.unread || 0), 0);

  // ── Expandable nav groups (e.g. "Ads Monitoring") ──────────────
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  useEffect(() => {
    const activeGroup = NAV.flatMap((s) => s.items).find((item) =>
      item.children?.some((c) => c.path === location.pathname)
    );
    if (activeGroup) setExpandedGroups((prev) => new Set(prev).add(activeGroup.key));
  }, [location.pathname]);
  const toggleGroup = (key) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <motion.aside
      className="relative z-40 flex flex-col bg-sidebar h-screen flex-shrink-0 border-r border-sidebar-border"
      style={{ overflow: 'visible' }}
      animate={{ width: sidebarOpen ? 232 : 58 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
    >
      {/* ── Logo ── */}
      <div className={cn(
        'flex border-b border-sidebar-border flex-shrink-0',
        sidebarOpen ? 'items-center px-3 py-3' : 'justify-center py-4'
      )}>
        {sidebarOpen ? (
          // The artwork is a padded 16:9 banner — scale and offset it so only the logo shows.
          <div className="relative flex-1 min-w-0 h-[62px] overflow-hidden rounded-lg" style={{ background: '#141d2e' }}>
            <img
              src="/sidebar_bbcCRM.png"
              alt="BizzBuzz Creations CRM"
              className="absolute max-w-none select-none"
              style={{ width: '124%', left: '-12.5%', top: '-41px' }}
              draggable={false}
            />
          </div>
        ) : (
          <img
            src="/Tab_logo.png"
            alt="BBC"
            className="w-8 h-8 rounded-lg object-cover bg-white flex-shrink-0"
          />
        )}
      </div>

      {/* Collapse toggle — centred exactly on the sidebar's right border line */}
      <button
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        className="absolute top-5 right-0 translate-x-1/2 z-10 w-6 h-8 flex items-center justify-center rounded-md bg-slate-800 border border-slate-600 text-slate-200 shadow-md hover:text-white hover:bg-indigo-600 hover:border-indigo-500 transition-colors"
      >
        {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {/* ── Timer — members only (not clients) ── */}
      {isMember && !isClient && <MemberTimer open={sidebarOpen} />}

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">
        {NAV.map(({ section, items }) => {
          const visible = items.filter((item) =>
            hasFeatureAccess(authUser, systemSettings, item.featureKey, item.roles)
          );
          if (!visible.length) return null;
          return (
            <div key={section} className="mb-1">
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.div
                    className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-slate-600 px-2.5 py-1.5 mt-2"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  >
                    {section}
                  </motion.div>
                )}
              </AnimatePresence>

              {visible.map((item) => item.children ? (
                <NavGroup
                  key={item.key}
                  item={item}
                  authUser={authUser}
                  systemSettings={systemSettings}
                  sidebarOpen={sidebarOpen}
                  isExpanded={expandedGroups.has(item.key)}
                  onToggle={() => toggleGroup(item.key)}
                  activePath={location.pathname}
                />
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={!sidebarOpen ? item.label : undefined}
                  className={({ isActive }) => cn(
                    'relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150 select-none',
                    !sidebarOpen && 'justify-center px-0',
                    isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {!sidebarOpen && isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-400 rounded-r" />
                      )}
                      {/* Icon — wrapped in relative div so we can overlay the collapsed dot */}
                      <div className="relative flex-shrink-0">
                        <item.icon size={16} />
                        {/* Collapsed sidebar: pulsing red dot when there are unreads */}
                        {!sidebarOpen && item.badge && totalUnread > 0 && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-slate-900 animate-pulse" />
                        )}
                      </div>
                      <AnimatePresence>
                        {sidebarOpen && (
                          <motion.span
                            className="flex-1 text-[13px] font-medium truncate"
                            initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            {item.label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {/* Expanded sidebar: full numeric badge */}
                      {sidebarOpen && item.badge && totalUnread > 0 && (
                        <span className="ml-auto bg-red-500 text-white text-[9.5px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-4">
                          {totalUnread}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* ── User + Logout ── */}
      <div className="border-t border-sidebar-border px-2 py-3 flex-shrink-0">
        <div className={cn('flex items-center gap-2.5 px-2.5 py-2 rounded-lg', !sidebarOpen && 'justify-center px-0')}>
          <Avatar user={authUser} size="sm" showStatus />
          <AnimatePresence>
            {sidebarOpen && (
              <motion.div className="flex-1 min-w-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="text-slate-200 text-[13px] font-semibold truncate">{authUser?.name}</div>
                <div className="text-slate-500 text-[11px] capitalize">{authUser?.role}</div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {sidebarOpen && (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={logout} title="Logout"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors flex-shrink-0"
              >
                <LogOut size={14} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        {!sidebarOpen && (
          <button onClick={logout} title="Logout"
            className="flex items-center justify-center w-full py-2 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors mt-1">
            <LogOut size={15} />
          </button>
        )}
      </div>
    </motion.aside>
  );
}
