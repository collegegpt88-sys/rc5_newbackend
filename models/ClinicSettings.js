const mongoose = require('mongoose');

// Stores blocked dates and holidays set by admin
const clinicSettingsSchema = new mongoose.Schema({
  blocked_dates: { type: [String], default: [] }, // ['2026-08-15']
  holidays:      { type: [String], default: [] },
  clinic_open:   { type: String, default: '07:00' },
  clinic_close:  { type: String, default: '21:00' },
  lunch_start:   { type: String, default: '13:00' },
  lunch_end:     { type: String, default: '14:00' },
  slot_duration: { type: Number, default: 30 }, // minutes
}, { timestamps: true });

module.exports = mongoose.model('ClinicSettings', clinicSettingsSchema);
