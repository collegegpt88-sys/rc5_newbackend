// Legacy JSON file routes — used when MONGO_URI is not configured
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const axios    = require('axios');
const Razorpay = require('razorpay');

const DB_FILE = path.join(__dirname, 'db.json');

const CONFIG = {
  CLINIC_NAME:           process.env.CLINIC_NAME              || 'RC5 Elite Motion',
  PRICE_INR:             parseInt(process.env.PRICE_INR              || '99'),
  CONSULTATION_PRICE_INR: parseInt(process.env.CONSULTATION_PRICE_INR || '249'),
  get PRICE_PAISE()            { return this.PRICE_INR * 100; },
  get CONSULTATION_PRICE_PAISE() { return this.CONSULTATION_PRICE_INR * 100; },
  RZP_KEY_ID:         process.env.RZP_KEY_ID         || '',
  RZP_KEY_SECRET:     process.env.RZP_KEY_SECRET     || '',
  WA_TOKEN:           process.env.WA_TOKEN            || '',
  WA_PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID || '',
  WA_VERIFY_TOKEN:    process.env.WA_VERIFY_TOKEN     || '',
  WA_CLINIC_NUMBER:   process.env.WA_CLINIC_NUMBER   || '',
};

function getRazorpay() {
  if (!CONFIG.RZP_KEY_ID || !CONFIG.RZP_KEY_SECRET)
    throw new Error('Razorpay keys not configured.');
  return new Razorpay({ key_id: CONFIG.RZP_KEY_ID, key_secret: CONFIG.RZP_KEY_SECRET });
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const init = { appointments: [], consultations: [], lastId: 0, lastConsultationId: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

function nextBookingId(db) {
  db.lastId = (db.lastId || 0) + 1;
  return 'RC5' + String(db.lastId).padStart(5, '0');
}

function nextConsultationId(db) {
  db.lastConsultationId = (db.lastConsultationId || 0) + 1;
  return 'RC5C-' + String(db.lastConsultationId).padStart(5, '0');
}

// Generate 1-hour slots 7AM–9PM, skip 1PM–2PM lunch (12-hr format to match frontend)
function generateSlots() {
  const slots = [];
  for (let h = 7; h < 21; h++) {
    if (h === 13) { slots.push({ slot: '01:00 PM – 02:00 PM', available: false, isLunch: true }); continue; }
    const fmt = hh => {
      const p = hh >= 12 ? 'PM' : 'AM';
      let hr = hh % 12; if (hr === 0) hr = 12;
      return String(hr).padStart(2,'0') + ':00 ' + p;
    };
    slots.push({ slot: `${fmt(h)} – ${fmt(h + 1)}`, available: true, isLunch: false });
  }
  return slots;
}

async function sendWA(to, body) {
  if (!CONFIG.WA_TOKEN || CONFIG.WA_TOKEN === 'YOUR_WHATSAPP_ACCESS_TOKEN') return;
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${CONFIG.WA_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
      { headers: { Authorization: `Bearer ${CONFIG.WA_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('WA failed:', e?.response?.data || e.message); }
}

module.exports = function(app) {

  // GET slot-counts
  app.get('/api/appointments/slot-counts', (req, res) => {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'date required' });
      const db = readDb();
      const slotCounts = {};
      db.appointments
        .filter(a => a.appt_date === date && ['reserved','confirmed'].includes(a.booking_status))
        .forEach(a => { slotCounts[a.appt_time] = (slotCounts[a.appt_time] || 0) + 1; });
      return res.json({ slotCounts });
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // GET booked slots
  app.get('/api/appointments/booked-slots', (req, res) => {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'date required' });
      const MAX_PER_SLOT = 3;
      const db = readDb();
      // Only mark slot as booked when all 3 spots are taken
      const slotCounts = {};
      db.appointments
        .filter(a => a.appt_date === date && ['reserved','confirmed'].includes(a.booking_status))
        .forEach(a => { slotCounts[a.appt_time] = (slotCounts[a.appt_time] || 0) + 1; });
      const booked = Object.keys(slotCounts).filter(t => slotCounts[t] >= MAX_PER_SLOT);
      return res.json({ bookedSlots: booked });
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // GET slots with availability
  app.get('/api/appointments/slots', (req, res) => {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'date required' });
      const db = readDb();
      const booked = db.appointments
        .filter(a => a.appt_date === date && ['reserved','confirmed'].includes(a.booking_status))
        .map(a => a.appt_time);
      const slots = generateSlots().map(s => ({
        ...s,
        available: s.isLunch ? false : !booked.includes(s.slot),
      }));
      return res.json({ slots });
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // POST reserve
  app.post('/api/appointments/reserve', async (req, res) => {
    try {
      const { name, mobile, age, gender, treatment, appt_date, appt_time, email, notes } = req.body;
      if (!name || !mobile || !age || !gender || !treatment || !appt_date || !appt_time)
        return res.status(400).json({ error: 'All fields are required.' });
      if (!/^\d{10}$/.test(mobile))
        return res.status(400).json({ error: 'Invalid mobile number.' });

      const db = readDb();
      const MAX_PER_SLOT = 3;
      const slotCount = db.appointments.filter(
        a => a.appt_date === appt_date && a.appt_time === appt_time &&
             ['reserved','confirmed'].includes(a.booking_status)
      ).length;
      if (slotCount >= MAX_PER_SLOT) return res.status(409).json({ error: 'This slot is fully booked. Please choose another.' });

      const booking_id = nextBookingId(db);

      try { getRazorpay() } catch(e) {
          const record = {
            booking_id, name, mobile, email: email||'', age, gender,
            treatment, appt_date, appt_time, notes: notes||'',
            amount: CONFIG.PRICE_INR,
            razorpay_order_id: null, razorpay_payment_id: null,
            payment_status: 'pending', booking_status: 'reserved',
            created_at: new Date().toISOString(),
          };
          db.appointments.push(record); writeDb(db);
          return res.json({ bookingId: booking_id, orderId: null, keyId: '', amount: CONFIG.PRICE_PAISE, paymentReady: false, name, mobile, treatment, date: appt_date, time: appt_time });
        }
      getRazorpay().orders.create(
        { amount: CONFIG.PRICE_PAISE, currency: 'INR', receipt: booking_id,
          notes: { booking_id, name, appt_date, appt_time } },
        (err, order) => {
          const record = {
            booking_id, name, mobile, email: email||'', age, gender,
            treatment, appt_date, appt_time, notes: notes||'',
            amount: CONFIG.PRICE_INR,
            razorpay_order_id:   err ? null : order.id,
            razorpay_payment_id: null,
            payment_status:  'pending',
            booking_status:  'reserved',
            created_at:      new Date().toISOString(),
          };
          db.appointments.push(record);
          writeDb(db);

          return res.json({
            bookingId:    booking_id,
            orderId:      err ? null : order.id,
            keyId:        CONFIG.RZP_KEY_ID,
            amount:       CONFIG.PRICE_PAISE,
            paymentReady: !err,
            name, mobile, treatment,
            date: appt_date, time: appt_time,
          });
        }
      );
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // POST consultation booking (legacy JSON fallback)
  app.post('/api/consultations/book', async (req, res) => {
    try {
      const { name, mobile, email, age, gender, pain_area, pain_duration, description, pref_date, pref_time } = req.body;
      if (!name || !mobile || !age || !gender || !pain_area || !pref_date || !pref_time)
        return res.status(400).json({ error: 'All required fields must be filled.' });
      if (!/^\d{10}$/.test(mobile))
        return res.status(400).json({ error: 'Invalid mobile number.' });

      const db = readDb();

      const duplicate = db.consultations.find(
        c => c.mobile === mobile && c.pref_date === pref_date && c.pref_time === pref_time
      );
      if (duplicate)
        return res.status(409).json({ error: 'A consultation request already exists for this mobile number on the selected date and time.' });

      const consultation_id = nextConsultationId(db);
      const record = {
        consultation_id, name, mobile, email: email || '', age, gender,
        pain_area, pain_duration: pain_duration || '',
        description: description || '',
        pref_date, pref_time,
        amount: CONFIG.CONSULTATION_PRICE_INR,
        payment_status: 'pending',
        razorpay_order_id: null,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      db.consultations.push(record);
      writeDb(db);

      let order = null;
      if (CONFIG.RZP_KEY_ID && CONFIG.RZP_KEY_SECRET) {
        order = await new Promise((resolve, reject) => {
          getRazorpay().orders.create(
            { amount: CONFIG.CONSULTATION_PRICE_PAISE, currency: 'INR',
              notes: { consultation_id, name, pref_date, pref_time } },
            (err, o) => err ? reject(err) : resolve(o)
          );
        });
        record.razorpay_order_id = order.id;
        writeDb(db);
      }

      return res.json({
        success: true,
        consultationId: consultation_id,
        orderId:      order ? order.id : null,
        keyId:        order ? CONFIG.RZP_KEY_ID : '',
        amount:       order ? order.amount : CONFIG.CONSULTATION_PRICE_PAISE,
        paymentReady: !!order,
        name, pref_date, pref_time,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // POST consultation verify-payment (legacy JSON fallback)
  app.post('/api/consultations/verify-payment', async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, consultation_id } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !consultation_id)
        return res.status(400).json({ error: 'Missing payment fields.' });

      const expected = crypto.createHmac('sha256', CONFIG.RZP_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
      if (expected !== razorpay_signature)
        return res.status(400).json({ error: 'Payment verification failed.' });

      const db = readDb();
      const c = db.consultations.find(x => x.consultation_id === consultation_id);
      if (!c) return res.status(404).json({ error: 'Consultation not found.' });
      if (c.payment_status === 'paid') return res.status(400).json({ error: 'Already paid.' });

      c.razorpay_order_id   = razorpay_order_id;
      c.razorpay_payment_id = razorpay_payment_id;
      c.razorpay_signature  = razorpay_signature;
      c.payment_status      = 'paid';
      c.status              = 'confirmed';
      writeDb(db);

      return res.json({
        success: true,
        consultationId: c.consultation_id,
        paymentId: razorpay_payment_id,
        name: c.name, pref_date: c.pref_date, pref_time: c.pref_time,
        amount: c.amount,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // GET lookup
  app.get('/api/appointments/lookup', async (req, res) => {
    try {
      const { bookingId } = req.query;
      if (!bookingId) return res.status(400).json({ error: 'bookingId required' });
      const db   = readDb();
      const appt = db.appointments.find(a => a.booking_id === bookingId.toUpperCase());
      if (!appt)                              return res.status(404).json({ error: 'Booking not found.' });
      if (appt.booking_status === 'confirmed') return res.status(400).json({ error: 'Already paid.' });

      getRazorpay().orders.create(
        { amount: CONFIG.PRICE_PAISE, currency: 'INR', receipt: appt.booking_id },
        (err, order) => {
          if (err) return res.status(500).json({ error: 'Payment gateway error.' });
          appt.razorpay_order_id = order.id;
          writeDb(db);
          return res.json({
            bookingId: appt.booking_id, orderId: order.id,
            keyId: CONFIG.RZP_KEY_ID, amount: CONFIG.PRICE_PAISE,
            name: appt.name, mobile: appt.mobile,
            treatment: appt.treatment, appt_date: appt.appt_date, appt_time: appt.appt_time,
          });
        }
      );
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // POST verify-payment
  app.post('/api/appointments/verify-payment', async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id)
        return res.status(400).json({ error: 'Missing payment fields.' });

      const expected = crypto.createHmac('sha256', CONFIG.RZP_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
      if (expected !== razorpay_signature)
        return res.status(400).json({ error: 'Payment verification failed.' });

      const db   = readDb();
      const appt = db.appointments.find(a => a.booking_id === booking_id);
      if (!appt)                              return res.status(404).json({ error: 'Booking not found.' });
      if (appt.booking_status === 'confirmed') return res.status(400).json({ error: 'Already paid.' });

      appt.razorpay_order_id   = razorpay_order_id;
      appt.razorpay_payment_id = razorpay_payment_id;
      appt.payment_status      = 'paid';
      appt.booking_status      = 'confirmed';
      appt.confirmed_at        = new Date().toISOString();
      writeDb(db);

      // WhatsApp
      const patientMsg = `Hello ${appt.name},\n\nYour appointment has been confirmed.\n\nBooking ID: ${appt.booking_id}\nDate: ${appt.appt_date}\nTime: ${appt.appt_time}\nPayment: Paid\n\nPlease arrive 10 minutes early.\n\nThank you.`;
      const clinicMsg  = `🏥 New Appointment\n\nBooking ID: ${appt.booking_id}\nPatient: ${appt.name}\nMobile: ${appt.mobile}\nDate: ${appt.appt_date}\nTime: ${appt.appt_time}\nPayment: Paid ✓`;
      sendWA('91' + appt.mobile, patientMsg);
      sendWA(CONFIG.WA_CLINIC_NUMBER, clinicMsg);

      return res.json({
        success: true, bookingId: booking_id, paymentId: razorpay_payment_id,
        name: appt.name, date: appt.appt_date, time: appt.appt_time,
        treatment: appt.treatment, amount: appt.amount,
      });
    } catch (err) { return res.status(500).json({ error: 'Server error' }); }
  });

  // Meta webhook
  app.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === CONFIG.WA_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send('Forbidden');
  });
  app.post('/webhook', (req, res) => res.status(200).send('EVENT_RECEIVED'));
};
