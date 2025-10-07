// routes/admin.js
const express = require('express');
const router = express.Router();

// スキーマ初期化だけ実行（変数束縛しない）
require('../models/db');

const bcrypt = require('bcrypt');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const csrf = require('csurf');

const csrfProtection = csrf();

// === DBユーティリティ ===
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
console.log('[DB] using', DB_PATH);
const openDB = () => new sqlite3.Database(DB_PATH);

const qOne = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
const qAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));

// === 管理者ガード ===
function ensureAdmin(req, res, next) {
  if (req.session?.user && req.session.user.role === 'admin') return next();
  return res.redirect('/admin/login');
}

router.get('/', ensureAdmin, (req, res) => {
  return res.redirect('/admin/dashboard');
});

// === ログイン画面 ===
router.get('/login', csrfProtection, (req, res) => {
  res.render('admin/login', { error: null, user: null, csrfToken: req.csrfToken() });
});

// === ログイン処理 ===
router.post('/login', csrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const db = openDB();
    const user = await qOne(
      db,
      `SELECT id, name, email, password, role, is_verified
         FROM users
        WHERE email = ? AND role = 'admin'`,
      [email]
    );
    db.close();

    if (!user) return res.render('admin/login', { error: 'ユーザーが見つかりません', user: null, csrfToken: req.csrfToken() });
    if (user.is_verified !== 1) {
      return res.render('admin/login', { error: 'メール認証が未完了です', user: null, csrfToken: req.csrfToken() });
    }

    const ok = bcrypt.compareSync(password || '', user.password);
    if (!ok) return res.render('admin/login', { error: 'メールまたはパスワードが違います', user: null, csrfToken: req.csrfToken() });

    // ログイン成功
    req.session.user = { id: user.id, name: user.name, email: user.email, role: 'admin' };
    return res.redirect('/admin');
  } catch (e) {
    console.error('admin login error:', e);
    return res.render('admin/login', { error: 'サーバーエラーが発生しました', user: null, csrfToken: req.csrfToken() });
  }
});

// === ログアウト ===
router.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// === ダッシュボード ===
router.get('/dashboard', ensureAdmin, async (req, res) => {
  const stats = {
    adCount: 0,
    applicationCount: 0,
    purchaseCount: 0,
    totalFlow: 0,
    totalInfluencer: 0,
    totalCompany: 0,
    totalPlatform: 0,
    totalRequestFee: 0
  };
  const db = openDB();
  try {
    const r1 = await qOne(db, `SELECT COUNT(*) AS count FROM ad_requests`);
    stats.adCount = r1?.count || 0;

    const r2 = await qOne(db, `SELECT COUNT(*) AS count FROM applications`);
    stats.applicationCount = r2?.count || 0;

    const r3 = await qOne(db, `SELECT COUNT(*) AS count FROM purchases`);
    stats.purchaseCount = r3?.count || 0;

    const r4 = await qOne(
      db,
      `SELECT SUM(ar.unit_price * COALESCE(p.quantity,1)) AS totalFlow
         FROM purchases p
         JOIN ad_requests ar ON p.ad_request_id = ar.id`
    );
    stats.totalFlow = r4?.totalFlow || 0;

    const r5 = await qOne(db, `SELECT SUM(COALESCE(influencer_amount,0)) AS totalInfluencer FROM purchases`);
    stats.totalInfluencer = r5?.totalInfluencer || 0;

    const r6 = await qOne(db, `SELECT SUM(COALESCE(company_amount,0)) AS totalCompany FROM purchases`);
    stats.totalCompany = r6?.totalCompany || 0;

    const r7 = await qOne(db, `SELECT SUM(COALESCE(platform_amount,0)) AS totalPlatform FROM purchases`);
    stats.totalPlatform = r7?.totalPlatform || 0;

    const r8 = await qOne(db, `
      SELECT SUM(5000 + (julianday(deadline) - julianday(created_at) + 1) * 100) AS totalRequestFee
      FROM ad_requests
    `);
    stats.totalRequestFee = r8?.totalRequestFee || 0;

    db.close();
    return res.render('admin/dashboard', { stats, user: req.session.user, error: null });
  } catch (e) {
    db.close();
    console.error('dashboard error:', e);
    return res.render('admin/dashboard', { stats, user: req.session.user, error: '取得に失敗しました' });
  }
});

