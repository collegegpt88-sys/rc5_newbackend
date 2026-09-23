const router = require('express').Router();
const { getSlots, getBookedSlots, getSlotCounts, reserve, verifyPayment, lookup } = require('../controllers/bookingController');
const { bookingRules, validate } = require('../middleware/validate');

router.get('/slots',           getSlots);
router.get('/booked-slots',    getBookedSlots);
router.get('/slot-counts',     getSlotCounts);
router.get('/lookup',          lookup);
router.post('/reserve',        ...bookingRules, validate, reserve);
router.post('/verify-payment', verifyPayment);

module.exports = router;
