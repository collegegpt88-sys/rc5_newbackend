require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');

const app = express();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// ── Security middleware ──────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = [
  "https://rc5-newfrontend.onrender.com",      // Render frontend
  "https://indigo-spoonbill-956947.hostingersite.com", // Hostinger
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

const corsOptions = {
  origin(origin, callback) {
    // Allow browser requests without Origin (Postman, health checks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS not allowed: " + origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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

// ── Frontend config (driven by .env) ─────────
// Set API_BASE_URL in .env only if frontend + backend are hosted on
// DIFFERENT domains. Leave it blank to auto-use the current origin
// (correct when this same server serves the frontend, as below).
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.API_BASE_URL = ${JSON.stringify(process.env.API_BASE_URL || '')};`);
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
// ── Start server ─────────────────────────────
const PORT = process.env.PORT || 3000;

//extra
app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    workshop: "/api/workshop-dates exists",
    health: "/health exists",
    time: new Date().toISOString()
  });
});


app.listen(PORT, () => {
  console.log(`RC5 backend running on port ${PORT}`);
}); 
