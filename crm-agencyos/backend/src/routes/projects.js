const express = require('express');
const { protect, denyClientWrites } = require('../middleware/auth');
const { authorizeFeature } = require('../middleware/authorizeFeature');
const xtra = require('../controllers/extraControllers');

const router = express.Router();
router.use(protect);
router.use(denyClientWrites); // clients get read-only access

// Sub-resource of "Clients & Projects" — no separate nav item/featureKey,
// reuses the 'clients' key on its own mutation routes only (GET stays open,
// same reasoning as clientsRouter — see authorizeFeature.js / SystemSettings).
// Members can view projects but not change them (they're in the 'clients' feature rule that gates the writes below).
const denyMemberWrites = (req, res, next) => (req.user.role === 'member'
  ? res.status(403).json({ success: false, message: 'Members have read-only access to clients and projects' })
  : next());

router.get('/',       xtra.getProjects);
router.post('/',      denyMemberWrites, authorizeFeature('clients', ['admin','manager']), xtra.createProject);
router.put('/:id',    denyMemberWrites, authorizeFeature('clients', ['admin','manager']), xtra.updateProject);
router.delete('/:id', denyMemberWrites, authorizeFeature('clients', ['admin','manager']), xtra.deleteProject);

module.exports = router;
