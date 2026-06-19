const jwt = require('jsonwebtoken');
const pool = require('../db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Malformed authorization header' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch fresh user data from DB -- do not rely on JWT payload for PII
    const result = await pool.query('SELECT id, email, name FROM users WHERE id=$1', [payload.id]);
    if (!result.rows[0]) return res.status(401).json({ error: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authenticate;
