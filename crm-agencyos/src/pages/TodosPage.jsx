import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Plus, Trash2, Check, MoreHorizontal, Search, Calendar, X, ClipboardList,
  Building2, Columns, List, Table, Clock, Paperclip, Link2, Bold, Italic,
  Underline as UnderlineIcon, List as ListIcon, ListOrdered, RefreshCw, ChevronDown, GanttChart,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import { getBackendUrl, todosAPI } from '../services/api';
import {
  Page, Button, PriorityBadge, Avatar, Modal, Input, Select,
  Textarea, EmptyState, ConfirmDialog, DropdownMenu, Badge, StatusBadge, ViewToggle,
} from '../components/ui';
import { cn, PRIORITY_CONFIG, canManage, truncate, getId, sameId, localDateStr } from '../utils/helpers';
import GanttView from '../components/GanttView';

const MEMBER_STATUSES = [
  { id: 'pending',           label: 'Pending',      color: '#f59e0b', bg: '#fffbeb' },
  { id: 'in-progress',       label: 'In Progress',  color: '#3b82f6', bg: '#eff6ff' },
  { id: 'sent-for-approval', label: 'For Approval', color: '#8b5cf6', bg: '#f5f3ff' },
];
const ALL_STATUSES = [
  ...MEMBER_STATUSES,
  { id: 'completed', label: 'Completed', color: '#10b981', bg: '#ecfdf5' },
];

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

// ── Date filter button ─────────────────────────────────────────
function DateFilter({ value, onChange }) {
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
        <button onClick={() => onChange('')} className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 z-10" title="Clear date">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ── Today's date string ─────────────────────────────────────────
const todayStr = () => localDateStr();

// ── Rich Text Editor ──────────────────────────────────────────
function RichTextEditor({ value, onChange, placeholder = 'Detailed description or notes…' }) {
  const editorRef = useRef(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (editorRef.current && !initRef.current) {
      editorRef.current.innerHTML = value || '';
      initRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      if (value === '' || document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value || '';
      }
    }
  }, [value]);

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
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-rte
        data-ph={placeholder}
        onInput={() => onChange(editorRef.current?.innerHTML || '')}
        className="min-h-[140px] max-h-[240px] overflow-y-auto p-3.5 text-[13.5px] text-slate-700 dark:text-slate-300 outline-none leading-relaxed break-words"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  );
}

