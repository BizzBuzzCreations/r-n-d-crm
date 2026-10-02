import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Plus, ArrowRight, Trash2, Lock, Wallet } from 'lucide-react';
import { payrollAPI } from '../../services/api';
import { Page, Button, Modal, EmptyState, ConfirmDialog } from '../../components/ui';
import { fmtDate } from '../../utils/helpers';

const STATUS = {
  draft:        { label: 'Draft',        cls: 'badge-neutral' },
  under_review: { label: 'Under Review', cls: 'badge-info' },
  approved:     { label: 'Approved',     cls: 'badge-success' },
  locked:       { label: 'Locked',       cls: 'badge-danger' },
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPeriod = (a, b) => `${fmtDate(a, { day: '2-digit', month: 'short' })} – ${fmtDate(b, { day: '2-digit', month: 'short', year: 'numeric' })}`;

const PERIOD_TYPES = [
  { value: 'monthly',  label: 'Monthly' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'custom',   label: 'Custom' },
];

// Suggested end date for a start date + period type (UTC maths so timezones can't shift the day).
const suggestEnd = (type, start) => {
  if (!start) return '';
  const d = new Date(start);
  if (type === 'monthly')  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (type === 'weekly')   { d.setUTCDate(d.getUTCDate() + 6);  return d.toISOString().slice(0, 10); }
  if (type === 'biweekly') { d.setUTCDate(d.getUTCDate() + 13); return d.toISOString().slice(0, 10); }
  return '';
};

const EMPTY = { name: '', periodType: 'monthly', periodStart: '', periodEnd: '', payDate: '', status: 'draft', employees: '', totalSalary: '', totalNet: '', notes: '' };

// Payroll → Pay Runs. Admin/manager only (gated server-side by the
// 'payroll_pay_runs' feature key). Locked runs are read-only.
export default function PayrollPayRunsPage() {
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | run
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await payrollAPI.getPayRuns();
        setRuns(data.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Failed to load pay runs');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSaved = (run, isNew) => {
    setRuns((prev) => (isNew ? [run, ...prev] : prev.map((r) => (r._id === run._id ? run : r))));
    setEditing(null);
    toast.success(isNew ? 'Pay run created' : 'Pay run updated');
  };

  const handleDelete = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await payrollAPI.deletePayRun(target._id);
      setRuns((prev) => prev.filter((r) => r._id !== target._id));
      setEditing(null);
      toast.success('Pay run deleted');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete pay run');
    }
  };

  if (editing === 'new') {
    return <NewPayRunForm onCancel={() => setEditing(null)} onCreated={(run) => handleSaved(run, true)} />;
  }

  return (
    <Page>
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="page-title">Pay Runs</h1>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={15} /> New Pay Run
        </Button>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-slate-400">Loading…</div>
        ) : runs.length === 0 ? (
          <EmptyState icon={Wallet} title="No pay runs yet" description="Create your first pay run to start tracking payroll." />
        ) : (
          <div className="overflow-x-auto">
            <table className="crm-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Name</th><th>Period</th><th>Pay Date</th><th>Status</th>
                  <th className="!text-right">Employees</th>
                  <th className="!text-right">Total Salary</th>
                  <th className="!text-right">Total Net</th><th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const cfg = STATUS[r.status] || STATUS.draft;
                  return (
                    <tr key={r._id}>
                      <td className="font-semibold text-slate-800 dark:text-slate-100 uppercase">{r.name}</td>
                      <td className="text-[12.5px] text-slate-500">{fmtPeriod(r.periodStart, r.periodEnd)}</td>
                      <td className="text-slate-500">{r.payDate ? fmtDate(r.payDate) : 'TBA'}</td>
                      <td><span className={`badge ${cfg.cls}`}>{cfg.label}</span></td>
                      <td className="!text-right">{r.employees}</td>
                      <td className="!text-right">{money(r.totalSalary)}</td>
                      <td className="!text-right font-semibold text-indigo-600 dark:text-indigo-400">{money(r.totalNet)}</td>
                      <td className="!text-right">
                        <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-300 hover:underline whitespace-nowrap">
                          View <ArrowRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PayRunModal
        target={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
        onDelete={(run) => setConfirmDelete(run)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete pay run?"
        message={`"${confirmDelete?.name}" will be permanently removed.`}
      />
    </Page>
  );
}

function PayRunModal({ target, onClose, onSaved, onDelete }) {
  const run = target;
  const isNew = false;
  const locked = run?.status === 'locked';

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm(isNew ? EMPTY : {
      name: run.name, periodType: run.periodType || 'custom', periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate || '',
      status: run.status, employees: run.employees, totalSalary: run.totalSalary, totalNet: run.totalNet, notes: run.notes || '',
    });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const body = {
      ...form,
      employees:   form.employees === '' ? undefined : Number(form.employees),
      totalSalary: form.totalSalary === '' ? 0 : Number(form.totalSalary),
      totalNet:    form.totalNet === '' ? undefined : Number(form.totalNet),
    };
    setSaving(true);
    try {
      const { data } = isNew ? await payrollAPI.createPayRun(body) : await payrollAPI.updatePayRun(run._id, body);
      onSaved(data.data, isNew);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save pay run');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, props = {}) => (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-input" value={form[key]} disabled={locked} onChange={(e) => set(key, e.target.value)} {...props} />
    </div>
  );

  return (
    <Modal
      open={!!target} onClose={onClose} size="lg"
      title={isNew ? 'New Pay Run' : locked ? 'Pay Run (locked)' : 'Edit Pay Run'}
      footer={<>
        {!isNew && !locked && (
          <Button variant="danger" className="mr-auto" onClick={() => onDelete(run)}><Trash2 size={14} /> Delete</Button>
        )}
        <Button variant="outline" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</Button>
        {!locked && <Button variant="primary" loading={saving} onClick={submit}>{isNew ? 'Create Pay Run' : 'Save Changes'}</Button>}
      </>}
    >
      <div className="space-y-4 p-6">
        {locked && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-[12.5px]">
            <Lock size={14} /> This pay run is locked and can no longer be changed.
          </div>
        )}
        {field('Name', 'name', { placeholder: 'e.g. June 2026 Monthly' })}
        <div>
          <label className="form-label">Period Type</label>
          <select className="form-input" value={form.periodType} disabled={locked} onChange={(e) => set('periodType', e.target.value)}>
            {PERIOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {field('Period start', 'periodStart', { type: 'date' })}
          {field('Period end', 'periodEnd', { type: 'date', min: form.periodStart })}
          {field('Pay date (optional)', 'payDate', { type: 'date' })}
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={form.status} disabled={locked} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(STATUS).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
          {form.status === 'locked' && !locked && (
            <p className="text-[11.5px] text-amber-600 mt-1">Once locked, this pay run can't be edited or deleted.</p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {field('Employees', 'employees', { type: 'number', min: 0, placeholder: isNew ? 'Auto (staff count)' : '' })}
          {field('Total salary (₹)', 'totalSalary', { type: 'number', min: 0, step: '0.01' })}
          {field('Total net (₹)', 'totalNet', { type: 'number', min: 0, step: '0.01', placeholder: isNew ? 'Same as salary' : '' })}
        </div>
        <div>
          <label className="form-label">Notes</label>
          <textarea rows={2} className="form-input resize-none" value={form.notes} disabled={locked} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── "New Pay Run" page ─────────────────────────────────────────
function NewPayRunForm({ onCancel, onCreated }) {
  const [form, setForm] = useState({ name: '', periodType: 'monthly', periodStart: '', periodEnd: '', payDate: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    // Auto-fill the end date from the start date + period type; the user can still override it.
    if ((k === 'periodStart' || k === 'periodType') && next.periodType !== 'custom') {
      next.periodEnd = suggestEnd(next.periodType, next.periodStart);
    }
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.periodStart || !form.periodEnd) return toast.error('Start date and end date are required');
    if (form.periodEnd < form.periodStart) return toast.error('End date cannot be before the start date');
    setSaving(true);
    try {
      const { data } = await payrollAPI.createPayRun(form);
      onCreated(data.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create pay run');
    } finally {
      setSaving(false);
    }
  };

  const Req = () => <span className="text-red-500">*</span>;

  return (
    <Page>
      <div className="max-w-[520px] mx-auto">
      <h1 className="page-title mb-5">New Pay Run</h1>
      <form onSubmit={submit} className="card p-6 space-y-5">
        <div>
          <label className="form-label">Name <Req /></label>
          <input className="form-input" placeholder="e.g. June 2026 Monthly" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>

        <div>
          <label className="form-label">Period Type</label>
          <select className="form-input" value={form.periodType} onChange={(e) => set('periodType', e.target.value)}>
            {PERIOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Start Date <Req /></label>
            <input type="date" className="form-input" value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
          </div>
          <div>
            <label className="form-label">End Date <Req /></label>
            <input type="date" className="form-input" value={form.periodEnd} min={form.periodStart || undefined} onChange={(e) => set('periodEnd', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="form-label">Pay Date <span className="text-slate-400 font-normal">(optional)</span></label>
          <input type="date" className="form-input" value={form.payDate} onChange={(e) => set('payDate', e.target.value)} />
          <p className="text-[11px] text-slate-400 mt-1">Leave blank to show as <span className="font-semibold">TBA</span> until confirmed.</p>
        </div>

        <div>
          <label className="form-label">Notes</label>
          <textarea rows={3} className="form-input resize-none" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        <div className="flex items-center gap-4 pt-1">
          <Button variant="primary" type="submit" loading={saving}>Create Pay Run</Button>
          <button type="button" onClick={onCancel} className="text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:underline">Cancel</button>
        </div>
      </form>
      </div>
    </Page>
  );
}
