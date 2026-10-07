const Booking = require('../models/Booking');
const { notifyCancellation, notifyReschedule } = require('../services/whatsapp');

// GET /api/admin/dashboard
async function dashboard(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [todayTotal, todayRevenue, upcoming, completed, cancelled, pendingPayment] = await Promise.all([
      Booking.countDocuments({ appt_date: today }),
      Booking.aggregate([
        { $match: { appt_date: today, payment_status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Booking.countDocuments({ appt_date: { $gt: today }, booking_status: { $in: ['reserved','confirmed'] } }),
      Booking.countDocuments({ booking_status: 'completed' }),
      Booking.countDocuments({ booking_status: 'cancelled' }),
      Booking.countDocuments({ payment_status: 'pending', booking_status: { $ne: 'cancelled' } }),
    ]);

    return res.json({
      today_appointments: todayTotal,
      today_revenue:      todayRevenue[0]?.total || 0,
      upcoming,
      completed,
      cancelled,
      pending_payments:   pendingPayment,
    });
  } catch (err) {
    console.error('dashboard:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/admin/bookings
async function listBookings(req, res) {
  try {
    const { search, filter, date, page = 1, limit = 20 } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { booking_id: new RegExp(search, 'i') },
        { name:       new RegExp(search, 'i') },
        { mobile:     new RegExp(search, 'i') },
      ];
    }

    const today    = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    if (filter === 'today')     query.appt_date = today;
    if (filter === 'tomorrow')  query.appt_date = tomorrow;
    if (filter === 'paid')      query.payment_status = 'paid';
    if (filter === 'pending')   query.payment_status = 'pending';
    if (filter === 'cancelled') query.booking_status = 'cancelled';
    if (filter === 'completed') query.booking_status = 'completed';
    if (date)                   query.appt_date = date;

    const bookings = await Booking.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    return res.json({ bookings, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('listBookings:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/admin/bookings/:id
async function getBooking(req, res) {
  try {
    const booking = await Booking.findOne({ booking_id: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    return res.json(booking);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

// PUT /api/admin/bookings/:id/cancel
async function cancelBooking(req, res) {
  try {
    const booking = await Booking.findOne({ booking_id: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.booking_status === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });

    booking.booking_status = 'cancelled';
    await booking.save();

    notifyCancellation(booking);

    return res.json({ success: true, message: 'Booking cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

// PUT /api/admin/bookings/:id/reschedule
async function rescheduleBooking(req, res) {
  try {
    const { appt_date, appt_time } = req.body;
    if (!appt_date || !appt_time) return res.status(400).json({ error: 'New date and time required' });

    const booking = await Booking.findOne({ booking_id: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Check new slot availability
    const conflict = await Booking.findOne({
      appt_date, appt_time,
      booking_status: { $in: ['reserved','confirmed','checked_in'] },
      booking_id: { $ne: booking.booking_id },
    });
    if (conflict) return res.status(409).json({ error: 'New slot already booked' });

    booking.appt_date = appt_date;
    booking.appt_time = appt_time;
    await booking.save();

    notifyReschedule(booking);

    return res.json({ success: true, booking });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

// PUT /api/admin/bookings/:id/status
async function updateStatus(req, res) {
  try {
    const { status } = req.body;
    const allowed = ['reserved','confirmed','checked_in','completed','cancelled','no_show'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const booking = await Booking.findOneAndUpdate(
      { booking_id: req.params.id },
      { booking_status: status },
      { new: true }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    return res.json({ success: true, booking });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { dashboard, listBookings, getBooking, cancelBooking, rescheduleBooking, updateStatus };
