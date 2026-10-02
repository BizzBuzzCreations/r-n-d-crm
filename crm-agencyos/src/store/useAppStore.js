import { create }  from 'zustand';
import { localDateStr } from '../utils/helpers';
import { io }       from 'socket.io-client';
import toast        from 'react-hot-toast';
import { createElement } from 'react';
import {
  authAPI, usersAPI, clientsAPI, tasksAPI,
  todosAPI, meetingsAPI, messagesAPI, worklogAPI, revenueAPI, notificationsAPI, channelsAPI, servicesAPI, projectsAPI,
  settingsAPI, leadsAPI, portalAPI, campaignsAPI, emailAccountsAPI, emailTemplatesAPI, getBackendUrl,
  prospectAuditsAPI,
  socialAPI, socialPlatformSettingsAPI,
} from '../services/api';

// ── Helpers ──────────────────────────────────────────────────
const todayStr = () => localDateStr();

// ID normalizer: handles both populated objects and raw id strings
export const getId = (ref) => ref?._id || ref?.id || String(ref || '');
export const sameId = (a, b) => String(getId(a)) === String(getId(b));

// ── Unread-count localStorage (survives page reloads) ────────
const U_KEY  = (uid) => `crm_unread_${uid}`;
const saveUnreadLS  = (uid, map) => { try { localStorage.setItem(U_KEY(uid), JSON.stringify(map)); } catch {} };
const loadUnreadLS  = (uid) => { try { const r = localStorage.getItem(U_KEY(uid)); return r ? JSON.parse(r) : {}; } catch { return {}; } };
const clearUnreadLS = (uid) => { try { localStorage.removeItem(U_KEY(uid)); } catch {} };

// ── Timer localStorage (syncs to /api/worklog) ────────────────
const T_KEY = (id) => `crm_timer_v2_${id}`;
const saveTimerLS = (uid, t) => { try { localStorage.setItem(T_KEY(uid), JSON.stringify(t)); } catch {} };
const loadTimerLS = (uid)    => { try { const r = localStorage.getItem(T_KEY(uid)); return r ? JSON.parse(r) : null; } catch { return null; } };
const loadWorkLogLS = (uid)  => {
  try {
    const r = localStorage.getItem(`crm_worklog_${uid}`);
    return r ? JSON.parse(r) : [];
  } catch { return []; }
};

// Any single tick gap longer than this is treated as real sleep/hibernation (or a
// forgotten check-out) and capped rather than fully credited — see tickTimer().
const IDLE_GAP_CAP_S = 4 * 3600;

// Hard daily ceiling — safety net against a forgotten logout running the clock
// for 24+ hours. The only automatic stop; everything else (pause/break/logout)
// is manual.
const MAX_WORK_SECONDS_PER_DAY = 10 * 3600;

function initialTimer() {
  return { active:false, workSeconds:0, sessionDate:null, sessionStart:null, breaks:[], breakActive:false, currentBreak:null, targetSeconds: 8 * 3600, lastTickTime: null };
}

// ── Default channels ──────────────────────────────────────────
const DEFAULT_CHANNELS = [
  { id:'general',       name:'general',       type:'channel', description:'Company-wide announcements', unread:0 },
  { id:'design',        name:'design',        type:'channel', description:'Design team discussions',    unread:0 },
  { id:'dev',           name:'development',   type:'channel', description:'Engineering updates',        unread:0 },
  { id:'marketing',     name:'marketing',     type:'channel', description:'Marketing and campaigns',    unread:0 },
  { id:'client-updates',name:'client-updates',type:'channel', description:'Client status updates',      unread:0 },
];

// ── Socket singleton ──────────────────────────────────────────
let sock = null;
export const getSock = () => sock; // expose for admin components (System Logs, etc.)
let _beforeUnloadFn = null;  // reference so we can remove it on disconnect
let _focusHandler = null;
let _visibilityHandler = null;

const getSocketUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:5000';
  const { protocol, hostname, port } = window.location;
  // Vite dev server runs on 5173 or 5174; backend is always on 5000 in that case
  if (port === '5173' || port === '5174') return 'http://localhost:5000';
  // Production: frontend and socket are served from the same origin
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
};

// Flush the timer to the DB using sendBeacon (fires even when tab closes).
// Closing/refreshing a tab is NOT a check-out — only the explicit Logout action (or
// the 10h auto-stop safety net in tickTimer) may set active:false. This just makes
// sure the last few unsynced seconds aren't lost before the page unloads.
function flushTimerToDb(store) {
  const { timer, authUser } = store.getState();
  if (!timer || !authUser) return;
  if (timer.workSeconds <= 0) return;
  const token = localStorage.getItem('crm_access_token');
  if (!token) return;
  const base = getSocketUrl();
  const body = JSON.stringify({
    date: timer.sessionDate || localDateStr(),
    workSeconds: timer.workSeconds,
    sessionStart: timer.sessionStart,
    breaks: timer.breaks || [],
    active: timer.active,
    breakActive: timer.breakActive,
    targetSeconds: timer.targetSeconds || 8 * 3600,
  });
  // sendBeacon is the only API that reliably fires on tab close
  navigator.sendBeacon(
    `${base}/api/worklog?_token=${encodeURIComponent(token)}`,
    new Blob([body], { type: 'application/json' })
  );
}

