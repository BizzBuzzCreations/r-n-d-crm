'use strict';

const { Invoice, Payment } = require('../models/Invoice');
const { Client }           = require('../models/index');
const audit                = require('../services/auditService');

// ── Currency formatter ─────────────────────────────────────────
const fmt = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Compute totals from lineItems + tax + discount ─────────────
function computeTotals(lineItems = [], taxRate = 0, discount = 0) {
  const items = lineItems.map((item) => ({
    ...item,
    amount: Math.round(Number(item.quantity || 1) * Number(item.rate || 0) * 100) / 100,
  }));
  const subtotal  = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount = Math.round(subtotal * (Number(taxRate) || 0) / 100 * 100) / 100;
  const total     = Math.round((subtotal + taxAmount - (Number(discount) || 0)) * 100) / 100;
  return { items, subtotal, taxAmount, total };
}

// ═══════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════

exports.getInvoices = async (req, res, next) => {
  try {
    const filter = { isDeleted: { $ne: true } };
    if (req.query.clientId) filter.clientId = req.query.clientId;
    if (req.query.status)   filter.status   = req.query.status;

    const invoices = await Invoice.find(filter)
      .populate('clientId', 'name email contact')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: invoices });
  } catch (err) { next(err); }
};

exports.getInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('clientId', 'name email contact phone address billingProfile')
      .populate('createdBy', 'name')
      .lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await Payment.find({ invoiceId: req.params.id })
      .populate('recordedBy', 'name')
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    res.json({ success: true, data: invoice, payments });
  } catch (err) { next(err); }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const body = { ...req.body };
    const { items, subtotal, taxAmount, total } = computeTotals(
      body.lineItems, body.taxRate, body.discount
    );
    body.lineItems  = items;
    body.subtotal   = subtotal;
    body.taxAmount  = taxAmount;
    body.total      = total;
    body.balanceDue = total;
    body.paidAmount = 0;
    body.createdBy  = req.user._id;

    const invoice = await Invoice.create(body);
    const populated = await Invoice.findById(invoice._id)
      .populate('clientId', 'name email contact')
      .populate('createdBy', 'name')
      .lean();

    audit.log(req, {
      action: 'create', category: 'billing',
      targetId: invoice._id, targetModel: 'Invoice',
      targetTitle: `INV-${invoice.invoiceNumber}`,
      metadata: { total: invoice.total, clientId: String(invoice.clientId) },
    });

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.updateInvoice = async (req, res, next) => {
  try {
    const existing = await Invoice.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Save snapshot to version history before mutating
    const snap = existing.toObject();
    delete snap.versions;
    existing.versions.push({ snapshot: snap, savedAt: new Date(), savedBy: req.user._id });

    // Whitelist what an edit may touch. `Object.assign(existing, req.body)`
    // below previously accepted the entire request body, so a caller could
    // set paidAmount/balanceDue (marking an invoice paid without any Payment
    // record), rewrite invoiceNumber, flip isDeleted, or overwrite the
    // versions[] audit trail. Money fields are derived from line items here
    // and from the Payment hooks in models/Invoice.js — never from input.
    const INVOICE_WRITABLE = ['clientId', 'lineItems', 'taxRate', 'discount', 'currency',
      'status', 'issueDate', 'dueDate', 'notes', 'terms', 'poNumber', 'title'];
    const body = INVOICE_WRITABLE.reduce((acc, k) => {
      if (req.body[k] !== undefined) acc[k] = req.body[k];
      return acc;
    }, {});

    // A tax-rate or discount-only edit changed neither the totals nor the
    // balance before, because recomputation was gated on lineItems alone.
    if (body.taxRate !== undefined || body.discount !== undefined) {
      body.lineItems = body.lineItems !== undefined ? body.lineItems : existing.lineItems;
    }

    // Recompute totals if lineItems changed
    if (body.lineItems !== undefined) {
      const taxRate  = body.taxRate  !== undefined ? body.taxRate  : existing.taxRate;
      const discount = body.discount !== undefined ? body.discount : existing.discount;
      const { items, subtotal, taxAmount, total } = computeTotals(body.lineItems, taxRate, discount);
      body.lineItems  = items;
      body.subtotal   = subtotal;
      body.taxAmount  = taxAmount;
      body.total      = total;
      body.balanceDue = Math.max(0, total - existing.paidAmount);
    }

    if (body.status === 'sent' && !existing.sentAt) body.sentAt = new Date();

    Object.assign(existing, body);
    await existing.save();

    const populated = await Invoice.findById(existing._id)
      .populate('clientId', 'name email contact phone address billingProfile')
      .populate('createdBy', 'name')
      .lean();

    audit.log(req, {
      action: 'update', category: 'billing',
      targetId: existing._id, targetModel: 'Invoice',
      targetTitle: `INV-${existing.invoiceNumber}`,
    });

    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};

exports.deleteInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { isDeleted: true },
      { new: true }
    ).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    audit.log(req, {
      action: 'delete', category: 'billing',
      targetId: req.params.id, targetModel: 'Invoice',
      targetTitle: `INV-${invoice.invoiceNumber}`,
    });

    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════

