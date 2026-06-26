const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 50,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 8000,
  statement_timeout: 60000,
});

module.exports = pool;