function connectSocket(store) {
  // Already connected — nothing to do
  if (sock?.connected) return;
  // Stale socket exists (e.g. failed after reconnectionAttempts) — clean it up first
  if (sock) { sock.removeAllListeners(); sock.disconnect(); sock = null; }

  // Use a callback so Socket.IO reads the CURRENT token on every reconnect attempt,
  // not the stale one captured at initial connect time (token may have been refreshed).
  sock = io(getSocketUrl(), {
    auth: (cb) => { cb({ token: localStorage.getItem('crm_access_token') }); },
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  // Helper: refresh auth token on the socket object before manual reconnects
  const refreshSocketAuth = () => {
    if (sock) sock.auth = { token: localStorage.getItem('crm_access_token') };
  };

  // Reconnect automatically on window focus or visibility change if disconnected
  if (_focusHandler) window.removeEventListener('focus', _focusHandler);
  _focusHandler = () => {
    if (sock && !sock.connected) {
      console.log('🔌 Window focused and socket disconnected — attempting reconnect');
      refreshSocketAuth();
      sock.connect();
    }
  };
  window.addEventListener('focus', _focusHandler);

  if (_visibilityHandler) window.removeEventListener('visibilitychange', _visibilityHandler);
  _visibilityHandler = () => {
    if (document.visibilityState === 'visible' && sock && !sock.connected) {
      console.log('🔌 Tab visible and socket disconnected — attempting reconnect');
      refreshSocketAuth();
      sock.connect();
    }
  };
  window.addEventListener('visibilitychange', _visibilityHandler);

  sock.on('connect', () => {
    console.log('🔌 Socket connected:', getSocketUrl());
    store.setState({ socketConnected: true });
    // Register beforeunload flush (remove any previous listener first)
    if (_beforeUnloadFn) window.removeEventListener('beforeunload', _beforeUnloadFn);
    _beforeUnloadFn = () => flushTimerToDb(store);
    window.addEventListener('beforeunload', _beforeUnloadFn);

    // Immediately broadcast current timer state so admins/managers see it right away
    const { timer, authUser } = store.getState();
    if (timer && authUser && timer.active !== undefined) {
      sock?.emit('timer:sync', {
        workSeconds:  timer.workSeconds,
        active:       timer.active,
        breakActive:  timer.breakActive,
        sessionDate:  timer.sessionDate,
        sessionStart: timer.sessionStart,
        targetSeconds:timer.targetSeconds,
      });
    }
  });
  sock.on('disconnect', (reason) => {
    console.warn('🔌 Socket disconnected:', reason);
    store.setState({ socketConnected: false });
  });
  sock.on('connect_error', (err) => {
    console.error('🔌 Socket connection error:', err.message);
    store.setState({ socketConnected: false });
  });

  // Tasks (Section 11)
  sock.on('task:created', (t) => store.setState((s) => ({ tasks: [t, ...s.tasks] })));
  sock.on('task:updated', (t) => store.setState((s) => ({ tasks: s.tasks.map((x) => getId(x) === getId(t) ? t : x) })));
  sock.on('task:deleted', (id)=> store.setState((s) => ({ tasks: s.tasks.filter((x) => getId(x) !== String(id)) })));

  // Client deleted — cascade-remove all related state for all connected users
  sock.on('client:deleted', (id) => {
    const cid = String(id);
    store.setState((s) => ({
      clients:  s.clients.filter((c) => getId(c) !== cid),
      tasks:    s.tasks.filter((t) => String(t.clientId) !== cid),
      todos:    s.todos.filter((t) => String(t.clientId) !== cid),
      projects: s.projects.filter((p) => String(p.clientId) !== cid),
      meetings: s.meetings.filter((m) => String(m.clientId) !== cid),
    }));
  });

  // Leads
  sock.on('lead:created', (l) => store.setState((s) => {
    const already = s.leads.some((x) => sameId(x, l));
    if (already) return {};
    return { leads: [l, ...s.leads] };
  }));
  sock.on('lead:updated', (l) => store.setState((s) => ({ leads: s.leads.map((x) => getId(x) === getId(l) ? l : x) })));
  sock.on('lead:deleted', (id)=> store.setState((s) => ({ leads: s.leads.filter((x) => getId(x) !== String(id)) })));
  sock.on('lead:won:alert', (payload) => {
    toast.success(`🎉 New Client Secured! "${payload.companyName}" workspace initialized.`, { duration: 6000 });
  });

  // ── Real-time email delivery feedback ────────────────────────
  sock.on('email:sent', (payload) => {
    toast.success(`✉️ Email delivered to ${payload.to}`, { duration: 4000 });
  });
  sock.on('email:failed', (payload) => {
    if (payload.willRetry) {
      toast.error(`⚠️ Email to ${payload.to} failed — retrying automatically`, { duration: 4000 });
    } else {
      toast.error(`❌ Email to ${payload.to} could not be delivered after all retries`, { duration: 6000 });
    }
  });

  // Todos
  sock.on('todo:created', (t) => store.setState((s) => {
    // Use sameId for reliable string-based comparison (avoids ObjectId === failures)
    const already = s.todos.some((x) => sameId(x, t));
    if (already) return {};
    return { todos: [t, ...s.todos] };
  }));
  sock.on('todo:updated', (t) => store.setState((s) => ({ todos: s.todos.map((x) => getId(x) === getId(t) ? t : x) })));
  sock.on('todo:deleted', (id)=> store.setState((s) => ({ todos: s.todos.filter((x) => getId(x) !== String(id)) })));

  // Meetings
  sock.on('meeting:created', (m) => store.setState((s) => ({ meetings: [m, ...s.meetings] })));

  // Messages
  sock.on('message:new', (msg) => {
    // Ignore events that arrive after logout (orphaned socket defence)
    if (!store.getState().authUser) return;

    // Read state first so we can use it for both the state update and the toast.
    // Using getState() + setState(obj) instead of setState(fn) so we can run
    // side-effects (toast, sound) after the state change without putting them
    // inside a pure state-updater callback.
    const s = store.getState();

    // ── Canonical DM thread → local "dm-{otherId}" form ──────────────────
    let tid = msg.threadId;
    const myId = getId(s.authUser);
    if (tid && tid.startsWith('dm-')) {
      const withoutPrefix = tid.slice(3);
      const dashIdx = withoutPrefix.indexOf('-');
      if (dashIdx !== -1) {
        const id1 = withoutPrefix.slice(0, dashIdx);
        const id2 = withoutPrefix.slice(dashIdx + 1);
        tid = `dm-${id1 === myId ? id2 : id1}`;
      }
    }

    // Dedup — drop if already in thread cache
    if ((s.messages.threads[tid] || []).some((x) => x._id === msg._id)) return;

    const msgWithLocalTid = { ...msg, threadId: tid };
    const senderId  = getId(msg.userId);
    const isFromMe  = senderId === myId;
    const isActive  = tid === s.activeThread;

    // ── Unread counters ────────────────────────────────────────────────────
    let channels = s.messages.channels;
    let dms      = s.messages.dms;
    if (!isActive && !isFromMe) {
      const isChannelThread = channels.some((c) => c.id === tid);
      if (isChannelThread) {
        channels = channels.map((c) => c.id === tid ? { ...c, unread: (c.unread || 0) + 1 } : c);
      } else {
        dms = dms.map((d) => d.id === tid ? { ...d, unread: (d.unread || 0) + 1 } : d);
      }
      const uid = getId(s.authUser);
      if (uid) {
        const saved = loadUnreadLS(uid);
        saved[tid] = (saved[tid] || 0) + 1;
        saveUnreadLS(uid, saved);
      }
    }

    // ── State update ───────────────────────────────────────────────────────
    store.setState({
      messages: {
        ...s.messages,
        channels,
        dms,
        threads: { ...s.messages.threads, [tid]: [...(s.messages.threads[tid] || []), msgWithLocalTid] },
      },
    });

    // ── Toast + sound (only for messages not from me and not in active thread) ──
    if (!isActive && !isFromMe) {
      const isChannelThread = s.messages.channels.some((c) => c.id === tid);

      // Resolve sender display name
      const senderObj  = msg.userId && typeof msg.userId === 'object' ? msg.userId : null;
      const senderName = senderObj?.name
        || (s.users || []).find((u) => getId(u) === senderId)?.name
        || 'Someone';

      // Resolve thread label
      let threadLabel;
      if (isChannelThread) {
        const ch = s.messages.channels.find((c) => c.id === tid);
        threadLabel = ch?.name ? '#' + ch.name : '#channel';
      } else {
        const dm = s.messages.dms.find((d) => d.id === tid);
        threadLabel = dm?.name || senderName;
      }

      // Build preview text — strip HTML tags, truncate
      const rawText   = (msg.text || '').replace(/<[^>]*>/g, '').trim();
      const hasFile   = (msg.fileUrls?.length || msg.files?.length) > 0;
      const preview   = rawText
        ? (rawText.length > 60 ? rawText.slice(0, 60) + '…' : rawText)
        : (hasFile ? '📎 Attachment' : 'New message');

      const toastTitle = isChannelThread ? `${senderName} in ${threadLabel}` : threadLabel;

      // ── In-app react-hot-toast (clickable — navigates to the thread) ───
      toast.custom((t) => createElement('div', {
        onClick: () => {
          store.getState().setActiveThread(tid);
          window.dispatchEvent(new CustomEvent('crm:navigate-thread', { detail: { threadId: tid } }));
          toast.dismiss(t.id);
        },
        style: {
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          background: '#0f172a', color: '#f8fafc', borderRadius: '10px',
          padding: '12px 16px', fontSize: '13.5px', cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)', maxWidth: '320px',
          fontFamily: '"DM Sans", system-ui, sans-serif',
          opacity: t.visible ? 1 : 0, transition: 'opacity 0.2s',
        },
      },
        createElement('span', { style: { fontSize: '16px', flexShrink: 0, marginTop: '1px' } }, '💬'),
        createElement('div', { style: { minWidth: 0 } },
          createElement('div', { style: { fontWeight: 600, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, toastTitle),
          createElement('div', { style: { fontSize: '12px', opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, preview),
          createElement('div', { style: { fontSize: '10px', opacity: 0.45, marginTop: '3px' } }, 'Click to open'),
        ),
      ), { duration: 5000, position: 'bottom-right' });

      // ── OS / Browser notification ─────────────────────────────────────────
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        if ('serviceWorker' in navigator) {
          // Chrome/Brave/Edge: MUST use SW-based notification when a SW is registered.
          // new Notification() throws in these browsers when a SW controls the page.
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification(toastTitle, {
              body:    preview,
              icon:    '/favicon.ico',
              badge:   '/favicon.ico',
              tag:     tid,
              data:    { threadId: tid },
              renotify: true,
            }))
            .catch((err) => console.warn('[CRM] OS notification failed:', err));
        } else {
          // Firefox / Safari (no SW) — direct Notification API
          try {
            const n = new Notification(toastTitle, { body: preview, icon: '/favicon.ico', tag: tid });
            n.onclick = () => {
              window.focus();
              store.getState().setActiveThread(tid);
              window.dispatchEvent(new CustomEvent('crm:navigate-thread', { detail: { threadId: tid } }));
              n.close();
            };
          } catch (e) { console.warn('[CRM] OS notification failed:', e); }
        }
      }

      // Soft chime — lighter tone than the notification sound
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx  = new AudioCtx();
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(783.99, ctx.currentTime); // G5
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.18);
        }
      } catch {}
    }
  });
  sock.on('message:deleted', ({ id, threadId }) => store.setState((s) => {
    let tid = threadId;
    const myId = getId(s.authUser);
    if (tid && tid.startsWith('dm-') && tid.includes('-')) {
      const parts = tid.split('-');
      const otherId = parts[1] === myId ? parts[2] : parts[1];
      tid = `dm-${otherId}`;
    }
    return {
      messages: {
        ...s.messages,
        threads: {
          ...s.messages.threads,
          [tid]: (s.messages.threads[tid] || []).map((m) =>
            m._id === id ? { ...m, isDeleted: true } : m
          )
        }
      }
    };
  }));
  sock.on('message:updated', (msg) => store.setState((s) => {
    let tid = msg.threadId;
    const myId = getId(s.authUser);
    if (tid && tid.startsWith('dm-') && tid.includes('-')) {
      const parts = tid.split('-');
      const otherId = parts[1] === myId ? parts[2] : parts[1];
      tid = `dm-${otherId}`;
    }
    return {
      messages: {
        ...s.messages,
        threads: {
          ...s.messages.threads,
          [tid]: (s.messages.threads[tid] || []).map((m) => m._id === msg._id ? msg : m)
        }
      }
    };
  }));

  // Notifications — prepend to store, show toast, trigger browser notif + sound
  sock.on('notification:new', (notif) => {
    // Ignore events that arrive after logout (orphaned socket defence)
    if (!store.getState().authUser) return;
    store.setState((s) => ({ notifications: [notif, ...s.notifications] }));

    // message_dm type is already handled (better) by the message:new handler
    const isMessageNotif = notif.type === 'message_dm';

    // Declare outside any block so sound code below can use them too
    const priority = notif.priority || 'info';
    const isError  = priority === 'error' || priority === 'critical';
    const isWarn   = priority === 'warning';
    const isOk     = priority === 'success';

    // ── In-app toast (skip for DMs — message:new shows the better clickable toast) ──
    if (!isMessageNotif) {
      const emoji = isError ? '❌ ' : isWarn ? '⚠️ ' : isOk ? '✅ ' : '🔔 ';
      const msg   = emoji + notif.title + (notif.message ? '\n' + notif.message : '');
      const opts  = { id: String(notif._id), duration: isError ? 10000 : 5000, position: 'bottom-right' };
      if (isError)     toast.error(msg, opts);
      else if (isWarn) toast(msg, { ...opts, icon: '⚠️' });
      else if (isOk)   toast.success(msg, opts);
      else             toast(msg, { ...opts, icon: '🔔' });
    }

    // ── OS / Browser notification — ALL non-DM notification types ─────────
    // DMs are skipped here because message:new already sends their OS notification.
    if (!isMessageNotif && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(notif.title, {
            body:    notif.message,
            icon:    '/favicon.ico',
            badge:   '/favicon.ico',
            tag:     String(notif._id),
            renotify: true,
            data:    { link: notif.link || null },
          }))
          .catch((err) => console.warn('[CRM] OS notification failed:', err));
      } else {
        try {
          const n = new Notification(notif.title, { body: notif.message, icon: '/favicon.ico', tag: String(notif._id) });
          n.onclick = () => { window.focus(); n.close(); };
        } catch (e) { console.warn('[CRM] OS notification failed:', e); }
      }
    }

    // ── Sound (Web Audio API — no file dependency) ─────────────────────
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx  = new AudioCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        if (isError) {
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.35);
        } else {
          osc.frequency.setValueAtTime(523.25, ctx.currentTime);
          osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.28);
        }
      }
    } catch {}
  });

  // Dynamic channels
  sock.on('channel:created', (ch) => store.setState((s) => {
    const formatted = {
      id: ch._id,
      name: ch.name,
      type: 'channel',
      description: ch.description || '',
      isPrivate: !!ch.isPrivate,
      members: ch.members || [],
      createdBy: ch.createdBy || null,
      clientId:  ch.clientId  || null,
      projectId: ch.projectId || null,
      unread: 0
    };
    if (s.messages.channels.some((c) => c.id === ch._id)) return {};
    sock?.emit('join:thread', ch._id);
    return {
      messages: {
        ...s.messages,
        channels: [...s.messages.channels, formatted]
      }
    };
  }));

  sock.on('channel:updated', (ch) => store.setState((s) => {
    return {
      messages: {
        ...s.messages,
        channels: s.messages.channels.map((c) =>
          c.id === ch._id
            ? {
                ...c,
                name: ch.name,
                description: ch.description || '',
                isPrivate: !!ch.isPrivate,
                members: ch.members || [],
                createdBy: ch.createdBy ?? c.createdBy,
                clientId:  ch.clientId  ?? c.clientId,
                projectId: ch.projectId ?? c.projectId,
              }
            : c
        )
      }
    };
  }));

  sock.on('channel:deleted', (id) => store.setState((s) => {
    const newChannels = s.messages.channels.filter((c) => c.id !== String(id));
    let activeThread = s.activeThread;
    if (activeThread === String(id)) {
      activeThread = newChannels[0]?.id || null;
    }
    return {
      activeThread,
      messages: {
        ...s.messages,
        channels: newChannels
      }
    };
  }));

  // User presence
  sock.on('user:online',  ({ userId }) => {
    store.setState((s) => ({ users: s.users.map((u) => getId(u) === userId ? { ...u, status:'online' } : u) }));
    // Re-fetch this member's timer state from DB so timerActive/workSeconds are restored
    // (user:offline previously wiped timerActive to false)
    const me = store.getState().authUser;
    if (me?.role === 'admin' || me?.role === 'manager') {
      worklogAPI.getAll({ userId, date: localDateStr() })
        .then(({ data }) => {
          const log = (data?.data || [])[0];
          if (log) {
            store.setState((s) => ({
              users: s.users.map((u) => getId(u) === userId ? {
                ...u,
                timerActive:       log.active,
                timerBreakActive:  log.breakActive,
                timerWorkSeconds:  log.workSeconds || 0,
                timerSessionStart: log.sessionStart,
                timerTargetSeconds:log.targetSeconds || 8 * 3600,
                timerLastUpdated:  Date.now(),
              } : u)
            }));
          }
        }).catch(() => {});
    }
  });
  sock.on('user:offline', ({ userId })          => store.setState((s) => ({ users: s.users.map((u) => getId(u) === userId ? { ...u, status:'offline', timerActive: false, timerBreakActive: false } : u) })));
  sock.on('user:status',  ({ userId, status }) => store.setState((s) => ({ users: s.users.map((u) => getId(u) === userId ? { ...u, status } : u) })));

  // User profile/role updated by admin — merge into users array for all clients
  sock.on('user:updated', (updatedUser) => {
    store.setState((s) => ({
      users: s.users.map((u) =>
        getId(u) === getId(updatedUser)
          ? { ...u, ...updatedUser }  // merge — preserves timer fields
          : u
      ),
    }));
  });

  // System settings updated — sync to all clients instantly
  sock.on('settings:updated', (settings) => {
    store.setState({ systemSettings: settings });
  });

  // Role changed — the affected user's own session gets this event
  sock.on('role:changed', ({ role }) => {
    const me = store.getState().authUser;
    if (me) {
      store.setState({ authUser: { ...me, role } });
      // Reload data so access-restricted endpoints are re-fetched with new role
      store.getState().loadAllData();
      toast.success(`Your role has been updated to ${role.charAt(0).toUpperCase() + role.slice(1)}`);
    }
  });

  sock.on('member:timer:update', (payload) => {
    store.setState((s) => ({
      users: s.users.map((u) =>
        getId(u) === payload.userId
          ? {
              ...u,
              timerActive:       payload.active       ?? u.timerActive,
              timerBreakActive:  payload.breakActive  ?? u.timerBreakActive,
              timerWorkSeconds:  payload.workSeconds  ?? u.timerWorkSeconds,
              timerSessionStart: payload.sessionStart || u.timerSessionStart,
              timerTargetSeconds:payload.targetSeconds|| u.timerTargetSeconds,
              timerLastUpdated:  Date.now(),
            }
          : u
      ),
    }));
  });

  // Cross-session timer sync — adopt the authoritative value from another browser tab
  sock.on('timer:sync', (payload) => {
    store.setState((s) => {
      const incoming = payload.workSeconds ?? 0;
      // Always take the higher value (the tab that's been ticking longer wins)
      // Also sync active/break state so pause/resume propagates instantly
      const merged = {
        ...s.timer,
        workSeconds:  Math.max(s.timer.workSeconds, incoming),
        active:       payload.active       ?? s.timer.active,
        breakActive:  payload.breakActive  ?? s.timer.breakActive,
        sessionDate:  payload.sessionDate  || s.timer.sessionDate,
        sessionStart: payload.sessionStart || s.timer.sessionStart,
        targetSeconds:payload.targetSeconds|| s.timer.targetSeconds,
      };
      return { timer: merged };
    });
  });
}