exports.getPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find({ invoiceId: req.params.invoiceId })
      .populate('recordedBy', 'name')
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();
    res.json({ success: true, data: payments });
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.invoiceId, isDeleted: { $ne: true } });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice is already fully paid' });
    }
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const payData = { ...req.body, amount, invoiceId: req.params.invoiceId, recordedBy: req.user._id };
    if (req.file) {
      payData.attachmentUrl  = `/uploads/${req.file.filename}`;
      payData.attachmentName = req.file.originalname;
    }
    const payment = await Payment.create(payData);

    audit.log(req, {
      action: 'create', category: 'billing',
      targetId: payment._id, targetModel: 'Payment',
      targetTitle: `Payment for INV-${invoice.invoiceNumber}`,
      metadata: { amount: payment.amount, method: payment.method },
    });

    const populated = await Payment.findById(payment._id).populate('recordedBy', 'name').lean();
    const updatedInvoice = await Invoice.findById(req.params.invoiceId)
      .populate('clientId', 'name email contact phone address billingProfile').lean();

    res.status(201).json({ success: true, data: populated, invoice: updatedInvoice });
  } catch (err) { next(err); }
};

exports.updatePayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    const ALLOWED = ['amount', 'paymentDate', 'method', 'reference', 'notes'];
    ALLOWED.forEach((k) => { if (req.body[k] !== undefined) payment[k] = k === 'amount' ? Number(req.body[k]) : req.body[k]; });

    if (req.file) {
      payment.attachmentUrl  = `/uploads/${req.file.filename}`;
      payment.attachmentName = req.file.originalname;
    }

    await payment.save(); // post-save hook resyncs invoice totals

    const populated = await Payment.findById(payment._id).populate('recordedBy', 'name').lean();
    const updatedInvoice = await Invoice.findById(payment.invoiceId)
      .populate('clientId', 'name email contact').lean();

    audit.log(req, {
      action: 'update', category: 'billing',
      targetId: payment._id, targetModel: 'Payment',
      targetTitle: `Payment ${payment._id}`,
      metadata: { amount: payment.amount },
    });

    res.json({ success: true, data: populated, invoice: updatedInvoice });
  } catch (err) { next(err); }
};

exports.deletePayment = async (req, res, next) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    const updatedInvoice = await Invoice.findById(payment.invoiceId)
      .populate('clientId', 'name email contact').lean();
    res.json({ success: true, message: 'Payment removed', invoice: updatedInvoice });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// COLLECTIONS / AGING REPORT
// ═══════════════════════════════════════════════════════════════

