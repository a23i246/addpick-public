// scripts/seed-full.js
require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// --- Promise helpers ---
const run = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(e){ e? rej(e): res(this); }));
const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (e,r)=> e? rej(e): res(r)));
const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e,r)=> e? rej(e): res(r)));

// すべて pass: "pass1234" の bcrypt ハッシュ（コスト10）
const HASH = "$2b$10$pdxMLtn8C05DpR0te/zx4OnAZiNPLvqJjr75KmwwZDSrTquNJJzD.";

// util
const nowMs = () => Date.now();

async function upsertUser({name, email, role, bio=null, notification_email=null}) {
  const row = await get(`SELECT id FROM users WHERE email=?`, [email]);
  // 画像は「画像以外」指定なので profile_image は NULL のまま
  if (row) {
    await run(
      `UPDATE users
         SET name=?, role=?, bio=?, notification_email=?, is_verified=1,
             verify_token=NULL, last_email_sent_at=NULL, reset_token=NULL, reset_expires=NULL
       WHERE id=?`,
      [name, role, bio, notification_email, row.id]
    );
    return row.id;
  } else {
    const r = await run(
      `INSERT INTO users
        (name, email, notification_email, password, role, bio,
         profile_image, is_verified, verify_token, last_email_sent_at, reset_token, reset_expires)
       VALUES (?,?,?,?,?,?,NULL,1,NULL,NULL,NULL,NULL)`,
      [name, email, notification_email, HASH, role, bio]
    );
    return r.lastID;
  }
}

async function ensureCategoryByName(name) {
  const hit = await get(`SELECT id FROM categories WHERE name=?`, [name]);
  if (hit) return hit.id;
  const r = await run(`INSERT INTO categories (name) VALUES (?)`, [name]);
  return r.lastID;
}

function splitShares(unitPrice) {
  const company = Math.floor(unitPrice * 0.8);
  const influencer = Math.floor(unitPrice * 0.1);
  const platform = unitPrice - (company + influencer);
  return {company, influencer, platform};
}

async function ensureAdByTitle({
  user_id, title, description, unit_price, company_name, product_name,
  deadline='2030-12-31', stock=100, category_name='その他'
}) {
  const hit = await get(`SELECT id FROM ad_requests WHERE title=? AND user_id=?`, [title, user_id]);
  const {company, influencer, platform} = splitShares(unit_price);
  const category_id = await ensureCategoryByName(category_name);

  if (hit) {
    await run(
      `UPDATE ad_requests
         SET description=?,
             reward=?, unit_price=?, company_share=?, influencer_share=?, platform_share=?,
             request_fee=0, company_name=?, product_name=?, deadline=?, image_url=NULL,
             stock=?, category_id=?
       WHERE id=?`,
      [description, unit_price, unit_price, company, influencer, platform,
       company_name, product_name, deadline, stock, category_id, hit.id]
    );
    return hit.id;
  } else {
    const r = await run(
      `INSERT INTO ad_requests
       (title, description, reward, unit_price, company_share, influencer_share, platform_share,
        request_fee, user_id, product_name, company_name, deadline, image_url, stock, category_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
      [title, description, unit_price, unit_price, company, influencer, platform,
       0, user_id, product_name, company_name, deadline, stock, category_id]
    );
    return r.lastID;
  }
}

async function insertOrIgnoreApplication(user_id, ad_request_id) {
  await run(
    `INSERT OR IGNORE INTO applications (user_id, ad_request_id) VALUES (?, ?)`,
    [user_id, ad_request_id]
  );
}

async function ensurePurchaseUnique({
  ad_request_id, referred_by_user_id, buyer_id, unit_price, quantity=1, variant='default', is_handled=0
}) {
  // 同一 ad/buyer/variant の購入が無ければ入れる（重複増殖を防止）
  const hit = await get(
    `SELECT id FROM purchases WHERE ad_request_id=? AND buyer_id=? AND IFNULL(variant,'')=IFNULL(?, '')`,
    [ad_request_id, buyer_id, variant]
  );
  const sum = unit_price * quantity;
  const {company, influencer, platform} = splitShares(unit_price);
  const company_amount = company * quantity;
  const influencer_amount = influencer * quantity;
  const platform_amount = platform * quantity;

  if (hit) {
    await run(
      `UPDATE purchases
         SET referred_by_user_id=?,
             quantity=?,
             company_amount=?, influencer_amount=?, platform_amount=?,
             is_handled=?,
             created_at=created_at
       WHERE id=?`,
      [referred_by_user_id, quantity, company_amount, influencer_amount, platform_amount, is_handled, hit.id]
    );
    return hit.id;
  } else {
    const r = await run(
      `INSERT INTO purchases
       (ad_request_id, referred_by_user_id, buyer_id, company_amount, influencer_amount, platform_amount,
        variant, quantity, is_handled)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ad_request_id, referred_by_user_id, buyer_id, company_amount, influencer_amount, platform_amount,
       variant, quantity, is_handled]
    );
    return r.lastID;
  }
}

