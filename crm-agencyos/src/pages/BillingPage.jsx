import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Plus, Search, Download, X, ChevronDown, ChevronRight,
  FileText, DollarSign, AlertTriangle, CheckCircle, Clock,
  Trash2, CreditCard, Send, Edit2, Eye, RefreshCw, TrendingUp,
  Users, IndianRupee,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { billingAPI, clientsAPI } from '../services/api';
import useAppStore from '../store/useAppStore';
import {
  Page, Button, Badge, Modal, Input, Textarea, Select,
  ConfirmDialog, EmptyState, Skeleton, Tabs,
} from '../components/ui';
import { cn, fmtDate, canManage, localDateStr } from '../utils/helpers';

// ── Constants ──────────────────────────────────────────────────
const STATUS_CFG = {
  draft:          { label: 'Draft',          color: 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-500/30' },
  sent:           { label: 'Sent',           color: 'bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-100 dark:border-blue-500/30' },
  partially_paid: { label: 'Partial',        color: 'bg-amber-50 dark:bg-amber-500/20 text-amber-705 dark:text-amber-300 border-amber-100 dark:border-amber-500/30' },
  paid:           { label: 'Paid',           color: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30' },
  overdue:        { label: 'Overdue',        color: 'bg-red-50 dark:bg-red-500/20 text-red-650 dark:text-red-300 border-red-100 dark:border-red-500/30' },
  cancelled:      { label: 'Cancelled',      color: 'bg-slate-100 dark:bg-slate-600/20 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600/30' },
};

const RISK_CFG = {
  Low:      { color: 'text-emerald-650 dark:text-emerald-450', bg: 'bg-emerald-50 dark:bg-emerald-500/10', bar: '#10b981' },
  Medium:   { color: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-500/10',   bar: '#f59e0b' },
  High:     { color: 'text-orange-655 dark:text-orange-400',  bg: 'bg-orange-50 dark:bg-orange-500/10',  bar: '#f97316' },
  Critical: { color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10',     bar: '#ef4444' },
};

const BUCKET_CFG = [
  { key: 'current',   label: 'Current',   color: '#10b981' },
  { key: '1_30',      label: '1-30 days', color: '#f59e0b' },
  { key: '31_60',     label: '31-60 d',   color: '#f97316' },
  { key: '61_90',     label: '61-90 d',   color: '#ef4444' },
  { key: '90plus',    label: '90+ days',  color: '#dc2626' },
];

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'upi',           label: 'UPI' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'card',          label: 'Card' },
  { value: 'other',         label: 'Other' },
];

const IMAGE_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.bmp'];
const isImage = (name = '') => IMAGE_EXTS.some(e => name.toLowerCase().endsWith(e));
const isPdf   = (name = '') => name.toLowerCase().endsWith('.pdf');

const fmt = (n, cur = 'INR') => {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n || 0);
};

const fmtShort = (n) => {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)    return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n || 0}`;
};

const today = () => localDateStr();
const futureDays = (d) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return localDateStr(dt);
};

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.draft;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border shadow-sm', cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ── Empty line item ────────────────────────────────────────────
const emptyItem = () => ({ description: '', quantity: 1, rate: 0, amount: 0 });

// ── Line Items Editor ──────────────────────────────────────────
function LineItemsEditor({ items, onChange }) {
  const update = (idx, field, val) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: val };
      if (field === 'quantity' || field === 'rate') {
        updated.amount = Number(updated.quantity || 0) * Number(updated.rate || 0);
      }
      return updated;
    });
    onChange(next);
  };

  const add    = () => onChange([...items, emptyItem()]);
  const remove = (idx) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
        <span>Description</span><span className="text-center">Qty</span><span className="text-right">Rate (₹)</span><span className="text-right">Amount</span><span />
      </div>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-center">
          <input
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 transition-colors placeholder-slate-400"
            placeholder="Description"
            value={it.description}
            onChange={(e) => update(idx, 'description', e.target.value)}
          />
          <input
            type="number" min="1"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 text-center transition-colors"
            value={it.quantity}
            onChange={(e) => update(idx, 'quantity', Number(e.target.value))}
          />
          <input
            type="number" min="0"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 text-right transition-colors"
            value={it.rate}
            onChange={(e) => update(idx, 'rate', Number(e.target.value))}
          />
          <div className="text-right text-[13px] text-slate-700 dark:text-slate-350 font-mono pr-1">
            {fmt(it.amount)}
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={items.length === 1}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700/60 disabled:opacity-30 transition-all"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 mt-1 transition-colors"
      >
        <Plus size={14} /> Add line item
      </button>
    </div>
  );
}

// ── Invoice Totals preview ─────────────────────────────────────
function TotalsPreview({ items, taxRate, discount }) {
  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
  const taxAmt   = (subtotal * (Number(taxRate) || 0)) / 100;
  const total    = subtotal + taxAmt - (Number(discount) || 0);
  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 space-y-2 text-[13px]">
      <div className="flex justify-between text-slate-500 dark:text-slate-400"><span>Subtotal</span><span className="font-mono font-medium text-slate-700 dark:text-slate-300">{fmt(subtotal)}</span></div>
      {taxRate > 0 && <div className="flex justify-between text-slate-500 dark:text-slate-400"><span>GST ({taxRate}%)</span><span className="font-mono font-medium text-slate-700 dark:text-slate-300">{fmt(taxAmt)}</span></div>}
      {discount > 0 && <div className="flex justify-between text-slate-500 dark:text-slate-400"><span>Discount</span><span className="font-mono text-red-500 dark:text-red-450">-{fmt(discount)}</span></div>}
      <div className="flex justify-between text-slate-900 dark:text-white font-bold border-t border-slate-200 dark:border-slate-700 pt-2.5 mt-1"><span>Total</span><span className="font-mono text-indigo-600 dark:text-indigo-400">{fmt(total)}</span></div>
    </div>
  );
}

// ── Create / Edit Invoice Modal ────────────────────────────────
function InvoiceFormModal({ open, onClose, onSaved, clients, editData }) {
  const isEdit = Boolean(editData);
  const [clientId,  setClientId]  = useState('');
  const [title,     setTitle]     = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate,   setDueDate]   = useState(futureDays(30));
  const [items,     setItems]     = useState([emptyItem()]);
  const [taxRate,   setTaxRate]   = useState(18);
  const [discount,  setDiscount]  = useState(0);
  const [notes,     setNotes]     = useState('');
  const [terms,     setTerms]     = useState('Payment due within 30 days.');
  const [currency,  setCurrency]  = useState('INR');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editData) {
      setClientId(editData.clientId?._id || editData.clientId || '');
      setTitle(editData.title || '');
      setIssueDate(editData.issueDate?.split('T')[0] || today());
      setDueDate(editData.dueDate?.split('T')[0] || futureDays(30));
      setItems(editData.lineItems?.length ? editData.lineItems.map(li => ({ ...li })) : [emptyItem()]);
      setTaxRate(editData.taxRate ?? 18);
      setDiscount(editData.discount ?? 0);
      setNotes(editData.notes || '');
      setTerms(editData.terms || 'Payment due within 30 days.');
      setCurrency(editData.currency || 'INR');
    } else {
      setClientId(''); setTitle(''); setIssueDate(today()); setDueDate(futureDays(30));
      setItems([emptyItem()]); setTaxRate(18); setDiscount(0);
      setNotes(''); setTerms('Payment due within 30 days.'); setCurrency('INR');
    }
  }, [open, editData]);

  const handleSave = async () => {
    if (!clientId) return toast.error('Select a client');
    if (!title.trim()) return toast.error('Enter invoice title');
    if (items.some(it => !it.description.trim())) return toast.error('Fill all line item descriptions');
    setSaving(true);
    try {
      const body = { clientId, title, issueDate, dueDate, lineItems: items, taxRate: Number(taxRate), discount: Number(discount), notes, terms, currency };
      if (isEdit) {
        await billingAPI.updateInvoice(editData._id, body);
        toast.success('Invoice updated');
      } else {
        await billingAPI.createInvoice(body);
        toast.success('Invoice created');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Invoice' : 'New Invoice'} size="xl"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Update Invoice' : 'Create Invoice'}</Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        {/* Row 1: Client + Currency */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label mb-1.5">Client *</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition-colors"
            >
              <option value="">Select client…</option>
              {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label mb-1.5">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition-colors"
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
        </div>

        {/* Title */}
        <Input label="Invoice Title *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website Design - June 2025" />

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Issue Date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          <Input label="Due Date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        {/* Line Items */}
        <div>
          <label className="form-label mb-2">Line Items</label>
          <LineItemsEditor items={items} onChange={setItems} />
        </div>

        {/* Tax + Discount */}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Tax Rate (%)" type="number" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="18" />
          <Input label="Discount (₹)" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </div>

        {/* Totals preview */}
        <TotalsPreview items={items} taxRate={taxRate} discount={discount} />

        {/* Notes + Terms */}
        <div className="grid grid-cols-2 gap-4">
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Thank you for your business!" />
          <Textarea label="Terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} placeholder="Payment terms…" />
        </div>
      </div>
    </Modal>
  );
}

// ── Attachment Viewer ──────────────────────────────────────────
function AttachmentView({ attachmentUrl, attachmentName }) {
  if (!attachmentUrl || !attachmentName) return null;
  const url = billingAPI.attachmentUrl(attachmentUrl);
  return (
    <div className="mt-3 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
        <span className="text-[12px] text-slate-600 dark:text-slate-300 font-medium truncate flex-1 mr-2">{attachmentName}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" download={attachmentName}
          className="flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 flex-shrink-0">
          <Download size={12} /> Download
        </a>
      </div>
      {isImage(attachmentName) ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={attachmentName} className="w-full max-h-56 object-contain bg-slate-100 dark:bg-slate-900" />
        </a>
      ) : isPdf(attachmentName) ? (
        <div className="p-4 text-center">
          <FileText size={32} className="mx-auto text-red-400 mb-2" />
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
            Open PDF in new tab
          </a>
        </div>
      ) : (
        <div className="p-4 text-center">
          <FileText size={32} className="mx-auto text-slate-400 mb-2" />
          <a href={url} target="_blank" rel="noopener noreferrer" download={attachmentName}
            className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
            Download {attachmentName}
          </a>
        </div>
      )}
    </div>
  );
}

// ── Record Payment Modal ───────────────────────────────────────
function PaymentModal({ open, onClose, invoiceId, balanceDue, onSaved }) {
  const [amount,    setAmount]    = useState('');
  const [date,      setDate]      = useState(today());
  const [method,    setMethod]    = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes,     setNotes]     = useState('');
  const [file,      setFile]      = useState(null);
  const [saving,    setSaving]    = useState(false);
  const fileRef = React.useRef(null);

  useEffect(() => {
    if (open) {
      setAmount(balanceDue || ''); setDate(today()); setMethod('bank_transfer');
      setReference(''); setNotes(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open, balanceDue]);

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error('Enter a valid amount');
    setSaving(true);
    try {
      let body;
      if (file) {
        body = new FormData();
        body.append('amount', amt);
        body.append('paymentDate', date);
        body.append('method', method);
        body.append('reference', reference);
        body.append('notes', notes);
        body.append('attachment', file);
      } else {
        body = { amount: amt, paymentDate: date, method, reference, notes };
      }
      await billingAPI.recordPayment(invoiceId, body);
      toast.success('Payment recorded');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Payment" size="sm"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <Input label={`Amount (₹) * (Max: ${balanceDue || 0})`} type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        <Input label="Payment Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div>
          <label className="form-label mb-1.5">Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 transition-colors">
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <Input label="Reference / UTR" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID, cheque no…" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes" />
        {/* Proof attachment */}
        <div>
          <label className="form-label mb-1.5">Proof / Receipt (optional)</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
          >
            <CreditCard size={16} className="text-slate-400 flex-shrink-0" />
            <span className="text-[12.5px] text-slate-500 dark:text-slate-400 flex-1 truncate">
              {file ? file.name : 'Click to attach receipt, screenshot, or document…'}
            </span>
            {file && (
              <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="text-slate-400 hover:text-red-400 flex-shrink-0">
                <X size={13} />
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Payment Detail / Edit Modal ────────────────────────────────
function PaymentDetailModal({ open, onClose, payment, onRefresh }) {
  const [editing,   setEditing]   = useState(false);
  const [amount,    setAmount]    = useState('');
  const [date,      setDate]      = useState('');
  const [method,    setMethod]    = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes,     setNotes]     = useState('');
  const [file,      setFile]      = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [confirmDel,setConfirmDel]= useState(false);
  const fileRef = React.useRef(null);

  useEffect(() => {
    if (open && payment) {
      setEditing(false);
      setAmount(payment.amount || '');
      setDate(payment.paymentDate || today());
      setMethod(payment.method || 'bank_transfer');
      setReference(payment.reference || '');
      setNotes(payment.notes || '');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open, payment]);

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error('Enter a valid amount');
    setSaving(true);
    try {
      let body;
      if (file) {
        body = new FormData();
        body.append('amount', amt);
        body.append('paymentDate', date);
        body.append('method', method);
        body.append('reference', reference);
        body.append('notes', notes);
        body.append('attachment', file);
      } else {
        body = { amount: amt, paymentDate: date, method, reference, notes };
      }
      await billingAPI.updatePayment(payment._id, body);
      toast.success('Payment updated');
      onRefresh();
      setEditing(false);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update payment');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await billingAPI.deletePayment(payment._id);
      toast.success('Payment deleted');
      onRefresh();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to delete payment');
    } finally {
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  if (!payment) return null;

  const methodLabel = PAYMENT_METHODS.find(m => m.value === payment.method)?.label || payment.method;

  return (
    <>
      <Modal
        open={open && !confirmDel}
        onClose={() => { setEditing(false); onClose(); }}
        title={editing ? 'Edit Payment' : 'Payment Details'}
        size="sm"
        footer={
          editing ? (
            <div className="flex justify-between items-center">
              <button onClick={() => { setConfirmDel(true); }}
                className="text-[12.5px] text-red-500 hover:text-red-600 font-semibold flex items-center gap-1">
                <Trash2 size={13} /> Delete
              </button>
              <div className="flex gap-2.5">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <button onClick={() => setConfirmDel(true)}
                className="text-[12.5px] text-red-500 hover:text-red-600 font-semibold flex items-center gap-1">
                <Trash2 size={13} /> Delete
              </button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit2 size={13} /> Edit
              </Button>
            </div>
          )
        }
      >
        <div className="px-6 py-5 space-y-4">
          {editing ? (
            <>
              <Input label="Amount (₹) *" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Input label="Payment Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <div>
                <label className="form-label mb-1.5">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 transition-colors">
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <Input label="Reference / UTR" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID…" />
              <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              <div>
                <label className="form-label mb-1.5">Replace Attachment (optional)</label>
                <div onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 cursor-pointer hover:border-indigo-400 transition-colors">
                  <CreditCard size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="text-[12.5px] text-slate-500 flex-1 truncate">
                    {file ? file.name : payment.attachmentName ? `Current: ${payment.attachmentName}` : 'Attach new file…'}
                  </span>
                  {file && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                      <X size={13} className="text-slate-400 hover:text-red-400" />
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </>
          ) : (
            <>
              {/* Read-only view */}
              <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-4 text-center border border-slate-200 dark:border-slate-700/50">
                <div className="text-[28px] font-bold font-mono text-emerald-600 dark:text-emerald-400">{fmt(payment.amount)}</div>
                <div className="text-[12px] text-slate-500 mt-1">{fmtDate(payment.paymentDate)}</div>
              </div>
              <div className="space-y-2.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Method</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{methodLabel}</span>
                </div>
                {payment.reference && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reference / UTR</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{payment.reference}</span>
                  </div>
                )}
                {payment.recordedBy?.name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Recorded by</span>
                    <span className="text-slate-700 dark:text-slate-300">{payment.recordedBy.name}</span>
                  </div>
                )}
                {payment.notes && (
                  <div className="pt-1 border-t border-slate-150 dark:border-slate-800">
                    <div className="text-slate-500 mb-1">Notes</div>
                    <div className="text-slate-700 dark:text-slate-300 text-[12.5px] leading-relaxed">{payment.notes}</div>
                  </div>
                )}
              </div>
              {/* Attachment */}
              {payment.attachmentUrl && (
                <AttachmentView attachmentUrl={payment.attachmentUrl} attachmentName={payment.attachmentName} />
              )}
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={handleDelete}
        title="Delete Payment"
        message={`Delete this ${fmt(payment?.amount)} payment? This will recalculate the invoice balance.`}
        confirmLabel="Delete"
      />
    </>
  );
}

// ── Invoice Detail Drawer ──────────────────────────────────────
function InvoiceDrawer({ invoice, open, onClose, onRefresh, clients }) {
  const authUser = useAppStore((s) => s.authUser);
  const [payments,        setPayments]        = useState([]);
  const [loadingPay,      setLoadingPay]      = useState(false);
  const [showPayModal,    setShowPayModal]     = useState(false);
  const [showEditModal,   setShowEditModal]    = useState(false);
  const [deleteConfirm,   setDeleteConfirm]    = useState(false);
  const [changingStatus,  setChangingStatus]   = useState(false);
  const [viewPayment,     setViewPayment]      = useState(null);
  const [showPayDetail,   setShowPayDetail]    = useState(false);

  const loadPayments = useCallback(async () => {
    if (!invoice) return;
    setLoadingPay(true);
    try {
      const r = await billingAPI.getPayments(invoice._id);
      setPayments(r.data.data || []);
    } catch {}
    setLoadingPay(false);
  }, [invoice]);

  useEffect(() => {
    if (open && invoice) loadPayments();
  }, [open, invoice, loadPayments]);

  const handleStatusChange = async (newStatus) => {
    if (!invoice) return;
    setChangingStatus(true);
    try {
      await billingAPI.updateInvoice(invoice._id, { status: newStatus });
      toast.success(`Status → ${STATUS_CFG[newStatus]?.label}`);
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update status');
    } finally {
      setChangingStatus(false);
    }
  };

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    try {
      await billingAPI.deleteInvoice(invoice._id);
      toast.success('Invoice deleted');
      onClose();
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to delete invoice');
    }
  };

  if (!invoice) return null;

  const clientName = invoice.clientId?.name || clients.find(c => c._id === invoice.clientId)?.name || 'Client';

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={onClose}
            />
            {/* Drawer */}
            <motion.div
              className="fixed right-0 top-0 h-full w-[520px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 flex flex-col overflow-hidden shadow-2xl"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-400 text-[12px] font-mono font-semibold">#{invoice.invoiceNumber}</span>
                    <StatusPill status={invoice.status} />
                  </div>
                  <h2 className="text-slate-900 dark:text-white font-bold text-[16px] mt-1.5 truncate max-w-[280px]">{invoice.title}</h2>
                  <div className="text-slate-600 dark:text-slate-400 text-[12.5px] mt-0.5">{clientName}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.open(billingAPI.pdfUrl(invoice._id) + '?token=' + localStorage.getItem('crm_access_token'), '_blank')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-lg text-[12px] font-semibold transition-colors"
                    title="Download PDF"
                  >
                    <Download size={13} /> PDF
                  </button>
                  <button
                    onClick={() => setShowEditModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-lg text-[12px] font-semibold transition-colors"
                  >
                    <Edit2 size={13} /> Edit
                  </button>
                  <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {/* Key figures */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total',   val: fmt(invoice.total),      color: 'text-slate-900 dark:text-white' },
                    { label: 'Paid',    val: fmt(invoice.paidAmount),  color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Balance', val: fmt(invoice.balanceDue),  color: invoice.balanceDue > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-slate-400' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800/50 rounded-xl p-3.5 text-center shadow-sm">
                      <div className="text-slate-500 dark:text-slate-450 text-[11px] font-bold uppercase tracking-wider mb-1">{label}</div>
                      <div className={cn('font-mono font-bold text-[14.5px]', color)}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Dates */}
                <div className="flex gap-6 text-[12.5px] bg-slate-50 dark:bg-slate-800/20 border border-slate-150 dark:border-slate-850 rounded-xl px-4 py-3">
                  <div><span className="text-slate-500 dark:text-slate-450 font-medium">Issued: </span><span className="text-slate-800 dark:text-slate-200 font-semibold">{fmtDate(invoice.issueDate)}</span></div>
                  <div><span className="text-slate-500 dark:text-slate-450 font-medium">Due: </span><span className="text-slate-800 dark:text-slate-200 font-semibold">{fmtDate(invoice.dueDate)}</span></div>
                </div>

                {/* Status change */}
                <div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-450 mb-2 font-bold uppercase tracking-wider">Change Status</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(STATUS_CFG).map(([s, cfg]) => (
                      <button
                        key={s}
                        disabled={invoice.status === s || changingStatus}
                        onClick={() => handleStatusChange(s)}
                        className={cn(
                          'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all',
                          invoice.status === s
                            ? cn(cfg.color, 'cursor-default opacity-100 shadow-sm')
                            : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-850 dark:hover:text-slate-300 hover:border-slate-350 dark:hover:border-slate-700 bg-white dark:bg-transparent shadow-sm'
                        )}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-450 mb-2.5 font-bold uppercase tracking-wider">Line Items</div>
                  <div className="space-y-2">
                    {invoice.lineItems?.map((li, i) => (
                      <div key={i} className="flex items-center justify-between text-[13px] bg-slate-50/50 dark:bg-slate-850/20 border border-slate-150 dark:border-slate-800/40 rounded-xl px-4 py-3">
                        <div className="text-slate-800 dark:text-slate-300 font-medium flex-1">{li.description}</div>
                        <div className="text-slate-500 dark:text-slate-450 text-right ml-4 flex-shrink-0">
                          {li.quantity} × {fmt(li.rate)} = <span className="text-slate-905 dark:text-slate-205 font-semibold font-mono">{fmt(li.amount)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-3 mt-3 space-y-1.5 px-2">
                      <div className="flex justify-between text-[12.5px] text-slate-500 dark:text-slate-450"><span>Subtotal</span><span className="font-mono text-slate-700 dark:text-slate-300">{fmt(invoice.subtotal)}</span></div>
                      {invoice.taxRate > 0 && <div className="flex justify-between text-[12.5px] text-slate-500 dark:text-slate-450"><span>Tax ({invoice.taxRate}%)</span><span className="font-mono text-slate-700 dark:text-slate-300">{fmt(invoice.taxAmount)}</span></div>}
                      {invoice.discount > 0 && <div className="flex justify-between text-[12.5px] text-slate-500 dark:text-slate-450"><span>Discount</span><span className="font-mono text-red-500 dark:text-red-400 font-medium">-{fmt(invoice.discount)}</span></div>}
                      <div className="flex justify-between text-[13.5px] text-slate-900 dark:text-white font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1.5"><span>Total</span><span className="font-mono text-indigo-600 dark:text-indigo-400">{fmt(invoice.total)}</span></div>
                    </div>
                  </div>
                </div>

                {/* Payments */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-450 font-bold uppercase tracking-wider">Payments</div>
                    {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                      <button
                        onClick={() => setShowPayModal(true)}
                        className="flex items-center gap-1 text-[12px] font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                      >
                        <Plus size={13} /> Record Payment
                      </button>
                    )}
                  </div>
                  {loadingPay ? (
                    <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                  ) : payments.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 text-[13px] bg-slate-50 dark:bg-slate-800/30 border border-slate-150 dark:border-slate-850 rounded-xl px-4 py-3 text-center">No payments recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {payments.map((p) => (
                        <button
                          key={p._id}
                          type="button"
                          onClick={() => { setViewPayment(p); setShowPayDetail(true); }}
                          className="w-full flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all text-left group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13.5px] font-mono font-bold text-emerald-600 dark:text-emerald-400">{fmt(p.amount)}</span>
                              {p.attachmentUrl && (
                                <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-semibold">
                                  Proof
                                </span>
                              )}
                            </div>
                            <div className="text-[11.5px] text-slate-500 dark:text-slate-450 mt-0.5 truncate">
                              {fmtDate(p.paymentDate)} · {PAYMENT_METHODS.find(m => m.value === p.method)?.label || p.method}
                              {p.reference && ` · ${p.reference}`}
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 flex-shrink-0 ml-2 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes / Terms */}
                {(invoice.notes || invoice.terms) && (
                  <div className="space-y-4 bg-slate-50 dark:bg-slate-805/10 border border-slate-150 dark:border-slate-850/50 rounded-xl p-4">
                    {invoice.notes && (
                      <div>
                        <div className="text-[11.5px] text-slate-500 dark:text-slate-450 mb-1 font-bold uppercase tracking-wider">Notes</div>
                        <p className="text-[13px] text-slate-650 dark:text-slate-405 leading-relaxed">{invoice.notes}</p>
                      </div>
                    )}
                    {invoice.terms && (
                      <div>
                        <div className="text-[11.5px] text-slate-500 dark:text-slate-450 mb-1 font-bold uppercase tracking-wider">Terms</div>
                        <p className="text-[13px] text-slate-655 dark:text-slate-405 leading-relaxed">{invoice.terms}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Delete */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="flex items-center justify-center w-full gap-1.5 py-2.5 rounded-xl border border-red-200 dark:border-red-950/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 text-[13px] font-semibold transition-all"
                  >
                    <Trash2 size={13} /> Delete Invoice
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <PaymentModal
        open={showPayModal}
        onClose={() => setShowPayModal(false)}
        invoiceId={invoice?._id}
        balanceDue={invoice?.balanceDue}
        onSaved={() => { loadPayments(); onRefresh(); }}
      />

      <InvoiceFormModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSaved={() => { onRefresh(); setShowEditModal(false); }}
        clients={clients}
        editData={invoice}
      />

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteInvoice}
        title="Delete Invoice"
        message={`Delete invoice #${invoice?.invoiceNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      <PaymentDetailModal
        open={showPayDetail}
        onClose={() => { setShowPayDetail(false); setViewPayment(null); }}
        payment={viewPayment}
        onRefresh={() => { loadPayments(); onRefresh(); }}
      />
    </>
  );
}

