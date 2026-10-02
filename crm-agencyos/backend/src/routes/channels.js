const express = require('express');
const { protect } = require('../middleware/auth');
const xtra = require('../controllers/extraControllers');

const router = express.Router();
router.use(protect);

// Any staff user can create a private group chat; edit/delete are limited to admins and the
// group's creator. All of that is enforced in the controllers (see extraControllers.js).
router.get('/',       xtra.getChannels);
router.post('/',      xtra.createChannel);
router.put('/:id',    xtra.updateChannel);
router.delete('/:id', xtra.deleteChannel);

module.exports = router;
