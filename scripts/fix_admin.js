// scripts/fix_admin.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin0490@example.com';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrator';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '04902513';

console.log('[fix] DB_PATH =', DB_PATH);
const db = new sqlite3.Database(DB_PATH);

const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

// emailが一意制約になっている前提でUPSERT
const sql = `
INSERT INTO users (name, email, password, role, is_verified)
VALUES (?, ?, ?, 'admin', 1)
ON CONFLICT(email) DO UPDATE
  SET password=excluded.password, role='admin', is_verified=1, name=excluded.name
`;
db.run(sql, [ADMIN_NAME, ADMIN_EMAIL, hash], function (e) {
  if (e) {
    console.error('[fix] upsert error:', e.message);
    db.close();
    process.exit(1);
  }
  console.log('[fix] admin upserted:', ADMIN_EMAIL);
  db.get(
    `SELECT id, name, email, role, is_verified FROM users WHERE email=?`,
    [ADMIN_EMAIL],
    (e2, row) => {
      if (e2) console.error('[fix] select error:', e2.message);
      else console.log('[fix] current:', row);
      db.close();
    }
  );
});
