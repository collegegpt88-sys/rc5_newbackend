const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Atomically increment and return the next sequence number.
 * findOneAndUpdate with upsert:true is a single atomic operation in MongoDB —
 * no two concurrent calls can receive the same seq value.
 */
async function nextSeq(key) {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

/**
 * Called once at server startup (MongoDB mode only).
 * Reads all existing booking_id values, extracts the numeric suffix,
 * and ensures the counter starts ABOVE the highest found value.
 * This prevents any new booking from duplicating an existing ID.
 *
 * Safe to call multiple times — only raises the counter, never lowers it.
 */
async function seedBookingCounter() {
  const Booking = mongoose.model('Booking');
  const existing = await Booking.find({}, { booking_id: 1, _id: 0 });

  let highest = 0;
  for (const b of existing) {
    if (!b.booking_id) continue;
    // Handles both formats: RC5-20260801-0012  and  RC500012
    const parts = b.booking_id.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > highest) highest = num;
  }

  if (highest === 0) return; // no existing bookings — counter starts at 0, first seq = 1

  const counterDoc = await Counter.findById('booking_sequence');
  if (!counterDoc) {
    await Counter.create({ _id: 'booking_sequence', seq: highest });
  } else if (counterDoc.seq < highest) {
    counterDoc.seq = highest;
    await counterDoc.save();
  }

  console.log(`RC5 booking counter seeded — next ID will be seq ${Math.max(counterDoc ? counterDoc.seq : 0, highest) + 1}`);
}

module.exports = { Counter, nextSeq, seedBookingCounter };