function disconnectSocket() {
  // Remove window handlers FIRST — prevent focus/visibility from triggering sock.connect() mid-logout
  if (_beforeUnloadFn) { window.removeEventListener('beforeunload', _beforeUnloadFn); _beforeUnloadFn = null; }
  if (_focusHandler) { window.removeEventListener('focus', _focusHandler); _focusHandler = null; }
  if (_visibilityHandler) { window.removeEventListener('visibilitychange', _visibilityHandler); _visibilityHandler = null; }
  if (sock) {
    try { sock.io.reconnection(false); } catch {} // disable auto-reconnect before anything else
    sock.removeAllListeners();                     // strip all handlers — orphaned socket cannot fire toasts
    sock.disconnect();
    sock = null;
  }
}

// ════════════════════════════════════════════════════════════
const useAppStore = create((set, get, store) => ({

  // ── State ──────────────────────────────────────────────────
  authUser:   null,
  users:      [],
  tasks:      [],
  todos:      [],
  clients:    [],
  meetings:   [],
  mySchedule: [],
  revenueSummary: null,
  messages:   { channels: DEFAULT_CHANNELS, dms: [], threads: {} },
  notifications: [],
  services:   [],
  projects:   [],
  leads:      [],
  campaigns:      [],   // lazy-loaded — only fetched when the Campaigns page mounts
  campaignLeads:  [],   // leads for whichever campaign is currently open
  prospectAuditBatches: [], // lazy-loaded — only fetched when the Prospect Audits page mounts
  prospectAudits:       [], // prospects for whichever batch is currently open
  socialAccounts: [], // connected Facebook Pages / Instagram / LinkedIn accounts
  socialPosts:    [], // lazy-loaded — only fetched when a Social Media page mounts
  socialPostDetail: null, // { post, publications } for whichever post is currently open
  emailAccounts:  [],   // sending accounts pool, lazy-loaded alongside campaigns
  emailTemplates: [],   // reusable email content library, lazy-loaded in Compose
  systemSettings: null,
  timer:      initialTimer(),
  activeThread: null,
  sidebarOpen:true,
  darkMode:   false,
  loading:    false,
  socketConnected: false,
  _loggingOut:false,

  // ── UI ─────────────────────────────────────────────────────
  toggleSidebar:  () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleDarkMode: () => set((s) => { const n=!s.darkMode; document.documentElement.classList.toggle('dark',n); return { darkMode:n }; }),
  markAllRead: async () => {
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
    try { await notificationsAPI.markAllRead(); } catch {}
  },
  dismissNotification: async (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n._id !== id) }));
    try { await notificationsAPI.delete(id); } catch {}
  },

  // ── Services ───────────────────────────────────────────────
  addService: async (body) => {
    const { data } = await servicesAPI.create(body);
    set((s) => ({ services: [...s.services, data.data] }));
    return data.data;
  },
  updateService: async (id, body) => {
    const { data } = await servicesAPI.update(id, body);
    set((s) => ({ services: s.services.map((sv) => sv._id === id ? data.data : sv) }));
  },
  deleteService: async (id) => {
    await servicesAPI.delete(id);
    set((s) => ({ services: s.services.filter((sv) => sv._id !== id) }));
  },

  // ── Projects ───────────────────────────────────────────────
  addProject: async (body) => {
    const { data } = await projectsAPI.create(body);
    set((s) => ({ projects: [...s.projects, data.data] }));
    // Increment projectCount on Client in store
    set((s) => ({
      clients: s.clients.map((c) =>
        sameId(c, body.clientId) ? { ...c, projectCount: c.projectCount + 1 } : c
      )
    }));
    return data.data;
  },
  updateProject: async (id, body) => {
    const { data } = await projectsAPI.update(id, body);
    set((s) => ({ projects: s.projects.map((p) => p._id === id ? data.data : p) }));
    return data.data;
  },
  deleteProject: async (id) => {
    const project = useAppStore.getState().projects.find((p) => p._id === id);
    await projectsAPI.delete(id);
    set((s) => ({ projects: s.projects.filter((p) => p._id !== id) }));
    if (project) {
      // Decrement projectCount on Client in store
      set((s) => ({
        clients: s.clients.map((c) =>
          sameId(c, project.clientId) ? { ...c, projectCount: c.projectCount - 1 } : c
        )
      }));
    }
  },

  // ── Leads ──────────────────────────────────────────────────
  loadLeads: async () => {
    try {
      const { data } = await leadsAPI.getAll();
      set({ leads: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load leads');
    }
  },
  createLead: async (body) => {
    try {
      const { data } = await leadsAPI.create(body);
      set((s) => {
        const already = s.leads.some((x) => sameId(x, data.data));
        if (already) return {};
        return { leads: [data.data, ...s.leads] };
      });
      toast.success('Lead created successfully');
      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create lead';
      toast.error(msg);
      throw err;
    }
  },
  bulkCreateLeads: async (leads) => {
    try {
      const { data } = await leadsAPI.bulkCreate(leads);
      set((s) => {
        const newLeads = (data.data || []).filter((l) => !s.leads.some((x) => sameId(x, l)));
        if (newLeads.length === 0) return {};
        return { leads: [...newLeads, ...s.leads] };
      });
      toast.success(`Successfully imported ${data.count} leads in bulk!`);
      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to import bulk leads';
      toast.error(msg);
      throw err;
    }
  },
  updateLead: async (id, body) => {
    try {
      const { data } = await leadsAPI.update(id, body);
      set((s) => ({ leads: s.leads.map((l) => l._id === id ? data.data : l) }));
      
      // If B2B conversion trigger initialized dynamic client/projects, reload catalog to sync UI
      if (body.status === 'Won') {
        const { data: clientsData } = await clientsAPI.getAll();
        const { data: projectsData } = await projectsAPI.getAll();
        set({ clients: clientsData.data, projects: projectsData.data });
      }

      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update lead';
      toast.error(msg);
      throw err;
    }
  },
  deleteLead: async (id) => {
    try {
      await leadsAPI.delete(id);
      set((s) => ({ leads: s.leads.filter((l) => l._id !== id) }));
      toast.success('Lead deleted successfully');
    } catch (err) {
      toast.error('Failed to delete lead');
      throw err;
    }
  },
  mergeLeads: async (body) => {
    try {
      const { data } = await leadsAPI.merge(body);
      // Reload leads timeline and client profiles to fully capture changes
      const { data: leadsData } = await leadsAPI.getAll();
      set({ leads: leadsData.data });
      toast.success('Duplicate B2B leads merged successfully');
      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to merge leads';
      toast.error(msg);
      throw err;
    }
  },

  // ── Email Accounts (campaign sending infra) ──────────────────
  loadEmailAccounts: async () => {
    try {
      const { data } = await emailAccountsAPI.getAll();
      set({ emailAccounts: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load email accounts');
    }
  },
  createEmailAccount: async (body) => {
    try {
      const { data } = await emailAccountsAPI.create(body);
      set((s) => ({ emailAccounts: [data.data, ...s.emailAccounts] }));
      toast.success('Email account added');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add email account');
      throw err;
    }
  },
  updateEmailAccount: async (id, body) => {
    try {
      const { data } = await emailAccountsAPI.update(id, body);
      set((s) => ({ emailAccounts: s.emailAccounts.map((a) => sameId(a, id) ? data.data : a) }));
      toast.success('Email account updated');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update email account');
      throw err;
    }
  },
  deleteEmailAccount: async (id) => {
    try {
      await emailAccountsAPI.delete(id);
      set((s) => ({ emailAccounts: s.emailAccounts.filter((a) => !sameId(a, id)) }));
      toast.success('Email account removed');
    } catch (err) {
      toast.error('Failed to remove email account');
      throw err;
    }
  },
  // Returns { success, smtp: {ok,message}, imap: {ok,message}|null } so the
  // UI can show per-protocol pass/fail, not just a single toast.
  testEmailAccount: async (id) => {
    try {
      const { data } = await emailAccountsAPI.test(id);
      toast.success('Connection successful');
      get().loadEmailAccounts();
      return data;
    } catch (err) {
      const data = err.response?.data;
      const parts = [];
      if (data?.smtp && !data.smtp.ok) parts.push(`SMTP: ${data.smtp.message}`);
      if (data?.imap && !data.imap.ok) parts.push(`IMAP: ${data.imap.message}`);
      toast.error(parts.length ? parts.join(' · ') : (data?.message || 'Connection test failed'));
      get().loadEmailAccounts();
      return data || { success: false };
    }
  },
  checkAccountDomain: async (id) => {
    try {
      const { data } = await emailAccountsAPI.checkDomain(id);
      return data.data;
    } catch (err) {
      toast.error('Domain check failed');
      throw err;
    }
  },
  testAssignmentSheet: async () => {
    try {
      const { data } = await settingsAPI.testAssignmentSheet();
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Assignment sheet test failed');
      throw err;
    }
  },

  // ── Campaigns ─────────────────────────────────────────────────
  loadCampaigns: async () => {
    try {
      const { data } = await campaignsAPI.getAll();
      set({ campaigns: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load campaigns');
    }
  },
  loadCampaign: async (id) => {
    try {
      const { data } = await campaignsAPI.getOne(id);
      set((s) => {
        const already = s.campaigns.some((c) => sameId(c, data.data));
        return { campaigns: already ? s.campaigns.map((c) => sameId(c, data.data) ? data.data : c) : [data.data, ...s.campaigns] };
      });
      return data.data;
    } catch (err) {
      toast.error('Failed to load campaign');
      throw err;
    }
  },
  createCampaign: async (body) => {
    try {
      const { data } = await campaignsAPI.create(body);
      set((s) => ({ campaigns: [data.data, ...s.campaigns] }));
      toast.success('Campaign created');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create campaign');
      throw err;
    }
  },
  updateCampaign: async (id, body) => {
    try {
      const { data } = await campaignsAPI.update(id, body);
      set((s) => ({ campaigns: s.campaigns.map((c) => sameId(c, id) ? data.data : c) }));
      toast.success('Campaign updated');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update campaign');
      throw err;
    }
  },
  deleteCampaign: async (id) => {
    try {
      await campaignsAPI.delete(id);
      set((s) => ({ campaigns: s.campaigns.filter((c) => !sameId(c, id)) }));
      toast.success('Campaign deleted');
    } catch (err) {
      toast.error('Failed to delete campaign');
      throw err;
    }
  },
  startCampaign: async (id) => {
    try {
      const { data } = await campaignsAPI.start(id);
      // Spread the full returned campaign (not just status) — starting also
      // clears scheduledAt/scheduleFailedReason server-side, and only
      // merging `status` here would leave those stale in the list view
      // until the next full reload.
      set((s) => ({ campaigns: s.campaigns.map((c) => sameId(c, id) ? { ...c, ...data.data } : c) }));
      toast.success('Campaign started');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start campaign');
      throw err;
    }
  },
  scheduleCampaign: async (id, scheduledAt) => {
    try {
      const { data } = await campaignsAPI.schedule(id, scheduledAt);
      set((s) => ({ campaigns: s.campaigns.map((c) => sameId(c, id) ? { ...c, ...data.data } : c) }));
      toast.success(`Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to schedule campaign');
      throw err;
    }
  },
  unscheduleCampaign: async (id) => {
    try {
      const { data } = await campaignsAPI.unschedule(id);
      set((s) => ({ campaigns: s.campaigns.map((c) => sameId(c, id) ? { ...c, ...data.data } : c) }));
      toast.success('Schedule cancelled');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel schedule');
      throw err;
    }
  },
  pauseCampaign: async (id) => {
    try {
      const { data } = await campaignsAPI.pause(id);
      set((s) => ({ campaigns: s.campaigns.map((c) => sameId(c, id) ? { ...c, ...data.data } : c) }));
      toast.success('Campaign paused');
      return data.data;
    } catch (err) {
      toast.error('Failed to pause campaign');
      throw err;
    }
  },
  diagnoseCampaign: async (id) => {
    try {
      const { data } = await campaignsAPI.diagnose(id);
      return data.data;
    } catch (err) {
      toast.error('Failed to run diagnosis');
      throw err;
    }
  },
  resolveStuckCampaignLeads: async (id) => {
    try {
      const { data } = await campaignsAPI.resolveStuck(id);
      toast.success(data.data.reset ? `Reset ${data.data.reset} stuck lead(s) — they'll be picked up again shortly` : 'No stuck leads found');
      await get().loadCampaignLeads(id);
      return data.data;
    } catch (err) {
      toast.error('Failed to resolve stuck leads');
      throw err;
    }
  },
  loadCampaignLeads: async (campaignId) => {
    try {
      const { data } = await campaignsAPI.getLeads(campaignId);
      set({ campaignLeads: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load campaign leads');
    }
  },
  importCampaignLeadsCsv: async (campaignId, file) => {
    try {
      const { data } = await campaignsAPI.importLeadsCsv(campaignId, file);
      return await get()._reportLeadImport(campaignId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to import leads');
      throw err;
    }
  },
  importCampaignLeadsSheet: async (campaignId, googleSheetUrl) => {
    try {
      const { data } = await campaignsAPI.importLeadsSheet(campaignId, googleSheetUrl);
      return await get()._reportLeadImport(campaignId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to import from Google Sheet');
      throw err;
    }
  },
  addCampaignLeadManual: async (campaignId, lead) => {
    try {
      const { data } = await campaignsAPI.importLeadsJson(campaignId, [lead]);
      if (!data.data.imported) {
        toast.error(data.data.invalidRows ? 'Invalid email address' : 'That lead is already in this campaign');
      } else {
        toast.success('Lead added');
      }
      await get().loadCampaignLeads(campaignId);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add lead');
      throw err;
    }
  },
  // Shared toast + reload for the three import paths above (CSV/Sheet share
  // the exact same { imported, skippedDuplicates, invalidRows } response).
  _reportLeadImport: async (campaignId, result) => {
    const { imported, skippedDuplicates, invalidRows, verifying } = result;
    const suffix = `${skippedDuplicates ? ` (${skippedDuplicates} duplicates skipped)` : ''}${invalidRows ? ` (${invalidRows} invalid rows)` : ''}`;
    // Large imports skip synchronous MX verification (see campaignController
    // .importLeads) so the request itself doesn't time out — it finishes in
    // the background instead, so say so rather than implying it's already
    // fully verified like the normal (small-import) path is.
    if (verifying) {
      toast.success(`Imported ${imported} leads${suffix} — verifying email deliverability in the background, this can take a few minutes for a large list.`, { duration: 6000 });
    } else {
      toast.success(`Imported ${imported} leads${suffix}`);
    }
    await get().loadCampaignLeads(campaignId);
    return result;
  },
  // Backfills `phone` on leads ALREADY in the campaign (matched by email) —
  // safe on a live/actively-sending campaign, unlike re-running import.
  updateCampaignLeadPhonesCsv: async (campaignId, file) => {
    try {
      const { data } = await campaignsAPI.updatePhonesCsv(campaignId, file);
      return await get()._reportPhoneUpdate(campaignId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update phone numbers');
      throw err;
    }
  },
  updateCampaignLeadPhonesSheet: async (campaignId, googleSheetUrl) => {
    try {
      const { data } = await campaignsAPI.updatePhonesSheet(campaignId, googleSheetUrl);
      return await get()._reportPhoneUpdate(campaignId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update phone numbers from Google Sheet');
      throw err;
    }
  },
  _reportPhoneUpdate: async (campaignId, result) => {
    const { updated, notFound, skippedNoPhone } = result;
    toast.success(`Updated ${updated} phone number${updated === 1 ? '' : 's'}${notFound ? ` (${notFound} emails not found in this campaign)` : ''}${skippedNoPhone ? ` (${skippedNoPhone} rows had no phone)` : ''}`);
    await get().loadCampaignLeads(campaignId);
    return result;
  },
  verifyCampaignLead: async (campaignId, leadId) => {
    try {
      const { data } = await campaignsAPI.verifyLead(campaignId, leadId);
      set((s) => ({ campaignLeads: s.campaignLeads.map((l) => sameId(l, leadId) ? data.data : l) }));
      return data.data;
    } catch (err) {
      toast.error('Failed to verify lead');
      throw err;
    }
  },
  verifyAllCampaignLeads: async (campaignId) => {
    try {
      const { data } = await campaignsAPI.verifyAllLeads(campaignId);
      toast.success(data.data.verified ? `Verified ${data.data.verified} leads` : 'All leads already verified');
      await get().loadCampaignLeads(campaignId);
      return data.data;
    } catch (err) {
      toast.error('Failed to verify leads');
      throw err;
    }
  },
  uploadCampaignImage: async (file) => {
    try {
      const { data } = await campaignsAPI.uploadImage(file);
      return `${getBackendUrl()}${data.data.url}`; // absolute URL — email clients can't resolve relative paths
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to upload image');
      throw err;
    }
  },

  // ── Prospect Audits ──────────────────────────────────────────
  loadProspectAuditBatches: async () => {
    try {
      const { data } = await prospectAuditsAPI.getAll();
      set({ prospectAuditBatches: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load prospect audit batches');
    }
  },
  loadProspectAuditBatch: async (id) => {
    try {
      const { data } = await prospectAuditsAPI.getOne(id);
      set((s) => {
        const already = s.prospectAuditBatches.some((b) => sameId(b, data.data));
        return { prospectAuditBatches: already ? s.prospectAuditBatches.map((b) => sameId(b, data.data) ? data.data : b) : [data.data, ...s.prospectAuditBatches] };
      });
      return data.data;
    } catch (err) {
      toast.error('Failed to load batch');
      throw err;
    }
  },
  createProspectAuditBatch: async (body) => {
    try {
      const { data } = await prospectAuditsAPI.create(body);
      set((s) => ({ prospectAuditBatches: [data.data, ...s.prospectAuditBatches] }));
      toast.success('Batch created');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create batch');
      throw err;
    }
  },
  deleteProspectAuditBatch: async (id) => {
    try {
      await prospectAuditsAPI.delete(id);
      set((s) => ({ prospectAuditBatches: s.prospectAuditBatches.filter((b) => !sameId(b, id)) }));
      toast.success('Batch deleted');
    } catch (err) {
      toast.error('Failed to delete batch');
      throw err;
    }
  },
  startProspectAuditCrawl: async (id) => {
    try {
      const { data } = await prospectAuditsAPI.start(id);
      set((s) => ({ prospectAuditBatches: s.prospectAuditBatches.map((b) => sameId(b, id) ? { ...b, ...data.data } : b) }));
      toast.success('Crawl started');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start crawl');
      throw err;
    }
  },
  pauseProspectAuditCrawl: async (id) => {
    try {
      const { data } = await prospectAuditsAPI.pause(id);
      set((s) => ({ prospectAuditBatches: s.prospectAuditBatches.map((b) => sameId(b, id) ? { ...b, ...data.data } : b) }));
      toast.success('Crawl paused');
      return data.data;
    } catch (err) {
      toast.error('Failed to pause crawl');
      throw err;
    }
  },
  loadProspectAudits: async (batchId) => {
    try {
      const { data } = await prospectAuditsAPI.getProspects(batchId);
      set({ prospectAudits: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load prospects');
    }
  },
  deleteProspectAudit: async (batchId, prospectId) => {
    try {
      await prospectAuditsAPI.deleteProspect(batchId, prospectId);
      set((s) => ({ prospectAudits: s.prospectAudits.filter((p) => !sameId(p, prospectId)) }));
      toast.success('Prospect removed');
    } catch (err) {
      toast.error('Failed to remove prospect');
      throw err;
    }
  },
  importProspectAuditsCsv: async (batchId, file) => {
    try {
      const { data } = await prospectAuditsAPI.importCsv(batchId, file);
      return await get()._reportProspectImport(batchId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to import prospects');
      throw err;
    }
  },
  importProspectAuditsSheet: async (batchId, googleSheetUrl) => {
    try {
      const { data } = await prospectAuditsAPI.importSheet(batchId, googleSheetUrl);
      return await get()._reportProspectImport(batchId, data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to import prospects');
      throw err;
    }
  },
  _reportProspectImport: async (batchId, result) => {
    const { imported, skippedDuplicates } = result;
    toast.success(`Imported ${imported} prospects${skippedDuplicates ? ` (${skippedDuplicates} duplicates skipped)` : ''}`);
    await get().loadProspectAuditBatch(batchId);
    await get().loadProspectAudits(batchId);
    return result;
  },

  // ── Social Media Management ───────────────────────────────────
  loadSocialAccounts: async () => {
    try {
      const { data } = await socialAPI.getAccounts();
      set({ socialAccounts: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load connected accounts');
    }
  },
  disconnectSocialAccount: async (id) => {
    try {
      await socialAPI.deleteAccount(id);
      set((s) => ({ socialAccounts: s.socialAccounts.filter((a) => !sameId(a, id)) }));
      toast.success('Account disconnected');
    } catch (err) {
      toast.error('Failed to disconnect account');
      throw err;
    }
  },

  loadSocialPosts: async (params) => {
    try {
      const { data } = await socialAPI.getPosts(params);
      set({ socialPosts: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load posts');
    }
  },
  loadSocialPostDetail: async (id) => {
    try {
      const { data } = await socialAPI.getPost(id);
      set({ socialPostDetail: data.data });
      return data.data;
    } catch (err) {
      toast.error('Failed to load post');
      throw err;
    }
  },
  createSocialPost: async (body) => {
    try {
      const { data } = await socialAPI.createPost(body);
      set((s) => ({ socialPosts: [data.data, ...s.socialPosts] }));
      return data.data;
    } catch (err) {
      const errs = err.response?.data?.errors;
      toast.error(errs?.[0]?.message || err.response?.data?.message || 'Failed to create post');
      throw err;
    }
  },
  updateSocialPost: async (id, body) => {
    try {
      const { data } = await socialAPI.updatePost(id, body);
      set((s) => ({ socialPosts: s.socialPosts.map((p) => sameId(p, id) ? data.data : p) }));
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update post');
      throw err;
    }
  },
  deleteSocialPost: async (id) => {
    try {
      await socialAPI.deletePost(id);
      set((s) => ({ socialPosts: s.socialPosts.filter((p) => !sameId(p, id)) }));
      toast.success('Post deleted');
    } catch (err) {
      toast.error('Failed to delete post');
      throw err;
    }
  },
  publishSocialPost: async (id) => {
    try {
      const { data } = await socialAPI.publishPost(id);
      set((s) => ({ socialPosts: s.socialPosts.map((p) => sameId(p, id) ? data.data : p) }));
      toast.success('Publishing now');
      return data.data;
    } catch (err) {
      const errs = err.response?.data?.errors;
      toast.error(errs?.[0]?.message || err.response?.data?.message || 'Failed to publish');
      throw err;
    }
  },
  scheduleSocialPost: async (id, scheduledAt) => {
    try {
      const { data } = await socialAPI.schedulePost(id, scheduledAt);
      set((s) => ({ socialPosts: s.socialPosts.map((p) => sameId(p, id) ? data.data : p) }));
      toast.success('Post scheduled');
      return data.data;
    } catch (err) {
      const errs = err.response?.data?.errors;
      toast.error(errs?.[0]?.message || err.response?.data?.message || 'Failed to schedule');
      throw err;
    }
  },
  cancelSocialPost: async (id) => {
    try {
      const { data } = await socialAPI.cancelPost(id);
      set((s) => ({ socialPosts: s.socialPosts.map((p) => sameId(p, id) ? data.data : p) }));
      toast.success('Post cancelled');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel post');
      throw err;
    }
  },
  retrySocialPublication: async (id, postId) => {
    try {
      await socialAPI.retryPublication(id);
      toast.success('Retrying…');
      if (postId) await get().loadSocialPostDetail(postId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Retry failed');
      throw err;
    }
  },
  uploadSocialMedia: async (file) => {
    try {
      const { data } = await socialAPI.uploadMedia(file);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to upload media');
      throw err;
    }
  },
  loadSocialAnalytics: async () => {
    try {
      const { data } = await socialAPI.getAnalytics();
      return data.data;
    } catch (err) {
      toast.error('Failed to load analytics');
    }
  },

  loadSocialPlatformStatus: async (platform) => {
    try {
      const { data } = await socialPlatformSettingsAPI.status(platform);
      return data.data;
    } catch (err) {
      toast.error(`Failed to load ${platform} status`);
    }
  },
  saveSocialPlatformCredentials: async (platform, body) => {
    try {
      await socialPlatformSettingsAPI.saveCredentials(platform, body);
      toast.success('Saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
      throw err;
    }
  },

  // ── Email Templates ──────────────────────────────────────────
  loadEmailTemplates: async () => {
    try {
      const { data } = await emailTemplatesAPI.getAll();
      set({ emailTemplates: data.data || [] });
      return data.data;
    } catch (err) {
      toast.error('Failed to load templates');
    }
  },
  createEmailTemplate: async (body) => {
    try {
      const { data } = await emailTemplatesAPI.create(body);
      set((s) => ({ emailTemplates: [data.data, ...s.emailTemplates] }));
      toast.success('Template saved');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save template');
      throw err;
    }
  },
  updateEmailTemplate: async (id, body) => {
    try {
      const { data } = await emailTemplatesAPI.update(id, body);
      set((s) => ({ emailTemplates: s.emailTemplates.map((t) => sameId(t, id) ? data.data : t) }));
      toast.success('Template updated');
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update template');
      throw err;
    }
  },
  deleteEmailTemplate: async (id) => {
    try {
      await emailTemplatesAPI.delete(id);
      set((s) => ({ emailTemplates: s.emailTemplates.filter((t) => !sameId(t, id)) }));
      toast.success('Template deleted');
    } catch (err) {
      toast.error('Failed to delete template');
      throw err;
    }
  },

  deleteCampaignLead: async (campaignId, leadId) => {
    try {
      await campaignsAPI.deleteLead(campaignId, leadId);
      set((s) => ({ campaignLeads: s.campaignLeads.filter((l) => !sameId(l, leadId)) }));
    } catch (err) {
      toast.error('Failed to remove lead');
      throw err;
    }
  },
  markCampaignLeadReplied: async (campaignId, leadId) => {
    try {
      const { data } = await campaignsAPI.markReplied(campaignId, leadId);
      set((s) => ({ campaignLeads: s.campaignLeads.map((l) => sameId(l, leadId) ? data.data : l) }));
      toast.success('Marked as replied — no further emails will be sent to this lead');
    } catch (err) {
      toast.error('Failed to update lead');
      throw err;
    }
  },

  // ── Settings ───────────────────────────────────────────────
  fetchSystemSettings: async () => {
    try {
      const { data } = await settingsAPI.get();
      set({ systemSettings: data.data });
      return data.data;
    } catch (err) {
      console.error('Failed to fetch system settings', err);
    }
  },
  updateSystemSettings: async (body) => {
    try {
      const { data } = await settingsAPI.update(body);
      set({ systemSettings: data.data });
      toast.success('Settings updated successfully');
      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update settings';
      toast.error(msg);
      throw err;
    }
  },
  inviteUser: async (body) => {
    try {
      const { data } = await settingsAPI.invite(body);
      set((s) => ({ users: [...s.users, data.data] }));
      toast.success(`Invitation sent to ${body.name}!`);
      return data.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to invite user';
      toast.error(msg);
      throw err;
    }
  },

  setActiveThread: (threadId) => {
    set({ activeThread: threadId });
    get().markThreadRead(threadId);
  },
  markThreadRead: (threadId) => {
    // Clear from localStorage so reload doesn't restore a stale count
    const uid = getId(get().authUser);
    if (uid) {
      const saved = loadUnreadLS(uid);
      if (saved[threadId]) { delete saved[threadId]; saveUnreadLS(uid, saved); }
    }
    set((s) => {
      const isChannel = s.messages.channels.some((c) => c.id === threadId);
      if (isChannel) {
        return {
          messages: {
            ...s.messages,
            channels: s.messages.channels.map((c) =>
              c.id === threadId ? { ...c, unread: 0 } : c
            )
          }
        };
      } else {
        return {
          messages: {
            ...s.messages,
            dms: s.messages.dms.map((d) =>
              d.id === threadId ? { ...d, unread: 0 } : d
            )
          }
        };
      }
    });
  },

  // ══════════════════════════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════════════════════════
  login: async (email, password) => {
    try {
      const { data } = await authAPI.login({ email, password });
      localStorage.setItem('crm_access_token', data.accessToken);
      const user = data.user;

      // Timer: restore same-day from DB or localStorage or start fresh
      const today = todayStr();
      let dbTimer = null;
      try {
        const { data: wlData } = await worklogAPI.getAll();
        const logs = wlData?.data || [];
        const todayLog = logs.find(l => l.date === today);
        if (todayLog) {
          dbTimer = {
            active: todayLog.active,
            workSeconds: todayLog.workSeconds || 0,
            sessionDate: todayLog.date,
            sessionStart: todayLog.sessionStart || new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
            breaks: todayLog.breaks || [],
            breakActive: todayLog.breakActive || false,
            currentBreak: null,
            targetSeconds: todayLog.targetSeconds || (8 * 3600),
          };
        }
      } catch (err) {
        console.error('Failed to load timer from DB', err);
      }

      const saved = loadTimerLS(getId(user));
      let timerState = initialTimer();

      // DB is the source of truth for active/breakActive (only explicit check-in/pause/
      // break/logout/unload-beacon writes it) — localStorage only ever contributes a
      // possibly-fresher workSeconds/breaks if this device ticked past the DB's last
      // 15s sync boundary before a crash/close.
      if (dbTimer) {
        const sameDayLocal = saved && saved.sessionDate === today;
        timerState = {
          ...dbTimer,
          workSeconds: Math.max(dbTimer.workSeconds || 0, sameDayLocal ? (saved.workSeconds || 0) : 0),
          breaks:      sameDayLocal && saved.breaks?.length > dbTimer.breaks?.length ? saved.breaks : dbTimer.breaks,
          // Resume from the last persisted tick (if this device saved one at least as fresh as the
          // DB) so time that passed while the tab was frozen/discarded/reloading is credited by the
          // first tick instead of being lost. tickTimer caps any single gap at IDLE_GAP_CAP_S.
          lastTickTime: dbTimer.active
            ? (sameDayLocal && saved.lastTickTime && (saved.workSeconds || 0) >= (dbTimer.workSeconds || 0) ? saved.lastTickTime : Date.now())
            : null,
        };
      } else if (saved && saved.sessionDate === today) {
        timerState = { ...saved, breakActive: false, currentBreak: null };
      }
      // No auto-start on login — the member must press "Start Timer" to check in.

      set({ authUser:user, timer:timerState, loading:false });
      saveTimerLS(getId(user), timerState);

      // Request browser notification permission silently after login
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }

      // Sync active state back to database if timer is restored as active
      if (timerState.active && user.role === 'member') {
        worklogAPI.setActive(true).catch(()=>{});
        worklogAPI.upsert({
          date: timerState.sessionDate || today,
          workSeconds: timerState.workSeconds,
          sessionStart: timerState.sessionStart,
          breaks: timerState.breaks,
          active: true,
          breakActive: timerState.breakActive,
          targetSeconds: timerState.targetSeconds || (8 * 3600),
        }).catch(()=>{});
      } else if (!dbTimer && user.role === 'member') {
        // If there was no DB log yet, create it so subsequent refreshes find it in the DB
        worklogAPI.upsert({
          date: timerState.sessionDate,
          workSeconds: timerState.workSeconds,
          sessionStart: timerState.sessionStart,
          breaks: timerState.breaks,
          active: timerState.active,
          breakActive: timerState.breakActive,
          targetSeconds: timerState.targetSeconds,
        }).catch(()=>{});
      }

      // Load all data then connect socket
      await get().loadAllData();
      connectSocket(store);

      return { success:true, user };
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed';
      toast.error(msg);
      return { success:false, message:msg };
    }
  },

  logout: async () => {
    // Guard against re-entrant calls (crm:logout event can re-trigger this)
    if (get()._loggingOut) return;
    set({ _loggingOut: true });

    const { authUser, timer } = get();

    // Make API calls BEFORE removing the token so they still have auth.
    // Awaited (not fire-and-forget) — if the page navigates/reloads right
    // after logout (e.g. a forced logout from an expired session), an
    // in-flight, un-awaited request here can get cancelled by the browser
    // before it reaches the server. The WorkLog is then left stuck at
    // active:true, and the next login — which treats the DB as the source
    // of truth for active/breakActive — silently resumes the timer with no
    // Start Timer click. Awaiting closes that race.
    if (authUser) {
      // Sync final worklog
      if (timer.workSeconds > 0) {
        await worklogAPI.upsert({ date:timer.sessionDate||todayStr(), workSeconds:timer.workSeconds, sessionStart:timer.sessionStart, breaks:timer.breaks, active:false }).catch(()=>{});
      }
      await worklogAPI.setActive(false).catch(()=>{});
    }
    try { await authAPI.logout(); } catch {}

    // NOW clear the token and state
    localStorage.removeItem('crm_access_token');
    clearUnreadLS(getId(get().authUser));
    disconnectSocket();
    set({ _loggingOut: false, socketConnected: false, authUser:null, users:[], tasks:[], todos:[], clients:[], meetings:[], timer:initialTimer(), messages:{ channels:DEFAULT_CHANNELS, dms:[], threads:{} }, notifications: [], services: [], projects: [] });
  },

  changePassword: async (currentPassword, newPassword) => {
    try {
      await authAPI.changePassword({ currentPassword, newPassword });
      toast.success('Password updated successfully!');
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update password';
      toast.error(msg);
      return { success: false, message: msg };
    }
  },

  updateProfile: async (body) => {
    try {
      const { data } = await authAPI.updateProfile(body);
      set({ authUser: data.user });
      return { success: true, user: data.user };
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update profile';
      toast.error(msg);
      return { success: false, message: msg };
    }
  },

  // Profile picture (DP): upload a new image or remove the current one
  updateAvatar: async (file) => {
    try {
      const { data } = file ? await authAPI.uploadAvatar(file) : await authAPI.removeAvatar();
      set((s) => ({ authUser: { ...s.authUser, avatar: data.user.avatar } }));
      return { success: true, user: data.user };
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update profile picture';
      toast.error(msg);
      return { success: false, message: msg };
    }
  },

  // Restore session on page reload using stored token
  restoreSession: async () => {
    const token = localStorage.getItem('crm_access_token');
    if (!token) return false;
    try {
      const { data } = await authAPI.me();
      const user = data.user;
      const today = todayStr();
      let dbTimer = null;
      try {
        const { data: wlData } = await worklogAPI.getAll();
        const logs = wlData?.data || [];
        const todayLog = logs.find(l => l.date === today);
        if (todayLog) {
          dbTimer = {
            active: todayLog.active,
            workSeconds: todayLog.workSeconds || 0,
            sessionDate: todayLog.date,
            sessionStart: todayLog.sessionStart || new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
            breaks: todayLog.breaks || [],
            breakActive: todayLog.breakActive || false,
            currentBreak: null,
            targetSeconds: todayLog.targetSeconds || (8 * 3600),
          };
        }
      } catch (err) {
        console.error('Failed to restore timer from DB', err);
      }

      const saved = loadTimerLS(getId(user));
      let timerState = initialTimer();

      // DB is the source of truth for active/breakActive (only explicit check-in/pause/
      // break/logout/unload-beacon writes it) — localStorage only ever contributes a
      // possibly-fresher workSeconds/breaks if this device ticked past the DB's last
      // 15s sync boundary before a crash/close.
      if (dbTimer) {
        const sameDayLocal = saved && saved.sessionDate === today;
        timerState = {
          ...dbTimer,
          workSeconds: Math.max(dbTimer.workSeconds || 0, sameDayLocal ? (saved.workSeconds || 0) : 0),
          breaks:      sameDayLocal && saved.breaks?.length > dbTimer.breaks?.length ? saved.breaks : dbTimer.breaks,
          lastTickTime: dbTimer.active
            ? (sameDayLocal && saved.lastTickTime && (saved.workSeconds || 0) >= (dbTimer.workSeconds || 0) ? saved.lastTickTime : Date.now())
            : null,
        };
      } else if (saved && saved.sessionDate === today) {
        timerState = { ...saved, breakActive: false, currentBreak: null };
      }

      set({ authUser:user, timer:timerState });

      // Sync active state back to database if timer is restored as active
      if (timerState.active && user.role === 'member') {
        worklogAPI.setActive(true).catch(()=>{});
        worklogAPI.upsert({
          date: timerState.sessionDate || today,
          workSeconds: timerState.workSeconds,
          sessionStart: timerState.sessionStart,
          breaks: timerState.breaks,
          active: true,
          breakActive: timerState.breakActive,
          targetSeconds: timerState.targetSeconds || (8 * 3600),
        }).catch(()=>{});
      }
      await get().loadAllData();
      // Re-read from localStorage: the 401 interceptor may have silently refreshed
      // the token during authAPI.me(), making the `token` variable above stale.
      connectSocket(store);
      return true;
    } catch {
      localStorage.removeItem('crm_access_token');
      return false;
    }
  },

  // ══════════════════════════════════════════════════════════
  // LOAD ALL DATA
  // ══════════════════════════════════════════════════════════
  loadAllData: async () => {
    set({ loading: true });
    const me = get().authUser;
    try {
      // ── Client portal: only load data relevant to this client ──────────
      if (me?.role === 'client') {
        const [tR, pR, mR, nR, dR, chR, coR] = await Promise.all([
          tasksAPI.getAll(),
          projectsAPI.getAll(),
          meetingsAPI.getAll(),
          notificationsAPI.getAll(),
          todosAPI.getAll(),
          channelsAPI.getAll(),
          portalAPI.contacts().catch(() => ({ data: { data: [] } })),
        ]);

        const savedUnread = loadUnreadLS(getId(me));

        // Channels (the dedicated private client channel + any public channels)
        const clientChannels = (chR.data.data || []).map((c) => ({
          id:          c._id,
          name:        c.name,
          type:        'channel',
          description: c.description || '',
          isPrivate:   !!c.isPrivate,
          members:     c.members || [],
          createdBy:   c.createdBy || null,
          clientId:    c.clientId || null,
          unread:      savedUnread[String(c._id)] || 0,
        }));

        // DMs — only with allowed contacts (admins + assigned team)
        const allowedContacts = coR.data.data || [];
        const clientDms = allowedContacts.map((u) => ({
          id:     `dm-${getId(u)}`,
          userId: getId(u),
          unread: savedUnread[`dm-${getId(u)}`] || 0,
        }));

        // Also put allowed contacts in the users array so the Messages page
        // can resolve names/avatars for DM threads
        const dedicatedChannel = clientChannels.find((c) => c.clientId);
        const resolvedThread   = dedicatedChannel?.id || clientChannels[0]?.id || get().activeThread;

        set({
          tasks:         tR.data.data || [],
          projects:      pR.data.data || [],
          meetings:      mR.data.data || [],
          notifications: nR.data.data || [],
          todos:         dR.data.data || [],
          users:         allowedContacts,          // only allowed contacts visible to client
          messages:      { ...get().messages, channels: clientChannels, dms: clientDms },
          activeThread:  resolvedThread,
          loading:       false,
        });
        return;
      }

      // ── Staff (admin / manager / member / client_relations) ────────────
      const [uR, cR, tR, dR, mR, nR, chR, svR, pR, lR, setR] = await Promise.all([
        usersAPI.getAll(), clientsAPI.getAll(), tasksAPI.getAll(), todosAPI.getAll(), meetingsAPI.getAll(),
        notificationsAPI.getAll(), channelsAPI.getAll(), servicesAPI.getAll(), projectsAPI.getAll(),
        leadsAPI.getAll(),
        settingsAPI.get().catch(() => ({ data: { data: null } }))
      ]);
      const users = uR.data.data;
      // Restore persisted unread counts — prevents the badge vanishing on reload
      const savedUnread = loadUnreadLS(getId(me));
      const dms   = users
        .filter((u) => getId(u) !== getId(me))
        .map((u)   => ({ id:`dm-${getId(u)}`, userId:getId(u), unread: savedUnread[`dm-${getId(u)}`] || 0 }));
      const channels = (chR.data.data || []).map((c) => ({
        id:          c._id,
        name:        c.name,
        type:        'channel',
        description: c.description || '',
        isPrivate:   !!c.isPrivate,
        members:     c.members || [],
        createdBy:   c.createdBy || null,
        clientId:    c.clientId  || null,
        projectId:   c.projectId || null,
        unread:      savedUnread[String(c._id)] || 0,
      }));
      // Keep active thread only if it's still valid after loading; otherwise show empty state
      const currentThread = get().activeThread;
      const isThreadValid = currentThread && (channels.some((c) => c.id === currentThread) || dms.some((d) => d.id === currentThread));
      const resolvedThread = isThreadValid ? currentThread : null;

      set({
        users,
        clients:        cR.data.data,
        tasks:          tR.data.data,
        todos:          dR.data.data,
        meetings:       mR.data.data,
        notifications:  nR.data.data,
        services:       svR.data.data,
        projects:       pR.data.data || [],
        leads:          lR.data.data || [],
        systemSettings: setR?.data?.data || null,
        messages:       { ...get().messages, dms, channels },
        activeThread:   resolvedThread,
        loading:        false,
      });
      await get().fetchMySchedule();
      if (me?.role === 'admin' || me?.role === 'manager') {
        await get().fetchRevenueSummary();
      }
      // Hydrate team timer states from DB now that users are loaded
      get().fetchTeamTimerStates?.();
    } catch (err) {
      console.error('loadAllData error:', err.message);
      set({ loading: false });
    }
  },

  // ── Channels Actions ─────────────────────────────────────────
  addChannel: async (body) => {
    try {
      const { data } = await channelsAPI.create(body);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create channel');
      throw err;
    }
  },
  updateChannel: async (id, body) => {
    try {
      const { data } = await channelsAPI.update(id, body);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update channel');
      throw err;
    }
  },
  deleteChannel: async (id) => {
    try {
      await channelsAPI.delete(id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete channel');
      throw err;
    }
  },

  // ══════════════════════════════════════════════════════════
  // USERS  — POST /api/users  PUT /api/users/:id  DELETE /api/users/:id
  // ══════════════════════════════════════════════════════════
  addUser: async (body) => {
    try {
      const { data } = await usersAPI.create(body);
      set((s) => ({ users: [...s.users, data.data] }));
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to add user'); throw err; }
  },
  updateUser: async (id, body) => {
    try {
      const { data } = await usersAPI.update(id, body);
      set((s) => ({ users: s.users.map((u) => getId(u)===id ? data.data : u) }));
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update user'); throw err; }
  },
  deleteUser: async (id) => {
    try {
      await usersAPI.delete(id);
      set((s) => ({ users: s.users.filter((u) => getId(u)!==id) }));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete user'); throw err; }
  },

  // ══════════════════════════════════════════════════════════
  // CLIENTS  — GET/POST/PUT/DELETE /api/clients  POST /api/clients/:id/notes
  // ══════════════════════════════════════════════════════════
  addClient: async (body) => {
    try {
      const { data } = await clientsAPI.create(body);
      set((s) => ({ clients: [data.data, ...s.clients] }));
      // Fetch updated projects if initial project details were provided
      try {
        const { data: pData } = await projectsAPI.getAll();
        set({ projects: pData.data || [] });
      } catch (err) {
        console.error('Failed to sync projects after client creation:', err);
      }
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to add client'); throw err; }
  },
  updateClient: async (id, body) => {
    try {
      const { data } = await clientsAPI.update(id, body);
      set((s) => ({ clients: s.clients.map((c) => getId(c)===id ? data.data : c) }));
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update client'); throw err; }
  },
  deleteClient: async (id) => {
    try {
      const { data } = await clientsAPI.delete(id);
      // Cascade-remove all associated local state so UI is consistent immediately
      set((s) => ({
        clients:  s.clients.filter((c) => getId(c) !== id),
        tasks:    s.tasks.filter((t) => String(t.clientId) !== id),
        todos:    s.todos.filter((t) => String(t.clientId) !== id),
        projects: s.projects.filter((p) => String(p.clientId) !== id),
        meetings: s.meetings.filter((m) => String(m.clientId) !== id),
      }));
      toast.success(data?.message || 'Client and all associated data deleted');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete client'); throw err; }
  },
  addClientNote: async (clientId, text) => {
    try {
      const { data } = await clientsAPI.addNote(clientId, text);
      set((s) => ({ clients: s.clients.map((c) => getId(c)===clientId ? data.data : c) }));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to add note'); throw err; }
  },

  // ══════════════════════════════════════════════════════════
  // TASKS  — GET/POST/PUT/DELETE /api/tasks
  // Socket emits task:created / task:updated / task:deleted
  // ══════════════════════════════════════════════════════════
  addTask: async (body) => {
    try {
      const { data } = await tasksAPI.create(body);
      // Socket will push task:created — just return
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to create task'); throw err; }
  },
  updateTask: async (id, body) => {
    // Optimistically update the store state immediately to eliminate latency and race conditions
    set((s) => ({
      tasks: s.tasks.map((t) => getId(t) === id ? { ...t, ...body } : t)
    }));
    try {
      const { data } = await tasksAPI.update(id, body);
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update task');
      throw err;
    }
  },
  moveTask: async (id, status) => {
    const updates = { status };
    if (status === 'completed') updates.progress = 100;
    else if (status === 'pending') updates.progress = 0;
    else if (status === 'in-progress') updates.progress = 50;
    else if (status === 'sent-for-approval') updates.progress = 90;

    // Clear readyForApproval whenever leaving in-progress (pending=reverted, sent-for-approval=moved by manager, completed=done)
    if (status === 'pending' || status === 'sent-for-approval' || status === 'completed') {
      updates.readyForApproval = false;
    }
    return get().updateTask(id, updates);
  },
  deleteTask: async (id) => {
    try {
      await tasksAPI.delete(id);
      // Socket will push task:deleted
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete task'); throw err; }
  },

  // ══════════════════════════════════════════════════════════
  // TODOS  — GET/POST/PUT/DELETE /api/todos
  // ══════════════════════════════════════════════════════════
  addTodo: async (body) => {
    try {
      const { data } = await todosAPI.create(body);
      // Don't push to store here — the backend's 'todo:created' socket event
      // will add it via the socket listener (single source of truth, no duplicates)
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to create todo'); throw err; }
  },
  updateTodo: async (id, body) => {
    try {
      const { data } = await todosAPI.update(id, body);
      set((s) => ({ todos: s.todos.map((t) => getId(t)===id ? data.data : t) }));
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update todo'); throw err; }
  },
  deleteTodo: async (id) => {
    try {
      await todosAPI.delete(id);
      set((s) => ({ todos: s.todos.filter((t) => getId(t)!==id) }));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete todo'); throw err; }
  },

  // ══════════════════════════════════════════════════════════
  // MEETINGS  — GET/POST/PUT/DELETE /api/meetings
  // ══════════════════════════════════════════════════════════
  addMeeting: async (body) => {
    try {
      const { data } = await meetingsAPI.schedule(body);
      await get().fetchMySchedule();
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to schedule meeting'); throw err; }
  },
  updateMeeting: async (id, body) => {
    try {
      const { data } = await meetingsAPI.update(id, body);
      set((s) => ({ meetings: s.meetings.map((m) => getId(m)===id ? data.data : m) }));
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update meeting'); throw err; }
  },
  deleteMeeting: async (id) => {
    try {
      await meetingsAPI.delete(id);
      set((s) => ({ meetings: s.meetings.filter((m) => getId(m)!==id) }));
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete meeting'); throw err; }
  },
  fetchMySchedule: async () => {
    try {
      const { data } = await meetingsAPI.getMySchedule();
      set({ mySchedule: data.data || [] });
    } catch (err) {
      console.error('Error in fetchMySchedule Zustand:', err);
    }
  },
  submitRSVP: async (invitationId, status) => {
    try {
      const { data } = await meetingsAPI.rsvp(invitationId, status);
      set((s) => ({
        mySchedule: s.mySchedule.map((item) =>
          getId(item.invitationId) === invitationId
            ? { ...item, rsvpStatus: status }
            : item
        )
      }));
      // Also update standard meeting status in main list if present
      await get().loadAllData();
      toast.success(`RSVP updated to ${status}!`);
    } catch (err) {
      toast.error('Failed to submit RSVP');
    }
  },
  fetchRevenueSummary: async () => {
    try {
      const { data } = await revenueAPI.getSummary();
      set({ revenueSummary: data.data });
    } catch (err) {
      console.error('Error in fetchRevenueSummary Zustand:', err);
    }
  },
  recordRevenue: async (body) => {
    try {
      const { data } = await revenueAPI.record(body);
      await get().fetchRevenueSummary();
      return data.data;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record revenue');
      throw err;
    }
  },

  // ══════════════════════════════════════════════════════════
  // MESSAGES  — GET/POST/DELETE /api/messages/:threadId
  // Real-time via Socket.io (Section 11)
  // ══════════════════════════════════════════════════════════
  loadThread: async (threadId) => {
    try {
      const { data } = await messagesAPI.getThread(threadId);
      const mappedMsgs = (data.data || []).map((m) => ({ ...m, threadId }));
      set((s) => ({ messages: { ...s.messages, threads: { ...s.messages.threads, [threadId]: mappedMsgs } } }));
      sock?.emit('join:thread', threadId);
      return mappedMsgs;
    } catch (err) {
      return [];
    }
  },
  leaveThread: (threadId) => { sock?.emit('leave:thread', threadId); },

  sendMessage: async (threadId, text, attachments = []) => {
    if (!text?.trim() && attachments.length === 0) return null;
    try {
      let resp;
      if (attachments.length > 0) {
        const fd = new FormData();
        if (text?.trim()) fd.append('text', text.trim());
        attachments.forEach((a) => a.file && fd.append('files', a.file));
        resp = await messagesAPI.sendFiles(threadId, fd);
      } else {
        resp = await messagesAPI.send(threadId, text.trim());
      }
      const newMsg = { ...resp.data.data, threadId };
      set((s) => {
        const threadMsgs = s.messages.threads[threadId] || [];
        const already = threadMsgs.some((x) => x._id === newMsg._id);
        if (already) return {};
        return {
          messages: {
            ...s.messages,
            threads: {
              ...s.messages.threads,
              [threadId]: [...threadMsgs, newMsg]
            }
          }
        };
      });
      return newMsg;
    } catch (err) {
      toast.error('Failed to send message');
      throw err;
    }
  },
  deleteMessage: async (threadId, msgId) => {
    try {
      await messagesAPI.delete(msgId);
      set((s) => ({
        messages: {
          ...s.messages,
          threads: {
            ...s.messages.threads,
            [threadId]: (s.messages.threads[threadId] || []).map((m) =>
              m._id === msgId ? { ...m, isDeleted: true } : m
            )
          }
        }
      }));
    } catch {
      toast.error('Failed to delete message');
    }
  },
  toggleReaction: async (threadId, msgId, emoji = '👍') => {
    try {
      const { data: resp } = await messagesAPI.react(msgId, emoji);
      set((s) => ({
        messages: {
          ...s.messages,
          threads: {
            ...s.messages.threads,
            [threadId]: (s.messages.threads[threadId] || []).map((m) =>
              m._id === msgId ? resp.data : m
            )
          }
        }
      }));
    } catch {
      toast.error('Failed to toggle reaction');
    }
  },

  // Typing indicators (Section 11)
  emitTypingStart: (threadId) => sock?.emit('typing:start', { threadId }),
  emitTypingStop:  (threadId) => sock?.emit('typing:stop',  { threadId }),
  onTypingStart: (cb) => { sock?.on('typing:start', cb); return () => sock?.off('typing:start', cb); },
  onTypingStop:  (cb) => { sock?.on('typing:stop',  cb); return () => sock?.off('typing:stop',  cb); },

  // ══════════════════════════════════════════════════════════
  // WORK TIMER  (local tick → syncs to POST /api/worklog every 60s,
  //              cross-session sync via socket timer:sync every 10s)
  // ══════════════════════════════════════════════════════════

  // Helper: emit the current timer state to all other sessions of this user
  _emitTimerSync: () => {
    const { timer } = get();
    sock?.emit('timer:sync', {
      workSeconds:  timer.workSeconds,
      active:       timer.active,
      breakActive:  timer.breakActive,
      sessionDate:  timer.sessionDate,
      sessionStart: timer.sessionStart,
      targetSeconds:timer.targetSeconds,
    });
  },
  startTimer: () => set((s) => {
    const uid = getId(s.authUser);
    const upd = { ...s.timer, active:true, breakActive:false, sessionDate:s.timer.sessionDate||todayStr(), sessionStart:s.timer.sessionStart||new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), lastTickTime: Date.now() };
    saveTimerLS(uid, upd);
    worklogAPI.upsert({ date:upd.sessionDate, workSeconds:upd.workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:true, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
    worklogAPI.setActive(true).catch(()=>{});
    // Notify other sessions immediately
    sock?.emit('timer:sync', { workSeconds:upd.workSeconds, active:true, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
    return { timer:upd };
  }),
  pauseTimer: () => set((s) => {
    const upd = { ...s.timer, active:false };
    saveTimerLS(getId(s.authUser), upd);
    worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds:upd.workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:false, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
    // Notify other sessions immediately so they pause too
    sock?.emit('timer:sync', { workSeconds:upd.workSeconds, active:false, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
    return { timer:upd };
  }),
  resetTimer: () => set((s) => {
    localStorage.removeItem(T_KEY(getId(s.authUser)));
    return { timer:{ ...initialTimer(), sessionDate:todayStr() } };
  }),
  tickTimer: () => set((s) => {
    if (!s.timer.active || s.timer.breakActive) return {};
    const now = Date.now();
    const lastTick = s.timer.lastTickTime || now;

    // Work time is always derived from the wall clock (now - lastTickTime), never from
    // "how many times the interval fired" — browsers throttle/freeze timers in
    // background tabs, so a tick can arrive late (or after a long pause) and must
    // credit everything that really elapsed.
    if (now < lastTick) return { timer: { ...s.timer, lastTickTime: now } };     // clock moved backwards: resync
    const delta = Math.floor((now - lastTick) / 1000);
    if (delta <= 0) return s.timer.lastTickTime ? {} : { timer: { ...s.timer, lastTickTime: now } };  // <1s elapsed: nothing to add

    // Backgrounded/throttled tabs, screen locks, and network blips must NOT cost work
    // time — only a genuine multi-hour gap (real OS sleep/hibernation, or a forgotten
    // check-out overnight) gets capped, as a safety net against unbounded hour inflation
    // in a single jump.
    const actualDelta = Math.min(delta, IDLE_GAP_CAP_S);
    // Advance the anchor by exactly the whole seconds credited so the sub-second
    // remainder carries over to the next tick instead of being dropped.
    const nextTick = delta > IDLE_GAP_CAP_S ? now : lastTick + delta * 1000;
    const rawWorkSeconds = s.timer.workSeconds + actualDelta;
    const uid = getId(s.authUser);

    // Safety net: auto check-out at the 10h/day ceiling if logout was forgotten.
    // This is the ONLY automatic stop — everything else (tab close, backgrounding,
    // network loss, socket disconnect) must never touch `active`.
    if (rawWorkSeconds >= MAX_WORK_SECONDS_PER_DAY) {
      const workSeconds = MAX_WORK_SECONDS_PER_DAY;
      const upd = { ...s.timer, workSeconds, active: false, lastTickTime: now };
      saveTimerLS(uid, upd);
      worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:false, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
      sock?.emit('timer:sync', { workSeconds, active:false, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
      toast('Timer auto-stopped at 10h — press Start Timer if you\'re still working.', { icon: '⏱️', duration: 6000 });
      return { timer:upd };
    }

    const workSeconds = rawWorkSeconds;
    const upd = { ...s.timer, workSeconds, lastTickTime: nextTick };

    // Sync to database if we crossed a 15-second boundary
    const oldBoundary = Math.floor(s.timer.workSeconds / 15);
    const newBoundary = Math.floor(workSeconds / 15);
    if (newBoundary > oldBoundary || workSeconds % 15 === 0) {
      saveTimerLS(uid, upd);
      worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:true, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
    }

    // Broadcast to other sessions if we crossed a 10-second boundary
    const oldSocketBoundary = Math.floor(s.timer.workSeconds / 10);
    const newSocketBoundary = Math.floor(workSeconds / 10);
    if (newSocketBoundary > oldSocketBoundary || workSeconds % 10 === 0) {
      sock?.emit('timer:sync', { workSeconds, active:true, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
    }
    return { timer:upd };
  }),
  startBreak: (type, totalSeconds, reason='') => set((s) => {
    const upd = { ...s.timer, active:false, breakActive:true, currentBreak:{ type, reason, totalSeconds, elapsedSeconds:0, lastBreakTickTime: Date.now() } };
    saveTimerLS(getId(s.authUser), upd);
    worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds:upd.workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:false, breakActive:true, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
    // Notify other sessions — they should also show break state
    sock?.emit('timer:sync', { workSeconds:upd.workSeconds, active:false, breakActive:true, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
    return { timer:upd };
  }),
  tickBreak: () => set((s) => {
    if (!s.timer.breakActive || !s.timer.currentBreak) return {};
    const now = Date.now();
    const lastTick = s.timer.currentBreak.lastBreakTickTime || now;
    if (now < lastTick) return { timer: { ...s.timer, currentBreak: { ...s.timer.currentBreak, lastBreakTickTime: now } } };
    const delta = Math.floor((now - lastTick) / 1000);
    if (delta <= 0) return {};
    const elapsed = s.timer.currentBreak.elapsedSeconds + delta;
    const { totalSeconds } = s.timer.currentBreak;

    if (elapsed >= totalSeconds) {
      const done = { type:s.timer.currentBreak.type, reason:s.timer.currentBreak.reason, planned:totalSeconds, actual:elapsed, endedAt:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) };
      const upd  = { ...s.timer, active:true, breakActive:false, currentBreak:null, breaks:[...s.timer.breaks, done], lastTickTime: Date.now() };
      saveTimerLS(getId(s.authUser), upd);
      worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds:upd.workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:true, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
      sock?.emit('timer:sync', { workSeconds:upd.workSeconds, active:true, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
      return { timer:upd };
    }

    const upd = { ...s.timer, currentBreak:{ ...s.timer.currentBreak, elapsedSeconds:elapsed, lastBreakTickTime: lastTick + delta * 1000 } };
    const oldLSBoundary = Math.floor(s.timer.currentBreak.elapsedSeconds / 15);
    const newLSBoundary = Math.floor(elapsed / 15);
    if (newLSBoundary > oldLSBoundary || elapsed % 15 === 0) saveTimerLS(getId(s.authUser), upd);

    const oldSocketBoundary = Math.floor(s.timer.currentBreak.elapsedSeconds / 10);
    const newSocketBoundary = Math.floor(elapsed / 10);
    if (newSocketBoundary > oldSocketBoundary || elapsed % 10 === 0) {
      sock?.emit('timer:sync', { workSeconds:s.timer.workSeconds, active:false, breakActive:true, sessionDate:s.timer.sessionDate, sessionStart:s.timer.sessionStart, targetSeconds:s.timer.targetSeconds });
    }
    return { timer:upd };
  }),
  endBreak: () => set((s) => {
    if (!s.timer.currentBreak) return {};
    const done = { type:s.timer.currentBreak.type, reason:s.timer.currentBreak.reason, planned:s.timer.currentBreak.totalSeconds, actual:s.timer.currentBreak.elapsedSeconds, endedAt:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) };
    const upd  = { ...s.timer, active:true, breakActive:false, currentBreak:null, breaks:[...s.timer.breaks, done], lastTickTime: Date.now() };
    saveTimerLS(getId(s.authUser), upd);
    worklogAPI.upsert({ date:upd.sessionDate||todayStr(), workSeconds:upd.workSeconds, sessionStart:upd.sessionStart, breaks:upd.breaks, active:true, breakActive:false, targetSeconds:upd.targetSeconds || (8 * 3600) }).catch(()=>{});
    sock?.emit('timer:sync', { workSeconds:upd.workSeconds, active:true, breakActive:false, sessionDate:upd.sessionDate, sessionStart:upd.sessionStart, targetSeconds:upd.targetSeconds });
    return { timer:upd };
  }),
  updateTargetSeconds: async (seconds) => {
    const { authUser, timer } = get();
    if (!authUser) return;
    const upd = { ...timer, targetSeconds: seconds };
    set({ timer: upd });
    saveTimerLS(getId(authUser), upd);
    try {
      await worklogAPI.upsert({
        date: upd.sessionDate || todayStr(),
        workSeconds: upd.workSeconds,
        sessionStart: upd.sessionStart,
        breaks: upd.breaks,
        active: upd.active,
        targetSeconds: seconds
      });
      toast.success(`Target time updated to ${Math.round(seconds / 3600)}h`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save target time to database');
    }
  },

  // ── WorkLog reader (GET /api/worklog) ─────────────────────
  getWorkLog: (userId) => loadWorkLogLS(userId),   // local cache
  fetchWorkLog: async (params) => {
    try {
      const { data } = await worklogAPI.getAll(params);
      return data.data;
    } catch { return []; }
  },
  updateWorkLog: async (id, body) => {
    try {
      const { data } = await worklogAPI.update(id, body);
      toast.success('Work log entry updated');
      return data.data;
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update work log entry'); throw err; }
  },
  deleteWorkLog: async (id) => {
    try {
      await worklogAPI.delete(id);
      toast.success('Work log entry deleted');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete work log entry'); throw err; }
  },
  bulkDeleteWorkLogs: async (ids) => {
    try {
      const { data } = await worklogAPI.bulkDelete(ids);
      toast.success(data?.message || 'Work log entries deleted');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to delete work log entries'); throw err; }
  },
  fetchTeamTimerStates: async () => {
    try {
      const today = todayStr();
      const logs = await get().fetchWorkLog({ date: today });
      set((s) => ({
        users: s.users.map((u) => {
          const log = logs.find((l) => getId(l.userId) === getId(u));
          if (log) {
            return {
              ...u,
              timerActive:       log.active,
              timerBreakActive:  log.breakActive,
              timerWorkSeconds:  log.workSeconds || 0,
              timerSessionStart: log.sessionStart,
              timerTargetSeconds:log.targetSeconds || 8 * 3600,
              timerLastUpdated:  Date.now(),
            };
          }
          return u;
        })
      }));
    } catch (err) {
      console.error('Failed to fetch team timer states:', err);
    }
  },
}));

export default useAppStore;