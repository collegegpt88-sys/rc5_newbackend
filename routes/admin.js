const router  = require('express').Router();
const authAdmin = require('../middleware/auth');
const {
  dashboard, listBookings, getBooking,
  cancelBooking, rescheduleBooking, updateStatus,
} = require('../controllers/adminController');

router.get('/dashboard',                  authAdmin, dashboard);
router.get('/bookings',                   authAdmin, listBookings);
router.get('/bookings/:id',               authAdmin, getBooking);
router.put('/bookings/:id/cancel',        authAdmin, cancelBooking);
router.put('/bookings/:id/reschedule',    authAdmin, rescheduleBooking);
router.put('/bookings/:id/status',        authAdmin, updateStatus);

module.exports = router;
