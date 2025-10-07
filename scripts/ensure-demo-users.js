// scripts/ensure-demo-data.js
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './dev.sqlite3';
console.log('[DB]', DB_PATH, '=>', path.resolve(DB_PATH));
const db = new sqlite3.Database(DB_PATH);

// ---------- helpers ----------
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
async function tableExists(name) {
  const row = await get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return !!row;
}
async function cols(name) {
  const info = await all(`PRAGMA table_info(${name});`);
  return info.map(c => c.name);
}
function hasAllColumns(colset, req) {
  return req.every(c => colset.includes(c));
}

// ---------- users ----------
async function ensureUsers() {
  if (!(await tableExists('users'))) {
    console.log('⏭️  skip users (table not found)');
    return;
  }
  const c = await cols('users');
  const pwdCol = c.includes('password_hash') ? 'password_hash' : 'password';
  const hasVerified = c.includes('is_verified');
  const ph = await bcrypt.hash('pass1234', 10);

  const users = [
    { role: 'company',    name: 'Demo Company',    email: 'company@example.com' },
    { role: 'influencer', name: 'Demo Influencer', email: 'influencer@example.com' },
    { role: 'buyer',      name: 'Demo Buyer',      email: 'buyer@example.com' },
  ];

  for (const u of users) {
    // INSERT OR IGNORE
    const insertCols = ['role', 'name', 'email', pwdCol].concat(hasVerified ? ['is_verified'] : []);
    const insertVals = [u.role, u.name, u.email, ph].concat(hasVerified ? [1] : []);
    await run(
      `INSERT OR IGNORE INTO users (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`,
      insertVals
    );

    // UPDATE（最新化）
    let set = `role=?, name=?, ${pwdCol}=?`;
    const updVals = [u.role, u.name, ph];
    if (hasVerified) set += `, is_verified=1`;
    updVals.push(u.email);
    await run(`UPDATE users SET ${set} WHERE email=?`, updVals);

    console.log('✔ users ensured:', u.email);
  }
}

// ---------- categories ----------
async function ensureCategories() {
  if (!(await tableExists('categories'))) {
    console.log('⏭️  skip categories (table not found)');
    return;
  }
  const c = await cols('categories');
  const can = {
    name: c.includes('name'),
    slug: c.includes('slug'),
    description: c.includes('description'),
    created_at: c.includes('created_at'),
  };
  const items = [
    { name: 'スイーツ', slug: 'sweets', description: '甘いもの' },
    { name: 'ドリンク', slug: 'beverage', description: '飲料' },
    { name: 'コスメ', slug: 'cosmetics', description: '化粧品' },
  ];

  for (const x of items) {
    // 既存判定（name or slug）
    let where = can.slug ? 'slug=?' : 'name=?';
    let key = can.slug ? x.slug : x.name;
    const found = await get(`SELECT id FROM categories WHERE ${where} LIMIT 1`, [key]);

    if (!found) {
      const colsArr = ['name'].filter(() => can.name);
      if (can.slug) colsArr.push('slug');
      if (can.description) colsArr.push('description');
      if (can.created_at) colsArr.push('created_at');

      const valsArr = [x.name];
      if (can.slug) valsArr.push(x.slug);
      if (can.description) valsArr.push(x.description);
      if (can.created_at) valsArr.push(new Date().toISOString());

      await run(
        `INSERT INTO categories (${colsArr.join(',')}) VALUES (${colsArr.map(() => '?').join(',')})`,
        valsArr
      );
      console.log('✔ categories inserted:', key);
    } else {
      if (can.description) {
        await run(`UPDATE categories SET description=? WHERE id=?`, [x.description, found.id]);
      }
      console.log('✔ categories ensured:', key);
    }
  }
}