// ── Invoices Tab ───────────────────────────────────────────────
function InvoicesTab({ clients }) {
  const [invoices,     setInvoices]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [activeInv,    setActiveInv]    = useState(null);
  const [drawerOpen,   setDrawerOpen]   = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterClient) params.clientId = filterClient;
      const r = await billingAPI.getInvoices(params);
      setInvoices(r.data.data || []);
    } catch { toast.error('Failed to load invoices'); }
    setLoading(false);
  }, [filterStatus, filterClient]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const displayed = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return invoices;
    return invoices.filter(inv =>
      String(inv.invoiceNumber).includes(q) ||
      inv.title?.toLowerCase().includes(q) ||
      inv.clientId?.name?.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const openDrawer = (inv) => { setActiveInv(inv); setDrawerOpen(true); };
  const closeDrawer = () => { setDrawerOpen(false); };

  const handleRefresh = async () => {
    await loadInvoices();
    if (activeInv && drawerOpen) {
      try {
        const r = await billingAPI.getInvoice(activeInv._id);
        setActiveInv(r.data.data);
      } catch {}
    }
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-[13px] text-slate-905 dark:text-white outline-none focus:border-indigo-500 transition-colors placeholder-slate-400 dark:placeholder-slate-500 shadow-sm"
            placeholder="Search invoices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-[13px] text-slate-905 dark:text-white outline-none focus:border-indigo-500 transition-colors shadow-sm cursor-pointer"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_CFG).map(([s, c]) => <option key={s} value={s}>{c.label}</option>)}
        </select>

        <select
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-[13px] text-slate-905 dark:text-white outline-none focus:border-indigo-500 transition-colors shadow-sm cursor-pointer"
        >
          <option value="">All clients</option>
          {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>

        <button onClick={loadInvoices} className="p-2 text-slate-400 hover:text-slate-650 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all" title="Refresh">
          <RefreshCw size={14} />
        </button>

        <Button onClick={() => setShowCreate(true)} className="ml-auto">
          <Plus size={14} /> New Invoice
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : displayed.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices found" description="Create your first invoice to get started." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/60 shadow-sm bg-white dark:bg-slate-900/20">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wide">
                {['#', 'Client', 'Title', 'Status', 'Issued', 'Due', 'Total', 'Balance', ''].map(h => (
                  <th key={h} className={cn('px-4 py-3 text-left', h === 'Total' || h === 'Balance' ? 'text-right' : '')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800/40">
              {displayed.map((inv) => (
                <tr
                  key={inv._id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-850/40 transition-colors cursor-pointer"
                  onClick={() => openDrawer(inv)}
                >
                  <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 text-[12px]">#{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">{inv.clientId?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-900 dark:text-white max-w-[200px] truncate">{inv.title}</td>
                  <td className="px-4 py-3"><StatusPill status={inv.status} /></td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[12px]">{fmtDate(inv.issueDate)}</td>
                  <td className={cn('px-4 py-3 text-[12px]', inv.status === 'overdue' ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-500 dark:text-slate-400')}>
                    {fmtDate(inv.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">{fmt(inv.total)}</td>
                  <td className={cn('px-4 py-3 text-right font-mono font-semibold', inv.balanceDue > 0 ? 'text-red-505 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-450')}>
                    {fmt(inv.balanceDue)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={14} className="text-slate-400 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={loadInvoices}
        clients={clients}
        editData={null}
      />

      <InvoiceDrawer
        invoice={activeInv}
        open={drawerOpen}
        onClose={closeDrawer}
        onRefresh={handleRefresh}
        clients={clients}
      />
    </>
  );
}

// ── Collections Tab ────────────────────────────────────────────
function CollectionsTab() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await billingAPI.getCollections();
      setData(r.data.data);
    } catch { toast.error('Failed to load collections data'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  if (!data) return null;

  const { summary, buckets, bucketAmounts, clientRisk } = data;

  const chartData = BUCKET_CFG.map(b => ({
    name: b.label,
    amount: bucketAmounts?.[b.key] || 0,
    count: buckets?.[b.key] || 0,
    color: b.color,
  }));

  const totalOverdue = (bucketAmounts?.['1_30'] || 0) + (bucketAmounts?.['31_60'] || 0) + (bucketAmounts?.['61_90'] || 0) + (bucketAmounts?.['90plus'] || 0);
  const criticalCount = (clientRisk || []).filter(cr => cr.riskLevel === 'High' || cr.riskLevel === 'Critical').length;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Outstanding', val: summary?.totalOutstanding,   icon: IndianRupee,   color: '#6366f1' },
          { label: 'Overdue Amount',    val: totalOverdue,                 icon: AlertTriangle, color: '#ef4444' },
          { label: 'Overdue Invoices',  val: summary?.overdueInvoices,     icon: Clock,         color: '#f59e0b', isCnt: true },
          { label: 'Clients at Risk',   val: criticalCount,                icon: Users,         color: '#f97316', isCnt: true },
        ].map(({ label, val, icon: Icon, color, isCnt }) => (
          <div key={label} className="bg-white dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-all duration-150">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '20' }}>
                <Icon size={14} style={{ color }} />
              </div>
              <span className="text-[12px] font-medium text-slate-550 dark:text-slate-400">{label}</span>
            </div>
            <div className="text-[22px] font-bold text-slate-900 dark:text-white leading-tight">{isCnt ? (val || 0) : fmtShort(val)}</div>
          </div>
        ))}
      </div>

      {/* Aging bar chart */}
      <div className="bg-white dark:bg-slate-800/40 rounded-xl p-5 border border-slate-200 dark:border-slate-700/40 shadow-sm">
        <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-250 mb-4">Invoice Aging Buckets</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barCategoryGap="35%">
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 12 }}
              formatter={(v, name) => [fmt(v), 'Amount']}
              labelFormatter={(label) => label}
            />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3 justify-center">
          {BUCKET_CFG.map((b) => (
            <div key={b.key} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-405">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />
              {b.label}: <span className="text-slate-800 dark:text-slate-300 font-mono ml-0.5">{buckets?.[b.key] || 0} inv</span>
            </div>
          ))}
        </div>
      </div>

      {/* Client risk table */}
      <div className="bg-white dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/40 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700/40">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-200">Client Risk Scores</h3>
        </div>
        {!clientRisk?.length ? (
          <div className="px-5 py-8 text-center text-slate-500 text-[13px]">No clients with overdue invoices</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800/40 text-slate-505 dark:text-slate-400 text-[11px] uppercase tracking-wide">
                  {['Client', 'Overdue Amount', 'Invoices', 'Days Overdue', 'Risk Score', 'Level'].map(h => (
                    <th key={h} className={cn('px-4 py-2.5 text-left', h === 'Overdue Amount' || h === 'Risk Score' ? 'text-right' : '')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-800/40">
                {clientRisk.map((cr) => {
                  const rCfg = RISK_CFG[cr.riskLevel] || RISK_CFG.Low;
                  return (
                    <tr key={cr.clientId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-semibold">{cr.clientName}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-500 dark:text-red-400 font-semibold">{fmt(cr.totalOverdue)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-center">{cr.overdueCount}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{cr.maxDaysOverdue}d</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${cr.riskScore}%`, background: rCfg.bar }} />
                          </div>
                          <span className="text-slate-700 dark:text-slate-350 font-mono text-[12px]">{cr.riskScore}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', rCfg.bg, rCfg.color)}>
                          {cr.riskLevel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Client Billing Modal / Form ────────────────────────────────
function ClientBillingModal({ open, onClose, client, onSaved }) {
  const [billingContact, setBillingContact] = useState('');
  const [billingEmail,   setBillingEmail]   = useState('');
  const [billingPhone,   setBillingPhone]   = useState('');
  const [gstNumber,      setGstNumber]      = useState('');
  const [currency,       setCurrency]       = useState('INR');
  const [paymentTerms,   setPaymentTerms]   = useState('Net 30');
  const [creditLimit,    setCreditLimit]    = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingNotes,   setBillingNotes]   = useState('');
  const [saving,         setSaving]         = useState(false);

  useEffect(() => {
    if (open && client) {
      const bp = client.billingProfile || {};
      setBillingContact(bp.billingContact || '');
      setBillingEmail(bp.billingEmail || '');
      setBillingPhone(bp.billingPhone || '');
      setGstNumber(bp.gstNumber || '');
      setCurrency(bp.currency || 'INR');
      setPaymentTerms(bp.paymentTerms || 'Net 30');
      setCreditLimit(bp.creditLimit || '');
      setBillingAddress(bp.billingAddress || '');
      setBillingNotes(bp.billingNotes || '');
    }
  }, [open, client]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await billingAPI.updateBillingProfile(client._id, {
        billingProfile: {
          billingContact,
          billingEmail,
          billingPhone,
          gstNumber,
          currency,
          paymentTerms,
          creditLimit: creditLimit ? Number(creditLimit) : 0,
          billingAddress,
          billingNotes,
        }
      });
      toast.success('Billing profile updated');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update billing profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Billing Profile: ${client?.name}`} size="lg"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        {/* Section: Billing Contact Info */}
        <div>
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500 mb-3">Billing Contact</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Contact Person"
              placeholder="e.g. Finance Officer"
              value={billingContact}
              onChange={(e) => setBillingContact(e.target.value)}
            />
            <Input
              label="Billing Email"
              type="email"
              placeholder="e.g. accounts@company.com"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
            <Input
              label="Billing Phone"
              placeholder="e.g. +91 9876543210"
              value={billingPhone}
              onChange={(e) => setBillingPhone(e.target.value)}
            />
          </div>
        </div>

        <hr className="border-slate-150 dark:border-slate-700/60" />

        {/* Section: Commercial & Tax Terms */}
        <div>
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500 mb-3">Commercials & Tax</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              label="GST Number / Tax ID"
              placeholder="e.g. 22AAAAA1111A1Z1"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
            />
            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </Select>
            <Select
              label="Payment Terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            >
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net 15">Net 15</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 45">Net 45</option>
              <option value="Net 60">Net 60</option>
            </Select>
            <Input
              label="Credit Limit"
              type="number"
              min="0"
              placeholder="e.g. 500000"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </div>
        </div>

        <hr className="border-slate-150 dark:border-slate-700/60" />

        {/* Section: Address and Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Textarea
            label="Billing Address"
            placeholder="Complete address for invoices..."
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            rows={3}
          />
          <Textarea
            label="Billing Notes"
            placeholder="Special billing instructions, PO requirements, etc."
            value={billingNotes}
            onChange={(e) => setBillingNotes(e.target.value)}
            rows={3}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Billing Profiles Tab ───────────────────────────────────────
function BillingProfilesTab({ clients, onRefresh }) {
  const [search, setSearch] = useState('');
  const [activeClient, setActiveClient] = useState(null);

  const displayed = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.billingProfile?.billingContact?.toLowerCase().includes(q) ||
      c.billingProfile?.gstNumber?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-[13px] text-slate-900 dark:text-white outline-none focus:border-indigo-500 transition-colors placeholder-slate-400 dark:placeholder-slate-500 shadow-sm"
            placeholder="Search clients or contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button onClick={onRefresh} className="p-2 text-slate-400 hover:text-slate-650 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Grid or Table */}
      {displayed.length === 0 ? (
        <EmptyState icon={Users} title="No clients found" description="No clients match your filter criteria." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/60 shadow-sm bg-white dark:bg-slate-900/20">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800/60 text-slate-505 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wide">
                {['Client', 'Billing Contact', 'GST Number', 'Currency', 'Payment Terms', 'Credit Limit', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800/40">
              {displayed.map((c) => {
                const bp = c.billingProfile || {};
                return (
                  <tr key={c._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                      <div className="text-slate-500 text-[12px]">{c.industry || 'No industry'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-850 dark:text-slate-200 font-medium">{bp.billingContact || '—'}</div>
                      {(bp.billingEmail || bp.billingPhone) && (
                        <div className="text-slate-500 dark:text-slate-450 text-[11.5px] mt-0.5">
                          {bp.billingEmail} {bp.billingEmail && bp.billingPhone && '·'} {bp.billingPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-350">{bp.gstNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">{bp.currency || 'INR'}</td>
                    <td className="px-4 py-3 text-slate-750 dark:text-slate-300">{bp.paymentTerms || 'Net 30'}</td>
                    <td className="px-4 py-3 font-mono text-slate-750 dark:text-slate-300">
                      {bp.creditLimit ? fmt(bp.creditLimit, bp.currency) : 'No limit'}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setActiveClient(c)}
                        className="flex items-center gap-1 text-[12px]"
                      >
                        <Edit2 size={11} /> Edit Profile
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeClient && (
        <ClientBillingModal
          open={!!activeClient}
          onClose={() => setActiveClient(null)}
          client={activeClient}
          onSaved={onRefresh}
        />
      )}
    </>
  );
}

// ── Main BillingPage ───────────────────────────────────────────
export default function BillingPage() {
  const [tab,     setTab]     = useState('invoices');
  const [clients, setClients] = useState([]);

  const loadClients = useCallback(() => {
    clientsAPI.getAll().then(r => setClients(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const TABS = [
    { value: 'invoices',    label: 'Invoices' },
    { value: 'collections', label: 'Collections' },
    { value: 'profiles',    label: 'Billing Profiles' },
  ];

  return (
    <Page>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Billing & Invoicing</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[13px] mt-0.5">Manage invoices, track payments, and monitor receivables</p>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'invoices'    && <InvoicesTab    clients={clients} />}
      {tab === 'collections' && <CollectionsTab />}
      {tab === 'profiles'    && <BillingProfilesTab clients={clients} onRefresh={loadClients} />}
    </Page>
  );
}
