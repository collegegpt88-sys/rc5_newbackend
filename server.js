require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');

const app = express();
app.set('trust proxy', 1);
// ── Security middleware ──────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS: FRONTEND_URL (comma-separated) + known production frontend.
// Localhost / 127.0.0.1 any port is always allowed for local testing.
function stripSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

const allowedOrigins = [...new Set([
  'https://lightcoral-finch-883644.hostingersite.com',
  ...((process.env.FRONTEND_URL || '').split(',')),
].map(stripSlash).filter(Boolean))];

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (_) {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = stripSlash(origin);
  return allowedOrigins.includes(normalized) || isLocalOrigin(origin);
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    console.warn('CORS blocked origin:', origin);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(mongoSanitize());

// Rate limiter — 100 requests per 15 min per IP
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

// ── MongoDB ──────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || '';
let usingMongo = false;

if (MONGO_URI && MONGO_URI !== 'your_mongodb_atlas_uri_here') {
  const connectDB = require('./config/db');
  const { seedBookingCounter } = require('./models/Counter');
  connectDB().then(async () => {
    usingMongo = true;
    await seedBookingCounter();
  });

  // MongoDB routes
  app.use('/api/appointments', require('./routes/bookings'));
  app.use('/api/consultations', require('./routes/consultations'));
  app.use('/api/admin',        require('./routes/admin'));
  app.use('/webhook',          require('./routes/webhook'));

  console.log('Running with MongoDB');
} else {
  // ── Fallback: JSON file routes (existing server logic) ──
  console.log('MONGO_URI not set — running with JSON file database');
  require('./legacy')(app);
}

// ── Frontend config (driven by backend .env when this server serves frontend) ──
// When frontend is hosted separately, use frontend/.env + generate-config.js instead.
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(
    `window.API_BASE_URL = ${JSON.stringify(process.env.API_BASE_URL || '')};\n` +
    `window.WA_CLINIC_NUMBER = ${JSON.stringify(process.env.WA_CLINIC_NUMBER || '')};\n` +
    `window.WHATSAPP_COMMUNITY_LINK = ${JSON.stringify(process.env.WHATSAPP_COMMUNITY_LINK || '')};\n` +
    `window.WA_PREFILL_TEXT = ${JSON.stringify(process.env.WA_PREFILL_TEXT || 'Hi RC5, I want to book a session.')};\n`
  );
});

