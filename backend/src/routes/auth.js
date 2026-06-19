const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pool = require('../db');
const router = express.Router();

// -- Rate limiter: shared for all auth endpoints ----------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// -- Validation schemas -----------------------------------------------------
const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

// -- Small body limit for auth routes ---------------------------------------
const smallBody = express.json({ limit: '16kb' });

// -- Dummy hash for constant-time comparison when user does not exist -------
// Pre-computed at startup so bcrypt.compare timing matches a real comparison.
let DUMMY_HASH = null;
(async () => { DUMMY_HASH = await bcrypt.hash('__dummy_password_noop__', 12); })();

router.post('/register', authLimiter, smallBody, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { email, password, name } = parsed.data;
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hash, name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error('[register]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, smallBody, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { email, password } = parsed.data;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    // Constant-time comparison even when user does not exist (prevents timing-based enumeration)
    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, DUMMY_HASH || '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
    if (!user || !valid) return res.status(401).json({ error: 'Invalid credentials' });
    // JWT payload contains only the user ID -- no PII
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