exports.getCollections = async (req, res, next) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const today    = new Date(todayStr + 'T00:00:00');

    const allInvoices = await Invoice.find({ isDeleted: { $ne: true }, status: { $ne: 'cancelled' } })
      .populate('clientId', 'name status')
      .lean();

    // Enrich each invoice with aging data
    const enriched = allInvoices.map((inv) => {
      const due          = inv.dueDate ? new Date(inv.dueDate + 'T00:00:00') : null;
      const daysOverdue  = (due && today > due && inv.status !== 'paid')
        ? Math.floor((today - due) / 86400000)
        : 0;
      let agingBucket = 'current';
      if (daysOverdue > 0) {
        if      (daysOverdue <= 30)  agingBucket = '1-30';
        else if (daysOverdue <= 60)  agingBucket = '31-60';
        else if (daysOverdue <= 90)  agingBucket = '61-90';
        else                         agingBucket = '90+';
      }
      return { ...inv, daysOverdue, agingBucket };
    });

    // Aging bucket counts + amounts
    const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const bucketAmounts = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    enriched.forEach((inv) => {
      const bal = inv.balanceDue || 0;
      buckets[inv.agingBucket]       = (buckets[inv.agingBucket] || 0) + 1;
      bucketAmounts[inv.agingBucket] = (bucketAmounts[inv.agingBucket] || 0) + bal;
    });

    // Per-client risk scoring
    const clientMap = {};
    enriched.forEach((inv) => {
      const cid = String(inv.clientId?._id || inv.clientId);
      if (!clientMap[cid]) {
        clientMap[cid] = {
          clientId:         cid,
          clientName:       inv.clientId?.name || 'Unknown',
          totalOutstanding: 0,
          overdueCount:     0,
          maxDaysOverdue:   0,
          invoiceCount:     0,
        };
      }
      const e = clientMap[cid];
      e.totalOutstanding += inv.balanceDue || 0;
      e.invoiceCount++;
      if (inv.agingBucket !== 'current') {
        e.overdueCount++;
        e.maxDaysOverdue = Math.max(e.maxDaysOverdue, inv.daysOverdue);
      }
    });

    const clientRisk = Object.values(clientMap).map((c) => {
      const daysScore  = Math.min(60, c.maxDaysOverdue) / 60 * 60;
      const countScore = Math.min(5,  c.overdueCount)   / 5  * 40;
      const riskScore  = Math.round(daysScore + countScore);
      let riskLabel = 'Low';
      if      (riskScore >= 75) riskLabel = 'Critical';
      else if (riskScore >= 50) riskLabel = 'High';
      else if (riskScore >= 25) riskLabel = 'Medium';
      return { ...c, riskScore, riskLabel };
    }).sort((a, b) => b.riskScore - a.riskScore);

    // Overall summary
    const totalOutstanding = enriched.reduce((s, i) => s + (i.balanceDue || 0), 0);
    const totalOverdue     = enriched
      .filter((i) => i.agingBucket !== 'current')
      .reduce((s, i) => s + (i.balanceDue || 0), 0);

    const collectedAgg = await Invoice.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$paidAmount' } } },
    ]);
    const totalCollected = collectedAgg[0]?.total || 0;

    res.json({
      success: true,
      data: {
        invoices: enriched,
        buckets,
        bucketAmounts,
        clientRisk,
        summary: {
          totalOutstanding,
          totalOverdue,
          totalCollected,
          totalInvoices:    allInvoices.length,
          overdueInvoices:  enriched.filter((i) => i.agingBucket !== 'current').length,
          paidInvoices:     allInvoices.filter((i) => i.status === 'paid').length,
        },
      },
    });
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// PDF EXPORT
// ═══════════════════════════════════════════════════════════════

