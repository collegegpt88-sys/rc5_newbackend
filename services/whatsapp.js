const axios = require('axios');

// async function sendWA(to, body) {
//   if (!process.env.WA_TOKEN || process.env.WA_TOKEN === 'YOUR_WHATSAPP_ACCESS_TOKEN') return;
//   try {
//     await axios.post(
//       `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
//       { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
//       { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' } }
//     );
//     console.log(`WhatsApp sent to ${to}`);
//   } catch (e) {
//     console.error('WhatsApp failed:', e?.response?.data || e.message);
//   }
// }

async function sendWA(to, body) {
  if (!process.env.WA_TOKEN) {
    console.log("❌ WA_TOKEN missing");
    return;
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: body
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WA_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("========== WHATSAPP API SUCCESS ==========");
    console.log("TO:", to);
    console.log("RESPONSE:", JSON.stringify(response.data, null, 2));
    console.log("==========================================");

  } catch (e) {
    console.log("========== WHATSAPP API FAILED ==========");
    console.log(
      JSON.stringify(e?.response?.data || e.message, null, 2)
    );
    console.log("=========================================");
  }
}

async function notifyBookingConfirmed(booking) {
  const communityLink = process.env.WHATSAPP_COMMUNITY_LINK || '';

  const patientMsg =
    `🎉 Your RC5 Workshop Booking is Confirmed!\n\n` +
    `Hello ${booking.name},\n\n` +
    `Thank you for registering for the RC5 Elite Motion Workshop.\n\n` +
    `Booking ID:\n${booking.booking_id}\n\n` +
    `Workshop Date:\n${booking.appt_date}\n\n` +
    `Workshop Time:\n${booking.appt_time}\n\n` +
    `Amount Paid:\n₹${booking.amount}\n\n` +
    `Payment Status:\nSuccessful\n\n` +
    `--------------------------------------------------\n\n` +
    `📢 Join our Official RC5 WhatsApp Community\n\n` +
    `${communityLink}\n\n` +
    `--------------------------------------------------\n\n` +
    `Inside the Community you will receive:\n\n` +
    `✅ Workshop Reminder\n` +
    `✅ Google Meet Link\n` +
    `✅ Daily Updates\n` +
    `✅ Exercise PDFs\n` +
    `✅ Important Announcements\n` +
    `✅ Live Workshop Support\n\n` +
    `--------------------------------------------------\n\n` +
    `Thank you.\nRC5 Elite Motion Team`;

  const clinicMsg =
    `🏥 New Workshop Booking Confirmed\n\n` +
    `Booking ID: ${booking.booking_id}\n` +
    `Patient: ${booking.name}\n` +
    `Mobile: ${booking.mobile}\n` +
    `Age: ${booking.age} | Gender: ${booking.gender}\n` +
    `Focus Area: ${booking.treatment}\n` +
    `Date: ${booking.appt_date}\n` +
    `Time: ${booking.appt_time}\n` +
    `Amount: ₹${booking.amount}\n` +
    `Payment: Paid ✓`;

     console.log("PATIENT MOBILE FROM BOOKING:", booking.mobile);                                  // aa be navi add kari che
     console.log("PATIENT WHATSAPP NUMBER:", '91' + booking.mobile);                               //


  await sendWA('91' + booking.mobile, patientMsg);
  await sendWA(process.env.WA_CLINIC_NUMBER, clinicMsg);
}

async function notifyConsultationConfirmed(consultation) {
  const communityLink = process.env.WHATSAPP_COMMUNITY_LINK || '';

  const patientMsg =
    `Hello ${consultation.name}\n\n` +
    `Thank you for submitting your Consultation Request.\n\n` +
    `Your Consultation ID:\n${consultation.consultation_id}\n\n` +
    `Preferred Date:\n${consultation.pref_date}\n\n` +
    `Preferred Time:\n${consultation.pref_time}\n\n` +
    `Our RC5 Expert will contact you within 24 hours.\n\n` +
    `Join our Official RC5 WhatsApp Community:\n${communityLink}\n\n` +
    `Thank you.\nRC5 Elite Motion Team`;

  const clinicMsg =
    `📢 New Consultation Request\n\n` +
    `Consultation ID:\n${consultation.consultation_id}\n\n` +
    `Customer Name:\n${consultation.name}\n\n` +
    `Mobile Number:\n${consultation.mobile}\n\n` +
    `Age:\n${consultation.age}\n\n` +
    `Gender:\n${consultation.gender}\n\n` +
    `Pain Area:\n${consultation.pain_area}\n\n` +
    `Preferred Date:\n${consultation.pref_date}\n\n` +
    `Preferred Time:\n${consultation.pref_time}\n\n` +
    `Status:\nPending\n\n` +
    `Please contact the customer within 24 hours.`;

  await sendWA('91' + consultation.mobile, patientMsg);
  await sendWA(process.env.WA_CLINIC_NUMBER, clinicMsg);
}

async function notifyCancellation(booking) {
  const msg =
    `Hello ${booking.name},\n\n` +
    `Your appointment (${booking.booking_id}) on ${booking.appt_date} at ${booking.appt_time} has been cancelled.\n\n` +
    `Please contact us to reschedule.\n\nThank you.`;
  await sendWA('91' + booking.mobile, msg);
}

async function notifyReschedule(booking) {
  const msg =
    `Hello ${booking.name},\n\n` +
    `Your appointment has been rescheduled.\n\n` +
    `Booking ID: ${booking.booking_id}\n` +
    `New Date: ${booking.appt_date}\n` +
    `New Time: ${booking.appt_time}\n\n` +
    `Please arrive 10 minutes early.\n\nThank you.`;
  await sendWA('91' + booking.mobile, msg);
}

module.exports = { sendWA, notifyBookingConfirmed, notifyConsultationConfirmed, notifyCancellation, notifyReschedule };
