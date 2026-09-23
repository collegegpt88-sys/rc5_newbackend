const mongoose = require('mongoose');
const { nextSeq } = require('./Counter');

const bookingSchema = new mongoose.Schema({
  booking_id:          { type: String, unique: true },
  name:                { type: String, required: true },
  mobile:              { type: String, required: true },
  email:               { type: String, default: '' },
  age:                 { type: String, required: true },
  gender:              { type: String, required: true },
  treatment:           { type: String, required: true },
  appt_date:           { type: String, required: true }, // yyyy-mm-dd
  appt_time:           { type: String, required: true },
  amount:              { type: Number, default: 0 },
  booking_status:      { type: String, enum: ['reserved','confirmed','checked_in','completed','cancelled','no_show'], default: 'reserved' },
  payment_status:      { type: String, enum: ['pending','paid','failed','refunded'], default: 'pending' },
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  razorpay_signature:  { type: String, default: null },
  notes:               { type: String, default: '' },
}, { timestamps: true });

// Auto-generate booking_id before save — uses atomic counter to prevent race conditions
bookingSchema.pre('save', async function() {
  if (this.booking_id) return;
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const seq = await nextSeq('booking_sequence');
  this.booking_id = `RC5-${dateStr}-${String(seq).padStart(4, '0')}`;
});

module.exports = mongoose.model('Booking', bookingSchema);