exports.downloadPDF = async (req, res, next) => {
  try {
    const PDFDocument = require('pdfkit');

    const invoice = await Invoice.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('clientId', 'name email contact phone address billingProfile')
      .populate('createdBy', 'name')
      .lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await Payment.find({ invoiceId: req.params.id }).sort({ paymentDate: 1 }).lean();

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="INV-${invoice.invoiceNumber}.pdf"`);
    doc.pipe(res);

    const symCurrency = (invoice.currency || 'INR') === 'INR' ? '₹' : invoice.currency || '';
    const fmtN = (n) => `${symCurrency}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const statusColor = {
      paid: '#10b981', sent: '#3b82f6', draft: '#94a3b8',
      overdue: '#ef4444', partially_paid: '#f59e0b', cancelled: '#6b7280',
    }[invoice.status] || '#94a3b8';

    // ── Header band ──────────────────────────────────────────
    doc.rect(0, 0, 595, 100).fill('#4f46e5');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff').text('INVOICE', 50, 30);
    doc.fontSize(11).font('Helvetica').fillColor('rgba(255,255,255,0.75)')
      .text(`INV-${invoice.invoiceNumber}`, 50, 64)
      .text(`Issued: ${invoice.issueDate || '—'}   Due: ${invoice.dueDate || '—'}`, 50, 78);

    // Status pill (top-right)
    doc.roundedRect(430, 36, 115, 28, 6).fill(statusColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
      .text((invoice.status || '').replace(/_/g, ' ').toUpperCase(), 437, 44, { width: 100, align: 'center' });

    // ── From / To ────────────────────────────────────────────
    const infoY = 120;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8').text('FROM', 50, infoY);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a').text('BBC Creations', 50, infoY + 13);
    doc.fontSize(10).font('Helvetica').fillColor('#475569')
      .text('BizzBuzz Creations Digital Agency', 50, infoY + 28);

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8').text('BILL TO', 310, infoY);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a').text(invoice.clientId?.name || '—', 310, infoY + 13);
    doc.fontSize(10).font('Helvetica').fillColor('#475569');
    let toY = infoY + 28;
    if (invoice.clientId?.contact) { doc.text(invoice.clientId.contact, 310, toY); toY += 14; }
    if (invoice.clientId?.email)   { doc.text(invoice.clientId.email,   310, toY); toY += 14; }
    if (invoice.clientId?.phone)   { doc.text(invoice.clientId.phone,   310, toY); toY += 14; }
    if (invoice.clientId?.billingProfile?.gstNumber) {
      doc.text(`GST: ${invoice.clientId.billingProfile.gstNumber}`, 310, toY);
    }

    // ── Title ────────────────────────────────────────────────
    if (invoice.title) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b').text(invoice.title, 50, infoY + 80);
    }

    // ── Line items table ─────────────────────────────────────
    const tableTop = infoY + (invoice.title ? 110 : 95);
    doc.rect(50, tableTop, 495, 22).fill('#f1f5f9');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569');
    doc.text('DESCRIPTION', 58, tableTop + 6);
    doc.text('QTY',    370, tableTop + 6, { width: 45, align: 'right' });
    doc.text('RATE',   420, tableTop + 6, { width: 55, align: 'right' });
    doc.text('AMOUNT', 480, tableTop + 6, { width: 60, align: 'right' });

    let rowY = tableTop + 28;
    (invoice.lineItems || []).forEach((item, i) => {
      if (i % 2 === 1) doc.rect(50, rowY - 4, 495, 22).fill('#f8fafc');
      doc.fontSize(10).font('Helvetica').fillColor('#1e293b');
      doc.text(item.description || '', 58, rowY, { width: 295 });
      doc.text(String(item.quantity || 1), 370, rowY, { width: 45, align: 'right' });
      doc.text(fmtN(item.rate),   420, rowY, { width: 55, align: 'right' });
      doc.text(fmtN(item.amount), 480, rowY, { width: 60, align: 'right' });
      rowY += 26;
    });

    doc.moveTo(50, rowY + 4).lineTo(545, rowY + 4).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    rowY += 16;

    // ── Totals block ─────────────────────────────────────────
    const tX = 360, vX = 480, vW = 60;
    doc.fontSize(10).font('Helvetica').fillColor('#475569');
    doc.text('Subtotal', tX, rowY, { width: 110 });
    doc.text(fmtN(invoice.subtotal), vX, rowY, { width: vW, align: 'right' });
    rowY += 18;

    if (invoice.taxRate > 0) {
      doc.text(`Tax (${invoice.taxRate}%)`, tX, rowY, { width: 110 });
      doc.text(fmtN(invoice.taxAmount), vX, rowY, { width: vW, align: 'right' });
      rowY += 18;
    }
    if (invoice.discount > 0) {
      doc.text('Discount', tX, rowY, { width: 110 });
      doc.text(`-${fmtN(invoice.discount)}`, vX, rowY, { width: vW, align: 'right' });
      rowY += 18;
    }

    doc.moveTo(tX, rowY).lineTo(545, rowY).strokeColor('#cbd5e1').stroke();
    rowY += 8;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a');
    doc.text('Total', tX, rowY, { width: 110 });
    doc.text(fmtN(invoice.total), vX, rowY, { width: vW, align: 'right' });
    rowY += 24;

    if (invoice.paidAmount > 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#10b981');
      doc.text('Amount Paid', tX, rowY, { width: 110 });
      doc.text(`-${fmtN(invoice.paidAmount)}`, vX, rowY, { width: vW, align: 'right' });
      rowY += 18;
      doc.fontSize(12).font('Helvetica-Bold').fillColor(invoice.balanceDue > 0 ? '#ef4444' : '#10b981');
      doc.text('Balance Due', tX, rowY, { width: 110 });
      doc.text(fmtN(invoice.balanceDue), vX, rowY, { width: vW, align: 'right' });
      rowY += 24;
    }

    // ── Payment history ──────────────────────────────────────
    if (payments.length > 0) {
      rowY += 8;
      doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#e2e8f0').stroke();
      rowY += 12;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#94a3b8').text('PAYMENT HISTORY', 50, rowY);
      rowY += 14;
      payments.forEach((p) => {
        doc.fontSize(10).font('Helvetica').fillColor('#475569');
        doc.text(`${p.paymentDate || '—'}  ·  ${(p.method || '').replace('_', ' ')}  ·  Ref: ${p.reference || '—'}`, 50, rowY);
        doc.font('Helvetica-Bold').fillColor('#10b981').text(fmtN(p.amount), 480, rowY, { width: 60, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        rowY += 18;
      });
    }

    // ── Notes / Terms ────────────────────────────────────────
    if (invoice.notes || invoice.terms) {
      rowY += 12;
      doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#e2e8f0').stroke();
      rowY += 14;
      if (invoice.notes) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8').text('NOTES', 50, rowY);
        rowY += 12;
        doc.fontSize(10).font('Helvetica').fillColor('#475569').text(invoice.notes, 50, rowY, { width: 495 });
        rowY += doc.heightOfString(invoice.notes, { width: 495 }) + 12;
      }
      if (invoice.terms) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#94a3b8').text('PAYMENT TERMS', 50, rowY);
        rowY += 12;
        doc.fontSize(10).font('Helvetica').fillColor('#475569').text(invoice.terms, 50, rowY, { width: 495 });
      }
    }

    // ── Footer ───────────────────────────────────────────────
    const pageH = 842;
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8')
      .text('BBC Creations — BizzBuzz Creations Digital Agency', 50, pageH - 50, { align: 'center', width: 495 });

    doc.end();
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════
// BILLING PROFILE (on Client)
// ═══════════════════════════════════════════════════════════════

exports.updateBillingProfile = async (req, res, next) => {
  try {
    const client = await Client.findOneAndUpdate(
      { _id: req.params.clientId, isDeleted: { $ne: true } },
      { billingProfile: req.body.billingProfile },
      { new: true, runValidators: true }
    ).populate('assignedTeam', 'name email color initials status position');
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    audit.log(req, {
      action: 'update', category: 'client',
      targetId: client._id, targetModel: 'Client',
      targetTitle: client.name, metadata: { billingProfileUpdated: true },
    });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
};
