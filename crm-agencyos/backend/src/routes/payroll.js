const express = require('express');
const { protect } = require('../middleware/auth');
const { authorizeFeature } = require('../middleware/authorizeFeature');
const ctrl = require('../controllers/payrollController');
const uploadAttachment = require('../middleware/uploadLeaveAttachment');

const router = express.Router();
router.use(protect);

// Leaves — every staff role can request their own; the controller scopes what each role can see/do.
const leaves = authorizeFeature('payroll_leaves', ['admin', 'manager', 'member', 'client_relations', 'read_only']);
router.get('/leaves',            leaves, ctrl.getLeaves);
router.post('/leaves', leaves, (req, res, next) => uploadAttachment.single('attachment')(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
}), ctrl.createLeave);
router.put('/leaves/:id/status', leaves, ctrl.updateLeaveStatus);
router.delete('/leaves/:id',     leaves, ctrl.deleteLeave);

// Pay runs — admin/manager only by default (configurable under Settings → Feature Access Control).
const payRuns = authorizeFeature('payroll_pay_runs', ['admin', 'manager']);
router.get('/pay-runs',        payRuns, ctrl.getPayRuns);
router.post('/pay-runs',       payRuns, ctrl.createPayRun);
router.put('/pay-runs/:id',    payRuns, ctrl.updatePayRun);
router.delete('/pay-runs/:id', payRuns, ctrl.deletePayRun);

module.exports = router;
