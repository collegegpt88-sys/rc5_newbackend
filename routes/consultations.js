const router = require('express').Router();
const { book, verifyPayment } = require('../controllers/consultationController');

router.post('/book',           book);
router.post('/verify-payment', verifyPayment);

module.exports = router;
