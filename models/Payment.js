const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  booking_id:          { type: String, required: true },
  razorpay_order_id:   { type: String, required: true },
  razorpay_payment_id: { type: String, default: null },
  razorpay_signature:  { type: String, default: null },
  amount:              { type: Number, required: true },
  currency:            { type: String, default: 'INR' },
  status:              { type: String, enum: ['pending','paid','failed','refunded'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
