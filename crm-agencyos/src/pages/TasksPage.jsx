import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Plus, List, Search, MoreHorizontal, Trash2, Check,
  Calendar, Clock, Building2, X, Paperclip, Link2,
  Bold, Italic, Underline as UnderlineIcon, List as ListIcon,
  ListOrdered, RefreshCw, ChevronDown, Columns, Table, ClipboardList, GanttChart,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { getBackendUrl, tasksAPI } from '../services/api';
import { useShallow } from 'zustand/shallow';
import { TodoDetailDrawer } from './TodosPage';
import {
  Page, Button, Badge, PriorityBadge, StatusBadge, Avatar,
  ViewToggle, EmptyState, ProgressBar, ConfirmDialog, DropdownMenu, AvatarContent } from '../components/ui';
import { cn, PRIORITY_CONFIG, canManage, truncate, getId, sameId } from '../utils/helpers';
import GanttView from '../components/GanttView';

const KANBAN_COLS = [
  { id: 'pending',           label: 'Pending',      color: '#f59e0b', bg: '#fffbeb' },
  { id: 'in-progress',       label: 'In Progress',  color: '#3b82f6', bg: '#eff6ff' },
  { id: 'sent-for-approval', label: 'For Approval', color: '#8b5cf6', bg: '#f5f3ff' },
  { id: 'completed',         label: 'Completed',    color: '#10b981', bg: '#ecfdf5' },
];

const MEMBER_MOVE_TARGETS = ['pending', 'in-progress'];

const fileIcon = (mime) => {
  if (!mime) return 'fa-solid fa-paperclip';
  if (mime.startsWith('image/')) return 'fa-solid fa-image';
  if (mime.startsWith('video/')) return 'fa-solid fa-film';
  if (mime.startsWith('audio/')) return 'fa-solid fa-music';
  if (mime.includes('pdf'))      return 'fa-solid fa-file-pdf';
  return 'fa-solid fa-paperclip';
};

const getAttachmentUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const backendBase = getBackendUrl();
  return `${backendBase}${url}`;
};

