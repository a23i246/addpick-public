// scripts/init-bank-schema.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'database.sqlite'));

const sql = `
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bank_code TEXT,
  branch_code TEXT,
  account_type TEXT CHECK(account_type IN ('futsu','toza','chokin')) NOT NULL,
  account_number_cipher TEXT NOT NULL,
  account_iv TEXT NOT NULL,
  account_tag TEXT NOT NULL,
  holder_kana TEXT NOT NULL,
  mandate_accepted_at TEXT,
  verified INTEGER DEFAULT 0,
  verify_code INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS bank_debit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK(amount_jpy > 0),
  status TEXT CHECK(status IN ('pending','submitted','succeeded','failed','canceled')) NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  scheduled_at TEXT,
  requested_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  failure_reason TEXT,
  UNIQUE(idempotency_key)
);
CREATE TABLE IF NOT EXISTS bank_debit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debit_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);`;
db.exec(sql, (err) => {
  if (err) console.error(err);
  else console.log('Bank mock schema initialized.');
  db.close();
});