// ── Serve frontend static files ─────────────
const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Workshop dates ───────────────────────────
app.get('/api/workshop-dates', (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun,1=Mon,...,6=Sat

  function nextWeekday(base, targetDow) {
    const d = new Date(base);
    const diff = (targetDow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function fmt(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function disp(d) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  let d1, d2;
  if (dow === 1 || dow === 2) {
    // Mon or Tue — current Mon+Tue
    d1 = nextWeekday(today, 1);
    d2 = nextWeekday(today, 2);
  } else if (dow === 6 || dow === 0) {
    // Sat or Sun — current Sat+Sun
    d1 = nextWeekday(today, 6);
    d2 = nextWeekday(today, 0);
    if (d2 < d1) d2.setDate(d2.getDate() + 7);
  } else {
    // Wed/Thu/Fri — upcoming Sat+Sun
    d1 = nextWeekday(today, 6);
    d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
  }

  // If both dates have passed, jump to next Mon+Tue
  if (d2 < today) {
    d1 = nextWeekday(today, 1); if (d1 <= today) d1.setDate(d1.getDate() + 7);
    d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
  }

  res.json({
    display: `${disp(d1)} & ${disp(d2)}`,
    dates: [fmt(d1), fmt(d2)],
  });
});

// ── Health check ─────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', db: usingMongo ? 'mongodb' : 'json' }));

// ── Start server ─────────────────────────────
const { execSync } = require('child_process');
const PORT = process.env.PORT || 3000;

function freePort(port) {
  try {
    const out = execSync(`netstat -aon | findstr :${port}`).toString();
    [...new Set(
      out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p) && p !== '0')
    )].forEach(pid => { try { execSync(`taskkill /f /pid ${pid}`); } catch (_) {} });
  } catch (_) {}
}

function startServer() {
  const server = app.listen(PORT, () => console.log(`RC5 backend → http://localhost:${PORT}`));
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} busy — freeing...`);
      freePort(PORT);
      setTimeout(startServer, 1000);
    } else throw err;
  });
}

startServer();

// require('dotenv').config();
// const express     = require('express');
// const cors        = require('cors');
// const helmet      = require('helmet');
// const rateLimit   = require('express-rate-limit');
// const mongoSanitize = require('express-mongo-sanitize');

// const app = express();

// // ── Security middleware ──────────────────────
// app.use(helmet({ contentSecurityPolicy: false }));

// // CORS: allow FRONTEND_URL origins (comma-separated). Falls back to * if unset.
// // const allowedOrigins = (process.env.FRONTEND_URL || '')
// //   .split(',')
// //   .map(s => s.trim())
// //   .filter(Boolean);

// // app.use(cors({
// //   origin: allowedOrigins.length
// //     ? (origin, cb) => {
// //         // Allow non-browser clients (no Origin) and listed frontend URLs
// //         if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
// //         return cb(null, false);
// //       }
// //     : '*',
// //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
// //   allowedHeaders: ['Content-Type', 'Authorization'],
// // }));
// // app.options('*', cors());
// // CORS Configuration
// const allowedOrigins = [
//   'http://127.0.0.1:5502',
//   'http://localhost:5502',
//   'http://127.0.0.1:5501',
//   'http://localhost:5501',
//   'http://127.0.0.1:5500',
//   'http://localhost:5500',
//   ...((process.env.FRONTEND_URL || '')
//     .split(',')
//     .map(s => s.trim())
//     .filter(Boolean))
// ];

// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }

//     return callback(new Error('Not allowed by CORS'));
//   },
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true
// }));
// app.use(express.json());
// app.use(mongoSanitize());

// // Rate limiter — 100 requests per 15 min per IP
// app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

// // ── MongoDB ──────────────────────────────────
// const MONGO_URI = process.env.MONGO_URI || '';
// let usingMongo = false;

// if (MONGO_URI && MONGO_URI !== 'your_mongodb_atlas_uri_here') {
//   const connectDB = require('./config/db');
//   const { seedBookingCounter } = require('./models/Counter');
//   connectDB().then(async () => {
//     usingMongo = true;
//     await seedBookingCounter();
//   });

//   // MongoDB routes
//   app.use('/api/appointments', require('./routes/bookings'));
//   app.use('/api/consultations', require('./routes/consultations'));
//   app.use('/api/admin',        require('./routes/admin'));
//   app.use('/webhook',          require('./routes/webhook'));

//   console.log('Running with MongoDB');
// } else {
//   // ── Fallback: JSON file routes (existing server logic) ──
//   console.log('MONGO_URI not set — running with JSON file database');
//   require('./legacy')(app);
// }

// // ── Frontend config (driven by backend .env when this server serves frontend) ──
// // When frontend is hosted separately, use frontend/.env + generate-config.js instead.
// app.get('/config.js', (req, res) => {
//   res.type('application/javascript');
//   res.send(
//     `window.API_BASE_URL = ${JSON.stringify(process.env.API_BASE_URL || '')};\n` +
//     `window.WA_CLINIC_NUMBER = ${JSON.stringify(process.env.WA_CLINIC_NUMBER || '')};\n` +
//     `window.WHATSAPP_COMMUNITY_LINK = ${JSON.stringify(process.env.WHATSAPP_COMMUNITY_LINK || '')};\n` +
//     `window.WA_PREFILL_TEXT = ${JSON.stringify(process.env.WA_PREFILL_TEXT || 'Hi RC5, I want to book a session.')};\n`
//   );
// });

// // ── Serve frontend static files ─────────────
// const path = require('path');
// app.use(express.static(path.join(__dirname, '../frontend')));

// // ── Workshop dates ───────────────────────────
// app.get('/api/workshop-dates', (req, res) => {
//   const today = new Date();
//   today.setHours(0, 0, 0, 0);
//   const dow = today.getDay(); // 0=Sun,1=Mon,...,6=Sat

//   function nextWeekday(base, targetDow) {
//     const d = new Date(base);
//     const diff = (targetDow - d.getDay() + 7) % 7;
//     d.setDate(d.getDate() + diff);
//     return d;
//   }
//   function fmt(d) {
//     return d.getFullYear() + '-' +
//       String(d.getMonth() + 1).padStart(2, '0') + '-' +
//       String(d.getDate()).padStart(2, '0');
//   }
//   function disp(d) {
//     const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
//     return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
//   }

//   let d1, d2;
//   if (dow === 1 || dow === 2) {
//     // Mon or Tue — current Mon+Tue
//     d1 = nextWeekday(today, 1);
//     d2 = nextWeekday(today, 2);
//   } else if (dow === 6 || dow === 0) {
//     // Sat or Sun — current Sat+Sun
//     d1 = nextWeekday(today, 6);
//     d2 = nextWeekday(today, 0);
//     if (d2 < d1) d2.setDate(d2.getDate() + 7);
//   } else {
//     // Wed/Thu/Fri — upcoming Sat+Sun
//     d1 = nextWeekday(today, 6);
//     d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
//   }

//   // If both dates have passed, jump to next Mon+Tue
//   if (d2 < today) {
//     d1 = nextWeekday(today, 1); if (d1 <= today) d1.setDate(d1.getDate() + 7);
//     d2 = new Date(d1); d2.setDate(d1.getDate() + 1);
//   }

//   res.json({
//     display: `${disp(d1)} & ${disp(d2)}`,
//     dates: [fmt(d1), fmt(d2)],
//   });
// });

// // ── Health check ─────────────────────────────
// app.get('/health', (req, res) => res.json({ status: 'ok', db: usingMongo ? 'mongodb' : 'json' }));

// // ── Start server ─────────────────────────────
// const { execSync } = require('child_process');
// const PORT = process.env.PORT || 3000;

// function freePort(port) {
//   try {
//     const out = execSync(`netstat -aon | findstr :${port}`).toString();
//     [...new Set(
//       out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p) && p !== '0')
//     )].forEach(pid => { try { execSync(`taskkill /f /pid ${pid}`); } catch (_) {} });
//   } catch (_) {}
// }

// function startServer() {
//   const server = app.listen(PORT, () => console.log(`RC5 backend → http://localhost:${PORT}`));
//   server.on('error', err => {
//     if (err.code === 'EADDRINUSE') {
//       console.log(`Port ${PORT} busy — freeing...`);
//       freePort(PORT);
//       setTimeout(startServer, 1000);
//     } else throw err;
//   });
// }

// startServer();