(async () => {
  try {
    console.log('[DB]', DB_PATH);

    // === Users (画像以外の全列を詰める：画像はNULL) ===
    const adminId = await upsertUser({
      name: 'Demo Admin', email: 'admin@addpick.local', role: 'admin',
      bio: '全体管理用のデモ管理者', notification_email: 'admin_notify@example.com'
    });
    const companyId = await upsertUser({
      name: 'Demo Company', email: 'company@example.com', role: 'company',
      bio: 'デモ用の企業アカウント', notification_email: 'company_notify@example.com'
    });
    const influencerId = await upsertUser({
      name: 'Demo Influencer', email: 'influencer@example.com', role: 'influencer',
      bio: 'デモ用のインフルエンサー', notification_email: 'influencer_notify@example.com'
    });
    const buyerId = await upsertUser({
      name: 'Demo Buyer', email: 'buyer@example.com', role: 'buyer',
      bio: 'デモ用の購入者', notification_email: 'buyer_notify@example.com'
    });
    console.log('[OK] users ready', { adminId, companyId, influencerId, buyerId });

    // === Categories（必要分） ===
    const catSweets = await ensureCategoryByName('スイーツ');
    const catCafe   = await ensureCategoryByName('カフェ');

    // === Ad Requests（全列を埋める。画像だけNULL） ===
    const ad1 = await ensureAdByTitle({
      user_id: companyId,
      title: '新作モンブランPR',
      description: 'Instagramで写真＋本文（ハッシュタグ指定あり）',
      unit_price: 3000,
      company_name: 'Demo Company',
      product_name: '秋のモンブラン',
      deadline: '2030-12-31',
      stock: 50,
      category_name: 'スイーツ'
    });

    const ad2 = await ensureAdByTitle({
      user_id: companyId,
      title: '深煎りブレンドPR',
      description: 'Xでのポスト＋画像1枚（固定文言あり）',
      unit_price: 2000,
      company_name: 'Demo Company',
      product_name: '深煎りブレンド',
      deadline: '2030-10-31',
      stock: 100,
      category_name: 'カフェ'
    });

    console.log('[OK] ad_requests ready', { ad1, ad2 });

    // === Applications（インフルエンサーが両方に応募） ===
    await insertOrIgnoreApplication(influencerId, ad1);
    await insertOrIgnoreApplication(influencerId, ad2);
    console.log('[OK] applications ready');

    // === Purchases（buyer が 2件購入、分配も保存。1件だけ対応済み(=1)） ===
    const p1 = await ensurePurchaseUnique({
      ad_request_id: ad1,
      referred_by_user_id: influencerId,
      buyer_id: buyerId,
      unit_price: 3000,
      quantity: 1,
      variant: 'default',
      is_handled: 0
    });
    const p2 = await ensurePurchaseUnique({
      ad_request_id: ad2,
      referred_by_user_id: influencerId,
      buyer_id: buyerId,
      unit_price: 2000,
      quantity: 2,
      variant: 'M',
      is_handled: 1
    });
    console.log('[OK] purchases ready', { p1, p2 });

    // === ダイジェスト表示 ===
    const users = await all(`SELECT id,name,email,role,is_verified FROM users ORDER BY id`);
    const ads   = await all(`SELECT id,title,unit_price,company_share,influencer_share,platform_share,stock,category_id FROM ad_requests ORDER BY id`);
    const apps  = await all(`SELECT id,user_id,ad_request_id,created_at FROM applications ORDER BY id`);
    const purs  = await all(`SELECT id,ad_request_id,buyer_id,referred_by_user_id,company_amount,influencer_amount,platform_amount,variant,quantity,is_handled FROM purchases ORDER BY id`);

    console.log('\n[users]');    console.table(users);
    console.log('\n[ad_requests]'); console.table(ads);
    console.log('\n[applications]'); console.table(apps);
    console.log('\n[purchases]'); console.table(purs);

    db.close(); process.exit(0);
  } catch (e) {
    console.error(e);
    db.close(); process.exit(1);
  }
})();
