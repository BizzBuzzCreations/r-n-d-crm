import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useAppStore, { getId } from '../store/useAppStore';
import { leadsAPI } from '../services/api';
import { useShallow } from 'zustand/shallow';
import { Page, Button, Avatar } from '../components/ui';
import toast from 'react-hot-toast';
import LeadsKanbanView from './LeadsKanbanView';
import LeadsTableView from './LeadsTableView';
import PipelineForecastView from './PipelineForecastView';
import EmailLeadsView from './EmailLeadsView';
import ExternalFormLeadsView from './ExternalFormLeadsView';
import ConfettiCanvas from '../components/ConfettiCanvas';
import {
  Target, TrendingUp, User, Phone, Mail, Plus, Search, Trash2, Edit2,
  Calendar, Users, Layers, MessageSquare, Check, X, ChevronRight, AlertCircle,
  Filter, Sparkles, Clock, ArrowRight, ExternalLink, Sliders, Settings, ShieldAlert,
  HelpCircle, Trash, RefreshCw, BarChart2, Briefcase, FileText, ArrowUpRight,
  ChevronUp, ChevronDown, Eye, EyeOff, Download, Upload, Archive, FolderOpen, Lock, Save, Globe2
} from 'lucide-react';

// Values here can come from anonymous public forms and scraped listings, so a
// cell starting with = + - @ (or a control char) would be executed as a
// formula when the export is opened in Excel/Sheets. Prefixing with an
// apostrophe forces it to be read as text.
const csvCell = (c) => {
  const s = String(c ?? '').replace(/"/g, '""');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

// ── Standard Funnel Stage Constants ───────────────────────────
const STAGES = ['New Lead', 'First Contact', 'Proposal Sent', 'Won', 'Lost'];

const STAGE_PROBABILITIES = {
  'New Lead': 20,
  'First Contact': 40,
  'Proposal Sent': 70,
  'Won': 100,
  'Lost': 0
};

const STAGE_COLORS = {
  'New Lead': '#3b82f6',
  'First Contact': '#f59e0b',
  'Proposal Sent': '#8b5cf6',
  'Won': '#10b981',
  'Lost': '#ef4444'
};

const EMAIL_TYPE_LABELS = {
  OUTBOUND_EMAIL:  'Outbound',
  LEAD_ASSIGNED:   'Assignment',
  LEAD_WON:        'Deal Won',
  LEAD_MENTIONED:  'Mention',
  WELCOME_EMAIL:   'Welcome',
  TASK_ASSIGNMENT: 'Task',
};

// ── Simulated Communication Tabs drawer widgets ──────────────────
function SimulatedCommsTabs({ lead, onUpdate }) {
  const [activeTab, setActiveTab] = useState('notes');
  const authUser = useAppStore((s) => s.authUser);

  // Email history state
  const [emailLogs, setEmailLogs]         = useState([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);

  const fetchEmailLogs = useCallback(async () => {
    if (!lead?._id) return;
    setEmailLogsLoading(true);
    try {
      const { data } = await leadsAPI.getEmailLogs(lead._id);
      setEmailLogs(data?.data || []);
    } catch {
      // silently fail — history panel is non-critical
    } finally {
      setEmailLogsLoading(false);
    }
  }, [lead?._id]);

  useEffect(() => {
    if (activeTab === 'email') fetchEmailLogs();
  }, [activeTab, fetchEmailLogs]);

  // WhatsApp simulation state
  const [waText, setWaText] = useState('');
  const [waMessages, setWaMessages] = useState([
    { incoming: true, text: `Hello! Interested in BizzBuzz CRM setups. Are you available?`, time: '10:15 AM' },
    { incoming: false, text: `Hi there! Absolutely, our team is processing your budget outline. Let's arrange a proposal call.`, time: '10:20 AM' },
    { incoming: true, text: `Perfect! Looking forward to reviewing the proposal contract soon.`, time: '11:00 AM' }
  ]);

  const handleSendWhatsApp = () => {
    if (!waText.trim()) return;
    const newMsg = { incoming: false, text: waText, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) };
    setWaMessages([...waMessages, newMsg]);
    setWaText('');
    toast.success('Simulated WhatsApp message sent');
  };

  // Email state
  const [emailSubject, setEmailSubject] = useState(`Corporate Proposal - ${lead.companyName}`);
  const [emailBody, setEmailBody] = useState(`Hi ${lead.contactPerson},\n\nIt was great speaking with you today. Following our discussion, we have drafted the workspace specifications outlined for ${lead.companyName}.\n\nPlease let us know if this aligns with your delivery schedule.\n\nBest regards,\n${authUser?.name || 'BBC Partner'}`);
  const [emailSending, setEmailSending] = useState(false);

  const handleSendEmail = async () => {
    if (!lead.email) {
      toast.error('This lead has no email address — add one first');
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error('Subject and body cannot be empty');
      return;
    }
    setEmailSending(true);
    try {
      await leadsAPI.sendEmail(lead._id, emailSubject.trim(), emailBody.trim());
      toast.success(`Email queued for ${lead.email} — delivering shortly`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  };

  // Call simulation state
  const [callDuration, setCallDuration] = useState('5');
  const [callNotes, setCallNotes] = useState('');

  const handleLogCall = async () => {
    if (!callNotes.trim()) return;
    await onUpdate(lead._id, {
      noteText: `[📞 Call Logged] Duration: ${callDuration} mins. Outcome/Summary: ${callNotes}`
    });
    setCallNotes('');
    toast.success('Call log logged in timeline activities');
  };

  // Notes state
  const [noteInput, setNoteInput] = useState('');

  const handleAddNote = async () => {
    if (!noteInput.trim()) return;
    await onUpdate(lead._id, { noteText: noteInput });
    setNoteInput('');
    toast.success('Internal note logged & parsed for @mentions');
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/10">
      <div className="flex bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-[12.5px] font-bold">
        {['notes', 'whatsapp', 'email', 'calls'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-center border-b-2 transition-all capitalize ${activeTab === tab
                ? 'border-indigo-500 text-indigo-650 dark:text-indigo-400 bg-white dark:bg-slate-900/60'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
              }`}
          >
            {tab === 'calls' ? '📞 Calls' : tab === 'whatsapp' ? '💬 WhatsApp' : tab === 'email' ? '📧 Email' : '📝 Notes'}
          </button>
        ))}
      </div>

      <div className="p-4 bg-white dark:bg-slate-900/40 min-h-[220px]">
        {activeTab === 'notes' && (
          <div className="space-y-3">
            <textarea
              className="form-input text-[13px] h-20 placeholder-slate-400"
              placeholder="Write internal notes... Type @Name to mention team members."
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
            />
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-400 italic">Supports tagging team reps (e.g. @Rahul Dev)</span>
              <Button size="sm" variant="primary" onClick={handleAddNote} disabled={!noteInput.trim()}>
                Log note & update
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'whatsapp' && (
          <div className="space-y-4">
            <div className="h-44 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 font-sans text-[12.5px]">
              {waMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.incoming ? 'justify-start' : 'justify-end'}`}>
                  <div className={`p-2.5 rounded-2xl max-w-[80%] leading-relaxed ${msg.incoming
                      ? 'bg-slate-200 dark:bg-slate-750 text-slate-850 dark:text-slate-100 rounded-tl-none'
                      : 'bg-emerald-500 text-white rounded-tr-none'
                    }`}>
                    <p>{msg.text}</p>
                    <span className={`text-[9px] block text-right mt-1.5 ${msg.incoming ? 'text-slate-450 dark:text-slate-400' : 'text-emerald-100'
                      }`}>{msg.time}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                className="form-input text-[13px]"
                placeholder="Type WhatsApp message..."
                value={waText}
                onChange={(e) => setWaText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendWhatsApp()}
              />
              <Button variant="primary" size="sm" onClick={handleSendWhatsApp} disabled={!waText.trim()}>
                Send
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'email' && (
          <div className="space-y-3.5">
            {/* ── Compose ── */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">To</label>
              <input className="form-input text-[13px] py-1 bg-slate-50/50 dark:bg-slate-800/20 cursor-not-allowed" value={lead.email || 'client@company.com'} disabled />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Subject</label>
              <input className="form-input text-[13px] py-1.5" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Body</label>
              <textarea className="form-input text-[13px] h-24 font-mono leading-relaxed" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 italic">
                {lead.email ? `To: ${lead.email}` : '⚠ No email on this lead'}
              </span>
              <Button variant="primary" size="sm" onClick={handleSendEmail} disabled={emailSending || !lead.email}>
                {emailSending ? 'Sending…' : 'Send Email'}
              </Button>
            </div>

            {/* ── Sent History ── */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Sent History {emailLogs.length > 0 && `(${emailLogs.length})`}
                </span>
                <button
                  onClick={fetchEmailLogs}
                  disabled={emailLogsLoading}
                  className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 font-semibold disabled:opacity-50"
                >
                  <RefreshCw size={11} className={emailLogsLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>

              {emailLogsLoading ? (
                <p className="text-[12px] text-slate-400 italic py-2">Loading history…</p>
              ) : emailLogs.length === 0 ? (
                <p className="text-[12px] text-slate-400 italic py-2">No emails sent for this lead yet.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-0.5">
                  {emailLogs.map((log) => (
                    <div
                      key={log._id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-[12px]"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 leading-snug line-clamp-1 flex-1">
                          {log.subject}
                        </span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                          {new Date(log.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-500 truncate">To: {log.recipientEmail}</span>
                        {log.cc && <span className="text-[11px] text-slate-400">CC: {log.cc}</span>}
                        <span className="ml-auto flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                          {EMAIL_TYPE_LABELS[log.emailType] || log.emailType}
                        </span>
                      </div>
                      {log.bodyText && (
                        <p className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed border-t border-slate-200 dark:border-slate-700 pt-1.5">
                          {log.bodyText.substring(0, 160)}…
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Call duration</label>
                <select className="form-input text-[13px] py-1.5" value={callDuration} onChange={(e) => setCallDuration(e.target.value)}>
                  <option value="2">2 mins (quick follow-up)</option>
                  <option value="5">5 mins (pitch outline)</option>
                  <option value="15">15 mins (pricing negotiation)</option>
                  <option value="30">30 mins (detailed proposal)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Stakeholder</label>
                <input className="form-input text-[13px] py-1.5 bg-slate-50/50 dark:bg-slate-800/20" value={lead.contactPerson} disabled />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Call outcome & notes</label>
              <textarea className="form-input text-[13px] h-16 placeholder-slate-400" placeholder="Spoke with client, requested budget proposal..." value={callNotes} onChange={(e) => setCallNotes(e.target.value)} />
            </div>
            <div className="text-right">
              <Button variant="primary" size="sm" onClick={handleLogCall} disabled={!callNotes.trim()}>
                Log Call to timeline
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Slide-Out detailed panel drawer ───────────────────────────
function LeadDetailDrawer({ lead, onClose, onUpdate, onDelete, onMerge, users, allLeads }) {
  const [showAddContact, setShowAddContact] = useState(false);
  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState('Marketing Head');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');

  const handleAddContact = async () => {
    if (!cName.trim()) return;
    const existing = lead.contacts || [];
    const newContact = { name: cName.trim(), role: cRole, email: cEmail.trim(), phone: cPhone.trim() };

    await onUpdate(lead._id, { contacts: [...existing, newContact] });

    setCName('');
    setCRole('Marketing Head');
    setCEmail('');
    setCPhone('');
    setShowAddContact(false);
    toast.success('B2B stakeholder contact added!');
  };

  const duplicateSuggestions = useMemo(() => {
    return allLeads.filter(l =>
      l._id !== lead._id &&
      l.companyName.toLowerCase().replace(/[^a-z0-9]/g, '').includes(lead.companyName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 5))
    );
  }, [allLeads, lead._id, lead.companyName]);

  const handleMerge = async (sourceId) => {
    if (window.confirm('Are you sure you want to merge these duplicate B2B leads? This merges contacts, values, notes and cannot be undone.')) {
      await onMerge({ targetLeadId: lead._id, sourceLeadId: sourceId });
      onClose();
    }
  };

  const isWatcher = lead.watchers?.includes(useAppStore.getState().authUser?._id);

  const handleToggleWatcher = async () => {
    const myId = useAppStore.getState().authUser?._id;
    let list = [...(lead.watchers || [])];
    if (isWatcher) {
      list = list.filter(id => String(id) !== String(myId));
      toast.success('Stopped watching lead');
    } else {
      list.push(myId);
      toast.success('Started watching lead for timelines updates');
    }
    await onUpdate(lead._id, { watchers: list });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[600px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-slideIn">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="badge badge-purple uppercase tracking-wider text-[9.5px] px-2 py-0.5 font-bold">
              {lead.status}
            </span>
            <span className="font-mono text-[10.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-550 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60 px-1.5 py-0.5 rounded leading-none">
              {lead.leadId || (lead._id ? `LD-${lead._id.slice(-4).toUpperCase()}` : 'LD-TBD')}
            </span>
          </div>
          <h2 className="text-[17px] font-bold text-slate-900 dark:text-white leading-tight">
            {lead.companyName}
          </h2>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-650">
          <X size={18} />
        </button>
      </div>

      {/* Body scroll */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Watcher and Actions */}
        <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl text-[12.5px]">
          <div>
            <p className="font-bold text-slate-850 dark:text-slate-200">Timeline Watcher</p>
            <p className="text-[11.5px] text-slate-400">Receive alerts on any timeline logs or reassignment events.</p>
          </div>
          <Button size="sm" variant={isWatcher ? 'primary' : 'outline'} onClick={handleToggleWatcher}>
            {isWatcher ? '✓ Watching' : '+ Watch Lead'}
          </Button>
        </div>

        {/* Dynamic score card details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border border-slate-150 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/20 text-[12px]">
          <div>
            <span className="text-slate-400 block font-semibold">Web Visits</span>
            <span className="text-[16px] font-bold text-slate-800 dark:text-white">{lead.websiteVisits || 0}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold">Email Opens</span>
            <span className="text-[16px] font-bold text-slate-800 dark:text-white">{lead.emailOpens || 0}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold">Proposal Views</span>
            <span className="text-[16px] font-bold text-slate-800 dark:text-white">{lead.proposalViews || 0}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold">Interactions</span>
            <span className="text-[16px] font-bold text-slate-800 dark:text-white">{lead.interactionsCount || 0}</span>
          </div>
        </div>

        {/* Duplicate finder suggestion box */}
        {duplicateSuggestions.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-[12.5px] space-y-2">
            <div className="flex items-start gap-2">
              <ShieldAlert className="text-amber-500 flex-shrink-0 mt-0.5" size={16} />
              <div>
                <p className="font-bold text-amber-600 dark:text-amber-400">Potential Duplicate B2B Leads Found</p>
                <p className="text-[11.5px] text-slate-500">We detected leads with similar company names. Merge accounts to consolidate notes, stakeholders database, and timelines.</p>
              </div>
            </div>
            <div className="space-y-1.5 pt-1">
              {duplicateSuggestions.map(dup => (
                <div key={dup._id} className="flex items-center justify-between p-2 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{dup.companyName} ({dup.contactPerson})</span>
                  <button
                    onClick={() => handleMerge(dup._id)}
                    className="text-[11.5px] font-bold text-indigo-650 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:text-indigo-400 px-3 py-1 rounded-lg"
                  >
                    Merge Accounts
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interactive Simulated Communication widget */}
        <SimulatedCommsTabs lead={lead} onUpdate={onUpdate} />

        {/* Additional contacts section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Users size={16} className="text-indigo-500" /> B2B Stakeholders Map
            </h3>
            <Button size="sm" variant="outline" onClick={() => setShowAddContact(!showAddContact)}>
              {showAddContact ? 'Cancel' : '+ Add Contact'}
            </Button>
          </div>

          {showAddContact && (
            <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-850 space-y-3 text-[12.5px] animate-fadeIn">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Name</label>
                  <input className="form-input py-1 text-[13px]" placeholder="e.g. John Doe" value={cName} onChange={(e) => setCName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Role</label>
                  <select className="form-input py-1 text-[13px]" value={cRole} onChange={(e) => setCRole(e.target.value)}>
                    <option value="CEO">CEO</option>
                    <option value="CTO">CTO</option>
                    <option value="Marketing Head">Marketing Head</option>
                    <option value="Operations BDE">Operations BDE</option>
                    <option value="Financial Manager">Financial Manager</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Email</label>
                  <input className="form-input py-1 text-[13px]" placeholder="john@company.com" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Phone</label>
                  <input className="form-input py-1 text-[13px]" placeholder="9876543210" value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
                </div>
              </div>
              <div className="text-right">
                <Button size="sm" variant="primary" onClick={handleAddContact} disabled={!cName.trim()}>
                  Add Stakeholder Map
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {(!lead.contacts || lead.contacts.length === 0) ? (
              <span className="text-[12.5px] text-slate-450 italic block">No secondary contact mapped yet.</span>
            ) : (
              lead.contacts.map((c, i) => (
                <div key={i} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900 flex items-center justify-between text-[12.5px]">
                  <div>
                    <p className="font-bold text-slate-850 dark:text-slate-100">{c.name}</p>
                    <p className="text-[11.5px] text-slate-400 mt-0.5">{c.role} · {c.email || 'No Email'} · {c.phone || 'No Phone'}</p>
                  </div>
                  <div className="flex gap-2">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:text-indigo-400">
                        <Mail size={13} />
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="p-1.5 rounded-lg bg-emerald-50 text-emerald-500 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400">
                        <Phone size={13} />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Timeline Activities log */}
        <div className="space-y-4">
          <h3 className="text-[14px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Clock size={16} className="text-indigo-500" /> Lead Pipeline Activities & Logs
          </h3>

          <div className="border-l border-slate-200 dark:border-slate-800 ml-3 pl-4 space-y-4 text-[12.5px] font-sans">
            {(!lead.activities || lead.activities.length === 0) ? (
              <span className="text-slate-450 italic">No activity logged yet</span>
            ) : (
              [...lead.activities].reverse().map((act, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-indigo-500 ring-4 ring-white dark:ring-slate-900" />
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-slate-850 dark:text-slate-200">{act.text}</span>
                    <span className="text-[10.5px] text-slate-400">{new Date(act.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 italic">Logged by {act.performedBy || 'System'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Actions footer */}
      <div className="p-5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
        <button
          onClick={() => {
            if (window.confirm('Are you sure you want to permanently delete this lead from records?')) {
              onDelete(lead._id);
              onClose();
            }
          }}
          className="text-red-500 hover:text-red-650 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl text-[12.5px] font-bold transition-all"
        >
          Permanent Delete Lead
        </button>
      </div>
    </div>
  );
}

// ── Main Leads Page ───────────────────────────────────────────
export default function LeadsPage() {
  const {
    leads, users, loadLeads, createLead, updateLead, deleteLead, mergeLeads, bulkCreateLeads, authUser, systemSettings
  } = useAppStore(
    useShallow((s) => ({
      leads: s.leads,
      users: s.users,
      loadLeads: s.loadLeads,
      createLead: s.createLead,
      updateLead: s.updateLead,
      deleteLead: s.deleteLead,
      mergeLeads: s.mergeLeads,
      bulkCreateLeads: s.bulkCreateLeads,
      authUser: s.authUser,
      systemSettings: s.systemSettings
    }))
  );

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState('pipeline'); // 'pipeline' | 'emailLeads'
  const [activeView, setActiveView] = useState('csvgrid'); // 'kanban' | 'csvgrid' | 'forecast'
  const [searchTerm, setSearchTerm] = useState('');
  const [quickAddInput, setQuickAddInput] = useState('');

  // Missing state — bulk selection used by table view and export handlers
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  // CSV import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Creation & Import Modal States
  const [showAddModal, setShowAddModal] = useState(false);

  // Manual Creation Form State
  const [formCompany, setFormCompany] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formAssignee, setFormAssignee] = useState('');

  // Selected lead for Slide-out drawer
  const [selectedLead, setSelectedLead] = useState(null);

  // Confetti trigger
  const [confettiActive, setConfettiActive] = useState(false);

  // Re-fetch details when items list changes to keep drawer in sync
  const currentDetailsLead = useMemo(() => {
    if (!selectedLead) return null;
    return leads.find(l => l._id === selectedLead._id) || selectedLead;
  }, [leads, selectedLead]);

  // ── Column Visibility & Order States (including sequential unique leadId) ──
  const customFields = useMemo(() => {
    return systemSettings?.customFields?.filter(cf => cf.module === 'Deals') || [];
  }, [systemSettings]);

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('crm_leads_visible_cols');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      leadId: true,
      companyName: true,
      contactPerson: true,
      email: true,
      phone: true,
      dealValue: true,
      status: true,
      source: true,
      assignedTo: true,
      healthScore: true,
      nextFollowUpDate: true,
      lastActivity: true,
      createdAt: true,
      tags: true
    };
  });

  useEffect(() => {
    if (customFields.length > 0) {
      setVisibleColumns(prev => {
        const next = { ...prev };
        let changed = false;
        customFields.forEach(cf => {
          if (next[cf.name] === undefined) {
            next[cf.name] = true;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [customFields]);

  const toggleColumnVisibility = (colId) => {
    const next = { ...visibleColumns, [colId]: !visibleColumns[colId] };
    setVisibleColumns(next);
    localStorage.setItem('crm_leads_visible_cols', JSON.stringify(next));
  };

  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('crm_leads_col_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      'leadId',
      'companyName',
      'contactPerson',
      'email',
      'phone',
      'dealValue',
      'status',
      'source',
      'assignedTo',
      'healthScore',
      'nextFollowUpDate',
      'lastActivity',
      'createdAt',
      'tags'
    ];
  });

  const orderedColumns = useMemo(() => {
    const currentOrder = [...columnOrder];
    customFields.forEach(cf => {
      if (!currentOrder.includes(cf.name)) {
        currentOrder.push(cf.name);
      }
    });
    return currentOrder;
  }, [columnOrder, customFields]);

  const saveColumnOrder = (newOrder) => {
    setColumnOrder(newOrder);
    localStorage.setItem('crm_leads_col_order', JSON.stringify(newOrder));
  };

  const handleHeaderDragStart = (e, colId) => {
    e.dataTransfer.setData('reorderColId', colId);
  };

  const handleHeaderDrop = (e, targetColId) => {
    e.preventDefault();
    const sourceColId = e.dataTransfer.getData('reorderColId');
    if (!sourceColId || sourceColId === targetColId) return;

    const newOrder = [...columnOrder];
    const sourceIdx = newOrder.indexOf(sourceColId);
    const targetIdx = newOrder.indexOf(targetColId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    newOrder.splice(sourceIdx, 1);
    newOrder.splice(targetIdx, 0, sourceColId);
    saveColumnOrder(newOrder);
    toast.success('Column layout updated!');
  };

  // ── Role-Based Permission Matrix Checker ──
  const canEdit = (lead) => {
    if (!authUser) return false;
    if (authUser.role === 'admin' || authUser.role === 'manager') return true;
    if (authUser.role === 'member') {
      const assignedId = lead.assignedTo?._id || lead.assignedTo;
      return String(assignedId) === String(authUser._id);
    }
    return false;
  };

  // ── Inline Editing States & Saving Sync Flashes ──
  const handleCellSync = async (leadId, field, value, isCustom = false) => {
    const cellKey = `${leadId}-${field}`;
    const targetLead = leads.find(l => l._id === leadId);
    
    if (!targetLead) return;
    if (!canEdit(targetLead)) {
      toast.error('Permission denied: You cannot edit this lead');
      return;
    }

    try {
      let payload = {};
      if (isCustom) {
        payload = { customFields: { ...targetLead.customFields, [field]: value } };
      } else {
        payload = { [field]: value };
      }
      await updateLead(leadId, payload);
    } catch {
      // toast already dispatched by store action
    }
  };

  // ── Sorting ──
  const [sortColumn, setSortColumn] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');

  const toggleSort = (colId) => {
    if (sortColumn === colId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn('');
        setSortDirection(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  };

  // ── Advanced Multi-Filtering States & Preset Manager ──
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterMinVal, setFilterMinVal] = useState('');
  const [filterMaxVal, setFilterMaxVal] = useState('');
  const [filterMinHealth, setFilterMinHealth] = useState('');
  const [filterMaxHealth, setFilterMaxHealth] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [filterPresets, setFilterPresets] = useState(() => {
    try {
      const saved = localStorage.getItem('crm_leads_filter_presets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [presetNameInput, setPresetNameInput] = useState('');

  const savePreset = () => {
    if (!presetNameInput.trim()) {
      toast.error('Please enter a preset name');
      return;
    }
    const newPreset = {
      id: Date.now().toString(),
      name: presetNameInput.trim(),
      filters: {
        filterStatus,
        filterAssigned,
        filterSource,
        filterMinVal,
        filterMaxVal,
        filterMinHealth,
        filterMaxHealth,
        filterStartDate,
        filterEndDate,
        filterTags,
        showArchived
      }
    };
    const updated = [...filterPresets, newPreset];
    setFilterPresets(updated);
    localStorage.setItem('crm_leads_filter_presets', JSON.stringify(updated));
    setPresetNameInput('');
    toast.success(`Preset "${newPreset.name}" saved!`);
  };

  const applyPreset = (preset) => {
    const f = preset.filters;
    setFilterStatus(f.filterStatus || '');
    setFilterAssigned(f.filterAssigned || '');
    setFilterSource(f.filterSource || '');
    setFilterMinVal(f.filterMinVal || '');
    setFilterMaxVal(f.filterMaxVal || '');
    setFilterMinHealth(f.filterMinHealth || '');
    setFilterMaxHealth(f.filterMaxHealth || '');
    setFilterStartDate(f.filterStartDate || '');
    setFilterEndDate(f.filterEndDate || '');
    setFilterTags(f.filterTags || '');
    setShowArchived(!!f.showArchived);
    toast.success(`Preset applied: "${preset.name}"`);
  };

  const deletePreset = (presetId, e) => {
    e.stopPropagation();
    const updated = filterPresets.filter(p => p.id !== presetId);
    setFilterPresets(updated);
    localStorage.setItem('crm_leads_filter_presets', JSON.stringify(updated));
    toast.success('Preset deleted');
  };

  const clearAllFilters = () => {
    setFilterStatus('');
    setFilterAssigned('');
    setFilterSource('');
    setFilterMinVal('');
    setFilterMaxVal('');
    setFilterMinHealth('');
    setFilterMaxHealth('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterTags('');
    setShowArchived(false);
    toast.success('Filters cleared');
  };

  // ── Advanced Multi-Filtering Logic ──
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      // 1. Search term match (LeadId, Company, Contact, Email, Phone, and notes)
      const matchesSearch = 
        (l.leadId && l.leadId.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (l.companyName && l.companyName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (l.contactPerson && l.contactPerson.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (l.email && l.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (l.phone && l.phone.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (l.notes && l.notes.some(n => n.text?.toLowerCase().includes(searchTerm.toLowerCase())));

      if (!matchesSearch) return false;

      // 2. Archived status
      if (showArchived) {
        if (!l.archived) return false;
      } else {
        if (l.archived) return false;
      }

      // 3. Stage Status
      if (filterStatus && l.status !== filterStatus) return false;

      // 4. Assigned Sales Rep
      if (filterAssigned) {
        const assignedId = l.assignedTo?._id || l.assignedTo;
        if (String(assignedId) !== String(filterAssigned)) return false;
      }

      // 5. Source Origin
      if (filterSource && l.source !== filterSource) return false;

      // 6. Deal Value bounds
      if (filterMinVal && (l.dealValue || 0) < Number(filterMinVal)) return false;
      if (filterMaxVal && (l.dealValue || 0) > Number(filterMaxVal)) return false;

      // 7. Health Score bounds
      if (filterMinHealth && (l.healthScore || 0) < Number(filterMinHealth)) return false;
      if (filterMaxHealth && (l.healthScore || 0) > Number(filterMaxHealth)) return false;

      // 8. Created Date bounds
      if (filterStartDate && new Date(l.createdAt) < new Date(filterStartDate)) return false;
      if (filterEndDate) {
        const endDateObj = new Date(filterEndDate);
        endDateObj.setHours(23, 59, 59, 999);
        if (new Date(l.createdAt) > endDateObj) return false;
      }

      // 9. Multi-Tags Matching
      if (filterTags) {
        const searchTags = filterTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (searchTags.length > 0) {
          const leadTags = (l.tags || []).map(t => t.toLowerCase());
          const hasMatchingTag = searchTags.some(st => leadTags.some(lt => lt.includes(st)));
          if (!hasMatchingTag) return false;
        }
      }

      return true;
    });
  }, [
    leads, searchTerm, showArchived, filterStatus, filterAssigned, filterSource,
    filterMinVal, filterMaxVal, filterMinHealth, filterMaxHealth, filterStartDate, filterEndDate, filterTags
  ]);

  // ── Pipeline vs Email Leads vs External Form Leads split ──
  // Campaign-engagement leads (opened 3+ times / replied — see leadPipelineSync.js
  // on the backend) live in their own "Email Leads" tab, and public-form-captured
  // leads (witPublicController.captureLead / external-api/leadCapture — source
  // === 'Web Form') live in their own "External Form Leads" tab, both fully
  // separate from the main pipeline's grid, stats, and Kanban/Forecast views,
  // until someone explicitly moves one in ("Move to Pipeline" — flips source
  // away from 'Campaign'/'Web Form'; reversible from the main pipeline table's
  // "Move back" buttons, since campaignAttribution/utmSource are set once at
  // creation and never cleared, so which tab a lead belongs to is never lost).
  const pipelineLeads = useMemo(() => filteredLeads.filter((l) => l.source !== 'Campaign' && l.source !== 'Web Form'), [filteredLeads]);
  // A lead counts as an "email lead" either because it originated from a
  // campaign (source === 'Campaign') OR because it's since gone Hot from
  // campaign engagement (leadPipelineSync tags existing leads — from any
  // original source — 'Hot' on repeat opens without changing their
  // source, so a strict source-only filter was hiding exactly the leads
  // this tab exists to surface).
  const isEmailLead = (l) => l.source === 'Campaign' || l.tags?.includes('Hot');
  const emailLeadsList = useMemo(() => filteredLeads.filter(isEmailLead), [filteredLeads]);
  const isExternalFormLead = (l) => l.source === 'Web Form';
  const externalFormLeadsList = useMemo(() => filteredLeads.filter(isExternalFormLead), [filteredLeads]);
  // Unfiltered pools — tab badge counts and the pipeline sub-views' "allLeads"
  // fallback (archive lookups etc.) shouldn't shift with the search box.
  const pipelineAllLeads = useMemo(() => leads.filter((l) => l.source !== 'Campaign' && l.source !== 'Web Form'), [leads]);
  const emailLeadsAllCount = useMemo(() => leads.filter(isEmailLead).length, [leads]);
  // Full list, not just a count — External Form Leads reuses LeadsTableView
  // (see below), which needs its own unfiltered "allLeads" pool for the
  // Archived toggle, same as the main pipeline does.
  const externalFormLeadsAllList = useMemo(() => leads.filter(isExternalFormLead), [leads]);

  // ── Multi-Column Sorting Logic ──
  const sortedLeads = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredLeads;
    return [...filteredLeads].sort((a, b) => {
      let valA, valB;
      if (sortColumn === 'lastActivity') {
        valA = new Date(a.updatedAt || a.lastContactDate || 0).getTime();
        valB = new Date(b.updatedAt || b.lastContactDate || 0).getTime();
      } else if (sortColumn === 'createdAt') {
        valA = new Date(a.createdAt || 0).getTime();
        valB = new Date(b.createdAt || 0).getTime();
      } else if (sortColumn === 'assignedTo') {
        valA = a.assignedTo?.name || '';
        valB = b.assignedTo?.name || '';
      } else if (sortColumn === 'nextFollowUpDate') {
        valA = a.nextFollowUpDate ? new Date(a.nextFollowUpDate).getTime() : 0;
        valB = b.nextFollowUpDate ? new Date(b.nextFollowUpDate).getTime() : 0;
      } else if (customFields.some(cf => cf.name === sortColumn)) {
        valA = a.customFields?.[sortColumn] ?? '';
        valB = b.customFields?.[sortColumn] ?? '';
      } else {
        valA = a[sortColumn] ?? '';
        valB = b[sortColumn] ?? '';
      }

      if (typeof valA === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return sortDirection === 'asc' 
          ? (valA > valB ? 1 : -1) 
          : (valA < valB ? 1 : -1);
      }
    });
  }, [filteredLeads, sortColumn, sortDirection, customFields]);

  // ── Server-Side Optimized Pagination ──
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const paginatedLeads = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedLeads.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedLeads, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(sortedLeads.length / rowsPerPage) || 1;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, filterAssigned, filterSource, filterMinVal, filterMaxVal, filterMinHealth, filterMaxHealth, filterStartDate, filterEndDate, filterTags, showArchived, sortColumn, sortDirection]);

  // ── CSV Download Exporter ──
  const downloadCSV = (rows, filename) => {
    const csv  = rows.map((r) => r.map((c) => `"${csvCell(c)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = (type) => {
    let targetLeads = [];
    if (type === 'selected') {
      targetLeads = leads.filter(l => selectedLeadIds.includes(l._id));
      if (targetLeads.length === 0) {
        toast.error('No leads selected');
        return;
      }
    } else if (type === 'filtered') {
      targetLeads = filteredLeads;
    } else {
      targetLeads = leads.filter(l => !l.archived);
    }

    const headers = [
      'Lead ID',
      'Company Name',
      'Contact Person',
      'Email',
      'Phone',
      'Deal Value',
      'Status',
      'Lead Source',
      'Assigned To',
      'Health Score',
      'Next Follow-up Date',
      'Last Activity',
      'Created Date',
      'Tags',
      ...customFields.map(cf => cf.label)
    ];

    const rows = [
      headers,
      ...targetLeads.map(l => [
        l.leadId || '',
        l.companyName,
        l.contactPerson,
        l.email || '',
        l.phone || '',
        l.dealValue || 0,
        l.status,
        l.source || 'Manual',
        l.assignedTo?.name || 'Unassigned',
        l.healthScore || 0,
        l.nextFollowUpDate ? new Date(l.nextFollowUpDate).toISOString().split('T')[0] : '',
        new Date(l.updatedAt || l.lastContactDate || l.createdAt).toLocaleString(),
        new Date(l.createdAt).toLocaleString(),
        (l.tags || []).join(', '),
        ...customFields.map(cf => l.customFields?.get?.(cf.name) || l.customFields?.[cf.name] || '')
      ])
    ];

    const filename = `leads_export_${type}_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(rows, filename);
    toast.success(`Exported ${targetLeads.length} leads successfully!`);
  };

  // ── Bulk Actions Updates ──
  const handleBulkStatusChange = async (status) => {
    if (!status) return;
    try {
      await Promise.all(selectedLeadIds.map(id => updateLead(id, { status })));
      setSelectedLeadIds([]);
      toast.success('Funnel stages shifted in bulk');
    } catch {}
  };

  const handleBulkArchive = async () => {
    if (window.confirm(`Are you sure you want to archive ${selectedLeadIds.length} B2B leads?`)) {
      try {
        await Promise.all(selectedLeadIds.map(id => updateLead(id, { archived: true })));
        setSelectedLeadIds([]);
        toast.success('Leads archived successfully');
      } catch {}
    }
  };

  const handleBulkAddTags = async (tagString) => {
    if (!tagString.trim()) return;
    const newTags = tagString.split(',').map(t => t.trim()).filter(Boolean);
    if (newTags.length === 0) return;
    try {
      await Promise.all(selectedLeadIds.map(id => {
        const lead = leads.find(l => l._id === id);
        const existingTags = lead?.tags || [];
        const combined = Array.from(new Set([...existingTags, ...newTags]));
        return updateLead(id, { tags: combined });
      }));
      setSelectedLeadIds([]);
      toast.success('Tags appended in bulk');
    } catch {}
  };

  // Handle Manual creation form submit
  const handleManualCreate = async (e) => {
    e.preventDefault();
    if (!formCompany.trim() || !formContact.trim()) {
      toast.error('Company Name and Contact Person are required');
      return;
    }

    try {
      await createLead({
        companyName: formCompany.trim(),
        contactPerson: formContact.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim(),
        website: formWebsite.trim(),
        dealValue: Number(formValue) || 0,
        assignedTo: formAssignee || null,
        status: 'New Lead',
        source: 'Manual'
      });

      // Clear fields and close
      setFormCompany('');
      setFormContact('');
      setFormEmail('');
      setFormPhone('');
      setFormWebsite('');
      setFormValue('');
      setFormAssignee('');
      setShowAddModal(false);
    } catch { }
  };

  // CSV Bulk Importer file drop parser
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length <= 1) {
          toast.error('The selected CSV file has no records');
          return;
        }

        // Parse headers and normalize casing
        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
        const parsedLeads = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
          if (cols.length === 0 || !cols[0]) continue;

          const leadObj = {};
          headers.forEach((header, index) => {
            const val = cols[index] || '';
            if (header.includes('company') || header.includes('title')) {
              leadObj.companyName = val;
            } else if (header.includes('contact') || header.includes('name') || header.includes('person')) {
              leadObj.contactPerson = val;
            } else if (header.includes('value') || header.includes('deal') || header.includes('size')) {
              leadObj.dealValue = Number(val.replace(/[^0-9.]/g, '')) || 0;
            } else if (header.includes('email')) {
              leadObj.email = val;
            } else if (header.includes('phone')) {
              leadObj.phone = val;
            } else if (header.includes('website') || header.includes('site') || header.includes('link')) {
              leadObj.website = val;
            }
          });

          // Fallbacks and validation
          if (!leadObj.companyName) continue;
          if (!leadObj.contactPerson) leadObj.contactPerson = 'Undecided';

          parsedLeads.push(leadObj);
        }

        if (parsedLeads.length === 0) {
          toast.error('Could not parse any valid Lead records from this CSV');
          return;
        }

        await bulkCreateLeads(parsedLeads);
        setShowImportModal(false);
      } catch (err) {
        console.error(err);
        toast.error('Failed to parse CSV file. Ensure standard comma-separated format.');
      }
    };
    reader.readAsText(file);
  };

  // Drag-Drop handlers
  const handleDrop = async (e, col) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');

    const lead = leads.find(l => l._id === leadId);
    if (!lead || lead.status === col) return;

    try {
      await updateLead(leadId, { status: col });
      if (col === 'Won') {
        setConfettiActive(true);
      }
      toast.success(`Pipeline shifted: "${lead.companyName}" moved to "${col}"`);
    } catch { }
  };

  const handleReassign = async (leadId, userId) => {
    try {
      await updateLead(leadId, { assignedTo: userId });
      toast.success('Sales representative reassigned');
    } catch { }
  };

  return (
    <Page>
      {/* Confetti Explosion Component */}
      <ConfettiCanvas active={confettiActive} onComplete={() => setConfettiActive(false)} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Target className="text-indigo-500 animate-pulse" /> B2B Leads pipeline
          </h1>
          <p className="page-sub">Ingest, qualify, draft B2B contracts, and automatically onboard won accounts into delivery workspaces</p>
        </div>

        {/* Header Action buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {activeSection === 'pipeline' && (
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/60">
              {[
                { id: 'csvgrid',  label: 'CSV Pipeline Grid', icon: FileText    },
                { id: 'kanban',   label: 'Kanban Funnel',    icon: Sliders      },
                { id: 'forecast', label: 'Pipeline Forecast', icon: BarChart2   },
              ].map((v) => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => {
                      setActiveView(v.id);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all ${activeView === v.id
                        ? 'bg-white dark:bg-slate-900 text-indigo-650 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                      }`}
                  >
                    <Icon size={14} />
                    <span>{v.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {activeSection === 'pipeline' && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)} className="flex items-center gap-1">
                <Plus size={14} />
                <span>Add Lead</span>
              </Button>
              {activeView === 'csvgrid' && (
                <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)} className="flex items-center gap-1 text-indigo-600 border-indigo-200 dark:text-indigo-400 dark:border-indigo-950">
                  <FileText size={14} />
                  <span>Import CSV</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section tabs — Pipeline (manual/imported deals) vs Email Leads (campaign
          engagement) vs External Form Leads (public form intake) */}
      <div className="flex items-center gap-1.5 mb-5 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'pipeline', label: 'Leads Pipeline', icon: Target, count: pipelineAllLeads.length },
          { id: 'emailLeads', label: 'Email Leads', icon: Mail, count: emailLeadsAllCount },
          { id: 'externalFormLeads', label: 'External Form Leads', icon: Globe2, count: externalFormLeadsAllList.length },
        ].map((sec) => {
          const Icon = sec.icon;
          const active = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-all ${active
                  ? 'border-indigo-500 text-indigo-650 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                }`}
            >
              <Icon size={14} />
              <span>{sec.label}</span>
              <span className={`ml-0.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-indigo-100 text-indigo-650 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                {sec.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search and control box */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-450" />
          <input
            className="form-input text-[13px] pl-10"
            placeholder={
              activeSection === 'pipeline' ? 'Search B2B leads by Company or Representative...'
                : activeSection === 'emailLeads' ? 'Search email leads by Company or Contact...'
                  : 'Search external form leads by Name or Email...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Main Panel views */}
      {activeSection === 'emailLeads' && (
        <EmailLeadsView
          leads={emailLeadsList}
          users={users}
          onSelectLead={setSelectedLead}
          onUpdate={updateLead}
        />
      )}

      {activeSection === 'externalFormLeads' && (
        <ExternalFormLeadsView
          leads={externalFormLeadsList}
          allLeads={externalFormLeadsAllList}
          users={users}
          onSelectLead={setSelectedLead}
          onDelete={deleteLead}
          onUpdate={updateLead}
        />
      )}

      {activeSection === 'pipeline' && activeView === 'kanban' && (
        <LeadsKanbanView
          filteredLeads={pipelineLeads}
          users={users}
          onSelectLead={setSelectedLead}
          onReassign={handleReassign}
          onDrop={handleDrop}
        />
      )}

      {activeSection === 'pipeline' && activeView === 'csvgrid' && (
        <LeadsTableView
          filteredLeads={pipelineLeads}
          allLeads={pipelineAllLeads}
          users={users}
          onSelectLead={setSelectedLead}
          onDelete={deleteLead}
          onUpdate={updateLead}
        />
      )}

      {activeSection === 'pipeline' && activeView === 'forecast' && (
        <PipelineForecastView leads={pipelineAllLeads} />
      )}

      {/* Slide-out Inspections drawer Details panel */}
      {currentDetailsLead && (
        <LeadDetailDrawer
          lead={currentDetailsLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={updateLead}
          onDelete={deleteLead}
          onMerge={mergeLeads}
          users={users}
          allLeads={leads}
        />
      )}

      {/* ── CSV Import Modal (table view) ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-150 dark:border-slate-800/80 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-indigo-500" /> Import Leads from CSV
              </h3>
              <button onClick={() => setShowImportModal(false)} className="p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-450">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[13px] text-slate-500">
                Upload a <strong>.csv</strong> file with columns: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[12px]">Company Name, Contact Person, Email, Phone, Deal Value, Website</code>. The first row must be a header row.
              </p>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl py-8 cursor-pointer hover:border-indigo-400 transition-colors bg-slate-50 dark:bg-slate-800/30">
                <FileText size={28} className="text-slate-400" />
                <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">Click to select CSV file</span>
                <span className="text-[11.5px] text-slate-400">or drag and drop here</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
              </label>
            </div>
            <div className="px-6 pb-5 flex justify-end">
              <Button variant="outline" onClick={() => setShowImportModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 1. Manual Creation Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-150 dark:border-slate-800/80 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Target size={18} className="text-indigo-500" /> Log prospective B2B Lead
              </h3>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-450">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleManualCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-[12.5px]">
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Company Name *</label>
                  <input required className="form-input" placeholder="e.g. Acme Corporation" value={formCompany} onChange={(e) => setFormCompany(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Contact Stakeholder *</label>
                  <input required className="form-input" placeholder="John Doe" value={formContact} onChange={(e) => setFormContact(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Deal Size (₹)</label>
                  <input type="number" className="form-input" placeholder="5000" value={formValue} onChange={(e) => setFormValue(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Email address</label>
                  <input className="form-input" placeholder="john@acme.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Phone number</label>
                  <input className="form-input" placeholder="+12345678" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Company Website / URL</label>
                  <input className="form-input" placeholder="acme.com" value={formWebsite} onChange={(e) => setFormWebsite(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Assigned Rep Representative</label>
                  <select className="form-input" value={formAssignee} onChange={(e) => setFormAssignee(e.target.value)}>
                    <option value="">Choose delegate representative...</option>
                    {users.map(u => (
                      <option key={u._id} value={u._id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 text-[13px]">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Log B2B Lead</Button>
              </div>
            </form>
          </div>
        </div>
      )}


    </Page>
  );
}
