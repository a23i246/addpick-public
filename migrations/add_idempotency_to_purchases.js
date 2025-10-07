// migrations/add_idempotency_to_purchases.js
const db = require('../models/db');

module.exports = function ensureIdempotencyKey() {
  db.all('PRAGMA table_info(purchases);', [], (err, cols) => {
    if (err) return console.error(err);
    const has = cols.some(c => c.name === 'idempotency_key');
    if (has) return; // 既にあれば何もしない

    db.serialize(() => {
      db.run('ALTER TABLE purchases ADD COLUMN idempotency_key TEXT;', (e) => {
        if (e) return console.error(e);
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_idempo ON purchases(idempotency_key);',
          (e2) => e2 ? console.error(e2) : console.log('[migrate] idempotency_key added'));
      });
    });
  });
};