// ── Date filter button ────────────────────────────────────────
function DateFilter({ value, onChange, label = 'All Dates' }) {
  return (
    <div className="relative flex items-center">
      <Calendar size={13} className="absolute left-3 text-slate-400 pointer-events-none z-10" />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'form-input pl-9 pr-8 py-1.5 text-[13px] w-[165px] cursor-pointer appearance-none',
          value ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : ''
        )}
        style={{ colorScheme: 'light' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 z-10"
          title="Clear date filter"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ── Rich Text Editor ──────────────────────────────────────────
function RichTextEditor({ value, onChange, placeholder = 'Task description, acceptance criteria, notes…' }) {
  const editorRef  = useRef(null);
  const initRef    = useRef(false);

  useEffect(() => {
    if (editorRef.current && !initRef.current) {
      editorRef.current.innerHTML = value || '';
      initRef.current = true;
    }
  }, []);

  // Sync outside resets/updates correctly without cursor jumps
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      if (value === '' || document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value || '';
      }
    }
  }, [value]);

  // Ensure default paragraph separator is p for consistent block styles
  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, []);

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    if (cmd === 'formatBlock' && val === 'h3') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        let parent = selection.getRangeAt(0).startContainer;
        while (parent && parent !== editorRef.current) {
          if (parent.nodeName === 'H3') {
            document.execCommand('formatBlock', false, 'p');
            onChange(editorRef.current?.innerHTML || '');
            return;
          }
          parent = parent.parentNode;
        }
      }
    }
    document.execCommand(cmd, false, val);
    onChange(editorRef.current?.innerHTML || '');
  };

  const Btn = ({ cmd, val, title, children }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); exec(cmd, val); }}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors"
    >
      {children}
    </button>
  );

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900/30">
      <style>{`[data-rte]:empty:before{content:attr(data-ph);color:#94a3b8;pointer-events:none}`}</style>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex-wrap">
        <Btn cmd="bold"               title="Bold">          <Bold         size={13} /></Btn>
        <Btn cmd="italic"             title="Italic">        <Italic        size={13} /></Btn>
        <Btn cmd="underline"          title="Underline">     <UnderlineIcon size={13} /></Btn>
        <Btn cmd="strikeThrough"      title="Strikethrough"> <span className="text-[11px] font-bold line-through">S</span></Btn>
        <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />
        <Btn cmd="formatBlock" val="h3" title="Heading">     <span className="text-[11px] font-black">H</span></Btn>
        <Btn cmd="insertUnorderedList" title="Bullet list">  <ListIcon      size={13} /></Btn>
        <Btn cmd="insertOrderedList"   title="Numbered list"><ListOrdered   size={13} /></Btn>
        <div className="w-px h-4 bg-slate-200 dark:bg-slate-600 mx-1" />
        <Btn cmd="removeFormat"       title="Clear format">  <span className="text-[10px] font-semibold text-slate-500">Tx</span></Btn>
      </div>
      {/* Content area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-rte
        data-ph={placeholder}
        onInput={() => onChange(editorRef.current?.innerHTML || '')}
        className="min-h-[150px] max-h-[280px] overflow-y-auto p-3.5 text-[13.5px] text-slate-700 dark:text-slate-300 outline-none leading-relaxed break-words"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  );
}

// ── Attachment Zone ───────────────────────────────────────────
function AttachmentZone({ attachments, onAdd, onRemove }) {
  const fileRef        = useRef(null);
  const [dragging, setDragging]       = useState(false);
  const [showLink, setShowLink]       = useState(false);
  const [linkUrl,  setLinkUrl]        = useState('');
  const [linkName, setLinkName]       = useState('');

  const handleFiles = (files) => {
    Array.from(files).forEach((f) => {
      onAdd({
        type:    'file',
        file:    f,
        name:    f.name,
        size:    f.size,
        mimeType:f.type,
        preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      });
    });
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    onAdd({ type: 'link', url, name: linkName.trim() || url });
    setLinkUrl(''); setLinkName(''); setShowLink(false);
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl py-6 cursor-pointer transition-all text-center',
          dragging ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-900/20'
        )}
      >
        <Paperclip size={18} className="text-slate-400" />
        <p className="text-[12.5px] text-slate-500">Drop files or <span className="text-indigo-500 font-semibold">browse</span></p>
        <p className="text-[11px] text-slate-400">Images · Videos · Audio · PDFs & more</p>
        <input
          ref={fileRef} type="file" multiple className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Link row */}
      {!showLink ? (
        <button type="button" onClick={() => setShowLink(true)}
          className="flex items-center gap-1.5 text-[12.5px] text-indigo-500 hover:text-indigo-700 font-medium">
          <Link2 size={13} /> Add a link
        </button>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <input autoFocus placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLink()}
            className="form-input text-[13px] py-1.5 flex-1 min-w-[160px]" />
          <input placeholder="Label (optional)" value={linkName} onChange={(e) => setLinkName(e.target.value)}
            className="form-input text-[13px] py-1.5 w-[140px]" />
          <button type="button" onClick={addLink}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-700">
            Add
          </button>
          <button type="button" onClick={() => setShowLink(false)}
            className="px-2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Attachment list */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {attachments.map((att, i) => (
            <div key={i} className="group flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 min-w-0">
              {att.preview
                ? <img src={att.preview} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" alt="" />
                : <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                    <i className={cn(att.type === 'link' ? 'fa-solid fa-link' : fileIcon(att.mimeType), 'text-[13px]')} />
                  </div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-[11.5px] font-medium text-slate-700 dark:text-slate-300 truncate">{att.name}</p>
                {att.size  && <p className="text-[10px] text-slate-400">{(att.size/1024).toFixed(1)} KB</p>}
                {att.type === 'link' && <p className="text-[10px] text-indigo-400 truncate">{att.url}</p>}
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                className="flex-shrink-0 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task Create Drawer ────────────────────────────────────────
const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', dot: '#ef4444', bg: 'bg-red-50 dark:bg-red-900/20',    ring: 'border-red-400 dark:border-red-600',    text: 'text-red-600 dark:text-red-400' },
  { value: 'high',   label: 'High',   dot: '#f97316', bg: 'bg-orange-50 dark:bg-orange-900/20', ring: 'border-orange-400 dark:border-orange-600', text: 'text-orange-600 dark:text-orange-400' },
  { value: 'medium', label: 'Medium', dot: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-900/20', ring: 'border-yellow-400 dark:border-yellow-600',  text: 'text-yellow-600 dark:text-yellow-400' },
  { value: 'low',    label: 'Low',    dot: '#22c55e', bg: 'bg-green-50 dark:bg-green-900/20',   ring: 'border-green-400 dark:border-green-600',    text: 'text-green-600 dark:text-green-400' },
];

function TaskCreateDrawer({ open, onClose, users, clients, currentUser }) {
  const { addTask, projects } = useAppStore();

  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');

  // ── Form state ──────────────────────────────────────────────
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [taskType,    setTaskType]    = useState('inhouse');
  const [clientId,    setClientId]    = useState('');
  const [projectId,   setProjectId]   = useState('');
  const [assignedTo,  setAssignedTo]  = useState(getId(currentUser));
  const [startDate,   setStartDate]   = useState('');
  const [startTime,   setStartTime]   = useState('');
  const [dueDate,     setDueDate]     = useState('');
  const [dueTime,     setDueTime]     = useState('');
  const [tags,        setTags]        = useState([]);
  const [tagInput,    setTagInput]    = useState('');
  const [eta,         setEta]         = useState('');
  const [attachments, setAttachments] = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [userSearch,  setUserSearch]  = useState('');
  const descInitRef                   = useRef(false);

  // reset when drawer opens
  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setPriority('medium');
      setTaskType('inhouse'); setClientId(''); setProjectId('');
      setAssignedTo(getId(currentUser));
      setStartDate(''); setStartTime('');
      setDueDate(''); setDueTime('');
      setEta('');
      setTags([]); setTagInput(''); setAttachments([]);
      setSaving(false);
      setUserSearch('');
      descInitRef.current = false;
    }
  }, [open, currentUser]);

  const clientProjects = projects.filter((p) => sameId(p.clientId, clientId));

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/,/g, '');
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Task title is required'); return; }
    if (taskType === 'client' && !clientId) { toast.error('Please select a client'); return; }
    if (!startDate) { toast.error('Start date (From) is required'); return; }
    if (!dueDate) { toast.error('Due date (To) is required'); return; }
    if (!eta.trim()) { toast.error('ETA is required (e.g. 2h, 45m)'); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title',      title.trim());
      fd.append('description',description);
      fd.append('priority',   priority);
      fd.append('type',       taskType);
      fd.append('assignedTo', assignedTo || getId(currentUser));
      fd.append('startDate',  startDate);
      fd.append('startTime',  startTime);
      fd.append('dueDate',    dueDate);
      fd.append('dueTime',    dueTime);
      fd.append('eta',        eta.trim());
      fd.append('status',     'pending');
      fd.append('progress',   '0');
      if (taskType === 'client' && clientId)  fd.append('clientId',  clientId);
      if (taskType === 'client' && projectId) fd.append('projectId', projectId);
      tags.forEach((t) => fd.append('tags[]', t));

      const links = attachments.filter((a) => a.type === 'link').map((a) => ({ url: a.url, name: a.name }));
      if (links.length) fd.append('links', JSON.stringify(links));
      attachments.filter((a) => a.type === 'file' && a.file).forEach((a) => fd.append('files', a.file));

      await addTask(fd);
      toast.success('Task created!');
      onClose();
    } catch {
      // toast already shown in store
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'block text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1.5';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40" onClick={onClose} />

          <motion.div key="dr"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-[680px] max-w-[97vw] bg-white dark:bg-slate-800 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* ── Header ── */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <div>
                <h2 className="text-[18px] font-bold text-slate-900 dark:text-white">Create New Task</h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5">Fill in the details and assign to a team member</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all">
                <X size={18} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* Title */}
              <div>
                <input
                  autoFocus
                  className="w-full text-[20px] font-bold text-slate-900 dark:text-white bg-transparent border-0 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 border-b-2 border-slate-100 dark:border-slate-700 pb-2 focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
                  placeholder="Task title…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Priority */}
              <div>
                <label className={labelCls}>Priority</label>
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button key={p.value} type="button" onClick={() => setPriority(p.value)}
                      className={cn('py-2 rounded-xl border-2 text-[12.5px] font-semibold transition-all flex items-center justify-center gap-1.5',
                        priority === p.value
                          ? `${p.bg} ${p.ring} ${p.text}`
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 text-slate-500 hover:border-slate-300'
                      )}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.dot }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Task type */}
              <div>
                <label className={labelCls}>Task Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[['inhouse', 'fa-solid fa-house-laptop', 'In-House'], ['client', 'fa-solid fa-user-tie', 'Client Project']].map(([v, icon, l]) => (
                    <button key={v} type="button"
                      onClick={() => { setTaskType(v); setClientId(''); setProjectId(''); }}
                      className={cn('py-2.5 rounded-xl border-2 text-[13px] font-semibold transition-all flex items-center justify-center gap-2',
                        taskType === v
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-400 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 text-slate-500 hover:border-slate-300'
                      )}>
                      <i className={cn(icon, 'text-[14px]', taskType === v ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400')} />
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Client + Project */}
              {taskType === 'client' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Client *</label>
                    <select className="form-input text-[13.5px] py-2" value={clientId}
                      onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}>
                      <option value="">Select client…</option>
                      {clients.map((c) => <option key={getId(c)} value={getId(c)}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project</label>
                    <select className="form-input text-[13.5px] py-2" value={projectId}
                      onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
                      <option value="">{clientId ? 'Select project…' : 'Choose client first'}</option>
                      {clientProjects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Assign to */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Assign To</label>
                  <div className="relative w-44">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-450 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search member…"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2 py-1 text-[11.5px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-slate-700 dark:text-slate-300 transition-colors"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto p-1.5 border border-slate-200 dark:border-slate-700/50 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
                  {[currentUser, ...memberUsers.filter((u) => !sameId(u, currentUser))]
                    .filter((u) => 
                      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
                      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
                      u.position?.toLowerCase().includes(userSearch.toLowerCase())
                    )
                    .map((u) => (
                      <button key={getId(u)} type="button" onClick={() => setAssignedTo(getId(u))}
                        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[12.5px] font-medium transition-all',
                          assignedTo === getId(u)
                            ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                            : 'border-transparent bg-slate-100 dark:bg-slate-800/40 text-slate-650 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                        )}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 overflow-hidden"
                          style={{ background: u.avatar ? 'transparent' : (u.color || '#6366f1') }}>
                          <AvatarContent user={u} fallback={u.initials || u.name?.[0]} />
                        </div>
                        {u.name.split(' ')[0]}
                        {sameId(u, currentUser) && <span className="text-[10px] opacity-50">(you)</span>}
                      </button>
                    ))}
                  {[currentUser, ...memberUsers.filter((u) => !sameId(u, currentUser))]
                    .filter((u) => 
                      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
                      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
                      u.position?.toLowerCase().includes(userSearch.toLowerCase())
                    ).length === 0 && (
                      <p className="text-[11.5px] text-slate-400 dark:text-slate-500 py-1.5 px-2">No members found matching "{userSearch}"</p>
                    )}
                </div>
              </div>

              {/* ETA / Timeline */}
              <div>
                <label className={labelCls}>ETA / Timeline <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Start Date (From) <span className="text-red-500">*</span></label>
                      <input type="date" className={cn('form-input text-[13.5px] py-2', !startDate && 'border-red-300 dark:border-red-800/60 focus:border-red-400')}
                        value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Start Time (From)</label>
                      <input type="time" className="form-input text-[13.5px] py-2"
                        value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Due Date (To) <span className="text-red-500">*</span></label>
                      <input type="date" className={cn('form-input text-[13.5px] py-2', !dueDate && 'border-red-300 dark:border-red-800/60 focus:border-red-400')}
                        min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Due Time (To)</label>
                      <input type="time" className="form-input text-[13.5px] py-2"
                        value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ETA input */}
              <div>
                <label className={labelCls}>ETA (Estimated Time) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  className={cn('form-input text-[13.5px] py-2 w-full', !eta.trim() && 'border-red-300 dark:border-red-800/60 focus:border-red-400')}
                  placeholder="e.g. 2h, 45m, 1h 30m…"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                />
                <p className="text-[11px] text-slate-400 mt-1">How long will this task take? (required)</p>
              </div>

              {/* Tags */}
              <div>
                <label className={labelCls}>Tags</label>
                <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 min-h-[44px] bg-white dark:bg-slate-900/20 focus-within:border-indigo-400 transition-colors">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-[12px] font-medium border border-indigo-200 dark:border-indigo-800">
                      #{tag}
                      <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))}
                        className="text-indigo-400 hover:text-red-500 ml-0.5 leading-none">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    className="flex-1 min-w-[130px] bg-transparent outline-none text-[13px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400"
                    placeholder={tags.length ? '' : 'Type a tag and press Enter…'}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                      if (e.key === 'Backspace' && !tagInput && tags.length) setTags((t) => t.slice(0, -1));
                    }}
                  />
                </div>
              </div>

              {/* Description — rich text */}
              <div>
                <label className={labelCls}>Description</label>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                />
              </div>

              {/* Attachments */}
              <div>
                <label className={labelCls}>Attachments</label>
                <AttachmentZone
                  attachments={attachments}
                  onAdd={(a) => setAttachments((prev) => [...prev, a])}
                  onRemove={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 bg-slate-50 dark:bg-slate-900/20">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-[13.5px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={saving || !title.trim() || !startDate || !dueDate || !eta.trim()}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
                {saving
                  ? <><RefreshCw size={14} className="animate-spin" /> Creating…</>
                  : <><Plus size={14} /> Create Task</>
                }
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Kanban Card ───────────────────────────────────────────────
function KanbanCard({ task, users, clients, role, authUser, onMove, onApprove, onDelete, onSelect }) {
  const projects  = useAppStore((s) => s.projects);
  const todos     = useAppStore((s) => s.todos) || [];
  const taskTodos = (todos || []).filter((todo) => sameId(todo.taskId, task));
  const totalTodos = taskTodos.length;
  const completedTodos = taskTodos.filter((todo) => todo.status === 'completed').length;
  const assignee  = users.find((u) => sameId(u, task.assignedTo));
  const client    = task.clientId ? clients.find((c) => sameId(c, task.clientId)) : null;
  const pCfg      = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const isManager = canManage(role);

  const targets = KANBAN_COLS
    .filter((c) => c.id !== task.status)
    .filter((c) => {
      if (isManager) return true;
      if (task.status === 'pending' && c.id === 'in-progress') return true;
      if (task.status === 'sent-for-approval' && c.id === 'in-progress') return true;
      return false;
    });

  const menuItems = [
    ...targets.map((c) => ({ label: `Move → ${c.label}`, onClick: () => onMove(getId(task), c.id) })),
    ...(targets.length ? [{ separator: true }] : []),
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(getId(task)) },
  ];

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      className={cn('kanban-card border-l-[3px] cursor-pointer')} style={{ borderLeftColor: pCfg.dot }}
      onClick={() => onSelect?.(task)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 leading-snug flex-1 break-words">
          <span className="text-slate-400 font-mono mr-1.5 text-[12px]">#{task.taskNumber || '—'}</span>
          {task.title}
        </p>
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu trigger={<button className="btn-icon p-1 text-slate-400 flex-shrink-0"><MoreHorizontal size={14} /></button>} items={menuItems} />
        </div>
      </div>
      {client && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-2.5 flex-wrap">
          <Building2 size={11} className="text-slate-400 flex-shrink-0" />
          <span className="font-medium text-slate-650 dark:text-slate-450">{client.name}</span>
          {task.projectId && (
            <>
              <span className="text-slate-350">•</span>
              <span className="text-primary-600 dark:text-primary-400 font-semibold text-[11px]">
                {typeof task.projectId === 'object' ? task.projectId.name : (projects.find((p) => sameId(p, task.projectId))?.name || 'Project')}
              </span>
            </>
          )}
        </div>
      )}
      {task.tags?.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2.5">
          {task.tags.map((t) => <span key={t} className="badge badge-neutral text-[10.5px]">#{t}</span>)}
        </div>
      )}

      <div className="flex items-center justify-between mt-1 pt-2 border-t border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PriorityBadge priority={task.priority} />
          {totalTodos > 0 && (
            <span className="badge bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[10.5px] font-semibold flex items-center gap-1 select-none py-0.5">
              <ClipboardList size={10} className="text-slate-400" />
              {completedTodos}/{totalTodos}
            </span>
          )}
          {(task.startDate || task.dueDate) && (
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Clock size={10} className="text-slate-400" />
              {task.startDate || '—'} ➔ {task.dueDate || '—'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {task.eta && <span className="text-[11px] text-slate-400"><Clock size={10} className="inline mr-0.5" />{task.eta}</span>}
          <Avatar user={assignee} size="xs" />
        </div>
      </div>
      {isManager && task.status === 'sent-for-approval' && (
        <button onClick={(e) => { e.stopPropagation(); onApprove(getId(task)); }} className="btn-success btn-sm w-full justify-center mt-2.5">
          <Check size={12} /> Approve & Mark Done
        </button>
      )}
      {!isManager && sameId(task.assignedTo, authUser) && task.status === 'in-progress' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            useAppStore.getState().updateTask(getId(task), { status: 'sent-for-approval', readyForApproval: false });
            toast.success('Task submitted for approval!');
          }}
          className="w-full py-1.5 rounded-lg text-[11.5px] font-semibold transition-all justify-center items-center flex gap-1 mt-2.5 border border-dashed select-none bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/30 text-emerald-600 hover:bg-emerald-100"
        >
          ✓ Mark Ready for Approval
        </button>
      )}
    </motion.div>
  );
}

