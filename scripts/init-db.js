// scripts/init-db.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

// 1) DBファイルの場所（.envのDB_PATHを使う）
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database.sqlite");

// 2) 既存DBを削除（デモ用：毎回作り直す）
try { fs.unlinkSync(DB_PATH); } catch {}

// 3) アプリ本体のスキーマ作成ロジックを実行（models/db.js）
process.env.DB_PATH = DB_PATH; // 念のため明示
const appDb = require("../models/db"); // ← これで全テーブルが作成され、admin自動作成も走る

// 4) ここからシード投入
const db = new sqlite3.Database(DB_PATH);

// 便利関数
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

// デモ用ユーザー4種（すべて pass1234）
const PASS = "pass1234";
// 事前に作ったbcrypt（コスト10）。別のハッシュでもOK。
const HASH = "$2b$10$pdxMLtn8C05DpR0te/zx4OnAZiNPLvqJjr75KmwwZDSrTquNJJzD.";

async function upsertUser(name, email, role) {
  const row = await get("SELECT id FROM users WHERE email=?", [email]);
  if (row) {
    await run("UPDATE users SET name=?, role=?, is_verified=1 WHERE id=?", [name, role, row.id]);
    return row.id;
  } else {
    const r = await run(
      "INSERT INTO users (name, email, password, role, is_verified) VALUES (?,?,?,?,1)",
      [name, email, HASH, role]
    );
    return r.lastID;
  }
}

(async () => {
  try {
    // 4-1) ユーザー
    const adminId = await upsertUser("Demo Admin", "admin@addpick.local", "admin");
    const compId  = await upsertUser("Demo Company", "company@example.com", "company");
    const inflId  = await upsertUser("Demo Influencer", "influencer@example.com", "influencer");
    const buyerId = await upsertUser("Demo Buyer", "buyer@example.com", "buyer");

    // 4-2) 案件（companyが作成）
    // 単価→分配(80/10/10)を計算する小関数
    const split = (price) => ({
      unit_price: price,
      company: Math.floor(price * 0.8),
      influencer: Math.floor(price * 0.1),
      platform: price - (Math.floor(price * 0.8) + Math.floor(price * 0.1))
    });

    const a1 = split(3000);
    const a2 = split(2000);

    const ad1 = await run(
      `INSERT INTO ad_requests
        (user_id, title, description, unit_price, company_share, influencer_share, platform_share,
         request_fee, product_name, company_name, deadline, image_url, stock, category_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [compId, '新作スイーツPR', 'Instagramで写真＋本文', a1.unit_price, a1.company, a1.influencer, a1.platform,
       0, '秋のモンブラン', 'Demo Company', '2030-12-31', null, 50, 1]
    );

    const ad2 = await run(
      `INSERT INTO ad_requests
        (user_id, title, description, unit_price, company_share, influencer_share, platform_share,
         request_fee, product_name, company_name, deadline, image_url, stock, category_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [compId, 'コーヒー新メニュー', 'Xでのポスト＋画像', a2.unit_price, a2.company, a2.influencer, a2.platform,
       0, '深煎りブレンド', 'Demo Company', '2030-10-31', null, 100, 2]
    );

    // 4-3) 応募（influencer）
    await run(`INSERT OR IGNORE INTO applications (user_id, ad_request_id) VALUES (?, ?)`, [inflId, ad1.lastID]);
    await run(`INSERT OR IGNORE INTO applications (user_id, ad_request_id) VALUES (?, ?)`, [inflId, ad2.lastID]);

    // 4-4) 購入（buyer=buyerId / 紹介=influencer=inflId）
    await run(
      `INSERT INTO purchases (ad_request_id, referred_by_user_id, buyer_id, company_amount, influencer_amount, platform_amount, variant, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ad1.lastID, inflId, buyerId, a1.company, a1.influencer, a1.platform, 'default', 1]
    );
    await run(
      `INSERT INTO purchases (ad_request_id, referred_by_user_id, buyer_id, company_amount, influencer_amount, platform_amount, variant, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ad2.lastID, inflId, buyerId, a2.company * 2, a2.influencer * 2, a2.platform * 2, 'M', 2]
    );

    console.log(`[OK] Demo DB initialized at ${DB_PATH}`);
    db.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    db.close();
    process.exit(1);
  }
})();
