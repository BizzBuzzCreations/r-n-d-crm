import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Hash, MessageCircle, Send, Trash2, Search, Paperclip,
  X, FileText, ImageIcon, Film, File, Download, Loader2, Plus, Lock, Pencil, Settings, Ban, Bell, BellOff, Check, Eye,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { getBackendUrl } from '../services/api';
import { useShallow } from 'zustand/shallow';
import { Page, Avatar } from '../components/ui';
import { cn, getId, sameId } from '../utils/helpers';

// ── File helpers ──────────────────────────────────────────────
const IMG_EXTS = /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)$/i;
const VID_EXTS = /\.(mp4|mov|webm|avi|mkv)$/i;

function isImageFile(att) {
  if ((att.type||'').startsWith('image/')) return true;
  if (att.name && IMG_EXTS.test(att.name)) return true;
  if (att.filename && IMG_EXTS.test(att.filename)) return true;
  if (att.url && IMG_EXTS.test(att.url)) return true;
  return false;
}

function isVideoFile(att) {
  if ((att.type||'').startsWith('video/')) return true;
  if (att.name && VID_EXTS.test(att.name)) return true;
  return false;
}

function fileIconCfg(att) {
  const type = typeof att === 'string' ? att : (att?.type || '');
  if (isImageFile(typeof att === 'object' ? att : { type })) return { icon:ImageIcon, color:'#8b5cf6', bg:'#f5f3ff' };
  if (isVideoFile(typeof att === 'object' ? att : { type })) return { icon:Film,      color:'#ef4444', bg:'#fef2f2' };
  if (type==='application/pdf')  return { icon:FileText,  color:'#ef4444', bg:'#fef2f2' };
  if (type.includes('sheet')||type.includes('csv')) return { icon:FileText, color:'#16a34a', bg:'#ecfdf5' };
  return { icon:File, color:'#6366f1', bg:'#eef2ff' };
}
function fmtSize(b) { if(b<1024) return `${b} B`; if(b<1048576) return `${(b/1024).toFixed(1)} KB`; return `${(b/1048576).toFixed(1)} MB`; }

function AttachmentPill({ att, onRemove }) {
  const { icon:Icon, color, bg } = fileIconCfg(att);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-[12px]">
      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{background:bg}}><Icon size={12} style={{color}}/></div>
      <div className="min-w-0"><p className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[110px]">{att.name}</p><p className="text-[10.5px] text-slate-400">{fmtSize(att.size)}</p></div>
      <button onClick={onRemove} className="text-slate-400 hover:text-red-500 ml-1"><X size={12}/></button>
    </div>
  );
}

function handleDownload(url, filename) {
  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 100);
    })
    .catch(() => { window.open(url, '_blank'); });
}

