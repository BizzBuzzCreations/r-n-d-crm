'use strict';
const Leave  = require('../models/Leave');
const PayRun = require('../models/PayRun');
const User   = require('../models/User');
const fs     = require('fs');
const notifService = require('../services/notificationService');

const isManager = (user) => ['admin', 'manager'].includes(user.role);
// Only the manager role may approve / reject leave. Admins are notified and can
// view every request, but the decision is the manager's.
const canDecideLeave = (user) => user.role === 'manager';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (res, code, message) => res.status(code).json({ success: false, message });

// ══════════════════════════════ LEAVES ══════════════════════════════
const EMPLOYEE_FIELDS = 'name email avatar color initials position';

// Working days between two YYYY-MM-DD dates (inclusive). Office off-days are
// Saturday and Sunday. A half-day start/end removes 0.5 from that day; a
// single-day request is 0.5 if either breakdown is half, otherwise 1.
const isWorkday = (d) => { const w = d.getUTCDay(); return w !== 0 && w !== 6; };
const countLeaveDays = (from, to, startBreakdown, endBreakdown) => {
  const start = new Date(from), end = new Date(to);
  if (from === to) return isWorkday(start) ? (startBreakdown === 'half' || endBreakdown === 'half' ? 0.5 : 1) : 0;
  let days = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (isWorkday(d)) days += 1;
  if (isWorkday(start) && startBreakdown === 'half') days -= 0.5;
  if (isWorkday(end) && endBreakdown === 'half') days -= 0.5;
  return days;
};

// @GET /api/payroll/leaves — admin/manager see everyone; everyone else only their own.
exports.getLeaves = async (req, res, next) => {
  try {
    const { status, type, search } = req.query;
    const filter = {};
    if (!isManager(req.user)) filter.employee = req.user._id;
    if (status && status !== 'all') filter.status = status;
    if (type && type !== 'all') filter.type = type;

    let leaves = await Leave.find(filter)
      .populate('employee', EMPLOYEE_FIELDS)
      .populate('actionedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    if (search?.trim() && isManager(req.user)) {
      const q = search.trim().toLowerCase();
      leaves = leaves.filter((l) => l.employee?.name?.toLowerCase().includes(q));
    }
    res.json({ success: true, data: leaves });
  } catch (err) { next(err); }
};

// @POST /api/payroll/leaves — multipart/form-data:
//   type, from, to, startBreakdown, endBreakdown, reason, employee?, attachment? (file)
// `employee` (filing on someone else's behalf) is honoured for admin/manager only.
exports.createLeave = async (req, res, next) => {
  const discardUpload = () => { if (req.file) fs.promises.unlink(req.file.path).catch(() => {}); };
  try {
    const { type, from, to, reason, employee } = req.body;
    const startBreakdown = req.body.startBreakdown === 'half' ? 'half' : 'full';
    const endBreakdown   = req.body.endBreakdown === 'half' ? 'half' : 'full';
    const bad = (code, msg) => { discardUpload(); return fail(res, code, msg); };

    if (!Leave.TYPES.includes(type)) return bad(400, 'Please choose a leave type');
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return bad(400, 'Start date and end date are required');
    if (to < from) return bad(400, 'End date cannot be before the start date');
    if (!reason?.trim()) return bad(400, 'Description is required');
    const days = countLeaveDays(from, to, startBreakdown, endBreakdown);
    if (days <= 0) return bad(400, 'The selected dates contain no working days (weekends are office off-days)');

    let employeeId = req.user._id;
    if (employee && String(employee) !== String(req.user._id)) {
      if (!isManager(req.user)) return bad(403, 'You can only request leave for yourself');
      const target = await User.findById(employee).select('_id');
      if (!target) return bad(404, 'Employee not found');
      employeeId = target._id;
    }

    const leave = await Leave.create({
      employee: employeeId, type, from, to,
      startBreakdown, endBreakdown, days,
      reason: reason.trim(),
      attachment: req.file ? { url: `/uploads/leaves/${req.file.filename}`, name: req.file.originalname } : undefined,
    });
    const populated = await Leave.findById(leave._id).populate('employee', EMPLOYEE_FIELDS).lean();
    res.status(201).json({ success: true, data: populated });

    // Tell every admin and manager (except the requester) a request is waiting.
    // Fire-and-forget: dispatch never throws, and the response is already sent.
    try {
      const approvers = await User.find({ role: { $in: ['admin', 'manager'] }, _id: { $ne: req.user._id } }).select('_id');
      const who = populated.employee?.name || 'An employee';
      const range = from === to ? from : `${from} → ${to}`;
      const io = req.app.get('io');
      await Promise.all(approvers.map((u) => notifService.dispatch(io, {
        recipient: u._id, sender: req.user._id,
        type: 'leave_requested', priority: 'info',
        title: 'New leave request',
        message: `${who} requested ${days} day${days === 1 ? '' : 's'} of ${type} leave (${range}).`,
        link: '/payroll/leaves',
      })));
    } catch (e) { console.error('[Payroll] leave notification failed:', e.message); }
  } catch (err) { discardUpload(); next(err); }
};

