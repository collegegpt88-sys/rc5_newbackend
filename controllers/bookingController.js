const Booking  = require('../models/Booking');
const Payment  = require('../models/Payment');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const { notifyBookingConfirmed } = require('../services/whatsapp');
const { getAvailableSlots }      = require('../services/slots');

function getRazorpay() {
  if (!process.env.RZP_KEY_ID || !process.env.RZP_KEY_SECRET)
    throw new Error('Razorpay keys not configured. Add RZP_KEY_ID and RZP_KEY_SECRET to .env');
  return new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
}

const MAX_PER_SLOT = 3;

// GET /api/appointments/slot-counts?date=yyyy-mm-dd
async function getSlotCounts(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    const bookings = await Booking.find({
      appt_date: date,
      booking_status: { $in: ['reserved','confirmed','checked_in'] },
    }).select('appt_time');
    const slotCounts = {};
    bookings.forEach(b => { slotCounts[b.appt_time] = (slotCounts[b.appt_time] || 0) + 1; });
    return res.json({ slotCounts });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/appointments/slots?date=yyyy-mm-dd
async function getSlots(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    const slots = await getAvailableSlots(date);
    return res.json({ slots });
  } catch (err) {
    console.error('getSlots:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/appointments/booked-slots?date=yyyy-mm-dd
async function getBookedSlots(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });

    const bookings = await Booking.find({
      appt_date: date,
      booking_status: { $in: ['reserved', 'confirmed', 'checked_in'] },
    }).select('appt_time');

    // Count per slot — mark full when >= MAX_PER_SLOT
    const counts = {};
    bookings.forEach(b => { counts[b.appt_time] = (counts[b.appt_time] || 0) + 1; });
    const bookedSlots = Object.keys(counts).filter(t => counts[t] >= MAX_PER_SLOT);

    return res.json({ bookedSlots });
  } catch (err) {
    console.error('getBookedSlots:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/appointments/reserve
async function reserve(req, res) {
  try {
    const { name, mobile, email, age, gender, treatment, appt_date, appt_time, notes } = req.body;

    // Check slot capacity
    const slotCount = await Booking.countDocuments({
      appt_date,
      appt_time,
      booking_status: { $in: ['reserved', 'confirmed', 'checked_in'] },
    });
    if (slotCount >= MAX_PER_SLOT)
      return res.status(409).json({ error: 'This slot is fully booked. Please choose another.' });

    const price = parseInt(process.env.PRICE_INR || '99');

    // Create Razorpay order
    let order = null;
    if (process.env.RZP_KEY_ID && process.env.RZP_KEY_SECRET) {
      order = await new Promise((resolve, reject) => {
        getRazorpay().orders.create(
          { amount: price * 100, currency: 'INR', notes: { name, appt_date, appt_time } },
          (err, o) => err ? reject(err) : resolve(o)
        );
      });
    }

    // Save booking
    const booking = new Booking({
      name, mobile, email: email || '', age, gender,
      treatment, appt_date, appt_time,
      notes: notes || '',
      amount: price,
      razorpay_order_id: order ? order.id : null,
      booking_status: 'reserved',
      payment_status: 'pending',
    });
    await booking.save();

    if (order) {
      await Payment.create({
        booking_id: booking.booking_id,
        razorpay_order_id: order.id,
        amount: price,
        status: 'pending',
      });
    }

    return res.json({
      bookingId:    booking.booking_id,
      orderId:      order ? order.id : null,
      keyId:        process.env.RZP_KEY_ID || '',
      amount:       order ? order.amount : price * 100,
      paymentReady: !!order,
      name, mobile, treatment,
      date: appt_date,
      time: appt_time,
    });
  } catch (err) {
    console.error('reserve:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// POST /api/appointments/verify-payment
async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id)
      return res.status(400).json({ error: 'Missing payment fields.' });

    // Verify signature
    const expected = crypto
      .createHmac('sha256', process.env.RZP_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.status(400).json({ error: 'Payment verification failed.' });

    const booking = await Booking.findOne({ booking_id });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.booking_status === 'confirmed') return res.status(400).json({ error: 'Already confirmed.' });

    booking.razorpay_payment_id = razorpay_payment_id;
    booking.razorpay_signature  = razorpay_signature;
    booking.payment_status      = 'paid';
    booking.booking_status      = 'confirmed';
    await booking.save();

    // Update Payment record — use $set so partial update is safe,
    // upsert:false ensures we never create a ghost record.
    // Also match by booking_id as fallback in case order_id rotated (Pay Now flow).
    const paymentUpdate = await Payment.findOneAndUpdate(
      { $or: [{ razorpay_order_id }, { booking_id: booking.booking_id }] },
      { $set: { razorpay_payment_id, razorpay_signature, razorpay_order_id, status: 'paid' } },
      { new: true, upsert: false }
    );

    // If no Payment doc exists yet (edge case: order created outside reserve),
    // create one so the record is never missing.
    if (!paymentUpdate) {
      await Payment.create({
        booking_id:          booking.booking_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount:              booking.amount,
        status:              'paid',
      });
    }

    // Fire WhatsApp after all DB writes are done — fire-and-forget intentionally.
    notifyBookingConfirmed(booking).catch(err =>
      console.error('WhatsApp notify failed (non-fatal):', err.message)
    );

    return res.json({
      success:   true,
      bookingId: booking.booking_id,
      paymentId: razorpay_payment_id,
      name:      booking.name,
      date:      booking.appt_date,
      time:      booking.appt_time,
      treatment: booking.treatment,
      amount:    booking.amount,
    });
  } catch (err) {
    console.error('verifyPayment:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/appointments/lookup?bookingId=BK-xxx
async function lookup(req, res) {
  try {
    const { bookingId } = req.query;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const booking = await Booking.findOne({ booking_id: bookingId.toUpperCase() });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.booking_status === 'confirmed') return res.status(400).json({ error: 'Already paid and confirmed.' });

    const price = parseInt(process.env.PRICE_INR || '99');
    const order = await new Promise((resolve, reject) => {
      getRazorpay().orders.create(
        { amount: price * 100, currency: 'INR', notes: { booking_id: booking.booking_id } },
        (err, o) => err ? reject(err) : resolve(o)
      );
    });

    booking.razorpay_order_id = order.id;
    await booking.save();

    return res.json({
      bookingId:  booking.booking_id,
      orderId:    order.id,
      keyId:      process.env.RZP_KEY_ID,
      amount:     order.amount,
      name:       booking.name,
      mobile:     booking.mobile,
      treatment:  booking.treatment,
      appt_date:  booking.appt_date,
      appt_time:  booking.appt_time,
    });
  } catch (err) {
    console.error('lookup:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getSlots, getBookedSlots, getSlotCounts, reserve, verifyPayment, lookup };