// === 広告依頼一覧 ===
router.get('/ad_requests', ensureAdmin, async (req, res) => {
  const db = openDB();
  try {
    const rows = await qAll(
      db,
      `
      SELECT ar.id, ar.title, ar.reward, ar.deadline, ar.created_at, u.name AS company_name
        FROM ad_requests ar
        JOIN users u ON ar.user_id = u.id
       ORDER BY ar.created_at DESC
      `
    );
    db.close();
    return res.render('admin/ad_requests', { adRequests: rows, error: null, admin: req.session.user });
  } catch (e) {
    db.close();
    console.error('ad_requests error:', e);
    return res.render('admin/ad_requests', { adRequests: [], error: 'データ取得エラー', admin: req.session.user });
  }
});

// === ユーザー一覧 ===
router.get('/users', ensureAdmin, async (req, res) => {
  const db = openDB();
  try {
    const rows = await qAll(
      db,
      `
      SELECT id, name, email, role, is_verified
        FROM users
       ORDER BY id DESC
      `
    );
    db.close();
    return res.render('admin/users', { users: rows, error: null, admin: req.session.user });
  } catch (e) {
    db.close();
    console.error('users error:', e);
    return res.render('admin/users', { users: [], error: 'ユーザー取得エラー', admin: req.session.user });
  }
});

// === 応募履歴一覧 ===
router.get('/applications', ensureAdmin, async (req, res) => {
  const db = openDB();
  try {
    const rows = await qAll(
      db,
      `
      SELECT a.id, a.created_at, u.name AS applicant_name, ar.title AS ad_title
        FROM applications a
        JOIN users u ON a.user_id = u.id
        JOIN ad_requests ar ON a.ad_request_id = ar.id
       ORDER BY a.created_at DESC
      `
    );
    db.close();
    return res.render('admin/applications', { applications: rows, error: null, admin: req.session.user });
  } catch (e) {
    db.close();
    console.error('applications error:', e);
    return res.render('admin/applications', { applications: [], error: '応募履歴取得エラー', admin: req.session.user });
  }
});

// === 購入履歴一覧 ===
router.get('/purchases', ensureAdmin, async (req, res) => {
  const db = openDB();
  try {
    const rows = await qAll(
      db,
      `
      SELECT p.id, p.created_at,
             u_buyer.name    AS buyer_name,
             u_ref.name      AS influencer_name,
             ar.title        AS ad_title
        FROM purchases p
        JOIN users u_buyer    ON p.buyer_id = u_buyer.id
        JOIN users u_ref      ON p.referred_by_user_id = u_ref.id
        JOIN ad_requests ar   ON p.ad_request_id = ar.id
       ORDER BY p.created_at DESC
      `
    );
    db.close();
    return res.render('admin/purchases', { purchases: rows, error: null, admin: req.session.user });
  } catch (e) {
    db.close();
    console.error('purchases error:', e);
    return res.render('admin/purchases', { purchases: [], error: '購入履歴取得エラー', admin: req.session.user });
  }
});

// routes/admin.js （/admin/profile の中だけ差し替え）
router.get('/profile', ensureAdmin, csrfProtection, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const db = openDB();

    let user;
    try {
      // まずは created_at ありでトライ
      user = await qOne(
        db,
        `SELECT id, name, email, role, profile_image, created_at
           FROM users
          WHERE id = ?`,
        [userId]
      );
    } catch (e) {
      // もし列が無ければ、created_at を外して再取得
      if (/no such column:\s*created_at/i.test(e.message)) {
        user = await qOne(
          db,
          `SELECT id, name, email, role, profile_image
             FROM users
            WHERE id = ?`,
          [userId]
        );
        // ビュー側で扱いやすいように null を入れておく
        user.created_at = null;
      } else {
        db.close();
        throw e;
      }
    }

    db.close();
    if (!user) return res.status(404).send('User not found');

    return res.render('admin/profile', {
      user,
      csrfToken: req.csrfToken()
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
