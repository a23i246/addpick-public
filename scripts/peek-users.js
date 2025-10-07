// scripts/peek-users.js
require('dotenv').config();
const s = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || './dev.sqlite3';
console.log('[DB_PATH]', DB_PATH, '=>', path.resolve(DB_PATH));

const db = new s.Database(DB_PATH);

function inspectUsersTable(db) {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(users);', [], (err, rows) => {
      if (err) return reject(err);
      const names = rows.map(r => r.name);
      resolve({
        hasPwdHash: names.includes('password_hash'),
        hasVerified: names.includes('is_verified')
      });
    });
  });
}

(async () => {
  const info = await inspectUsersTable(db);
  const pwdCol = info.hasPwdHash ? 'password_hash' : 'password';
  const verExpr = info.hasVerified ? 'is_verified' : '1';

  const SQL = `
    SELECT id,email,role, ${verExpr} AS v, ${pwdCol} AS h
    FROM users
    ORDER BY id
  `;

  db.all(SQL, [], (e, rows) => {
    if (e) throw e;
    rows.forEach(x => {
      const h = x.h || '';
      console.log(
        x.id, x.email, x.role,
        'v=' + x.v,
        'hashLen=' + h.length,
        (h.slice(0, 7) || '') + '...'
      );
    });
    db.close();
  });
})().catch(err => {
  console.error(err);
  db.close();
});