// ── Attachment Zone ───────────────────────────────────────────
function AttachmentZone({ attachments, onAdd, onRemove }) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl,  setLinkUrl]  = useState('');
  const [linkName, setLinkName] = useState('');

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
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl py-5 cursor-pointer transition-all text-center',
          dragging ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-900/20'
        )}
      >
        <Paperclip size={16} className="text-slate-400" />
        <p className="text-[12px] text-slate-500">Drop files or <span className="text-indigo-500 font-semibold">browse</span></p>
        <p className="text-[10.5px] text-slate-400">Images · Videos · PDFs · Links</p>
        <input
          ref={fileRef} type="file" multiple className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {!showLink ? (
        <button type="button" onClick={() => setShowLink(true)}
          className="flex items-center gap-1.5 text-[12px] text-indigo-500 hover:text-indigo-750 font-medium select-none">
          <Link2 size={13} /> Add an attachment link
        </button>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <input autoFocus placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLink()}
            className="form-input text-[12.5px] py-1.5 flex-1 min-w-[150px]" />
          <input placeholder="Label" value={linkName} onChange={(e) => setLinkName(e.target.value)}
            className="form-input text-[12.5px] py-1.5 w-[110px]" />
          <button type="button" onClick={addLink}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[12.5px] font-semibold hover:bg-indigo-700">
            Add
          </button>
          <button type="button" onClick={() => setShowLink(false)}
            className="px-2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
          {attachments.map((att, i) => (
            <div key={i} className="group flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 min-w-0">
              {att.preview
                ? <img src={att.preview} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" alt="" />
                : <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                    <i className={cn(att.type === 'link' ? 'fa-solid fa-link' : fileIcon(att.mimeType), 'text-[11.5px]')} />
                  </div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">{att.name}</p>
                {att.size  && <p className="text-[9.5px] text-slate-400">{(att.size/1024).toFixed(1)} KB</p>}
                {att.type === 'link' && <p className="text-[9.5px] text-indigo-400 truncate">{att.url}</p>}
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                className="flex-shrink-0 p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Todo Form Modal ──────────────────────────────────────────────
function TodoFormModal({ open, onClose, currentUser }) {
  const { addTodo, clients, tasks } = useAppStore();
  const users = useAppStore((s) => s.users);
  
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [clientId,    setClientId]    = useState('');
  const [taskId,      setTaskId]      = useState('');
  const [startDate,   setStartDate]   = useState(todayStr());
  const [startTime,   setStartTime]   = useState('');
  const [dueDate,     setDueDate]     = useState(todayStr());
  const [dueTime,     setDueTime]     = useState('');
  const [eta,         setEta]         = useState('');
  const [assignedTo,  setAssignedTo]  = useState(getId(currentUser));
  const [attachments, setAttachments] = useState([]);
  const [saving,      setSaving]      = useState(false);

  const role = currentUser?.role;
  const isManager = canManage(role);
  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');

  // Filter tasks: members see only their assigned tasks
  const myTasks = role === 'member'
    ? tasks.filter((t) => sameId(t.assignedTo, currentUser))
    : tasks;

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setClientId('');
      setTaskId('');
      setStartDate(todayStr());
      setStartTime('');
      setDueDate(todayStr());
      setDueTime('');
      setEta('');
      setAssignedTo(getId(currentUser));
      setAttachments([]);
      setSaving(false);
    }
  }, [open, currentUser]);

  const handleSubmit = async () => {
    if (saving) return;
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!startDate) {
      toast.error('Start date (From) is required');
      return;
    }
    if (!dueDate) {
      toast.error('Due date (To) is required');
      return;
    }
    if (!eta.trim()) {
      toast.error('ETA is required (e.g. 2h, 45m)');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('description', description);
      fd.append('userId', assignedTo);
      if (clientId) fd.append('clientId', clientId);
      if (taskId) fd.append('taskId', taskId);
      fd.append('startDate', startDate);
      fd.append('startTime', startTime);
      fd.append('dueDate', dueDate);
      fd.append('dueTime', dueTime);
      fd.append('priority', priority);
      fd.append('eta', eta);
      fd.append('status', 'pending');

      const links = attachments.filter((a) => a.type === 'link').map((a) => ({ url: a.url, name: a.name }));
      if (links.length) fd.append('links', JSON.stringify(links));
      attachments.filter((a) => a.type === 'file' && a.file).forEach((a) => fd.append('files', a.file));

      await addTodo(fd);
      toast.success('Daily Todo created!');
      onClose();
    } catch (err) {
      // toast shown in store
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Daily Todo" size="lg"
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={handleSubmit} disabled={saving || !title.trim() || !startDate || !dueDate || !eta.trim()}>{saving ? 'Adding...' : 'Add Todo'}</Button></>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); }} className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
        <Input label="Todo Title *" placeholder="What needs to be done today?" value={title} onChange={(e) => setTitle(e.target.value)} required />

        <div>
          <label className="form-label mb-1.5 block">Description</label>
          <RichTextEditor value={description} onChange={setDescription} placeholder="Detail notes, links, or criteria..." />
        </div>

        {/* Assignee row: Locked for standard members, selectable for admins/managers */}
        <div>
          <label className="form-label mb-1.5 block">Assigned To</label>
          {isManager ? (
            <select className="form-input text-[14px]" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              {[currentUser, ...memberUsers].filter((u, idx, self) => u && self.findIndex(t => getId(t) === getId(u)) === idx).map((u) => (
                <option key={getId(u)} value={getId(u)}>{u.name} ({u.role})</option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-650">
              <Avatar user={currentUser} size="xs" />
              <span className="text-[13.5px] font-medium text-slate-700 dark:text-slate-300">{currentUser?.name}</span>
              <span className="ml-auto badge badge-neutral text-[10.5px]">You (Locked)</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label mb-1.5 block">Associated Task (Optional)</label>
            <select className="form-input text-[13.5px]" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No Connected Task</option>
              {myTasks.map((t) => (
                <option key={getId(t)} value={getId(t)}>Task #{t.taskNumber || '—'}: {t.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label mb-1.5 block">Associated Client / Purpose</label>
            <select className="form-input text-[13.5px]" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Personal / Internal Use</option>
              {clients.map((c) => (
                <option key={getId(c)} value={getId(c)}>Client: {c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Timeline ranges */}
        <div>
          <label className="form-label mb-1.5 block text-slate-500 font-bold uppercase tracking-wider text-[11px]">Timeline Dates &amp; Times <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/20 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">Start Date (From) <span className="text-red-500">*</span></label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={cn('form-input text-[13px] py-1.5', !startDate && 'border-red-300 dark:border-red-800/60')} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">Start Time (From)</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="form-input text-[13px] py-1.5" />
              </div>
            </div>
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">Due Date (To) <span className="text-red-500">*</span></label>
                <input type="date" value={dueDate} min={startDate} onChange={(e) => setDueDate(e.target.value)} className={cn('form-input text-[13px] py-1.5', !dueDate && 'border-red-300 dark:border-red-800/60')} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">Due Time (To)</label>
                <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="form-input text-[13px] py-1.5" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label mb-1 block">ETA <span className="text-red-500">*</span> <span className="text-slate-400 font-normal text-[11px]">(e.g. 2h, 45m)</span></label>
            <Input placeholder="e.g. 1h, 30m" value={eta} onChange={(e) => setEta(e.target.value)}
              className={!eta.trim() ? 'border-red-300 dark:border-red-800/60' : ''} />
          </div>
          <div>
            <label className="form-label mb-1.5 block">Priority</label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <label key={key} className="cursor-pointer">
                  <input type="radio" value={key} checked={priority === key} onChange={() => setPriority(key)} className="sr-only" />
                  <div
                    className={cn('flex items-center justify-center gap-1 py-2 rounded-lg border-2 text-[11.5px] font-bold transition-all',
                      priority === key ? 'border-current shadow-sm' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                    )}
                    style={priority === key ? { background: cfg.bg, color: cfg.color, borderColor: cfg.dot } : {}}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
                    {cfg.label.substring(0, 3)}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="form-label mb-1.5 block">Attachments &amp; Links</label>
          <AttachmentZone
            attachments={attachments}
            onAdd={(a) => setAttachments((prev) => [...prev, a])}
            onRemove={(idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
          />
        </div>
      </form>
    </Modal>
  );
}

// ── Todo Card Component ──────────────────────────────────────────
function TodoCard({ todo, users, role, authUser, onMove, onApprove, onDelete, onSelect }) {
  const clients   = useAppStore((s) => s.clients);
  const owner     = users.find((u) => sameId(u, todo.userId));
  const pCfg      = PRIORITY_CONFIG[todo.priority] || PRIORITY_CONFIG.medium;
  const isManager = canManage(role);
  const cols      = isManager ? ALL_STATUSES : MEMBER_STATUSES;
  const targets   = cols
    .filter((c) => c.id !== todo.status)
    .filter((c) => {
      if (isManager) return true;
      if (todo.status === 'pending' && c.id === 'in-progress') return true;
      if (todo.status === 'sent-for-approval' && c.id === 'in-progress') return true;
      return false;
    });

  const showReadyToggle = !isManager && sameId(todo.userId, authUser) && todo.status === 'in-progress';
  const menuItems = [
    ...targets.map((c) => ({ label: `Move → ${c.label}`, onClick: () => onMove(getId(todo), { status: c.id }) })),
    ...(showReadyToggle ? [
      ...(targets.length ? [] : [{ separator: true }]),
      {
        label: 'Mark Ready for Approval',
        onClick: () => {
          onMove(getId(todo), { status: 'sent-for-approval', readyForApproval: false });
          toast.success('Todo submitted for approval!');
        }
      }
    ] : []),
    ...(targets.length || showReadyToggle ? [{ separator: true }] : []),
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(getId(todo)) },
  ];

  const taskRef = todo.taskId && typeof todo.taskId === 'object' ? todo.taskId : null;
  const hasTimeline = todo.startDate || todo.dueDate;

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      className={cn('kanban-card border-l-[3px] cursor-pointer hover:shadow-md transition-shadow')} style={{ borderLeftColor: pCfg.dot }}
      onClick={() => onSelect(todo)}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 leading-snug flex-1 break-words">{todo.title}</p>
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu trigger={<button className="btn-icon p-1 text-slate-400 flex-shrink-0"><MoreHorizontal size={14} /></button>} items={menuItems} />
        </div>
      </div>
      {todo.description && (
        <p className="text-[12px] text-slate-500 leading-relaxed mb-2.5"
          dangerouslySetInnerHTML={{ __html: truncate(todo.description.replace(/<[^>]*>/g, ''), 75) }} />
      )}
      


      <div className="flex gap-1.5 flex-wrap items-center mb-2">
        <PriorityBadge priority={todo.priority} />
        {todo.eta && <span className="badge badge-neutral text-[10.5px]">⏱ {todo.eta}</span>}
        {todo.clientId && (
          <span className="badge badge-primary text-[10.5px] flex items-center gap-1">
            <Building2 size={10} />
            {typeof todo.clientId === 'object' ? todo.clientId.name : (clients.find((c) => sameId(c, todo.clientId))?.name || 'Client')}
          </span>
        )}
        {taskRef && (
          <span className="badge bg-indigo-50 border border-indigo-150 text-indigo-750 dark:bg-indigo-950/20 dark:border-indigo-900/50 text-[10px] font-semibold flex items-center gap-1 select-none py-0.5">
            <i className="fa-solid fa-list-check text-[9.5px] text-indigo-400" />
            #{taskRef.taskNumber}
          </span>
        )}
      </div>

      {hasTimeline && (
        <div className="flex items-center gap-1 text-[10.5px] text-slate-450 mt-1 mb-2 bg-slate-50 dark:bg-slate-800/30 p-1.5 rounded-lg border border-slate-100 dark:border-slate-700/50 select-none">
          <Clock size={11} className="text-slate-400" />
          <span className="truncate">
            {todo.startDate || '—'} ➔ {todo.dueDate || '—'}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-1.5">
          <Avatar user={owner} size="xs" />
          <span className="text-[11.5px] text-slate-500">{owner?.name?.split(' ')[0]}</span>
        </div>
        {todo.createdAt && (
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Calendar size={9} /> {todo.createdAt?.split?.('T')?.[0]}
          </span>
        )}
      </div>

      {isManager && todo.status === 'sent-for-approval' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApprove(getId(todo));
          }}
          className="btn-success btn-sm w-full justify-center mt-2.5 select-none"
        >
          <Check size={12} /> Approve &amp; Mark Done
        </button>
      )}

      {!isManager && sameId(todo.userId, authUser) && todo.status === 'in-progress' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove(getId(todo), { status: 'sent-for-approval', readyForApproval: false });
            toast.success('Todo submitted for approval!');
          }}
          className="w-full py-1.5 rounded-lg text-[11px] font-semibold transition-all justify-center items-center flex gap-1 mt-2.5 border border-dashed select-none bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/30 text-emerald-600 hover:bg-emerald-100"
        >
          ✓ Mark Ready for Approval
        </button>
      )}
    </motion.div>
  );
}

// ── Todo Detail Drawer Component ──────────────────────────────────
export function TodoDetailDrawer({ open, todo, onClose, users, clients, authUser, role }) {
  const { updateTodo, deleteTodo, tasks } = useAppStore();
  const [confirmDel, setConfirmDel] = useState(false);

  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [status,      setStatus]      = useState('pending');
  const [clientId,    setClientId]    = useState('');
  const [taskId,      setTaskId]      = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [startTime,   setStartTime]   = useState('');
  const [dueDate,     setDueDate]     = useState('');
  const [dueTime,     setDueTime]     = useState('');
  const [eta,         setEta]         = useState('');
  const [userId,      setUserId]      = useState('');
  const [existingAtts,setExistingAtts]= useState([]);
  const [newAtts,     setNewAtts]     = useState([]);
  const [saving,      setSaving]      = useState(false);

  const isManager = canManage(role);
  const canEdit = isManager || sameId(todo?.userId, authUser);
  const memberUsers = users.filter((u) => u.role === 'member' || u.role === 'client_relations');

  const myTasks = role === 'member'
    ? tasks.filter((t) => sameId(t.assignedTo, authUser))
    : tasks;

  useEffect(() => {
    if (todo && open) {
      setTitle(todo.title || '');
      setDescription(todo.description || '');
      setPriority(todo.priority || 'medium');
      setStatus(todo.status || 'pending');
      setClientId(todo.clientId ? getId(todo.clientId) : '');
      setTaskId(todo.taskId ? getId(todo.taskId) : '');
      setStartDate(todo.startDate || '');
      setStartTime(todo.startTime || '');
      setDueDate(todo.dueDate || '');
      setDueTime(todo.dueTime || '');
      setEta(todo.eta || '');
      setUserId(todo.userId ? getId(todo.userId) : '');
      setExistingAtts(todo.attachments || []);
      setNewAtts([]);
      setConfirmDel(false);
    }
  }, [todo, open]);

  if (!todo) return null;

  const assigner = todo.assignedBy ? users.find((u) => sameId(u, todo.assignedBy)) : null;

  const autoSave = async (updates) => {
    try {
      const fd = new FormData();
      Object.entries(updates).forEach(([k, v]) => {
        fd.append(k, v);
      });
      await updateTodo(getId(todo), fd);
    } catch {}
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('description', description);
      fd.append('priority', priority);
      fd.append('status', status);
      if (userId) fd.append('userId', userId);
      fd.append('clientId', clientId || '');
      fd.append('taskId', taskId || '');
      fd.append('startDate', startDate);
      fd.append('startTime', startTime);
      fd.append('dueDate', dueDate);
      fd.append('dueTime', dueTime);
      fd.append('eta', eta);
      
      // Preserve readyForApproval — only clear it when moving to completed
      if (status === 'completed') {
        fd.append('readyForApproval', 'false');
      }
      // (readyForApproval is NOT reset when saving; the toggle button manages it separately)

      fd.append('existingAttachments', JSON.stringify(existingAtts));
      
      const links = newAtts.filter((a) => a.type === 'link').map((a) => ({ url: a.url, name: a.name }));
      if (links.length) fd.append('links', JSON.stringify(links));
      newAtts.filter((a) => a.type === 'file' && a.file).forEach((a) => fd.append('files', a.file));

      await updateTodo(getId(todo), fd);
      toast.success('Todo updated!');
      onClose();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      await deleteTodo(getId(todo));
      toast.success('Todo deleted');
      setConfirmDel(false);
      onClose();
    } catch {}
  };

  const labelCls = 'block text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 select-none';

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
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 bg-slate-50/50 dark:bg-slate-900/10">
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {ALL_STATUSES.map((s) => {
                  const isAllowed = isManager || (todo.status === 'pending' && s.id === 'in-progress') || s.id === todo.status;
                  return (
                    <button key={s.id} type="button"
                      disabled={!canEdit || !isAllowed}
                      onClick={() => {
                        setStatus(s.id);
                        // When manager moves to sent-for-approval via pill, clear the flag;
                        // when moving to completed, clear it too. Otherwise preserve existing.
                        if (s.id === 'completed') {
                          autoSave({ status: s.id, readyForApproval: 'false' });
                        } else if (s.id === 'sent-for-approval') {
                          autoSave({ status: s.id, readyForApproval: 'false' });
                        } else {
                          autoSave({ status: s.id });
                        }
                      }}
                      className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all',
                        status === s.id
                          ? 'text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700',
                        (!canEdit || !isAllowed) && 'opacity-55 cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700/50'
                      )}
                      style={status === s.id ? { background: s.color } : {}}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', status === s.id ? 'bg-white/60' : '')}
                        style={status !== s.id ? { background: s.color } : {}} />
                      {s.label}
                    </button>
                  );
                })}
                <span className="ml-auto text-[11px] text-slate-400 flex items-center gap-1.5">
                  <span className="text-primary-650 dark:text-primary-400 font-mono font-bold">DAILY TODO</span>
                  <span className="text-slate-350 dark:text-slate-650">•</span>
                  <span>Created {todo.createdAt ? new Date(todo.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                </span>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {canEdit ? (
                    <textarea value={title} onChange={(e) => setTitle(e.target.value)}
                      rows={1}
                      className="w-full text-[20px] font-bold text-slate-900 dark:text-white bg-transparent border-0 outline-none placeholder:text-slate-355 border-b-2 border-transparent focus:border-indigo-400 transition-colors pb-1 resize-none overflow-hidden break-words whitespace-pre-wrap leading-tight h-auto"
                      style={{ wordBreak: 'break-word' }}
                      placeholder="Todo title…"
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
                  ) : (
                    <h2 className="text-[20px] font-bold text-slate-900 dark:text-white break-words" style={{ wordBreak: 'break-word' }}>{todo.title}</h2>
                  )}
                </div>
                <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 transition-all">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              
              {/* Priority */}
              <div>
                <label className={labelCls}>Priority</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                    <button key={key} type="button" disabled={!canEdit}
                      onClick={() => setPriority(key)}
                      className={cn('py-2 rounded-xl border-2 text-[12.5px] font-semibold transition-all flex items-center justify-center gap-1.5',
                        priority === key
                          ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20 text-slate-500 hover:border-slate-300',
                        !canEdit && 'cursor-default opacity-70'
                      )}
                      style={priority === key ? { background: cfg.bg, color: cfg.color, borderColor: cfg.dot } : {}}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: cfg.dot }} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assignee Selection */}
              <div>
                <label className={labelCls}>Assigned To</label>
                {isManager ? (
                  <div className="flex flex-wrap gap-2">
                    {[authUser, ...memberUsers].filter((u, idx, self) => u && self.findIndex(t => getId(t) === getId(u)) === idx).map((u) => (
                      <button key={getId(u)} type="button"
                        onClick={() => setUserId(getId(u))}
                        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-[12px] font-semibold transition-all',
                          userId === getId(u)
                            ? 'border-indigo-550 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-750 dark:text-indigo-300'
                            : 'border-transparent bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:border-slate-200'
                        )}
                      >
                        <Avatar user={u} size="xs" preview={false} />
                        <span>{u.name.split(' ')[0]}</span>
                        {sameId(u, authUser) && <span className="text-[10px] opacity-50 font-normal">(you)</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 dark:bg-slate-900/10 rounded-lg border border-slate-200 dark:border-slate-700 max-w-sm">
                    <Avatar user={users.find(u => getId(u) === userId) || authUser} size="xs" />
                    <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                      {users.find(u => getId(u) === userId)?.name || 'Assignee'}
                    </span>
                    <span className="ml-auto badge badge-neutral text-[10px]">Locked for Members</span>
                  </div>
                )}
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

              {/* Connected Task & Client */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Connected Task</label>
                  {canEdit ? (
                    <select className="form-input text-[13.5px]" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                      <option value="">No Associated Task</option>
                      {myTasks.map((t) => (
                        <option key={getId(t)} value={getId(t)}>Task #{t.taskNumber || '—'}: {t.title}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 pt-1 break-words" style={{ wordBreak: 'break-word' }}>
                      {myTasks.find(t => getId(t) === taskId) ? `Task #${myTasks.find(t => getId(t) === taskId).taskNumber}: ${myTasks.find(t => getId(t) === taskId).title}` : '—'}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Associated Client</label>
                  {canEdit ? (
                    <select className="form-input text-[13.5px]" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">Personal / Internal Use</option>
                      {clients.map((c) => (
                        <option key={getId(c)} value={getId(c)}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 pt-1 break-words" style={{ wordBreak: 'break-word' }}>
                      {clients.find(c => getId(c) === clientId)?.name || '—'}
                    </p>
                  )}
                </div>
              </div>

              {/* Timeline date-time values */}
              <div>
                <label className={labelCls}>ETA &amp; Timeline</label>
                <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/10 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] text-slate-450 mb-0.5 font-semibold">Start Date</label>
                      <input type="date" className="form-input text-[13px] py-1.5" disabled={!canEdit}
                        value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-450 mb-0.5 font-semibold">Start Time (From)</label>
                      <input type="time" className="form-input text-[13px] py-1.5" disabled={!canEdit}
                        value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] text-slate-450 mb-0.5 font-semibold">Due Date</label>
                      <input type="date" className="form-input text-[13px] py-1.5" disabled={!canEdit}
                        min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-450 mb-0.5 font-semibold">Due Time (To)</label>
                      <input type="time" className="form-input text-[13px] py-1.5" disabled={!canEdit}
                        value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="max-w-[280px]">
                <label className={labelCls}>ETA Duration</label>
                <Input placeholder="e.g. 1h, 30m" disabled={!canEdit} value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>

              {/* Description Rich Text Editor */}
              <div>
                <label className={labelCls}>Description</label>
                {canEdit ? (
                  <RichTextEditor value={description} onChange={setDescription} />
                ) : (
                  <div className="min-h-[80px] p-3.5 text-[13.5px] text-slate-700 dark:text-slate-300 leading-relaxed border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/20"
                    dangerouslySetInnerHTML={{ __html: description || '<span class="text-slate-450 italic">No description details.</span>' }} />
                )}
              </div>

              {/* Attachments */}
              <div>
                <label className={labelCls}>Attachments {existingAtts.length > 0 && `(${existingAtts.length})`}</label>
                
                {existingAtts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {existingAtts.map((att, i) => (
                      <div key={i} className="group flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 hover:border-indigo-400/60 transition-colors min-w-0">
                        <a href={getAttachmentUrl(att.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 flex-1 hover:text-indigo-650 dark:hover:text-indigo-400 transition-colors">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 flex-shrink-0">
                            <i className={cn(att.type === 'link' ? 'fa-solid fa-link' : fileIcon(att.mimeType), 'text-[13px]')} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11.5px] font-medium text-slate-700 dark:text-slate-300 group-hover:text-indigo-650 truncate">{att.name}</p>
                            {att.size > 0 && <p className="text-[10px] text-slate-400">{(att.size/1024).toFixed(1)} KB</p>}
                            {att.type === 'link' && <p className="text-[9.5px] text-indigo-450 dark:text-indigo-400 truncate">{att.url}</p>}
                          </div>
                        </a>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <a href={getAttachmentUrl(att.url)} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-[13px] font-bold transition-all"
                            title={att.type === 'link' ? 'Open link' : 'Download file'}>
                            {att.type === 'link' ? '↗' : '↓'}
                          </a>
                          {canEdit && (
                            <button type="button" onClick={() => setExistingAtts((p) => p.filter((_, idx) => idx !== i))}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-550 dark:hover:bg-red-900/20 transition-all">
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && (
                  <AttachmentZone
                    attachments={newAtts}
                    onAdd={(a) => setNewAtts((p) => [...p, a])}
                    onRemove={(i) => setNewAtts((p) => p.filter((_, idx) => idx !== i))}
                  />
                )}
              </div>

              {/* Member: submit for approval / withdraw */}
              {!isManager && sameId(todo.userId, authUser) && (status === 'in-progress' || status === 'sent-for-approval') && (
                <button type="button"
                  onClick={() => {
                    if (status === 'in-progress') {
                      setStatus('sent-for-approval');
                      autoSave({ status: 'sent-for-approval', readyForApproval: 'false' });
                      toast.success('Todo submitted for approval!');
                    } else {
                      setStatus('in-progress');
                      autoSave({ status: 'in-progress', readyForApproval: 'false' });
                      toast.success('Todo withdrawn from approval');
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

              {/* Manager Approval */}
              {isManager && status === 'sent-for-approval' && (
                <button type="button"
                  onClick={() => {
                    setStatus('completed');
                    autoSave({ status: 'completed', readyForApproval: 'false' });
                    toast.success('Todo approved & completed!');
                    onClose();
                  }}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13.5px] font-semibold flex items-center justify-center gap-2 transition-all select-none"
                >
                  <Check size={14} /> Approve &amp; Mark Completed
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 bg-slate-50 dark:bg-slate-900/20">
              {isManager || sameId(todo.userId, authUser) ? (
                <button type="button" onClick={() => setConfirmDel(true)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-red-400 hover:text-red-500 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all select-none">
                  <Trash2 size={14} /> Delete
                </button>
              ) : (
                <div />
              )}
              {canEdit && (
                <button type="button" onClick={handleSave} disabled={saving || !title.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-xl transition-all disabled:opacity-50 shadow-sm select-none">
                  {saving ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><Check size={14} /> Save Changes</>}
                </button>
              )}
            </div>
          </motion.div>

          <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={handleDelete}
            title="Delete Todo" message="Remove this daily todo permanently?" confirmLabel="Delete" />
        </>
      )}
    </AnimatePresence>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function TodosPage() {
  const { authUser, todos, addTodo, updateTodo, deleteTodo, systemSettings, clients, tasks } = useAppStore(useShallow((s) => ({
    authUser:       s.authUser,
    todos:          s.todos,
    addTodo:        s.addTodo,
    updateTodo:     s.updateTodo,
    deleteTodo:     s.deleteTodo,
    systemSettings: s.systemSettings,
    clients:        s.clients,
    tasks:          s.tasks,
  })));
  const users = useAppStore((s) => s.users);

  const [view,          setView]         = useState('kanban');
  const [showCreate,    setShowCreate]   = useState(false);
  const [confirmDel,    setConfirmDel]   = useState(null);
  const [selectedTodo,  setSelectedTodo] = useState(null);
  const [filters,       setFilters]      = useState({
    search:   '',
    priority: '',
    status:   '',
    position: '',
    memberId: '',
    date:     '',
  });

  // Gantt: optional date-range fetch (null = use store data)
  const [ganttOverride,  setGanttOverride]  = useState(null);
  const [ganttFetching,  setGanttFetching]  = useState(false);

  const handleGanttPeriodChange = async (start, end) => {
    if (!start && !end) { setGanttOverride(null); return; }
    setGanttFetching(true);
    try {
      const { data } = await todosAPI.getByDateRange(start, end);
      setGanttOverride(data.data);
    } catch { setGanttOverride([]); }
    finally { setGanttFetching(false); }
  };

  const role      = authUser?.role;
  const isManager = canManage(role);

  // Base: members see only their own
  const baseTodos = role === 'member'
    ? todos.filter((t) => sameId(t.userId, authUser))
    : todos;

  // Apply filters
  const filtered = baseTodos.filter((t) => {
    if (filters.search) {
      const matchTitle = t.title.toLowerCase().includes(filters.search.toLowerCase());
      const matchDesc = t.description?.toLowerCase().includes(filters.search.toLowerCase());
      if (!matchTitle && !matchDesc) return false;
    }
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.status   && t.status   !== filters.status)   return false;
    if (isManager) {
      if (filters.memberId) {
        if (getId(t.userId) !== filters.memberId) return false;
      } else if (filters.position) {
        const member = users.find((u) => getId(u) === getId(t.userId));
        if (!member || member.position !== filters.position) return false;
      }
    }
    // Date filter: matches start or due timeline or creation date
    if (filters.date) {
      const todoDate = t.createdAt?.split?.('T')?.[0] || t.createdAt;
      const matchStart = t.startDate === filters.date;
      const matchDue = t.dueDate === filters.date;
      if (todoDate !== filters.date && !matchStart && !matchDue) return false;
    }
    return true;
  });

  const handleApprove = (id) => { updateTodo(id, { status: 'completed', readyForApproval: false }); toast.success('Todo approved & completed!'); };
  const handleDelete  = (id) => { deleteTodo(id); toast.success('Todo deleted.'); setConfirmDel(null); };

  const memberUsers          = users.filter((u) => u.role === 'member' || u.role === 'client_relations');
  const positions            = systemSettings?.positions?.length ? systemSettings.positions : [];
  const membersInPosition    = filters.position ? memberUsers.filter((u) => u.position === filters.position) : [];
  const statusFilterOptions  = isManager ? ALL_STATUSES : MEMBER_STATUSES;
  const cols                 = ALL_STATUSES;
  const activeFiltersCount   = [filters.search, filters.priority, filters.status, filters.position, filters.memberId, filters.date].filter(Boolean).length;

  const allDates = [...new Set(baseTodos.map((t) => t.createdAt?.split?.('T')?.[0]||t.createdAt).filter(Boolean))].sort().reverse();
  const fmtDate = (ds) => ds ? new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

  const isViewingToday = !filters.date || filters.date === todayStr();
  const isViewingPast  = filters.date && filters.date < todayStr();

  return (
    <Page>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 select-none">
        <div>
          <h1 className="page-title">Daily Todos</h1>
          <p className="page-sub">
            {filtered.filter((t) => t.status === 'completed').length} of {filtered.length} completed
            {filters.date
              ? <span className="ml-2 text-primary-500 font-medium inline-flex items-center gap-1">
                  · {isViewingPast ? <><Calendar size={13} className="text-primary-500" /> History:</> : <ClipboardList size={13} className="text-primary-500" />}
                  {new Date(filters.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              : <span className="ml-2 text-slate-400">· All history</span>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={cn('btn-outline btn-sm', isViewingToday && !filters.date ? 'bg-primary-50 border-primary-300 text-primary-600 dark:bg-primary-900/20' : '')}
            onClick={() => setFilters((f) => ({ ...f, date: todayStr() }))}
          >
            Today
          </button>
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
            <Plus size={14} /> Add Todo
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 mb-5 flex-wrap items-center select-none">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input className="form-input pl-9 py-1.5 text-[13px]" placeholder="Search todos…"
            value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        </div>

        <select className="form-input w-[155px] text-[13px] py-1.5" value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All Statuses</option>
          {statusFilterOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

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

        <select className="form-input w-[150px] text-[13px] py-1.5" value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <DateFilter value={filters.date} onChange={(v) => setFilters((f) => ({ ...f, date: v }))} />

        {activeFiltersCount > 0 && (
          <button
            className="flex items-center gap-1 text-[12.5px] text-primary-500 hover:text-primary-600 font-medium animate-fade-in"
            onClick={() => setFilters({ search: '', priority: '', status: '', memberId: '', date: '', position: '' })}
          >
            <X size={12} /> Clear {activeFiltersCount > 1 ? `(${activeFiltersCount})` : ''}
          </button>
        )}
      </div>

      {/* Date banner */}
      {filters.date && (
        <div className={cn(
          'flex items-center gap-2 mb-4 px-3 py-2.5 rounded-xl border text-[13px]',
          isViewingPast
            ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
            : 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300'
        )}>
          <Calendar size={14} />
          {isViewingPast
            ? <span>Viewing history for <strong>{fmtDate(filters.date)}</strong></span>
            : <span>Viewing todos for <strong>{fmtDate(filters.date)}</strong></span>
          }
          <span className="text-slate-400 mx-1">·</span>
          <span className="text-slate-500">{filtered.length} todo{filtered.length !== 1 ? 's' : ''}</span>
          {isViewingPast && (
            <>
              <span className="text-slate-300 mx-1">·</span>
              <span className="text-[12px] opacity-70">Completed: {filtered.filter((t) => t.status === 'completed').length}</span>
            </>
          )}
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setFilters((f) => ({ ...f, date: '' }))}><X size={14} /></button>
        </div>
      )}

      {/* Chips */}
      {!filters.date && allDates.length > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap select-none">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Jump To Date:</span>
          {allDates.slice(0, 7).map((d) => (
            <button
              key={d}
              onClick={() => setFilters((f) => ({ ...f, date: d }))}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all',
                d === todayStr()
                  ? 'bg-primary-500 text-white border-primary-500'
                  : 'bg-white dark:bg-slate-800 text-slate-650 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:text-primary-600'
              )}
            >
              {d === todayStr() ? 'Today' : new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              <span className="ml-1 text-[10px] opacity-60">
                ({baseTodos.filter((t) => t.createdAt?.split?.('T')?.[0] === d).length})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Multi-View renders */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={filters.date ? `No todos for ${fmtDate(filters.date)}` : 'No todos yet'}
          description={filters.date
            ? isViewingPast ? 'No todos were recorded on this date.' : 'Add your first todo for today!'
            : 'Add your first todo using the button above.'
          }
          action={isViewingToday && (
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} /> Add Todo
            </Button>
          )}
        />
      ) : (
        <>
          {/* Kanban View */}
          {view === 'kanban' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {cols.map((col) => {
                const colItems = filtered.filter((t) => t.status === col.id);
                return (
                  <div key={col.id}>
                    <div className="flex items-center justify-between px-3 py-2.5 card mb-2.5 border border-slate-100 dark:border-slate-800 select-none">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: col.color }} />
                        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{col.label}</span>
                      </div>
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: col.bg, color: col.color }}>{colItems.length}</span>
                    </div>
                    <div className="space-y-2.5">
                      <AnimatePresence>
                        {colItems.map((todo) => (
                          <TodoCard key={getId(todo)} todo={todo} users={users} role={role} authUser={authUser}
                            onMove={(id, updates) => updateTodo(id, updates)}
                            onApprove={handleApprove}
                            onDelete={(id) => setConfirmDel(id)}
                            onSelect={setSelectedTodo}
                          />
                        ))}
                      </AnimatePresence>
                      {colItems.length === 0 && (
                        <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl py-7 text-center text-[11.5px] text-slate-400">Empty</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List View */}
          {view === 'list' && (
            <div className="space-y-2">
              <AnimatePresence>
                {filtered.map((todo) => {
                  const owner = users.find((u) => sameId(u, todo.userId));
                  const client = todo.clientId ? clients.find((c) => sameId(c, todo.clientId)) : null;
                  const pCfg = PRIORITY_CONFIG[todo.priority] || PRIORITY_CONFIG.medium;
                  const statuses = isManager ? ALL_STATUSES : MEMBER_STATUSES;
                  
                  const targets = statuses
                    .filter((c) => c.id !== todo.status)
                    .filter((c) => {
                      if (isManager) return true;
                      if (todo.status === 'pending' && c.id === 'in-progress') return true;
                      if (todo.status === 'sent-for-approval' && c.id === 'in-progress') return true;
                      return false;
                    });

                  const showReadyToggle = !isManager && sameId(todo.userId, authUser) && todo.status === 'in-progress';
                  const menuItems = [
                    ...targets.map((c) => ({ label: `Move → ${c.label}`, onClick: () => updateTodo(getId(todo), { status: c.id }) })),
                    ...(showReadyToggle ? [
                      ...(targets.length ? [] : [{ separator: true }]),
                      {
                        label: 'Mark Ready for Approval',
                        onClick: () => {
                          updateTodo(getId(todo), { status: 'sent-for-approval', readyForApproval: false });
                          toast.success('Todo submitted for approval!');
                        }
                      }
                    ] : []),
                    ...(targets.length || showReadyToggle ? [{ separator: true }] : []),
                    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDel(getId(todo)) },
                  ];

                  const taskRef = todo.taskId && typeof todo.taskId === 'object' ? todo.taskId : null;

                  return (
                    <motion.div key={getId(todo)} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                      className={cn('card p-4 flex items-center gap-4 border-l-[3px] cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors')} style={{ borderLeftColor: pCfg.dot }}
                      onClick={() => setSelectedTodo(todo)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {todo.title}
                          </p>

                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {todo.description && (
                            <span className="text-[12px] text-slate-500 truncate max-w-sm"
                              dangerouslySetInnerHTML={{ __html: truncate(todo.description.replace(/<[^>]*>/g, ''), 50) }} />
                          )}
                          {todo.description && <span className="text-slate-350 dark:text-slate-650">•</span>}
                          
                          {taskRef && (
                            <span className="text-[11.5px] text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/50 dark:border-indigo-900/50 px-2 py-0.5 rounded-lg font-semibold flex items-center gap-1 flex-shrink-0">
                              <i className="fa-solid fa-list-check text-[10px]" />
                              Task #{taskRef.taskNumber}
                            </span>
                          )}
                          {taskRef && <span className="text-slate-350 dark:text-slate-650">•</span>}
                          
                          {client && (
                            <span className="text-[11.5px] text-slate-550 flex items-center gap-1">
                              <Building2 size={10} className="text-slate-400" />
                              {client.name}
                            </span>
                          )}
                          {client && <span className="text-slate-355 dark:text-slate-650">•</span>}
                          {todo.eta && (
                            <span className="text-[11px] text-slate-500 font-semibold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              ⏱ {todo.eta}
                            </span>
                          )}
                          {todo.eta && <span className="text-slate-355 dark:text-slate-650">•</span>}
                          
                          {(todo.startDate || todo.dueDate) && (
                            <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                              <Clock size={11} className="text-slate-400" />
                              {todo.startDate || '—'} ➔ {todo.dueDate || '—'}
                            </span>
                          )}
                          {(todo.startDate || todo.dueDate) && <span className="text-slate-355 dark:text-slate-650">•</span>}
                          
                          <span className="text-[11.5px] text-slate-400 flex items-center gap-1">
                            <Calendar size={10} /> {todo.createdAt?.split?.('T')?.[0]}
                          </span>
                        </div>
                      </div>
                      <PriorityBadge priority={todo.priority} />
                      <StatusBadge status={todo.status} />
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Avatar user={owner} size="xs" />
                        <span className="text-[12px] text-slate-600 dark:text-slate-400 hidden lg:block">{owner?.name?.split(' ')[0]}</span>
                      </div>
                      {isManager && todo.status === 'sent-for-approval' && (
                        <Button variant="success" size="xs" onClick={(e) => { e.stopPropagation(); handleApprove(getId(todo)); }}><Check size={11} /> Approve</Button>
                      )}
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu trigger={<button className="btn-icon p-1 text-slate-400 flex-shrink-0"><MoreHorizontal size={14} /></button>} items={menuItems} />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {/* Table View */}
          {view === 'table' && (
            <div className="table-container">
              <table className="crm-table">
                <thead>
                  <tr>{['Todo Task', 'Client', 'Assigned To', 'Priority', 'Status', 'ETA / Timeline', 'Created', 'Actions'].map((h) => <th key={h} className="select-none">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((todo) => {
                    const owner    = users.find((u) => sameId(u, todo.userId));
                    const client   = todo.clientId ? clients.find((c) => sameId(c, todo.clientId)) : null;
                    const statuses = isManager ? ALL_STATUSES : MEMBER_STATUSES;
                    
                    const targets  = statuses
                      .filter((c) => c.id !== todo.status)
                      .filter((c) => {
                        if (isManager) return true;
                        if (todo.status === 'pending' && c.id === 'in-progress') return true;
                        if (todo.status === 'sent-for-approval' && c.id === 'in-progress') return true;
                        return false;
                      });

                    const showReadyToggle = !isManager && sameId(todo.userId, authUser) && todo.status === 'in-progress';
                    const menuItems = [
                      ...targets.map((c) => ({ label: `Move → ${c.label}`, onClick: () => updateTodo(getId(todo), { status: c.id }) })),
                      ...(showReadyToggle ? [
                        ...(targets.length ? [] : [{ separator: true }]),
                        {
                          label: 'Mark Ready for Approval',
                          onClick: () => {
                            updateTodo(getId(todo), { status: 'sent-for-approval', readyForApproval: false });
                            toast.success('Todo submitted for approval!');
                          }
                        }
                      ] : []),
                      ...(targets.length || showReadyToggle ? [{ separator: true }] : []),
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDel(getId(todo)) },
                    ];

                    const taskRef = todo.taskId && typeof todo.taskId === 'object' ? todo.taskId : null;

                    return (
                      <tr key={getId(todo)} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer" onClick={() => setSelectedTodo(todo)}>
                        <td className="max-w-[280px]">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={todo.title}>{todo.title}</div>

                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {taskRef && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/50 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 select-none flex-shrink-0">
                                <i className="fa-solid fa-list-check text-[9px]" />
                                #{taskRef.taskNumber}
                              </span>
                            )}
                            {todo.description && (
                              <div className="text-[11px] text-slate-400 truncate max-w-[180px] mt-0.5"
                                dangerouslySetInnerHTML={{ __html: truncate(todo.description.replace(/<[^>]*>/g, ''), 35) }} />
                            )}
                          </div>
                        </td>
                        <td>
                          {client ? (
                            <Badge variant="neutral">{client.name}</Badge>
                          ) : (
                            <span className="text-slate-400 text-[12px]">Internal</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Avatar user={owner} size="xs" />
                            <span className="text-[13px]">{owner?.name?.split(' ')[0]}</span>
                          </div>
                        </td>
                        <td><PriorityBadge priority={todo.priority} /></td>
                        <td><StatusBadge status={todo.status} /></td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            {todo.eta && <span className="badge badge-neutral text-[11px] w-fit">⏱ {todo.eta}</span>}
                            {(todo.startDate || todo.dueDate) && (
                              <span className="text-[10px] text-slate-400 font-semibold select-none">
                                {todo.startDate || '—'} ➔ {todo.dueDate || '—'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-slate-500 text-[12px]">{todo.createdAt?.split?.('T')?.[0] || '—'}</td>
                        <td>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {isManager && todo.status === 'sent-for-approval' && (
                              <Button variant="success" size="xs" onClick={() => handleApprove(getId(todo))}><Check size={11} /></Button>
                            )}
                            <DropdownMenu trigger={<button className="btn-icon p-1 text-slate-400"><MoreHorizontal size={14} /></button>} items={menuItems} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Gantt ── */}
      {view === 'gantt' && (
        <GanttView
          items={(ganttOverride ?? filtered).map((todo) => ({
            id:        getId(todo),
            title:     todo.title,
            startDate: todo.startDate || null,
            dueDate:   todo.dueDate   || null,
            priority:  todo.priority,
            status:    todo.status,
            assignee:  users.find((u) => sameId(u, todo.userId)),
            raw:       todo,
          }))}
          onItemClick={setSelectedTodo}
          onPeriodChange={handleGanttPeriodChange}
          isFetching={ganttFetching}
          emptyTitle="No todos found for this period"
          emptyDescription="Try a different date range or switch to All Data."
        />
      )}

      <TodoFormModal open={showCreate} onClose={() => setShowCreate(false)} currentUser={authUser} />

      <TodoDetailDrawer
        open={!!selectedTodo}
        todo={selectedTodo ? (todos.find((t) => sameId(t, selectedTodo)) ?? selectedTodo) : null}
        onClose={() => setSelectedTodo(null)}
        users={users}
        clients={clients}
        authUser={authUser}
        role={role}
      />

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => handleDelete(confirmDel)} title="Delete Todo" message="Remove this todo permanently?" confirmLabel="Delete" />
    </Page>
  );
}