// ── Task Detail Drawer ────────────────────────────────────────
function TaskDetailDrawer({ task, open, onClose, users, clients, authUser, role, todos = [], onSelectTodo }) {
  const { updateTask, deleteTask, projects } = useAppStore();

  const isManager = canManage(role);
  const canEdit   = isManager || sameId(task?.assignedTo, authUser);
  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');

  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [taskType,    setTaskType]    = useState('inhouse');
  const [clientId,    setClientId]    = useState('');
  const [projectId,   setProjectId]   = useState('');
  const [assignedTo,  setAssignedTo]  = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [startTime,   setStartTime]   = useState('');
  const [dueDate,     setDueDate]     = useState('');
  const [dueTime,     setDueTime]     = useState('');
  const [progress,    setProgress]    = useState(0);
  const [status,      setStatus]      = useState('pending');
  const [tags,        setTags]        = useState([]);
  const [tagInput,    setTagInput]    = useState('');
  const [existingAtts, setExistingAtts] = useState([]);
  const [newAtts,      setNewAtts]      = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [editUserSearch, setEditUserSearch] = useState('');

  useEffect(() => {
    if (task && open) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setTaskType(task.type || 'inhouse');
      setClientId(task.clientId ? getId(task.clientId) : '');
      setProjectId(task.projectId ? getId(task.projectId) : '');
      setAssignedTo(getId(task.assignedTo));
      setStartDate(task.startDate || '');
      setStartTime(task.startTime || '');
      setDueDate(task.dueDate || '');
      setDueTime(task.dueTime || '');
      setProgress(task.progress || 0);
      setStatus(task.status || 'pending');
      setTags(task.tags || []);
      setTagInput('');
      setExistingAtts(task.attachments || []);
      setNewAtts([]);
      setSaving(false);
      setConfirmDel(false);
    }
  }, [task?._id, open]);

  const clientProjects = projects.filter((p) => sameId(p.clientId, clientId));
  const client         = clients.find((c) => getId(c) === clientId);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/,/g, '');
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput('');
  };

  const autoSave = (patch) => updateTask(getId(task), patch);

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const hasNewFiles = newAtts.some((a) => a.type === 'file' && a.file);
      if (hasNewFiles) {
        const fd = new FormData();
        fd.append('title', title.trim()); fd.append('description', description);
        fd.append('priority', priority); fd.append('type', taskType);
        fd.append('assignedTo', assignedTo);
        fd.append('startDate', startDate); fd.append('startTime', startTime);
        fd.append('dueDate', dueDate); fd.append('dueTime', dueTime);
        fd.append('status', status); fd.append('progress', String(progress));
        if (taskType === 'client' && clientId)  fd.append('clientId', clientId);
        if (taskType === 'client' && projectId) fd.append('projectId', projectId);
        tags.forEach((t) => fd.append('tags[]', t));
        fd.append('existingAttachments', JSON.stringify(existingAtts));
        const links = newAtts.filter((a) => a.type === 'link').map((a) => ({ url: a.url, name: a.name }));
        if (links.length) fd.append('links', JSON.stringify(links));
        newAtts.filter((a) => a.type === 'file' && a.file).forEach((a) => fd.append('files', a.file));
        await updateTask(getId(task), fd);
      } else {
        const newLinks = newAtts.filter((a) => a.type === 'link').map((a) => ({ type: 'link', url: a.url, name: a.name }));
        await updateTask(getId(task), {
          title: title.trim(), description, priority, type: taskType,
          assignedTo, startDate, startTime, dueDate, dueTime, status, progress,
          clientId:  taskType === 'client' ? clientId  || null : null,
          projectId: taskType === 'client' ? projectId || null : null,
          tags, attachments: [...existingAtts, ...newLinks],
        });
      }
      toast.success('Task updated!');
      setNewAtts([]);
      onClose();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async () => {
    try { await deleteTask(getId(task)); toast.success('Task deleted!'); onClose(); } catch {}
  };

  if (!task) return null;

  const taskTodos = (todos || []).filter((todo) => sameId(todo.taskId, task));
  const assigner  = task.assignedBy ? users.find((u) => sameId(u, task.assignedBy)) : null;
  const labelCls  = 'block text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1.5';
  const STATUS_OPTIONS = [
    { value: 'pending',           label: 'Pending',      color: '#f59e0b' },
    { value: 'in-progress',       label: 'In Progress',  color: '#3b82f6' },
    { value: 'sent-for-approval', label: 'For Approval', color: '#8b5cf6' },
    { value: 'completed',         label: 'Completed',    color: '#10b981' },
  ];

  const attIcon = (att) => {
    if (att.type === 'link')             return '🔗';
    if (att.mimeType?.startsWith('image/')) return '🖼️';
    if (att.mimeType?.startsWith('video/')) return '🎬';
    if (att.mimeType?.startsWith('audio/')) return '🎵';
    if (att.mimeType?.includes('pdf'))      return '📄';
    return '📎';
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40" onClick={onClose} />

          <motion.div key="dr"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-[720px] max-w-[97vw] bg-white dark:bg-slate-800 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* ── Header ── */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              {/* Status pills */}
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {STATUS_OPTIONS.map((s) => {
                  const isAllowed = isManager || (task.status === 'pending' && s.value === 'in-progress') || s.value === task.status;
                  return (
                    <button key={s.value} type="button"
                      disabled={!canEdit || !isAllowed}
                      onClick={() => {
                        setStatus(s.value);
                        // Clear readyForApproval if leaving in-progress
                        const shouldClearApproval = s.value === 'pending' || s.value === 'sent-for-approval' || s.value === 'completed';
                        autoSave(shouldClearApproval ? { status: s.value, readyForApproval: false } : { status: s.value });
                      }}
                      className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all',
                        status === s.value
                          ? 'text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700',
                        (!canEdit || !isAllowed) && 'opacity-50 cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700/50'
                      )}
                      style={status === s.value ? { background: s.color } : {}}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', status === s.value ? 'bg-white/60' : '')}
                        style={status !== s.value ? { background: s.color } : {}} />
                      {s.label}
                    </button>
                  );
                })}
                <span className="ml-auto text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                  <span className="text-primary-650 dark:text-primary-400 font-mono font-bold">TASK #{task.taskNumber || '—'}</span>
                  <span className="text-slate-350 dark:text-slate-650">•</span>
                  <span>{task.type === 'client' ? '👤 Client' : '🏠 In-House'}</span>
                  <span className="text-slate-350 dark:text-slate-650">•</span>
                  <span>Created {task.createdAt ? new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                </span>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {canEdit
                    ? <textarea value={title} onChange={(e) => setTitle(e.target.value)}
                        rows={1}
                        className="w-full text-[20px] font-bold text-slate-900 dark:text-white bg-transparent border-0 outline-none placeholder:text-slate-350 border-b-2 border-transparent focus:border-indigo-400 transition-colors pb-1 resize-none overflow-hidden break-words whitespace-pre-wrap leading-tight h-auto"
                        style={{ wordBreak: 'break-word' }}
                        placeholder="Task title…"
                        onInput={(e) => {
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        ref={(el) => {
                          if (el) {
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                          }
                        }}
                      />
                    : <h2 className="text-[20px] font-bold text-slate-900 dark:text-white break-words" style={{ wordBreak: 'break-word' }}>{task.title}</h2>
                  }
                </div>
                <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 transition-all">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* Priority */}
              <div>
                <label className={labelCls}>Priority</label>
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button key={p.value} type="button" disabled={!canEdit}
                      onClick={() => setPriority(p.value)}
                      className={cn('py-2 rounded-xl border-2 text-[12.5px] font-semibold transition-all flex items-center justify-center gap-1.5',
                        priority === p.value
                          ? `${p.bg} ${p.ring} ${p.text}`
                          : cn('border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 text-slate-500', canEdit && 'hover:border-slate-300'),
                        !canEdit && 'cursor-default'
                      )}>
                      <span className="w-2 h-2 rounded-full" style={{ background: p.dot }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assignee */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Assigned To</label>
                  {isManager && (
                    <div className="relative w-44">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-450 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search member…"
                        value={editUserSearch}
                        onChange={(e) => setEditUserSearch(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2 py-1 text-[11.5px] outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-slate-700 dark:text-slate-300 transition-colors"
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto p-1.5 border border-slate-200 dark:border-slate-700/50 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
                  {[...memberUsers, ...(isManager ? [authUser] : [])]
                    .filter((u, i, arr) => u && arr.findIndex((x) => x && sameId(x, u)) === i)
                    .filter((u) =>
                      !editUserSearch ||
                      u.name?.toLowerCase().includes(editUserSearch.toLowerCase()) ||
                      u.email?.toLowerCase().includes(editUserSearch.toLowerCase()) ||
                      u.position?.toLowerCase().includes(editUserSearch.toLowerCase())
                    )
                    .map((u) => (
                      <button key={getId(u)} type="button" disabled={!isManager}
                        onClick={() => isManager && setAssignedTo(getId(u))}
                        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[12.5px] font-medium transition-all',
                          assignedTo === getId(u)
                            ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                            : cn('border-transparent bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400', isManager && 'hover:border-slate-300 dark:hover:border-slate-600'),
                          !isManager && 'cursor-default'
                        )}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold overflow-hidden" style={{ background: u.avatar ? 'transparent' : (u.color || '#6366f1') }}>
                          <AvatarContent user={u} fallback={u.initials || u.name?.[0]} />
                        </div>
                        {u.name.split(' ')[0]}
                        {sameId(u, authUser) && <span className="text-[10px] opacity-50">(you)</span>}
                      </button>
                    ))}
                  {[...memberUsers, ...(isManager ? [authUser] : [])]
                    .filter((u, i, arr) => u && arr.findIndex((x) => x && sameId(x, u)) === i)
                    .filter((u) =>
                      !editUserSearch ||
                      u.name?.toLowerCase().includes(editUserSearch.toLowerCase()) ||
                      u.email?.toLowerCase().includes(editUserSearch.toLowerCase()) ||
                      u.position?.toLowerCase().includes(editUserSearch.toLowerCase())
                    ).length === 0 && (
                      <p className="text-[11.5px] text-slate-400 dark:text-slate-500 py-1.5 px-2">No members found matching "{editUserSearch}"</p>
                    )}
                </div>
              </div>

              {/* Assigned By */}
              {assigner && (
                <div>
                  <label className={labelCls}>Assigned By</label>
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 dark:bg-slate-900/10 rounded-lg border border-slate-200 dark:border-slate-700 max-w-sm">
                    <Avatar user={assigner} size="xs" />
                    <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{assigner.name}</span>
                    <span className="ml-auto badge badge-neutral text-[10px]">{assigner.role}</span>
                  </div>
                </div>
              )}

              {/* Task type — managers only */}
              {isManager && (
                <div>
                  <label className={labelCls}>Task Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['inhouse','🏠 In-House'],['client','👤 Client Project']].map(([v,l]) => (
                      <button key={v} type="button"
                        onClick={() => { setTaskType(v); setClientId(''); setProjectId(''); }}
                        className={cn('py-2.5 rounded-xl border-2 text-[13px] font-semibold transition-all',
                          taskType === v
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-400 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 text-slate-500 hover:border-slate-300'
                        )}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Client + Project */}
              {taskType === 'client' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Client</label>
                    {isManager
                      ? <select className="form-input text-[13.5px] py-2" value={clientId}
                          onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}>
                          <option value="">Select client…</option>
                          {clients.map((c) => <option key={getId(c)} value={getId(c)}>{c.name}</option>)}
                        </select>
                      : <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 pt-1 break-words" style={{ wordBreak: 'break-word' }}>{client?.name || '—'}</p>
                    }
                  </div>
                  <div>
                    <label className={labelCls}>Project</label>
                    {isManager
                      ? <select className="form-input text-[13.5px] py-2" value={projectId}
                          onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
                          <option value="">{clientId ? 'Select project…' : 'Choose client first'}</option>
                          {clientProjects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                        </select>
                      : <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 pt-1 break-words" style={{ wordBreak: 'break-word' }}>
                          {projects.find((p) => sameId(p, projectId))?.name || '—'}
                        </p>
                    }
                  </div>
                </div>
              )}

              {/* ETA */}
              <div>
                <label className={labelCls}>ETA / Timeline</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Start Date</label>
                      <input type="date" className="form-input text-[13.5px] py-2" disabled={!canEdit}
                        value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Start Time (From)</label>
                      <input type="time" className="form-input text-[13.5px] py-2" disabled={!canEdit}
                        value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Due Date</label>
                      <input type="date" className="form-input text-[13.5px] py-2" disabled={!canEdit}
                        min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11.5px] text-slate-500 mb-1">Due Time (To)</label>
                      <input type="time" className="form-input text-[13.5px] py-2" disabled={!canEdit}
                        value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress section removed */}

              {/* Tags */}
              <div>
                <label className={labelCls}>Tags</label>
                <div className="flex flex-wrap gap-2 items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 min-h-[44px] bg-white dark:bg-slate-900/20">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-[12px] font-medium border border-indigo-200 dark:border-indigo-800">
                      #{tag}
                      {canEdit && <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="text-indigo-400 hover:text-red-500 ml-0.5"><X size={10} /></button>}
                    </span>
                  ))}
                  {canEdit && (
                    <input className="flex-1 min-w-[120px] bg-transparent outline-none text-[13px] placeholder:text-slate-400"
                      placeholder={tags.length ? '' : 'Add tags…'} value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                        if (e.key === 'Backspace' && !tagInput && tags.length) setTags((t) => t.slice(0, -1));
                      }} />
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className={labelCls}>Description</label>
                {canEdit
                  ? <RichTextEditor value={description} onChange={setDescription} />
                  : <div className="min-h-[80px] p-3.5 text-[13.5px] text-slate-700 dark:text-slate-300 leading-relaxed border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/20 break-words" style={{ wordBreak: 'break-word' }}
                      dangerouslySetInnerHTML={{ __html: description || '<span class="text-slate-400 italic">No description</span>' }} />
                }
              </div>

              {/* Connected Daily Todos Checklist */}
              <div>
                <label className={labelCls}>Daily Todos Checklist {taskTodos.length > 0 && `(${taskTodos.length})`}</label>
                {taskTodos.length === 0 ? (
                  <p className="text-[12.5px] text-slate-400 dark:text-slate-500 italic py-2">No daily todos are currently connected to this task.</p>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {taskTodos.map((td) => {
                      const isCompleted = td.status === 'completed';
                      return (
                        <div key={getId(td)}
                          onClick={() => onSelectTodo?.(td)}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 hover:border-indigo-400/60 dark:hover:border-indigo-500/50 cursor-pointer transition-all min-w-0"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={cn(
                              "w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors",
                              isCompleted
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                            )}>
                              {isCompleted && <Check size={10} strokeWidth={3} />}
                            </div>
                            <span className={cn(
                              "text-[13px] font-medium break-words whitespace-pre-wrap flex-1",
                              isCompleted ? "text-slate-400 line-through" : "text-slate-750 dark:text-slate-350"
                            )} style={{ wordBreak: 'break-word' }}>
                              {td.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>

                            <PriorityBadge priority={td.priority} />
                            <StatusBadge status={td.status} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Attachments */}
              <div>
                <label className={labelCls}>Attachments {existingAtts.length > 0 && `(${existingAtts.length})`}</label>

                {/* Existing */}
                {existingAtts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {existingAtts.map((att, i) => (
                      <div key={i} className="group flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 hover:border-indigo-400/60 transition-colors min-w-0">
                        {/* Clickable name/icon area */}
                        <a href={getAttachmentUrl(att.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 flex-1 hover:text-indigo-650 dark:hover:text-indigo-400 transition-colors">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                            <i className={cn(att.type === 'link' ? 'fa-solid fa-link' : fileIcon(att.mimeType), 'text-[13px]')} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11.5px] font-medium text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">{att.name}</p>
                            {att.size > 0 && <p className="text-[10px] text-slate-400">{(att.size/1024).toFixed(1)} KB</p>}
                            {att.type === 'link' && <p className="text-[9.5px] text-indigo-450 dark:text-indigo-400 truncate">{att.url}</p>}
                          </div>
                        </a>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <a href={getAttachmentUrl(att.url)} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-[13px] font-bold transition-all"
                            title={att.type === 'link' ? 'Open link' : 'Download'}>
                            {att.type === 'link' ? '↗' : '↓'}
                          </a>
                          {canEdit && (
                            <button type="button" onClick={() => setExistingAtts((p) => p.filter((_, idx) => idx !== i))}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new */}
                {canEdit && (
                  <AttachmentZone
                    attachments={newAtts}
                    onAdd={(a) => setNewAtts((p) => [...p, a])}
                    onRemove={(i) => setNewAtts((p) => p.filter((_, idx) => idx !== i))}
                  />
                )}
              </div>

              {/* Member: submit for approval / withdraw */}
              {!isManager && sameId(task.assignedTo, authUser) && (status === 'in-progress' || status === 'sent-for-approval') && (
                <button type="button"
                  onClick={() => {
                    if (status === 'in-progress') {
                      setStatus('sent-for-approval');
                      autoSave({ status: 'sent-for-approval', readyForApproval: false });
                      toast.success('Task submitted for approval!');
                    } else {
                      setStatus('in-progress');
                      autoSave({ status: 'in-progress', readyForApproval: false });
                      toast.success('Task withdrawn from approval');
                    }
                    onClose();
                  }}
                  className={cn('w-full py-2.5 rounded-xl text-[13px] font-semibold border-2 border-dashed transition-all',
                    status === 'sent-for-approval'
                      ? 'border-slate-200 bg-slate-50 dark:bg-slate-800/30 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                      : 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800/40 text-emerald-600 hover:bg-emerald-100'
                  )}>
                  {status === 'sent-for-approval' ? '✕ Withdraw from Approval' : '✓ Mark as Ready for Approval'}
                </button>
              )}

              {/* Manager: approve */}
              {isManager && status === 'sent-for-approval' && (
                <button type="button"
                  onClick={() => { autoSave({ status: 'completed', progress: 100, readyForApproval: false }); toast.success('Task approved!'); onClose(); }}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold flex items-center justify-center gap-2 transition-all">
                  <Check size={14} /> Approve &amp; Mark Completed
                </button>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 bg-slate-50 dark:bg-slate-900/20">
              {isManager
                ? <button type="button" onClick={() => setConfirmDel(true)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-red-400 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                    <Trash2 size={14} /> Delete
                  </button>
                : <div />
              }
              {canEdit && (
                <button type="button" onClick={handleSave} disabled={saving || !title.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-xl transition-all disabled:opacity-50 shadow-sm">
                  {saving ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><Check size={14} /> Save Changes</>}
                </button>
              )}
            </div>
          </motion.div>

          <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete}
            title="Delete Task" message={`"${task.title}" will be permanently deleted.`} confirmLabel="Delete Task" />
        </>
      )}
    </AnimatePresence>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function TasksPage() {
  const { authUser, tasks, clients, moveTask, deleteTask, projects, systemSettings, todos } = useAppStore(useShallow((s) => ({
    authUser:       s.authUser,
    tasks:          s.tasks,
    clients:        s.clients,
    moveTask:       s.moveTask,
    deleteTask:     s.deleteTask,
    projects:       s.projects,
    systemSettings: s.systemSettings,
    todos:          s.todos,
  })));
  const users = useAppStore((s) => s.users);

  const [view,         setView]         = useState('kanban');
  const [showCreate,   setShowCreate]   = useState(false);
  const [confirmDel,   setConfirmDel]   = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedTodo, setSelectedTodo] = useState(null);
  const [filters,    setFilters]    = useState({ search: '', priority: '', status: '', position: '', memberId: '', date: '' });

  // Gantt: optional date-range fetch (null = use store data)
  const [ganttOverride,  setGanttOverride]  = useState(null);  // fetched items or null
  const [ganttFetching,  setGanttFetching]  = useState(false);

  const handleGanttPeriodChange = async (start, end) => {
    if (!start && !end) { setGanttOverride(null); return; }
    setGanttFetching(true);
    try {
      const { data } = await tasksAPI.getByDateRange(start, end);
      setGanttOverride(data.data);
    } catch { setGanttOverride([]); }
    finally { setGanttFetching(false); }
  };

  const role      = authUser?.role;
  const isManager = canManage(role);

  // Base: members see only their own tasks
  const baseTasks = role === 'member'
    ? tasks.filter((t) => sameId(t.assignedTo, authUser))
    : tasks;

  // Apply all filters
  const filtered = baseTasks.filter((t) => {
    if (filters.search   && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.status   && t.status   !== filters.status)   return false;
    if (isManager) {
      if (filters.memberId) {
        if (getId(t.assignedTo) !== filters.memberId) return false;
      } else if (filters.position) {
        const assignee = users.find((u) => getId(u) === getId(t.assignedTo));
        if (!assignee || assignee.position !== filters.position) return false;
      }
    }
    // Date filter: matches dueDate OR createdAt
    if (filters.date) {
      const matchDue     = t.dueDate === filters.date;
      const createdDate  = t.createdAt?.split?.('T')?.[0] || t.createdAt;
      const matchCreated = createdDate === filters.date;
      if (!matchDue && !matchCreated) return false;
    }
    return true;
  });

  const handleApprove = (id) => { moveTask(id, 'completed'); toast.success('Task approved & completed!'); };
  const handleDelete  = (id) => { deleteTask(id); toast.success('Task deleted.'); };

  const statusOptions = isManager
    ? [['pending','Pending'],['in-progress','In Progress'],['sent-for-approval','For Approval'],['completed','Completed']]
    : [['pending','Pending'],['in-progress','In Progress'],['sent-for-approval','For Approval']];

  const memberUsers       = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const positions         = systemSettings?.positions?.length ? systemSettings.positions : [];
  const membersInPosition = filters.position
    ? memberUsers.filter((u) => u.position === filters.position)
    : [];
  const activeFiltersCount = [filters.search, filters.priority, filters.status, filters.position, filters.memberId, filters.date].filter(Boolean).length;

  return (
    <Page>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Task Management</h1>
          <p className="page-sub">
            {filtered.length} tasks · {filtered.filter((t) => t.status === 'completed').length} completed
            {filters.date && <span className="ml-2 text-primary-500 font-medium">· Filtered: {new Date(filters.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle
            views={[
              { value: 'kanban', icon: Columns,   label: 'Kanban' },
              { value: 'list',   icon: List,       label: 'List'   },
              { value: 'table',  icon: Table,      label: 'Table'  },
              { value: 'gantt',  icon: GanttChart, label: 'Gantt'  },
            ]}
            active={view} onChange={setView}
          />
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Task
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-2.5 mb-5 flex-wrap items-center">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input className="form-input pl-9 py-1.5 text-[13px]" placeholder="Search tasks…"
            value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        </div>

        {/* All Statuses */}
        <select className="form-input w-[155px] text-[13px] py-1.5" value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All Statuses</option>
          {statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {/* Position → Member two-level filter — admin/manager only */}
        {isManager && (
          <>
            <select
              className="form-input w-[155px] text-[13px] py-1.5"
              value={filters.position}
              onChange={(e) => setFilters((f) => ({ ...f, position: e.target.value, memberId: '' }))}
            >
              <option value="">All Positions</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            {filters.position && (
              <select
                className="form-input w-[155px] text-[13px] py-1.5"
                value={filters.memberId}
                onChange={(e) => setFilters((f) => ({ ...f, memberId: e.target.value }))}
              >
                <option value="">All {filters.position}s</option>
                {membersInPosition.map((u) => (
                  <option key={getId(u)} value={getId(u)}>{u.name.split(' ')[0]}</option>
                ))}
              </select>
            )}
          </>
        )}

        {/* All Priorities */}
        <select className="form-input w-[150px] text-[13px] py-1.5" value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* ── Date Filter — next to All Priorities ── */}
        <DateFilter
          value={filters.date}
          onChange={(v) => setFilters((f) => ({ ...f, date: v }))}
        />

        {/* Clear all */}
        {activeFiltersCount > 0 && (
          <button
            className="flex items-center gap-1 text-[12.5px] text-primary-500 hover:text-primary-600 font-medium"
            onClick={() => setFilters({ search: '', priority: '', status: '', memberId: '', date: '' })}
          >
            <X size={12} /> Clear {activeFiltersCount > 1 ? `(${activeFiltersCount})` : ''}
          </button>
        )}
      </div>

      {/* Date filter active banner */}
      {filters.date && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl text-[13px] text-primary-700 dark:text-primary-300">
          <Calendar size={14} />
          Showing tasks for <strong>{new Date(filters.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{filtered.length} task{filtered.length !== 1 ? 's' : ''} found</span>
          <button className="ml-auto text-primary-500 hover:text-primary-700" onClick={() => setFilters((f) => ({ ...f, date: '' }))}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Kanban ── */}
      {view === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.id);
            return (
              <div key={col.id} className="kanban-col flex-shrink-0">
                <div className="flex items-center justify-between px-3 py-2.5 card mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{col.label}</span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: col.bg, color: col.color }}>{colTasks.length}</span>
                </div>
                <div className="space-y-2.5">
                  <AnimatePresence>
                    {colTasks.map((task) => (
                      <KanbanCard key={getId(task)} task={task} users={users} clients={clients} role={role} authUser={authUser}
                        onMove={moveTask} onApprove={handleApprove} onDelete={(id) => setConfirmDel(id)}
                        onSelect={setSelectedTask} />
                    ))}
                  </AnimatePresence>
                  {colTasks.length === 0 && (
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl py-8 text-center text-[12px] text-slate-400">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── List ── */}
      {view === 'list' && (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((task) => {
              const assignee = users.find((u) => sameId(u, task.assignedTo));
              const client   = task.clientId ? clients.find((c) => sameId(c, task.clientId)) : null;
              const pCfg     = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
              const taskTodos = todos.filter((todo) => sameId(todo.taskId, task));
              const totalTodos = taskTodos.length;
              const completedTodos = taskTodos.filter((todo) => todo.status === 'completed').length;
              return (
                <motion.div key={getId(task)} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className={cn('card p-4 flex items-center gap-4 border-l-[3px] cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600')} style={{ borderLeftColor: pCfg.dot }}
                  onClick={() => setSelectedTask(task)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                      <span className="text-slate-400 font-mono mr-1.5 text-[12px]">#{task.taskNumber || '—'}</span>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {client && (
                        <span className="text-[11.5px] text-slate-550 flex items-center gap-1">
                          <Building2 size={10} className="text-slate-400" />
                          {client.name}
                          {task.projectId && (
                            <span className="text-primary-600 dark:text-primary-450 font-medium pl-1 text-[11px]">
                              ({typeof task.projectId === 'object' ? task.projectId.name : (projects.find((p) => sameId(p, task.projectId))?.name || 'Project')})
                            </span>
                          )}
                        </span>
                      )}
                      {(task.startDate || task.dueDate) && (
                        <span className="text-[11.5px] text-slate-400 flex items-center gap-1">
                          <Clock size={10} className="text-slate-400" />
                          {task.startDate || '—'} ➔ {task.dueDate || '—'}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">Created: {task.createdAt?.split?.('T')?.[0] || task.createdAt}</span>
                      {totalTodos > 0 && <span className="text-slate-355 dark:text-slate-650 select-none">•</span>}
                      {totalTodos > 0 && (
                        <span className="text-[11.5px] text-slate-500 font-semibold flex items-center gap-1 select-none">
                          <ClipboardList size={11} className="text-slate-400" />
                          Todos: {completedTodos}/{totalTodos}
                        </span>
                      )}
                    </div>
                  </div>
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Avatar user={assignee} size="xs" />
                    <span className="text-[12px] text-slate-600 dark:text-slate-400 hidden lg:block">{assignee?.name?.split(' ')[0]}</span>
                  </div>
                  {/* Progress section removed */}
                  {isManager && task.status === 'sent-for-approval' && (
                    <Button variant="success" size="xs" onClick={() => handleApprove(getId(task))}><Check size={11} /> Approve</Button>
                  )}
                  <button className="btn-icon text-slate-400 hover:text-red-500 p-1" onClick={(e) => { e.stopPropagation(); setConfirmDel(getId(task)); }}>
                    <Trash2 size={13} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {filtered.length === 0 && (
            <EmptyState icon={Calendar} title="No tasks found"
              description={filters.date ? `No tasks for ${filters.date}` : 'Adjust filters or create a new task.'}
              action={!filters.date && <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}><Plus size={13} /> Create Task</Button>}
            />
          )}
        </div>
      )}

      {/* ── Table ── */}
      {view === 'table' && (
        <div className="table-container">
          <table className="crm-table">
            <thead>
              <tr>{['Task','Client','Assigned To','Priority','Status','Timeline','Created','Actions'].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const assignee = users.find((u) => sameId(u, task.assignedTo));
                const client   = task.clientId ? clients.find((c) => sameId(c, task.clientId)) : null;
                const taskTodos = todos.filter((todo) => sameId(todo.taskId, task));
                const totalTodos = taskTodos.length;
                const completedTodos = taskTodos.filter((todo) => todo.status === 'completed').length;
                return (
                  <tr key={getId(task)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelectedTask(task)}>
                    <td className="font-semibold max-w-[200px] truncate">
                      <span className="text-slate-400 font-mono mr-1 text-[12px]">#{task.taskNumber || '—'}</span>
                      {task.title}
                      {totalTodos > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-500 select-none">
                          <i className="fa-solid fa-list-check text-[9px]" />
                          {completedTodos}/{totalTodos}
                        </span>
                      )}
                    </td>
                    <td>
                      {client ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="neutral">{client.name}</Badge>
                          {task.projectId && (
                            <span className="text-[10px] text-primary-600 dark:text-primary-400 font-semibold pl-1">
                              Proj: {typeof task.projectId === 'object' ? task.projectId.name : (projects.find((p) => sameId(p, task.projectId))?.name || 'Project')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[12px]">In-house</span>
                      )}
                    </td>
                    <td><div className="flex items-center gap-2"><Avatar user={assignee} size="xs" /><span className="text-[13px]">{assignee?.name?.split(' ')[0]}</span></div></td>
                    <td><PriorityBadge priority={task.priority} /></td>
                    <td><StatusBadge status={task.status} /></td>
                    <td className="text-slate-500 text-[12px]">
                      <span className="flex items-center gap-1">
                        <Clock size={10} className="text-slate-400" />
                        {task.startDate || '—'} ➔ {task.dueDate || '—'}
                      </span>
                    </td>
                    <td className="text-slate-500 text-[12px]">{task.createdAt?.split?.('T')?.[0] || task.createdAt || '—'}</td>
                    {/* Progress column data removed */}
                    <td>
                      <div className="flex items-center gap-1">
                        {isManager && task.status === 'sent-for-approval' && <Button variant="success" size="xs" onClick={(e) => { e.stopPropagation(); handleApprove(getId(task)); }}><Check size={11} /></Button>}
                        <button className="btn-icon text-slate-400 hover:text-red-500 p-1" onClick={(e) => { e.stopPropagation(); setConfirmDel(getId(task)); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState icon={Calendar} title="No tasks found" description={filters.date ? `No tasks for ${filters.date}` : 'Adjust filters or create a task.'} />}
        </div>
      )}

      {/* ── Gantt ── */}
      {view === 'gantt' && (
        <GanttView
          items={(ganttOverride ?? filtered).map((task) => ({
            id:        getId(task),
            title:     task.title,
            subtitle:  `#${task.taskNumber || '—'}`,
            startDate: task.startDate || null,
            dueDate:   task.dueDate   || null,
            priority:  task.priority,
            status:    task.status,
            assignee:  users.find((u) => sameId(u, task.assignedTo)),
            raw:       task,
          }))}
          onItemClick={setSelectedTask}
          onPeriodChange={handleGanttPeriodChange}
          isFetching={ganttFetching}
          emptyTitle="No tasks found for this period"
          emptyDescription="Try a different date range or switch to All Data."
        />
      )}

      <TaskCreateDrawer open={showCreate} onClose={() => setShowCreate(false)} users={users} clients={clients} currentUser={authUser} />

      <TaskDetailDrawer
        open={!!selectedTask}
        task={selectedTask ? (tasks.find((t) => sameId(t, selectedTask)) ?? selectedTask) : null}
        onClose={() => setSelectedTask(null)}
        users={users}
        clients={clients}
        authUser={authUser}
        role={role}
        todos={todos}
        onSelectTodo={setSelectedTodo}
      />

      <TodoDetailDrawer
        open={!!selectedTodo}
        todo={selectedTodo ? (todos.find((t) => sameId(t, selectedTodo)) ?? selectedTodo) : null}
        onClose={() => setSelectedTodo(null)}
        users={users}
        clients={clients}
        authUser={authUser}
        role={role}
      />

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => handleDelete(confirmDel)} title="Delete Task" message="This task will be permanently deleted." confirmLabel="Delete" />
    </Page>
  );
}