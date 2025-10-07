// scripts/seed-minimal.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

const run = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(e){ e? rej(e): res(this)}));
const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (e,r)=> e? rej(e): res(r)));
const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e,r)=> e? rej(e): res(r)));

const HASH = "$2b$10$pdxMLtn8C05DpR0te/zx4OnAZiNPLvqJjr75KmwwZDSrTquNJJzD."; // pass: pass1234

async function hasTable(name) {
  const r = await get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return !!r;
}
async function colSet(name) {
  const cols = await all(`PRAGMA table_info("${name}")`);
  return new Set(cols.map(c => c.name));
}
async function upsertUser(name, email, role) {
  const row = await get(`SELECT id FROM users WHERE email=?`, [email]);
  if (row) {
    await run(`UPDATE users SET name=?, role=?, is_verified=1 WHERE id=?`, [name, role, row.id]);
    return row.id;
  } else {
    const r = await run(
      `INSERT INTO users (name, email, password, role, is_verified) VALUES (?,?,?,?,1)`,
      [name, email, HASH, role]
    );
    return r.lastID;
  }
}

(async () => {
  try {
    console.log('[DB]', DB_PATH);

    // --- users ---
    if (!(await hasTable('users'))) throw new Error('users table not found');
    const adminId = await upsertUser('Demo Admin', 'admin@addpick.local', 'admin');
    const companyId = await upsertUser('Demo Company', 'company@example.com', 'company');
    const influencerId = await upsertUser('Demo Influencer', 'influencer@example.com', 'influencer');
    const buyerId = await upsertUser('Demo Buyer', 'buyer@example.com', 'buyer');
    console.log('[OK] users upserted:', { adminId, companyId, influencerId, buyerId });

    // --- categories (あれば2件だけ) ---
    if (await hasTable('categories')) {
      const c = await get(`SELECT COUNT(1) AS c FROM categories`);
      if (c.c === 0) {
        // 列名の違い吸収（category / name）
        const cols = await colSet('categories');
        if (cols.has('category')) {
          await run(`INSERT INTO categories (category) VALUES (?), (?)`, ['スイーツ','カフェ']);
        } else if (cols.has('name')) {
          await run(`INSERT INTO categories (name) VALUES (?), (?)`, ['スイーツ','カフェ']);
        }
        console.log('[OK] categories seeded (2 rows)');
      }
    }

    // --- ad_requests ---
    if (await hasTable('ad_requests')) {
      const cols = await colSet('ad_requests');
      const cnt = await get(`SELECT COUNT(1) AS c FROM ad_requests`);
      if (cnt.c === 0) {
        // 動作最小限の列を動的に組み立て
        const base = { user_id: companyId, title: '新作スイーツPR', description: 'Instagram投稿' };
        const base2 = { user_id: companyId, title: 'コーヒー新メニュー', description: 'Xポスト' };

        const a1 = { unit_price: 3000 };
        const a2 = { unit_price: 2000 };

        const mkInsert = async (obj) => {
          const data = { ...obj };
          // ある列だけ埋める
          const addIf = (k, v) => { if (cols.has(k)) data[k] = v; };
          addIf('company_name', 'Demo Company');
          addIf('product_name', data.title);
          addIf('unit_price', obj.unit_price || null);
          if (cols.has('company_share') && cols.has('influencer_share') && cols.has('platform_share') && obj.unit_price) {
            const company_share = Math.floor(obj.unit_price * 0.8);
            const influencer_share = Math.floor(obj.unit_price * 0.1);
            const platform_share = obj.unit_price - (company_share + influencer_share);
            addIf('company_share', company_share);
            addIf('influencer_share', influencer_share);
            addIf('platform_share', platform_share);
          }
          addIf('deadline', '2030-12-31');
          addIf('stock', 100);
          if (cols.has('category_id')) data['category_id'] = 1;

          const keys = Object.keys(data);
          const placeholders = keys.map(()=>'?').join(',');
          const sql = `INSERT INTO ad_requests (${keys.join(',')}) VALUES (${placeholders})`;
          const vals = keys.map(k => data[k]);
          return run(sql, vals);
        };

        const r1 = await mkInsert({ ...base, ...a1 });
        const r2 = await mkInsert({ ...base2, ...a2 });
        console.log('[OK] ad_requests seeded:', { ad1: r1.lastID, ad2: r2.lastID });

        // --- applications (influencerが両方に応募) ---
        if (await hasTable('applications')) {
          const appCols = await colSet('applications');
          const insertApp = async (adId) => {
            const colsArr = ['user_id','ad_request_id'];
            const valsArr = [influencerId, adId];
            if (appCols.has('status')) { colsArr.push('status'); valsArr.push('applied'); }
            const sql = `INSERT OR IGNORE INTO applications (${colsArr.join(',')}) VALUES (${colsArr.map(()=>'?').join(',')})`;
            await run(sql, valsArr);
          };
          await insertApp(r1.lastID);
          await insertApp(r2.lastID);
          console.log('[OK] applications seeded');
        }

        // --- purchases (buyerが2件購入、紹介はinfluencer) ---
        if (await hasTable('purchases')) {
          const pCols = await colSet('purchases');
          const insertPurchase = async (adId, unitPrice, qty) => {
            const vals = {};
            const addIf = (k, v) => { if (pCols.has(k)) vals[k] = v; };
            // 必須
            vals['ad_request_id'] = adId;
            addIf('referred_by_user_id', influencerId);
            addIf('buyer_id', buyerId);
            // 金額（列がある場合のみ）
            if (pCols.has('company_amount') && pCols.has('influencer_amount') && pCols.has('platform_amount')) {
              const comp = Math.floor(unitPrice * 0.8) * qty;
              const infl = Math.floor(unitPrice * 0.1) * qty;
              const plat = unitPrice * qty - (comp + infl);
              vals['company_amount'] = comp;
              vals['influencer_amount'] = infl;
              vals['platform_amount'] = plat;
            }
            addIf('variant', 'default');
            addIf('quantity', qty);

            const keys = Object.keys(vals);
            const sql = `INSERT INTO purchases (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;
            const res = await run(sql, keys.map(k => vals[k]));
            return res.lastID;
          };
          await insertPurchase(r1.lastID, 3000, 1);
          await insertPurchase(r2.lastID, 2000, 2);
          console.log('[OK] purchases seeded');
        }
      } else {
        console.log(`[SKIP] ad_requests already has ${cnt.c} rows`);
      }
    }

    console.log('[DONE] minimal seed finished.');
    db.close(); process.exit(0);
  } catch (e) {
    console.error(e);
    db.close(); process.exit(1);
  }
})();
