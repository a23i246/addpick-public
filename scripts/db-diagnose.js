// scripts/db-diagnose.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e, r)=> e? rej(e): res(r)));
const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (e, r)=> e? rej(e): res(r)));

(async () => {
  try {
    console.log('[DB]', DB_PATH);
    const tables = await all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    if (tables.length === 0) {
      console.log('No tables found.');
      db.close(); process.exit(0);
    }

    // テーブルごとの件数
    for (const t of tables) {
      const cnt = await get(`SELECT COUNT(1) AS c FROM "${t.name}"`);
      console.log(`${t.name}: ${cnt.c} rows`);
    }

    // 主要テーブルのサンプル表示
    const tryShow = async (name, cols='*', limit=5) => {
      try {
        const rows = await all(`SELECT ${cols} FROM "${name}" LIMIT ${limit}`);
        if (rows.length) {
          console.log(`\n--- sample: ${name} ---`);
          console.table(rows);
        }
      } catch {}
    };

    await tryShow('users', 'id, name, email, role, is_verified');
    await tryShow('ad_requests', 'id, user_id, title, unit_price');
    await tryShow('applications', 'id, user_id, ad_request_id');
    await tryShow('purchases', 'id, ad_request_id, referred_by_user_id, buyer_id, quantity');

    db.close(); process.exit(0);
  } catch (e) {
    console.error(e);
    db.close(); process.exit(1);
  }
})();