// @PUT /api/payroll/leaves/:id/status — admin/manager. body: { status: approved|rejected, remarks }
exports.updateLeaveStatus = async (req, res, next) => {
  try {
    if (!canDecideLeave(req.user)) return fail(res, 403, 'Only a manager can approve or reject leave requests');
    const { status, remarks } = req.body;
    if (!['approved', 'rejected'].includes(status)) return fail(res, 400, 'Status must be approved or rejected');

    const leave = await Leave.findById(req.params.id);
    if (!leave) return fail(res, 404, 'Leave request not found');
    if (String(leave.employee) === String(req.user._id)) return fail(res, 403, 'You cannot approve or reject your own leave request');
    leave.status = status;
    leave.remarks = remarks || '';
    leave.actionedBy = req.user._id;
    leave.actionedAt = new Date();
    await leave.save();

    const populated = await Leave.findById(leave._id).populate('employee', EMPLOYEE_FIELDS).populate('actionedBy', 'name').lean();
    res.json({ success: true, data: populated });

    // Let the employee know the outcome.
    const approved = status === 'approved';
    notifService.dispatch(req.app.get('io'), {
      recipient: leave.employee, sender: req.user._id,
      type: approved ? 'leave_approved' : 'leave_rejected',
      priority: approved ? 'success' : 'warning',
      title: approved ? 'Leave approved' : 'Leave rejected',
      message: `${req.user.name} ${approved ? 'approved' : 'rejected'} your ${leave.type} leave (${leave.from === leave.to ? leave.from : `${leave.from} → ${leave.to}`}).${leave.remarks ? ` Remarks: ${leave.remarks}` : ''}`,
      link: '/payroll/leaves',
    });
  } catch (err) { next(err); }
};

// @DELETE /api/payroll/leaves/:id — an employee may withdraw their own *pending* request;
// admin/manager may delete any.
exports.deleteLeave = async (req, res, next) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return fail(res, 404, 'Leave request not found');
    if (!isManager(req.user)) {
      if (String(leave.employee) !== String(req.user._id)) return fail(res, 403, 'Not your leave request');
      if (leave.status !== 'pending') return fail(res, 400, 'Only pending requests can be withdrawn');
    }
    await leave.deleteOne();
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ══════════════════════════════ PAY RUNS ══════════════════════════════
const PAYRUN_FIELDS = ['name', 'periodType', 'periodStart', 'periodEnd', 'payDate', 'status', 'employees', 'totalSalary', 'totalNet', 'notes'];

const pickPayRun = (body) => {
  const out = {};
  for (const k of PAYRUN_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  for (const k of ['employees', 'totalSalary', 'totalNet']) if (out[k] !== undefined) out[k] = Number(out[k]);
  return out;
};

const validatePayRun = (d) => {
  if (!d.name?.trim()) return 'Name is required';
  if (!DATE_RE.test(d.periodStart || '') || !DATE_RE.test(d.periodEnd || '')) return 'Valid period start and end dates are required';
  if (d.periodEnd < d.periodStart) return 'Period end cannot be before the period start';
  if (d.payDate && !DATE_RE.test(d.payDate)) return 'Invalid pay date';
  if (d.periodType !== undefined && !['monthly', 'weekly', 'biweekly', 'custom'].includes(d.periodType)) return 'Invalid period type';
  if (d.status !== undefined && !['draft', 'under_review', 'approved', 'locked'].includes(d.status)) return 'Invalid status';
  for (const k of ['employees', 'totalSalary', 'totalNet']) {
    if (d[k] !== undefined && (!Number.isFinite(d[k]) || d[k] < 0)) return `${k} must be a non-negative number`;
  }
  return null;
};

// @GET /api/payroll/pay-runs
exports.getPayRuns = async (_req, res, next) => {
  try {
    const runs = await PayRun.find({}).sort({ periodStart: -1, createdAt: -1 }).lean();
    res.json({ success: true, data: runs });
  } catch (err) { next(err); }
};

// @POST /api/payroll/pay-runs — `employees` defaults to the current staff headcount.
exports.createPayRun = async (req, res, next) => {
  try {
    const data = pickPayRun(req.body);
    const err = validatePayRun(data);
    if (err) return fail(res, 400, err);
    if (data.employees === undefined) {
      data.employees = await User.countDocuments({ role: { $nin: ['client'] } });
    }
    if (data.totalNet === undefined) data.totalNet = data.totalSalary || 0;
    const run = await PayRun.create({ ...data, name: data.name.trim(), createdBy: req.user._id });
    res.status(201).json({ success: true, data: run });
  } catch (err) { next(err); }
};

// @PUT /api/payroll/pay-runs/:id — locked runs are immutable.
exports.updatePayRun = async (req, res, next) => {
  try {
    const run = await PayRun.findById(req.params.id);
    if (!run) return fail(res, 404, 'Pay run not found');
    if (run.status === 'locked') return fail(res, 400, 'This pay run is locked and cannot be changed');

    const data = pickPayRun(req.body);
    const err = validatePayRun({ ...run.toObject(), ...data });
    if (err) return fail(res, 400, err);
    if (data.name !== undefined) data.name = data.name.trim();
    run.set(data);
    await run.save();
    res.json({ success: true, data: run });
  } catch (err) { next(err); }
};

// @DELETE /api/payroll/pay-runs/:id — locked runs can't be deleted.
exports.deletePayRun = async (req, res, next) => {
  try {
    const run = await PayRun.findById(req.params.id);
    if (!run) return fail(res, 404, 'Pay run not found');
    if (run.status === 'locked') return fail(res, 400, 'This pay run is locked and cannot be deleted');
    await run.deleteOne();
    res.json({ success: true });
  } catch (err) { next(err); }
};
