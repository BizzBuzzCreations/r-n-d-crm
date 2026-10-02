import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { Plus, Filter, Eye, Check, X, Trash2, CalendarOff, Paperclip } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { payrollAPI, avatarUrl } from '../../services/api';
import { Page, Button, Modal, EmptyState, ConfirmDialog, Avatar } from '../../components/ui';
import { fmtDate } from '../../utils/helpers';

const TYPES = [
  { value: 'annual',    label: 'Annual Leave' },
  { value: 'sick',      label: 'Sick Leave' },
  { value: 'unpaid',    label: 'Unpaid Leave' },
  { value: 'maternity', label: 'Maternity Leave' },
  { value: 'paternity', label: 'Paternity Leave' },
  { value: 'other',     label: 'Other' },
];
const typeLabel = (t) => TYPES.find((x) => x.value === t)?.label || (t === 'casual' ? 'Casual Leave' : t);

const STATUS = {
  pending:  { label: 'Pending',  cls: 'badge-warning' },
  approved: { label: 'Approved', cls: 'badge-success' },
  rejected: { label: 'Rejected', cls: 'badge-danger' },
};


function StatusBadge({ status }) {
  const cfg = STATUS[status] || STATUS.pending;
  return (
    <span className={`badge ${cfg.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

// Payroll → Leaves. Admin/manager see and action every request; everyone else
// sees only their own and can file / withdraw (pending) requests.
export default function PayrollLeavesPage() {
  const authUser = useAppStore((s) => s.authUser);
  const users    = useAppStore((s) => s.users);
  const isManager = ['admin', 'manager'].includes(authUser?.role);   // sees every request
  const isApprover = authUser?.role === 'manager';                    // only managers decide

  const [leaves, setLeaves]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: 'all', type: 'all' });

  const [showNew, setShowNew]   = useState(false);
  const [selected, setSelected] = useState(null);   // leave open in the View modal
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const { data } = await payrollAPI.getLeaves({
        search: f.search || undefined,
        status: f.status,
        type:   f.type,
      });
      setLeaves(data.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); /* initial load only; Filter button re-runs it */ }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => load(filters);

  const upsert = (leave) => setLeaves((prev) => prev.map((l) => (l._id === leave._id ? leave : l)));

  const handleDelete = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await payrollAPI.deleteLeave(target._id);
      setLeaves((prev) => prev.filter((l) => l._id !== target._id));
      setSelected(null);
      toast.success(isManager ? 'Leave request deleted' : 'Leave request withdrawn');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete leave request');
    }
  };

  return (
    <Page>
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="page-title">Leave Management</h1>
        <Button variant="primary" onClick={() => setShowNew(true)}>
          <Plus size={15} /> New Request
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {isManager && (
          <input
            className="form-input !w-56" placeholder="Search employee..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        )}
        <select className="form-input !w-40" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <select className="form-input !w-36" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
          <option value="all">All Types</option>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Button variant="primary" onClick={applyFilters}><Filter size={14} /> Filter</Button>
      </div>

      {/* Table */}
      <div className="table-container">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-slate-400">Loading…</div>
        ) : leaves.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title="No leave requests"
            description={isManager ? 'No requests match the current filters.' : 'You have not requested any leave yet.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="crm-table min-w-[820px]">
              <thead>
                <tr>
                  <th>Employee</th><th>Type</th><th>From</th><th>To</th>
                  <th className="!text-right">Days</th><th>Status</th><th>Actioned By</th><th />
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l._id}>
                    <td>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{l.employee?.name || 'Unknown'}</span>
                    </td>
                    <td>{typeLabel(l.type)}</td>
                    <td className="text-slate-500">{fmtDate(l.from)}</td>
                    <td className="text-slate-500">{fmtDate(l.to)}</td>
                    <td className="!text-right font-semibold">{Number(l.days).toFixed(2)}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="text-[12px] text-slate-500">
                      {l.actionedBy ? (
                        <>
                          <span className="font-medium text-slate-600 dark:text-slate-300">{l.actionedBy.name}</span>
                          {l.actionedAt && <span className="ml-1.5 text-slate-400">{fmtDate(l.actionedAt, { day: 'numeric', month: 'short' })}</span>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="!text-right">
                      <button
                        onClick={() => setSelected(l)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 text-[12px] font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                      >
                        <Eye size={13} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewLeaveModal
        open={showNew}
        onClose={() => setShowNew(false)}
        isManager={isManager}
        users={users}
        authUser={authUser}
        onCreated={(leave) => { setLeaves((prev) => [leave, ...prev]); setShowNew(false); toast.success('Leave request submitted'); }}
      />

      <LeaveDetailModal
        leave={selected}
        onClose={() => setSelected(null)}
        isManager={isManager}
        isApprover={isApprover}
        isOwner={selected && String(selected.employee?._id) === String(authUser?._id || authUser?.id)}
        onUpdated={(leave) => { upsert(leave); setSelected(leave); }}
        onDelete={() => setConfirmDelete(selected)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={isManager ? 'Delete leave request?' : 'Withdraw leave request?'}
        message="This cannot be undone."
        confirmLabel={isManager ? 'Delete' : 'Withdraw'}
      />
    </Page>
  );
}

// ── New request ───────────────────────────────────────────────
const BREAKDOWNS = [{ value: 'full', label: 'Full Day' }, { value: 'half', label: 'Half Day' }];
const MAX_ATTACHMENT = 10 * 1024 * 1024;

const Req = () => <span className="text-red-500">*</span>;

function NewLeaveModal({ open, onClose, isManager, users, authUser, onCreated }) {
  const blank = { type: '', from: '', to: '', startBreakdown: 'full', endBreakdown: 'full', reason: '', employee: '' };
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (open) { setForm(blank); setFile(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    if (k === 'from' && next.to && next.to < v) next.to = v;   // keep the range valid
    return next;
  });

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_ATTACHMENT) return toast.error('Attachment must be 10 MB or smaller');
    setFile(f);
  };

  const submit = async () => {
    if (!form.type) return toast.error('Please choose a leave type');
    if (!form.from || !form.to) return toast.error('Start date and end date are required');
    if (form.to < form.from) return toast.error('End date cannot be before the start date');
    if (!form.reason.trim()) return toast.error('Description is required');
    setSaving(true);
    try {
      const { data } = await payrollAPI.createLeave({ ...form, attachment: file || undefined });
      onCreated(data.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to submit leave request');
    } finally {
      setSaving(false);
    }
  };

  const staff = (users || []).filter((u) => u.role !== 'client' && String(u._id || u.id) !== String(authUser?._id || authUser?.id));

  return (
    <Modal
      open={open} onClose={onClose} title="Create Request"
      footer={<>
        <button type="button" onClick={onClose} className="px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">Cancel</button>
        <Button variant="primary" className="!bg-slate-700 hover:!bg-slate-800 !px-6" loading={saving} onClick={submit}>Save</Button>
      </>}
    >
      <div className="space-y-4 p-6">
        {isManager && (
          <div>
            <label className="form-label">Employee</label>
            <select className="form-input" value={form.employee} onChange={(e) => set('employee', e.target.value)}>
              <option value="">Myself ({authUser?.name})</option>
              {staff.map((u) => <option key={u._id || u.id} value={u._id || u.id}>{u.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Leave Type <Req /></label>
            <select className="form-input" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">--- Choose Leave Type ---</option>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Start date <Req /></label>
            <input type="date" className="form-input" value={form.from} onChange={(e) => set('from', e.target.value)} />
          </div>

          <div>
            <label className="form-label">Start Date Breakdown <Req /></label>
            <select className="form-input" value={form.startBreakdown} onChange={(e) => set('startBreakdown', e.target.value)}>
              {BREAKDOWNS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">End date <Req /></label>
            <input type="date" className="form-input" value={form.to} min={form.from || undefined} onChange={(e) => set('to', e.target.value)} />
          </div>

          <div>
            <label className="form-label">End Date Breakdown <Req /></label>
            <select className="form-input" value={form.endBreakdown} onChange={(e) => set('endBreakdown', e.target.value)}>
              {BREAKDOWNS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Attachment</label>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={pickFile} />
            <div className="form-input flex items-center gap-2 cursor-pointer" onClick={() => fileRef.current?.click()}>
              <Paperclip size={14} className="text-slate-400 flex-shrink-0" />
              <span className={`truncate flex-1 ${file ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{file ? file.name : 'Choose file...'}</span>
              {file && (
                <button type="button" title="Remove file" onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-slate-400 hover:text-red-500">
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1">PDF, JPG, PNG, DOC up to 10 MB</p>
          </div>
        </div>

        <div>
          <label className="form-label">Description <Req /></label>
          <textarea rows={4} className="form-input resize-none" placeholder="Description" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </div>

        <p className="text-[11.5px] text-slate-400 text-center pt-1">Days are calculated automatically — office off-days excluded.</p>
      </div>
    </Modal>
  );
}

// ── View / action ─────────────────────────────────────────────
function LeaveDetailModal({ leave, onClose, isManager, isApprover, isOwner, onUpdated, onDelete }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRemarks(leave?.remarks || ''); }, [leave?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (status) => {
    setBusy(true);
    try {
      const { data } = await payrollAPI.updateLeaveStatus(leave._id, { status, remarks });
      onUpdated(data.data);
      toast.success(`Leave ${status}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update leave request');
    } finally {
      setBusy(false);
    }
  };

  const row = (label, value) => (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-100 text-right">{value}</span>
    </div>
  );

  const canWithdraw = isManager || (isOwner && leave?.status === 'pending');

  return (
    <Modal
      open={!!leave} onClose={onClose} title="Leave Request"
      footer={<>
        {canWithdraw && (
          <Button variant="danger" className="mr-auto" onClick={onDelete}>
            <Trash2 size={14} /> {isManager ? 'Delete' : 'Withdraw'}
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>Close</Button>
      </>}
    >
      {leave && (
        <div className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <Avatar user={leave.employee} size="lg" />
            <div>
              <p className="text-[14.5px] font-bold text-slate-900 dark:text-white">{leave.employee?.name}</p>
              <StatusBadge status={leave.status} />
            </div>
          </div>
          {row('Type', typeLabel(leave.type))}
          {row('From', fmtDate(leave.from))}
          {row('To', fmtDate(leave.to))}
          {row('Days', Number(leave.days).toFixed(2))}
          {(leave.startBreakdown === 'half' || leave.endBreakdown === 'half') && row('Breakdown', `Start: ${leave.startBreakdown === 'half' ? 'Half day' : 'Full day'} · End: ${leave.endBreakdown === 'half' ? 'Half day' : 'Full day'}`)}
          {leave.attachment?.url && row('Attachment', (
            <a href={avatarUrl(leave.attachment.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300 hover:underline">
              <Paperclip size={12} /> {leave.attachment.name || 'View file'}
            </a>
          ))}
          {row('Reason', leave.reason || '—')}
          {leave.actionedBy && row('Actioned by', `${leave.actionedBy.name}${leave.actionedAt ? ` · ${fmtDate(leave.actionedAt)}` : ''}`)}
          {leave.remarks && row('Remarks', leave.remarks)}

          {isManager && !(isApprover && !isOwner) && leave.status === 'pending' && (
            <p className="mt-4 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/30 text-[12px] text-slate-500">
              {isOwner ? 'You cannot approve or reject your own request.' : 'Only a manager can approve or reject leave requests.'}
            </p>
          )}
          {isApprover && !isOwner && (
            <div className="mt-4">
              <label className="form-label">Remarks <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea rows={2} className="form-input resize-none" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <div className="flex gap-2 mt-3">
                <Button variant="success" loading={busy} disabled={leave.status === 'approved'} onClick={() => act('approved')}>
                  <Check size={14} /> Approve
                </Button>
                <Button variant="danger" loading={busy} disabled={leave.status === 'rejected'} onClick={() => act('rejected')}>
                  <X size={14} /> Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
