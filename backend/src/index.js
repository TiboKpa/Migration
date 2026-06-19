require('dotenv').config();

// -- Startup secret guard ---------------------------------------------------
const BANNED_SECRETS = ['change_me_jwt_secret', 'change_me', 'REPLACE_WITH_STRONG_SECRET', 'REPLACE_WITH_STRONG_PASSWORD', ''];
if (!process.env.JWT_SECRET || BANNED_SECRETS.includes(process.env.JWT_SECRET)) {
  console.error('FATAL: JWT_SECRET is not set or uses a default placeholder. Set a strong secret before starting.');
  process.exit(1);
}
if (!process.env.DB_PASSWORD || BANNED_SECRETS.includes(process.env.DB_PASSWORD)) {
  console.error('FATAL: DB_PASSWORD is not set or uses a default placeholder. Set a strong password before starting.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const migrate = require('./migrate');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const userListRoutes = require('./routes/userList');
const trainingMatrixRoutes = require('./routes/trainingMatrix');
const templateRoutes = require('./routes/templates');
const generationRoutes = require('./routes/generation');
const campaignRoutes = require('./routes/campaigns');
const roleMatrixRoutes = require('./routes/roleMatrix');

const app = express();

// -- Trust first proxy (Nginx Proxy Manager) --------------------------------
// Required so express-rate-limit reads the real client IP from X-Forwarded-For
// instead of the proxy IP. Set to 1 because there is exactly one proxy in front.
app.set('trust proxy', 1);

// -- Security headers -------------------------------------------------------
app.use(helmet());

// -- CORS: explicit origin only ---------------------------------------------
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// -- Request logging (path only, no query string to avoid leaking params) ---
morgan.token('path-only', (req) => req.path);
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :path-only HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'));

// -- Global rate limiter ----------------------------------------------------
// Applied before all routes. Authenticated or not, every IP is capped.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);

// -- Body parsing -----------------------------------------------------------
app.use(express.json({ limit: '10mb' }));

// -- Routes -----------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', userListRoutes);
app.use('/api/projects', trainingMatrixRoutes);
app.use('/api/projects', templateRoutes);
app.use('/api/projects', generationRoutes);
app.use('/api/projects', campaignRoutes);
app.use('/api/projects', roleMatrixRoutes);

const PORT = process.env.PORT || 4000;

migrate()
  .then(() => app.listen(PORT, () => console.log(`Backend running on port ${PORT}`)))
  .catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