// ---------- ad_requests / applications / purchases ----------
async function ensureAdsAndFlows() {
  // テーブル存在チェック
  const hasAdReq = await tableExists('ad_requests');
  if (!hasAdReq) { console.log('⏭️  skip ad_requests (table not found)'); return; }

  const cAds = await cols('ad_requests');
  const requiredAds = ['user_id', 'title', 'description', 'unit_price'];
  if (!hasAllColumns(cAds, requiredAds)) {
    console.log('⏭️  skip ad_requests (required columns missing)');
    return;
  }
  const cApps = (await tableExists('applications')) ? await cols('applications') : [];
  const cPurch = (await tableExists('purchases')) ? await cols('purchases') : [];

  // user ids
  const company = await get(`SELECT id,name FROM users WHERE email=?`, ['company@example.com']);
  const influencer = await get(`SELECT id,name FROM users WHERE email=?`, ['influencer@example.com']);
  const buyer = await get(`SELECT id,name FROM users WHERE email=?`, ['buyer@example.com']);
  if (!company) throw new Error('company@example.com not found (run ensureUsers first)');

  // category id（なければnull）
  let catSweets = null, catBeverage = null;
  if (await tableExists('categories')) {
    const cs = await cols('categories');
    if (cs.includes('slug')) {
      catSweets = (await get(`SELECT id FROM categories WHERE slug='sweets'`))?.id ?? null;
      catBeverage = (await get(`SELECT id FROM categories WHERE slug='beverage'`))?.id ?? null;
    } else if (cs.includes('name')) {
      catSweets = (await get(`SELECT id FROM categories WHERE name='スイーツ'`))?.id ?? null;
      catBeverage = (await get(`SELECT id FROM categories WHERE name='ドリンク'`))?.id ?? null;
    }
  }

  // デモ案件2件
  const ads = [
    {
      key: 'DEMO-AD-1',
      title: '新作スイーツPR',
      description: 'Instagram で写真＋本文（1投稿）',
      unit_price: 3000,
      product_name: '秋のモンブラン',
      company_name: company.name || 'Demo Company',
      deadline: '2030-12-31',
      stock: 50,
      category_id: catSweets,
    },
    {
      key: 'DEMO-AD-2',
      title: 'コーヒー新メニュー',
      description: 'X でのポスト＋画像（1投稿）',
      unit_price: 2000,
      product_name: '深煎りブレンド',
      company_name: company.name || 'Demo Company',
      deadline: '2030-10-31',
      stock: 100,
      category_id: catBeverage,
    }
  ];

  const adIdByKey = {};
  for (const ad of ads) {
    // 既存ヒット（title + user_id 基準）
    const found = await get(`SELECT id FROM ad_requests WHERE title=? AND user_id=? LIMIT 1`, [ad.title, company.id]);
    if (!found) {
      // 可用列だけ使ってINSERT
      const colsAvail = new Set(cAds);
      const colsToUse = ['user_id', 'title', 'description', 'unit_price'].filter(x => colsAvail.has(x));
      if (colsAvail.has('product_name')) colsToUse.push('product_name');
      if (colsAvail.has('company_name')) colsToUse.push('company_name');
      if (colsAvail.has('deadline')) colsToUse.push('deadline');
      if (colsAvail.has('stock')) colsToUse.push('stock');
      if (colsAvail.has('category_id') && ad.category_id != null) colsToUse.push('category_id');
      if (colsAvail.has('created_at')) colsToUse.push('created_at');

      const vals = [company.id, ad.title, ad.description, ad.unit_price];
      if (colsAvail.has('product_name')) vals.push(ad.product_name);
      if (colsAvail.has('company_name')) vals.push(ad.company_name);
      if (colsAvail.has('deadline')) vals.push(ad.deadline);
      if (colsAvail.has('stock')) vals.push(ad.stock);
      if (colsAvail.has('category_id') && ad.category_id != null) vals.push(ad.category_id);
      if (colsAvail.has('created_at')) vals.push(new Date().toISOString());

      await run(
        `INSERT INTO ad_requests (${colsToUse.join(',')}) VALUES (${colsToUse.map(() => '?').join(',')})`,
        vals
      );
      const row = await get(`SELECT id FROM ad_requests WHERE title=? AND user_id=?`, [ad.title, company.id]);
      adIdByKey[ad.key] = row.id;
      console.log('✔ ad_requests inserted:', ad.title);
    } else {
      adIdByKey[ad.key] = found.id;
      // 軽く更新
      await run(`UPDATE ad_requests SET description=?, unit_price=? WHERE id=?`, [ad.description, ad.unit_price, found.id]);
      console.log('✔ ad_requests ensured:', ad.title);
    }
  }

  // applications（インフル応募）
  if (cApps.length) {
    const canApp = new Set(cApps);
    if (influencer) {
      const mk = async (adKey, status) => {
        const adId = adIdByKey[adKey];
        if (!adId) return;
        const present = await get(`SELECT 1 FROM applications WHERE user_id=? AND ad_request_id=? LIMIT 1`, [influencer.id, adId]);
        if (!present) {
          const colsToUse = ['user_id', 'ad_request_id'].filter(x => canApp.has(x));
          const vals = [influencer.id, adId];
          if (canApp.has('status')) { colsToUse.push('status'); vals.push(status); }
          if (canApp.has('created_at')) { colsToUse.push('created_at'); vals.push(new Date().toISOString()); }
          await run(`INSERT INTO applications (${colsToUse.join(',')}) VALUES (${colsToUse.map(() => '?').join(',')})`, vals);
          console.log('✔ applications inserted:', adKey, status);
        } else {
          if (canApp.has('status')) await run(`UPDATE applications SET status=? WHERE user_id=? AND ad_request_id=?`, [status, influencer.id, adId]);
          console.log('✔ applications ensured:', adKey, status);
        }
      };
      await mk('DEMO-AD-1', 'applied');
      await mk('DEMO-AD-2', 'accepted');
    } else {
      console.log('⏭️  skip applications (influencer not found)');
    }
  } else {
    console.log('⏭️  skip applications (table not found)');
  }

  // purchases（購入）
  if (cPurch.length && buyer) {
    const canPur = new Set(cPurch);
    const variantOK = canPur.has('variant');
    const priceFor = (adKey, qty) => {
      const ad = ads.find(a => a.key === adKey);
      const unit = ad ? ad.unit_price : 0;
      const total = unit * qty;
      // 例: company 80%, influencer 10%, platform 10%
      const company_amount = Math.round(total * 0.8);
      const influencer_amount = Math.round(total * 0.1);
      const platform_amount = total - company_amount - influencer_amount;
      return { total, company_amount, influencer_amount, platform_amount };
    };

    async function ensurePurchase(adKey, qty, variant, idemKey) {
      const adId = adIdByKey[adKey];
      if (!adId) return;
      const present = await get(`SELECT 1 FROM purchases WHERE idempotency_key=?`, [idemKey]);
      if (present) { console.log('✔ purchases ensured:', idemKey); return; }

      const { total, company_amount, influencer_amount, platform_amount } = priceFor(adKey, qty);
      const colsToUse = ['ad_request_id', 'buyer_id', 'quantity', 'company_amount', 'influencer_amount', 'platform_amount', 'total_price', 'idempotency_key']
        .filter(x => canPur.has(x));
      const vals = [adId, buyer.id, qty, company_amount, influencer_amount, platform_amount, total, idemKey]
        .filter((v, i) => canPur.has(['ad_request_id','buyer_id','quantity','company_amount','influencer_amount','platform_amount','total_price','idempotency_key'][i]));
      // referred_by_user_id
      if (canPur.has('referred_by_user_id') && influencer) {
        colsToUse.splice(2, 0, 'referred_by_user_id');
        vals.splice(2, 0, influencer.id);
      }
      // variant
      if (variantOK) {
        colsToUse.push('variant');
        vals.push(variant);
      }
      if (canPur.has('created_at')) {
        colsToUse.push('created_at');
        vals.push(new Date().toISOString());
      }
      await run(`INSERT INTO purchases (${colsToUse.join(',')}) VALUES (${colsToUse.map(() => '?').join(',')})`, vals);
      console.log('✔ purchases inserted:', idemKey);
    }

    await ensurePurchase('DEMO-AD-1', 1, 'default', 'demo-001');
    await ensurePurchase('DEMO-AD-2', 2, 'M',       'demo-002');
  } else {
    console.log('⏭️  skip purchases (table not found or buyer missing)');
  }
}

(async () => {
  try {
    await ensureUsers();
    await ensureCategories();
    await ensureAdsAndFlows();
    console.log('✅ demo data ensured (users/categories/ads/applications/purchases)');
  } catch (e) {
    console.error('❌ ensure-demo-data failed:', e);
    process.exit(1);
  } finally {
    db.close();
  }
})();
