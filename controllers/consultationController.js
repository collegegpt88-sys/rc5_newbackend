const Consultation = require('../models/Consultation');
const Razorpay     = require('razorpay');
const crypto       = require('crypto');
const { notifyConsultationConfirmed } = require('../services/whatsapp');

function getRazorpay() {
  if (!process.env.RZP_KEY_ID || !process.env.RZP_KEY_SECRET)
    throw new Error('Razorpay keys not configured.');
  return new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
}

const CONSULTATION_PRICE = parseInt(process.env.CONSULTATION_PRICE_INR || '249');

// POST /api/consultations/book  — creates record + Razorpay order (payment required)
async function book(req, res) {
  try {
    const { name, mobile, email, age, gender, pain_area, pain_duration, description, pref_date, pref_time } = req.body;

    if (!name || !mobile || !age || !gender || !pain_area || !pref_date || !pref_time)
      return res.status(400).json({ error: 'All required fields must be filled.' });

    if (!/^\d{10}$/.test(mobile))
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });

    // Prevent duplicate: same mobile + same date + same time
    const existing = await Consultation.findOne({ mobile, pref_date, pref_time });
    if (existing)
      return res.status(409).json({ error: 'A consultation request already exists for this mobile number on the selected date and time.' });

    const consultation = new Consultation({
      name, mobile, email: email || '', age, gender,
      pain_area, pain_duration: pain_duration || '',
      description: description || '',
      pref_date, pref_time,
      amount: CONSULTATION_PRICE,
      payment_status: 'pending',
    });
    await consultation.save();

    // Create Razorpay order for ₹249
    let order = null;
    if (process.env.RZP_KEY_ID && process.env.RZP_KEY_SECRET) {
      order = await new Promise((resolve, reject) => {
        getRazorpay().orders.create(
          { amount: CONSULTATION_PRICE * 100, currency: 'INR',
            notes: { consultation_id: consultation.consultation_id, name, pref_date, pref_time } },
          (err, o) => err ? reject(err) : resolve(o)
        );
      });
      consultation.razorpay_order_id = order.id;
      await consultation.save();
    }

    return res.json({
      success:        true,
      consultationId: consultation.consultation_id,
      orderId:        order ? order.id   : null,
      keyId:          order ? process.env.RZP_KEY_ID : '',
      amount:         order ? order.amount : CONSULTATION_PRICE * 100,
      paymentReady:   !!order,
      name,
      pref_date,
      pref_time,
    });
  } catch (err) {
    console.error('consultation book:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// POST /api/consultations/verify-payment
async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, consultation_id } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !consultation_id)
      return res.status(400).json({ error: 'Missing payment fields.' });

    const expected = crypto
      .createHmac('sha256', process.env.RZP_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.status(400).json({ error: 'Payment verification failed.' });

    const consultation = await Consultation.findOne({ consultation_id });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found.' });
    if (consultation.payment_status === 'paid') return res.status(400).json({ error: 'Already paid.' });

    consultation.razorpay_payment_id = razorpay_payment_id;
    consultation.razorpay_signature  = razorpay_signature;
    consultation.payment_status      = 'paid';
    consultation.status              = 'confirmed';
    await consultation.save();

    notifyConsultationConfirmed(consultation).catch(err =>
      console.error('WhatsApp notify failed (non-fatal):', err.message)
    );

    return res.json({
      success:        true,
      consultationId: consultation.consultation_id,
      paymentId:      razorpay_payment_id,
      name:           consultation.name,
      pref_date:      consultation.pref_date,
      pref_time:      consultation.pref_time,
      amount:         consultation.amount,
    });
  } catch (err) {
    console.error('verifyConsultation:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { book, verifyPayment };
