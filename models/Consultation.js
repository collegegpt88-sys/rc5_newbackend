const mongoose = require('mongoose');

const consultationSchema = new mongoose.Schema({
  consultation_id:     { type: String, unique: true },
  name:                { type: String, required: true },
  mobile:              { type: String, required: true },
  email:               { type: String, default: '' },
  age:                 { type: String, required: true },
  gender:              { type: String, required: true },
  pain_area:           { type: String, required: true },
  pain_duration:       { type: String, default: '' },
  description:         { type: String, default: '' },
  pref_date:           { type: String, required: true },
  pref_time:           { type: String, required: true },
  amount:              { type: Number, default: 249 },
  payment_status:      { type: String, enum: ['pending','paid','failed','refunded'], default: 'pending' },
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  razorpay_signature:  { type: String, default: null },
  status:              { type: String, enum: ['pending','confirmed','completed','cancelled'], default: 'pending' },
}, { timestamps: true });

consultationSchema.pre('save', async function() {
  if (this.consultation_id) return;
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const count = await mongoose.model('Consultation').countDocuments();
  this.consultation_id = `RC5C-${dateStr}-${String(count + 1).padStart(4, '0')}`;
});

module.exports = mongoose.model('Consultation', consultationSchema);