function AttachmentCard({ att, isMe }) {
  const { icon:Icon, color, bg } = fileIconCfg(att);
  const isImg = isImageFile(att);
  const base  = getBackendUrl();
  const url   = att.url?.startsWith('http') ? att.url : `${base}${att.url}`;
  const [preview, setPreview] = useState(false);
  return (
    <>
      {preview && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreview(false)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <img src={url} alt={att.name} className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl"/>
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-white/80 text-[12px] truncate max-w-[300px]">{att.name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(url, att.name); }}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Download size={13}/> Download
                </button>
                <button onClick={() => setPreview(false)} className="bg-white/10 hover:bg-white/20 text-white p-1.5 rounded-lg transition-colors">
                  <X size={14}/>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className={cn(
        'mt-1.5 rounded-xl overflow-hidden border max-w-[240px]',
        isMe
          ? 'border-indigo-300 dark:border-white/20 bg-indigo-50 dark:bg-white/10'
          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700'
      )}>
        {isImg ? (
          <div>
            <img
              src={url}
              alt={att.name}
              className="w-full max-h-[180px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setPreview(true)}
            />
            <div className="flex items-center justify-between px-2.5 py-1.5">
              <span className={cn('text-[11px] truncate max-w-[150px]', isMe ? 'text-indigo-800 dark:text-white/80' : 'text-slate-600 dark:text-slate-400')}>{att.name}</span>
              <button onClick={() => handleDownload(url, att.name)} className={cn('ml-2', isMe ? 'text-indigo-600 dark:text-white/70 hover:text-indigo-800 dark:hover:text-white' : 'text-indigo-500 hover:text-indigo-700')}><Download size={12}/></button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 p-2.5">
            <div
              className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', isMe && 'bg-indigo-100 dark:bg-white/[0.15]')}
              style={isMe ? undefined : { background: bg }}
            >
              <Icon size={15} className={isMe ? 'text-indigo-600 dark:text-white' : ''} style={isMe ? undefined : { color }}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-[12px] font-medium truncate', isMe ? 'text-indigo-900 dark:text-white' : 'text-slate-700 dark:text-slate-300')}>{att.name}</p>
              <p className={cn('text-[10.5px]', isMe ? 'text-indigo-500 dark:text-white/60' : 'text-slate-400')}>{fmtSize(att.size||0)}</p>
            </div>
            <button onClick={() => handleDownload(url, att.name)} className={cn('flex-shrink-0', isMe ? 'text-indigo-500 dark:text-white/70 hover:text-indigo-700 dark:hover:text-white' : 'text-indigo-500 hover:text-indigo-700')}><Download size={13}/></button>
          </div>
        )}
      </div>
    </>
  );
}

function TypingDots({ names }) {
  if (!names?.length) return null;
  return (
    <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="flex items-center gap-2 px-4 py-1.5 text-[12px] text-slate-400">
      <div className="flex gap-0.5">
        {[0,1,2].map((i)=>(
          <motion.span key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full" animate={{y:[-2,2,-2]}} transition={{repeat:Infinity,delay:i*0.15,duration:0.6}}/>
        ))}
      </div>
      <span>{names.join(', ')} {names.length===1?'is':'are'} typing…</span>
    </motion.div>
  );
}

// Groups: any staff user can create a private group chat. Editing/deleting is limited to admins and
// the creator of that (private) group.
const canCreateGroup = (user) => !!user && !['client', 'read_only'].includes(user.role);
const canEditChannel = (user, ch) => !!user && !!ch && (
  user.role === 'admin' || (ch.isPrivate && String(ch.createdBy?._id || ch.createdBy || '') === String(getId(user)))
);

export default function MessagesPage() {
  const { authUser, messages, activeThread, setActiveThread, sendMessage, deleteMessage, loadThread, leaveThread, emitTypingStart, emitTypingStop, addChannel, updateChannel, deleteChannel } = useAppStore(useShallow((s) => ({
    authUser:       s.authUser,
    messages:       s.messages,
    activeThread:   s.activeThread,
    setActiveThread:s.setActiveThread,
    sendMessage:    s.sendMessage,
    deleteMessage:  s.deleteMessage,
    loadThread:     s.loadThread,
    leaveThread:    s.leaveThread,
    emitTypingStart:s.emitTypingStart,
    emitTypingStop: s.emitTypingStop,
    addChannel:     s.addChannel,
    updateChannel:  s.updateChannel,
    deleteChannel:  s.deleteChannel,
  })));
  const users = useAppStore((s) => s.users);
  const clients = useAppStore((s) => s.clients);
  const socketConnected = useAppStore((s) => s.socketConnected);

  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [input,         setInput]         = useState('');
  const [search,        setSearch]        = useState('');
  const [msgSearch,     setMsgSearch]     = useState('');
  const [hoveredMsg,    setHoveredMsg]    = useState(null);
  const [pendingFiles,  setPendingFiles]  = useState([]);
  const [sending,       setSending]       = useState(false);
  const [showNewDM,     setShowNewDM]     = useState(false);
  const [dmSearch,      setDmSearch]      = useState('');
  const [typingNames,   setTypingNames]   = useState([]);
  const [notifPerm,     setNotifPerm]     = useState(() =>
    (typeof Notification !== 'undefined') ? Notification.permission : 'denied'
  );

  // Channel Creation / Management states
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel,   setEditingChannel]   = useState(null);
  const [channelName,      setChannelName]      = useState('');
  const [channelDesc,      setChannelDesc]      = useState('');
  const [confirmDelChan,   setConfirmDelChan]   = useState(null);
  const [savingChannel,    setSavingChannel]    = useState(false);
  const [isPrivate,        setIsPrivate]        = useState(false);
  const [selectedMembers,  setSelectedMembers]  = useState([]);
  const [memberSearch,     setMemberSearch]     = useState('');

  const localMsgs = messages.threads[activeThread] || [];

  const endRef      = useRef(null);
  const fileRef     = useRef(null);
  const textareaRef = useRef(null);
  const typingTimer = useRef(null);
  const prevThread  = useRef(null);

  // ── Socket typing / presence listeners ───────────────────
  useEffect(() => {
    const { onTypingStart, onTypingStop } = useAppStore.getState();
    const cleanStart = onTypingStart?.((data) => {
      let tid = data.threadId;
      const myId = getId(authUser);
      if (tid && tid.startsWith('dm-') && tid.includes('-')) {
        const parts = tid.split('-');
        const otherId = parts[1] === myId ? parts[2] : parts[1];
        tid = `dm-${otherId}`;
      }
      if (tid !== activeThread) return;
      if (data.userId === myId) return;
      setTypingNames((prev) => prev.includes(data.name) ? prev : [...prev, data.name]);
    });
    const cleanStop = onTypingStop?.((data) => {
      let tid = data.threadId;
      const myId = getId(authUser);
      if (tid && tid.startsWith('dm-') && tid.includes('-')) {
        const parts = tid.split('-');
        const otherId = parts[1] === myId ? parts[2] : parts[1];
        tid = `dm-${otherId}`;
      }
      if (tid !== activeThread) return;
      setTypingNames((prev) => prev.filter((n) => n !== data.name));
    });
    return () => { cleanStart?.(); cleanStop?.(); };
  }, [activeThread, authUser]);

  // Merged store thread is read directly as localMsgs

  // ── Load thread on switch ────────────────────────────────
  useEffect(() => {
    if (!activeThread) return;
    if (prevThread.current) leaveThread(prevThread.current);
    prevThread.current = activeThread;
    setTypingNames([]);
    setLoadingMsgs(true);

    // Clear unread for this thread the moment the user opens/switches to it
    useAppStore.getState().markThreadRead(activeThread);

    // Load from database into store dynamically
    loadThread(activeThread).finally(() => {
      setLoadingMsgs(false);
    });
  }, [activeThread]);

  useEffect(() => {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior:'smooth' }), 60);
  }, [localMsgs]);

  // ── Derived ───────────────────────────────────────────────
  const isChannel    = messages.channels.some((c) => c.id === activeThread);
  const activeChannel= messages.channels.find((c) => c.id === activeThread);
  const activeDM     = messages.dms.find((d) => d.id === activeThread);
  const dmUser       = activeDM ? users.find((u) => getId(u) === String(activeDM.userId)) : null;
  const threadTitle  = isChannel ? `#${activeChannel?.name}` : dmUser?.name || 'Direct Message';
  const threadDesc   = isChannel ? activeChannel?.description : dmUser?.position;
  const statusColors = { online:'#10b981', away:'#f59e0b', offline:'#94a3b8' };

  // ── File input ────────────────────────────────────────────
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files||[]);
    setPendingFiles((prev) => [...prev, ...files.map((f) => ({ name:f.name, size:f.size, type:f.type, url:URL.createObjectURL(f), file:f }))]);
    e.target.value='';
  };
  const removePending = (idx) => setPendingFiles((prev) => { URL.revokeObjectURL(prev[idx].url); return prev.filter((_,i)=>i!==idx); });

  // ── Typing emission ───────────────────────────────────────
  const handleInputChange = (e) => {
    setInput(e.target.value);
    emitTypingStart(activeThread);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTypingStop(activeThread), 1500);
  };

  // ── Send (POST /api/messages/:threadId) ──────────────────
  const handleSend = async () => {
    if ((!input.trim() && pendingFiles.length===0) || sending) return;
    setSending(true);
    emitTypingStop(activeThread);
    try {
      await sendMessage(activeThread, input.trim(), pendingFiles);
      setInput('');
      setPendingFiles([]);
      if (textareaRef.current) textareaRef.current.style.height='auto';
    } catch { /* toast handled in store */ }
    finally { setSending(false); }
  };

  // ── Notification permission ───────────────────────────────
  const handleEnableNotifications = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotifPerm(result);
    if (result === 'granted') {
      toast.success('Browser notifications enabled!');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) =>
          reg.showNotification('Notifications enabled! 🔔', {
            body: "You'll now receive message alerts from any tab.",
            icon: '/favicon.ico',
          })
        );
      }
    } else {
      toast.error('Notifications blocked. Allow them in your browser site settings.');
    }
  };

  // ── Delete (DELETE /api/messages/:id) ────────────────────
  const handleDelete = async (msgId) => {
    try {
      await deleteMessage(activeThread, msgId);
    } catch {}
  };

  // ── Channels Handling (Admin only) ─────────────────────────
  const handleSaveChannel = async () => {
    if (!channelName.trim() || savingChannel) return;
    setSavingChannel(true);
    try {
      const payload = {
        name: channelName.trim(),
        description: channelDesc.trim(),
        isPrivate,
        members: isPrivate ? selectedMembers : [],
      };
      
      if (editingChannel) {
        await updateChannel(editingChannel.id, payload);
        toast.success(`Channel #${channelName} updated successfully!`);
      } else {
        await addChannel(payload);
        toast.success(`Channel #${channelName} created successfully!`);
      }
      setShowChannelModal(false);
      setEditingChannel(null);
      setChannelName('');
      setChannelDesc('');
      setIsPrivate(false);
      setSelectedMembers([]);
      setMemberSearch('');
    } catch {
      // toast notification handled by store
    } finally {
      setSavingChannel(false);
    }
  };

  const handleDeleteChannel = async () => {
    if (!confirmDelChan) return;
    const name = confirmDelChan.name;
    try {
      await deleteChannel(confirmDelChan.id);
      toast.success(`Channel #${name} and all its messages deleted successfully.`);
      setConfirmDelChan(null);
    } catch {}
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <Page className="!p-0">
      <div className="flex h-[calc(100vh-3.5rem)] -m-6 overflow-hidden">

        {/* Sidebar */}
        <div className="w-60 bg-slate-900 flex flex-col flex-shrink-0 border-r border-slate-800">
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
              <input placeholder="Search…" className="w-full bg-slate-800 text-slate-300 placeholder-slate-500 text-[12.5px] rounded-lg pl-7 pr-3 py-1.5 outline-none focus:bg-slate-700" value={search} onChange={(e)=>setSearch(e.target.value)}/>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-4">
            {/* Channels */}
            <div>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 flex items-center justify-between">
                <span>Channels</span>
                {canCreateGroup(authUser) && (
                  <button
                    onClick={() => {
                      setEditingChannel(null);
                      setChannelName('');
                      setChannelDesc('');
                      setSelectedMembers([]);
                      setMemberSearch('');
                      setIsPrivate(authUser?.role !== 'admin');   // non-admins can only create private groups
                      setShowChannelModal(true);
                    }}
                    className="w-4.5 h-4.5 flex items-center justify-center rounded hover:bg-slate-800 text-slate-500 hover:text-slate-350 transition-colors"
                    title={authUser?.role === 'admin' ? 'Create New Channel' : 'Create Group Chat'}
                  >
                    <Plus size={12}/>
                  </button>
                )}
              </div>
              {messages.channels.filter((c)=>!search||c.name.includes(search)).map((ch)=>(
                <div key={ch.id} role="button" tabIndex={0} onClick={()=>setActiveThread(ch.id)} onKeyDown={(e)=>e.key==='Enter'&&setActiveThread(ch.id)} className={cn('flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-[13px] transition-all group/chan cursor-pointer',activeThread===ch.id?'bg-primary-500/20 text-primary-300':'text-slate-400 hover:bg-slate-800 hover:text-slate-300')}>
                  <div className="relative flex-shrink-0 flex items-center justify-center w-4 h-4">
                    {ch.isPrivate ? (
                      <Lock size={11} className="flex-shrink-0 text-amber-500/80" />
                    ) : (
                      <Hash size={13} className="flex-shrink-0" />
                    )}
                    {ch.unread > 0 && (
                      <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse border border-slate-900" />
                    )}
                  </div>
                  <span className="flex-1 truncate">{ch.name}</span>
                  
                  {/* Admin / group-creator inline edit/delete */}
                  {canEditChannel(authUser, ch) && (
                    <div className="hidden group-hover/chan:flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingChannel(ch);
                          setChannelName(ch.name);
                          setChannelDesc(ch.description || '');
                          setIsPrivate(!!ch.isPrivate);
                          setSelectedMembers((ch.members || []).map(m => getId(m)));
                          setShowChannelModal(true);
                        }}
                        className="p-1 text-slate-500 hover:text-white rounded hover:bg-slate-700 transition-colors"
                        title="Edit Channel Settings"
                      >
                        <Pencil size={11} className="block leading-none" />
                      </button>
                      {ch.name !== 'general' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelChan(ch);
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-700 transition-colors"
                          title="Delete Channel"
                        >
                          <Trash2 size={11} className="block leading-none" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="relative flex items-center justify-center min-w-[20px] h-5 flex-shrink-0">
                    {ch.unread > 0 && (
                      <span className="group-hover/chan:hidden bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                        {ch.unread}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useAppStore.getState().markThreadRead(ch.id);
                      }}
                      className="hidden group-hover/chan:flex items-center justify-center w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      title="Mark as Read"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* DMs */}
            <div>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 flex items-center justify-between">
                <span>Direct Messages</span>
                <button
                  onClick={() => { setShowNewDM(true); setDmSearch(''); }}
                  className="w-4.5 h-4.5 flex items-center justify-center rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                  title="New Direct Message"
                >
                  <Plus size={12}/>
                </button>
              </div>
              {messages.dms.map((dm)=>{
                const u = users.find((u)=>getId(u)===String(dm.userId));
                if (!u) return null;
                if (search&&!u.name.toLowerCase().includes(search.toLowerCase())) return null;
                return (
                  <div key={dm.id} role="button" tabIndex={0} onClick={()=>setActiveThread(dm.id)} onKeyDown={(e)=>e.key==='Enter'&&setActiveThread(dm.id)} className={cn('flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] transition-all group cursor-pointer',activeThread===dm.id?'bg-primary-500/20 text-primary-300':'text-slate-400 hover:bg-slate-800 hover:text-slate-300')}>
                    <div className="relative flex-shrink-0">
                      <Avatar user={u} size="xs"/>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-900" style={{background:statusColors[u.status]||'#94a3b8'}}/>
                      {dm.unread > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full border border-slate-900 animate-pulse" />
                      )}
                    </div>
                    <span className="flex-1 truncate">{u.name.split(' ')[0]}</span>
                    <div className="relative flex items-center justify-center min-w-[20px] h-5">
                      {dm.unread > 0 && (
                        <span className="group-hover:hidden bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {dm.unread}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          useAppStore.getState().markThreadRead(dm.id);
                        }}
                        className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                        title="Mark as Read"
                      >
                        ✓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Notification permission banner */}
          {notifPerm !== 'granted' && (
            <div className="px-3 py-2 border-t border-slate-800">
              <button
                onClick={handleEnableNotifications}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition-all text-[11.5px] font-medium"
              >
                {notifPerm === 'denied' ? <BellOff size={12} className="flex-shrink-0"/> : <Bell size={12} className="flex-shrink-0"/>}
                <span>{notifPerm === 'denied' ? 'Notifications blocked' : 'Enable notifications'}</span>
              </button>
              {notifPerm === 'denied' && (
                <p className="text-[10px] text-slate-600 mt-1 px-1">Allow in browser site settings</p>
              )}
            </div>
          )}
          {/* Socket status */}
          <div className="px-3 py-2 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-[10.5px] text-slate-600">
              <span className={cn('w-1.5 h-1.5 rounded-full', socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')}/>
              <span>{socketConnected ? 'Live · Connected' : 'Disconnected — reconnecting…'}</span>
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="flex flex-col flex-1 bg-white dark:bg-slate-900 overflow-hidden">

          {/* Empty state — no thread selected yet */}
          {!isChannel && !activeDM && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 select-none">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center mb-4">
                <MessageCircle size={28} className="text-indigo-400 dark:text-indigo-500 opacity-70"/>
              </div>
              <p className="text-[15px] font-semibold text-slate-600 dark:text-slate-300">No conversation selected</p>
              <p className="text-[12.5px] mt-1 text-slate-400">Pick a channel or start a direct message from the sidebar</p>
            </div>
          )}

          {/* Header + messages + input — only when a real thread is selected */}
          {(isChannel || activeDM) && (<><div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              {isChannel
                ? <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center"><Hash size={15} className="text-indigo-600 dark:text-indigo-400"/></div>
                : <div className="relative"><Avatar user={dmUser} size="sm"/><span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900" style={{background:statusColors[dmUser?.status]||'#94a3b8'}}/></div>
              }
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[14px] font-semibold text-slate-900 dark:text-white">{threadTitle}</p>
                  {isChannel && canEditChannel(authUser, activeChannel) && (
                    <button
                      onClick={() => {
                        setEditingChannel(activeChannel);
                        setChannelName(activeChannel.name);
                        setChannelDesc(activeChannel.description || '');
                        setIsPrivate(!!activeChannel.isPrivate);
                        setSelectedMembers((activeChannel.members || []).map(m => getId(m)));
                        setShowChannelModal(true);
                      }}
                      className="p-0.5 text-slate-400 hover:text-indigo-500 transition-colors flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Edit Channel Settings"
                    >
                      <Settings size={12} className="block leading-none" />
                    </button>
                  )}
                </div>
                <p className="text-[11.5px] text-slate-500">{threadDesc}</p>
                {isChannel && authUser?.role === 'admin' && activeChannel?.isPrivate
                  && !(activeChannel.members || []).some((m) => String(m?._id || m) === String(getId(authUser))) && (
                  <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10.5px] font-semibold">
                    <Eye size={10} /> Admin view — you are not a member of this group
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Message Search */}
              <div className="relative max-w-[180px] hidden sm:block">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                <input
                  type="text"
                  placeholder="Search messages…"
                  value={msgSearch}
                  onChange={(e) => setMsgSearch(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400 text-[12.5px] rounded-lg pl-7 pr-7 py-1 outline-none border border-slate-200 dark:border-slate-700 focus:border-indigo-500 transition-colors"
                />
                {msgSearch && (
                  <button onClick={() => setMsgSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250"><X size={11}/></button>
                )}
              </div>



              <div className="text-[12px] text-slate-400 font-medium">{localMsgs.length} messages</div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loadingMsgs ? (
              <div className="flex items-center justify-center h-full gap-2 text-slate-400">
                <Loader2 size={18} className="animate-spin"/><span className="text-[13px]">Loading messages…</span>
              </div>
            ) : localMsgs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <MessageCircle size={36} className="mb-3 opacity-30"/>
                <p className="text-[14px] font-semibold">No messages yet</p>
                <p className="text-[12px] mt-0.5">Start the conversation!</p>
              </div>
            ) : (() => {
              let lastDate = null;
              // Filter messages in real-time by search query
              const filteredMsgs = localMsgs.filter((msg) => {
                if (!msgSearch.trim()) return true;
                return msg.text && msg.text.toLowerCase().includes(msgSearch.toLowerCase());
              });

              if (filteredMsgs.length === 0 && msgSearch.trim() !== '') {
                return (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <Search size={32} className="mb-2.5 opacity-20"/>
                    <p className="text-[13.5px] font-semibold">No matching messages found</p>
                    <p className="text-[12px] mt-0.5">Try searching for a different keyword</p>
                  </div>
                );
              }

              return filteredMsgs.map((msg, i) => {
                const senderObj = msg.userId && typeof msg.userId === 'object' ? msg.userId : null;
                const senderId  = getId(msg.userId);
                const myId      = getId(authUser);
                const isMe      = senderId === myId;
                const sender    = senderObj || users.find((u) => getId(u) === senderId);
                const prevSender= i > 0 ? getId(localMsgs[i-1]?.userId) : null;
                const isFirst   = prevSender !== senderId;
                const msgDate   = msg.createdAt ? new Date(msg.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Today';
                const showDate  = msgDate !== lastDate; lastDate = msgDate;
                const msgTime   = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : msg.time || '';
                const hasAtts   = msg.attachments?.length > 0;
                return (
                  <div key={msg._id || i}>
                    {showDate && (
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"/>
                        <span className="text-[11.5px] text-slate-400 font-medium">{msgDate}</span>
                        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"/>
                      </div>
                    )}
                    <motion.div initial={{opacity:0,y:3}} animate={{opacity:1,y:0}} className={cn('flex gap-3 group px-1 py-0.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors',isMe?'flex-row-reverse':'')} onMouseEnter={()=>setHoveredMsg(msg._id)} onMouseLeave={()=>setHoveredMsg(null)}>
                      {isFirst && !isMe && <Avatar user={sender} size="sm" className="mt-1 flex-shrink-0"/>}
                      {!isFirst && !isMe && <div className="w-8 flex-shrink-0"/>}
                      <div className={cn('flex flex-col max-w-sm lg:max-w-md',isMe?'items-end':'')}>
                        {isFirst && (
                          <div className={cn('flex items-center gap-2 mb-1',isMe?'flex-row-reverse':'')}>
                            <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">{sender?.name?.split(' ')[0]||'User'}</span>
                            <span className="text-[11px] text-slate-400">{msgTime}</span>
                          </div>
                        )}
                        {msg.isDeleted ? (
                          <div className="text-slate-400 dark:text-slate-500 italic text-[12.5px] bg-slate-50 dark:bg-slate-800/25 px-3.5 py-2 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center gap-1.5 shadow-sm max-w-[280px]">
                            <Ban size={12} className="text-slate-450 dark:text-slate-550 flex-shrink-0" /> This message was deleted
                          </div>
                        ) : (
                          <>
                            {msg.text && <div className={cn(isMe?'msg-bubble-out':'msg-bubble-in')}>{msg.text}</div>}
                            {hasAtts && (
                              <div className={cn('flex flex-col gap-1',isMe?'items-end':'items-start')}>
                                {msg.attachments.map((a,ai)=><AttachmentCard key={ai} att={a} isMe={isMe}/>)}
                              </div>
                            )}

                            {/* Reactions Badges Row */}
                            {msg.reactions && msg.reactions.length > 0 && (
                              <div className={cn('flex flex-wrap gap-1 mt-1.5', isMe ? 'justify-end' : 'justify-start')}>
                                {Object.values(
                                  msg.reactions.reduce((acc, r) => {
                                    const emoji = r.emoji || '👍';
                                    if (!acc[emoji]) {
                                      acc[emoji] = {
                                        emoji,
                                        count: 0,
                                        userIds: [],
                                        userNames: [],
                                        hasReacted: false,
                                      };
                                    }
                                    acc[emoji].count += 1;
                                    const rUserId = getId(r.userId);
                                    acc[emoji].userIds.push(rUserId);
                                    if (sameId(rUserId, authUser)) {
                                      acc[emoji].hasReacted = true;
                                    }
                                    const name = r.userId?.name || users.find(u => getId(u) === rUserId)?.name || 'Someone';
                                    acc[emoji].userNames.push(name);
                                    return acc;
                                  }, {})
                                ).map((item) => (
                                  <button
                                    key={item.emoji}
                                    onClick={() => useAppStore.getState().toggleReaction(activeThread, msg._id, item.emoji)}
                                    className={cn(
                                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all relative group/tooltip",
                                      item.hasReacted
                                        ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
                                        : "bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/80"
                                    )}
                                  >
                                    <span>{item.emoji}</span>
                                    <span className="text-[10px]">{item.count}</span>

                                    {/* Tooltip */}
                                    <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover/tooltip:block bg-slate-900/90 dark:bg-slate-950/90 text-white text-[9.5px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                                      {item.userNames.join(', ')}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <AnimatePresence>
                        {hoveredMsg === msg._id && !msg.isDeleted && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 2 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 2 }}
                            className={cn(
                              "flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md rounded-full px-1.5 py-0.5 flex-shrink-0 self-start mt-1 z-10",
                              isMe ? "mr-2" : "ml-2"
                            )}
                          >
                            {/* Default Thumbs up button */}
                            <button
                              onClick={() => useAppStore.getState().toggleReaction(activeThread, msg._id, '👍')}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-[13px]"
                              title="React 👍"
                            >
                              👍
                            </button>

                            {/* + Emoji Sub-Picker */}
                            <div className="relative group/picker">
                              <button
                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-405 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center font-bold text-[12px] w-6 h-6"
                                title="Add Reaction"
                              >
                                +
                              </button>
                              
                              {/* Hover menu with seamless bridge wrapper */}
                              <div className="absolute bottom-[80%] pb-2.5 left-1/2 -translate-x-1/2 hidden group-hover/picker:flex flex-col items-center z-50">
                                <div className="flex items-center gap-1.5 bg-slate-900/95 dark:bg-slate-950/95 border border-slate-700/60 rounded-xl px-2 py-1.5 shadow-lg">
                                  {['👍', '❤️', '🔥', '😂', '😮', '🎉'].map((emo) => (
                                    <button
                                      key={emo}
                                      onClick={() => useAppStore.getState().toggleReaction(activeThread, msg._id, emo)}
                                      className="hover:scale-125 transition-transform duration-100 text-[14px] px-0.5"
                                    >
                                      {emo}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Delete button (sender or admin only) */}
                            {(isMe || authUser?.role === 'admin') && (
                              <button
                                onClick={() => handleDelete(msg._id)}
                                className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 rounded-full transition-colors"
                                title="Delete Message"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </div>
                );
              });
            })()}
            <AnimatePresence>
              {typingNames.length > 0 && <TypingDots names={typingNames}/>}
            </AnimatePresence>
            <div ref={endRef}/>
          </div>

          {/* Input */}
          <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
            <AnimatePresence>
              {pendingFiles.length > 0 && (
                <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="flex gap-2 flex-wrap mb-2.5 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="w-full flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">{pendingFiles.length} file{pendingFiles.length>1?'s':''} attached</span>
                    <button onClick={()=>{pendingFiles.forEach((f)=>URL.revokeObjectURL(f.url));setPendingFiles([]);}} className="text-[11.5px] text-red-500 font-medium">Remove all</button>
                  </div>
                  {pendingFiles.map((f,i)=><AttachmentPill key={i} att={f} onRemove={()=>removePending(i)}/>)}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5">
              <button onClick={()=>fileRef.current?.click()} className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all mb-0.5" title="Attach file (max 10MB)">
                <Paperclip size={16}/>
              </button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFileChange} accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"/>

              <textarea ref={textareaRef} rows={1}
                className="flex-1 bg-transparent outline-none text-[13.5px] text-slate-800 dark:text-slate-200 placeholder-slate-400 resize-none max-h-[120px] py-0.5"
                placeholder={`Message ${threadTitle}…`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={(e)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();} }}
                onBlur={()=>emitTypingStop(activeThread)}
              />

              <button onClick={handleSend} disabled={(!input.trim()&&pendingFiles.length===0)||sending}
                className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all mb-0.5',(input.trim()||pendingFiles.length>0)&&!sending?'bg-primary-500 text-white hover:bg-primary-600':'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed')}>
                {sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 pl-1 flex items-center gap-3">
              <span>Enter to send · Shift+Enter for new line</span>
              <span className="flex items-center gap-1"><Paperclip size={10}/> Click 📎 to attach files</span>
            </p>
          </div>
          </>)}
        </div>
      </div>

      {/* ── New DM User Search Modal ──────────────────────────────── */}
      <AnimatePresence>
        {showNewDM && (
          <>
            {/* Backdrop */}
            <motion.div
              key="dm-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowNewDM(false)}
            />

            {/* Modal */}
            <motion.div
              key="dm-modal"
              initial={{ opacity: 0, scale: 0.92, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <MessageCircle size={14} className="text-indigo-600 dark:text-indigo-400"/>
                  </div>
                  <p className="text-[14px] font-semibold text-slate-800 dark:text-white">New Direct Message</p>
                </div>
                <button
                  onClick={() => setShowNewDM(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <X size={14}/>
                </button>
              </div>

              {/* Search input */}
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search teammates by name or email…"
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-700/60 text-slate-800 dark:text-slate-200 placeholder-slate-400 text-[13px] rounded-xl pl-8 pr-3 py-2 outline-none border border-transparent focus:border-indigo-500/60 focus:bg-white dark:focus:bg-slate-700 transition-all"
                  />
                  {dmSearch && (
                    <button
                      onClick={() => setDmSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={11}/>
                    </button>
                  )}
                </div>
              </div>

              {/* User list */}
              <div className="max-h-[280px] overflow-y-auto py-2">
                {(() => {
                  const filtered = users.filter((u) => {
                    if (getId(u) === getId(authUser)) return false;
                    if (!dmSearch.trim()) return true;
                    const q = dmSearch.toLowerCase();
                    return (
                      u.name?.toLowerCase().includes(q) ||
                      u.email?.toLowerCase().includes(q) ||
                      u.position?.toLowerCase().includes(q)
                    );
                  });

                  if (filtered.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                      <Search size={28} className="mb-2 opacity-25"/>
                      <p className="text-[13px] font-medium">No teammates found</p>
                      <p className="text-[11.5px] mt-0.5">Try a different name or email</p>
                    </div>
                  );

                  return filtered.map((u) => {
                    const threadId = `dm-${getId(u)}`;
                    const isActive = activeThread === threadId;
                    const statusColor = { online:'#10b981', away:'#f59e0b', offline:'#94a3b8' }[u.status] || '#94a3b8';
                    return (
                      <button
                        key={getId(u)}
                        onClick={() => {
                          setActiveThread(threadId);
                          setShowNewDM(false);
                          setDmSearch('');
                        }}
                        className={cn(
                          'flex items-center gap-3 w-full px-4 py-2.5 transition-all text-left',
                          isActive
                            ? 'bg-indigo-50 dark:bg-indigo-900/20'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                        )}
                      >
                        <div className="relative flex-shrink-0">
                          <Avatar user={u} size="sm" preview={false} />
                          <span
                            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-800"
                            style={{ background: statusColor }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'text-[13px] font-medium truncate',
                            isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-200'
                          )}>{u.name}</p>
                          <p className="text-[11.5px] text-slate-400 truncate">{u.position || u.email}</p>
                        </div>
                        <span
                          className="text-[10.5px] capitalize px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                          style={{
                            background: statusColor + '22',
                            color: statusColor,
                          }}
                        >
                          {u.status || 'offline'}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                <p className="text-[11.5px] text-slate-400 text-center">
                  {users.filter(u => getId(u) !== getId(authUser)).length} teammate{users.length !== 2 ? 's' : ''} available
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Channel CRUD Modal ──────────────────────────────── */}
      <AnimatePresence>
        {showChannelModal && (
          <>
            {/* Backdrop */}
            <motion.div
              key="channel-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowChannelModal(false)}
            />

            {/* Modal */}
            <motion.div
              key="channel-modal"
              initial={{ opacity: 0, scale: 0.92, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    {isPrivate ? (
                      <Lock size={13} className="text-amber-500"/>
                    ) : (
                      <Hash size={14} className="text-indigo-600 dark:text-indigo-400"/>
                    )}
                  </div>
                  <p className="text-[15px] font-bold text-slate-800 dark:text-white">
                    {editingChannel ? `Edit ${isPrivate ? 'Group' : 'Channel'} #${editingChannel.name}` : isPrivate ? 'Create Private Group Chat' : 'Create New Channel'}
                  </p>
                </div>
                <button
                  onClick={() => setShowChannelModal(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <X size={14}/>
                </button>
              </div>

              {/* Form body */}
              <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className="block text-[12px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                    {isPrivate ? 'Group' : 'Channel'} Name
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-[14px]">
                      {isPrivate ? '🔒' : '#'}
                    </span>
                    <input
                      autoFocus
                      type="text"
                      disabled={editingChannel && editingChannel.name === 'general'}
                      placeholder="e.g. engineering-team"
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                      className="w-full bg-slate-50 dark:bg-slate-700/40 disabled:opacity-60 disabled:cursor-not-allowed text-slate-850 dark:text-slate-150 text-[13px] rounded-xl pl-8 pr-4 py-2.5 outline-none border border-slate-200 dark:border-slate-700 focus:border-indigo-500/60 transition-all font-medium"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 pl-1">
                    Lowercase, no spaces. Use hyphens for separation (e.g. `tech-updates`).
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Describe what this conversation is for..."
                    value={channelDesc}
                    onChange={(e) => setChannelDesc(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-700/40 text-slate-850 dark:text-slate-150 text-[13px] rounded-xl px-4 py-2.5 outline-none border border-slate-200 dark:border-slate-700 focus:border-indigo-500/60 transition-all font-medium resize-none"
                  />
                </div>

                {/* Private switch */}
                {authUser?.role === 'admin' && (!editingChannel || editingChannel.name !== 'general') && (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/20">
                    <div>
                      <p className="text-[12.5px] font-bold text-slate-800 dark:text-white">Private Group Chat</p>
                      <p className="text-[10.5px] text-slate-400">Only selected members will be able to see and join</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => {
                          setIsPrivate(e.target.checked);
                          if (e.target.checked && selectedMembers.length === 0) {
                            setSelectedMembers([getId(authUser)]);
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                    </label>
                  </div>
                )}

                {/* Members multi-select checklist */}
                {isPrivate && (() => {
                  // If this channel was auto-created for a client/project, surface the portal user
                  const chClientId = editingChannel?.clientId || null;
                  const portalUser = chClientId
                    ? users.find((u) => u.role === 'client' && String(u.clientId || u.clientId?._id || '') === String(chClientId))
                    : null;
                  const portalUid  = portalUser ? getId(portalUser) : null;

                  // Non-client users only in the editable list
                  const editableUsers = users
                    .filter((u) => u.role !== 'client')
                    .filter((u) => getId(u) !== getId(authUser))
                    .filter((u) => {
                      if (!memberSearch.trim()) return true;
                      const q = memberSearch.toLowerCase();
                      return u.name.toLowerCase().includes(q) || (u.position || '').toLowerCase().includes(q);
                    });

                  return (
                    <div className="space-y-2">
                      <label className="block text-[11.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                        Select Group Members ({selectedMembers.filter(id => id !== getId(authUser) && id !== portalUid).length} teammates added)
                      </label>

                      {/* Client portal user — auto-included, locked */}
                      {portalUser && (
                        <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10">
                          <Check size={13} className="text-emerald-500 flex-shrink-0" />
                          <Avatar user={portalUser} size="xs" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-slate-800 dark:text-slate-200 leading-none mb-0.5 text-[12px] font-medium">{portalUser.name}</p>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate leading-none">Client · auto-included</p>
                          </div>
                        </div>
                      )}

                      <div className="relative">
                        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                        <input
                          type="text"
                          placeholder="Search team members…"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-700/40 text-slate-800 dark:text-slate-200 placeholder-slate-400 text-[12px] rounded-lg pl-7 pr-3 py-1.5 outline-none border border-slate-200 dark:border-slate-700"
                        />
                      </div>
                      <div className="max-h-[140px] overflow-y-auto border border-slate-100 dark:border-slate-700/60 rounded-xl p-2 space-y-1.5 bg-slate-50/20 dark:bg-slate-900/10">
                        {editableUsers.map((u) => {
                          const uid = getId(u);
                          const isChecked = selectedMembers.some((id) => String(id) === String(uid));
                          return (
                            <label key={uid} className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-lg cursor-pointer text-[12px] font-medium text-slate-700 dark:text-slate-350">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedMembers((prev) => prev.filter((id) => String(id) !== String(uid)));
                                  } else {
                                    setSelectedMembers((prev) => [...prev, uid]);
                                  }
                                }}
                                className="rounded border-slate-300 dark:border-slate-600 text-primary-500 focus:ring-primary-500 w-3.5 h-3.5"
                              />
                              <Avatar user={u} size="xs" preview={false} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-slate-800 dark:text-slate-200 leading-none mb-0.5">{u.name}</p>
                                <p className="text-[10px] text-slate-450 truncate leading-none">{u.position || 'Teammate'}</p>
                              </div>
                            </label>
                          );
                        })}
                        {editableUsers.length === 0 && memberSearch.trim() && (
                          <p className="text-[11.5px] text-slate-400 py-2 px-2">No teammates match "{memberSearch}"</p>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Modal footer */}
              <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowChannelModal(false)}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveChannel}
                  disabled={!channelName.trim() || savingChannel}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[13px] font-semibold text-white flex items-center gap-1.5 transition-all shadow-md",
                    channelName.trim() && !savingChannel
                      ? "bg-primary-500 hover:bg-primary-600 active:scale-95"
                      : "bg-slate-300 dark:bg-slate-700 text-slate-450 dark:text-slate-500 cursor-not-allowed shadow-none"
                  )}
                >
                  {savingChannel ? <Loader2 size={13} className="animate-spin"/> : null}
                  {editingChannel ? 'Save Changes' : isPrivate ? 'Create Group' : 'Create Channel'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Channel Delete Confirmation Modal ─────────────────── */}
      <AnimatePresence>
        {confirmDelChan && (
          <>
            {/* Backdrop */}
            <motion.div
              key="delete-chan-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[60]"
              onClick={() => setConfirmDelChan(null)}
            />

            {/* Modal */}
            <motion.div
              key="delete-chan-modal"
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              className="fixed top-[30%] left-1/2 -translate-x-1/2 w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[70] p-5 overflow-hidden text-center"
            >
              <div className="w-12 h-12 bg-red-100 dark:bg-red-950/40 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={20}/>
              </div>
              <h3 className="text-[15.5px] font-bold text-slate-900 dark:text-white mb-1.5">
                Delete Channel #{confirmDelChan.name}?
              </h3>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mb-4 px-2 leading-relaxed">
                This action is permanent. Deleting this channel will immediately destroy all messages and shared attachments within it.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelChan(null)}
                  className="flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-350 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteChannel}
                  className="flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold bg-red-500 hover:bg-red-600 text-white shadow-md hover:shadow-red-500/20 active:scale-95 transition-all"
                >
                  Delete Channel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Page>
  );
}