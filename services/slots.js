const ClinicSettings = require('../models/ClinicSettings');

// Generate 30-min slots between open/close, skip lunch
function generateSlots(openH, openM, closeH, closeM, lunchStartH, lunchStartM, lunchEndH, lunchEndM, duration) {
  const slots = [];
  let h = openH, m = openM;

  while (h < closeH || (h === closeH && m < closeM)) {
    const endM = m + duration;
    const endH = h + Math.floor(endM / 60);
    const endMin = endM % 60;

    if (endH > closeH || (endH === closeH && endMin > closeM)) break;

    // Skip lunch
    const isLunch = (h === lunchStartH && m >= lunchStartM) ||
                    (h > lunchStartH && h < lunchEndH) ||
                    (h === lunchEndH && m < lunchEndM);

    if (!isLunch) {
      const fmt = (hh, mm) => `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
      slots.push(`${fmt(h, m)} – ${fmt(endH, endMin)}`);
    }

    m += duration;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

async function getSettings() {
  let s = await ClinicSettings.findOne();
  if (!s) s = await ClinicSettings.create({});
  return s;
}

async function getAvailableSlots(date) {
  const Booking = require('../models/Booking');
  const settings = await getSettings();

  const [openH, openM]       = settings.clinic_open.split(':').map(Number);
  const [closeH, closeM]     = settings.clinic_close.split(':').map(Number);
  const [lunchSH, lunchSM]   = settings.lunch_start.split(':').map(Number);
  const [lunchEH, lunchEM]   = settings.lunch_end.split(':').map(Number);

  const allSlots = generateSlots(openH, openM, closeH, closeM, lunchSH, lunchSM, lunchEH, lunchEM, settings.slot_duration);

  const booked = await Booking.find({
    appt_date: date,
    booking_status: { $in: ['reserved', 'confirmed', 'checked_in'] },
  }).select('appt_time');

  const bookedTimes = booked.map(b => b.appt_time);

  return allSlots.map(slot => ({
    slot,
    available: !bookedTimes.includes(slot),
    isLunch: false,
  }));
}

module.exports = { getAvailableSlots, getSettings, generateSlots };
