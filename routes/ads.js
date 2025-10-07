const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);
const multer = require('multer');
const csrf = require('csurf');
const csrfProtection = csrf();
const sanitizeHtml = require('sanitize-html'); // ★ 追加
const { v4: uuidv4 } = require('uuid');

const upload = multer({
  dest: path.join(__dirname, '../public/uploads'),
  limits: { fileSize: 1 * 1024 * 1024 }
});

function ensureLoggedIn(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  next();
}

// 新規広告依頼フォーム
router.get('/ad_requests/new', csrfProtection, (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  db.all('SELECT * FROM categories', (err, categories) => {
    if (err) return res.send('カテゴリの取得に失敗しました');
    res.render('ad_request_form', {
      user: req.session.user,
      categories,
      adRequest: {},
      csrfToken: req.csrfToken()
    });
  });
});

// 広告依頼登録処理
router.post(
  '/ad_requests',
  upload.single('image_file'),
  csrfProtection,
  (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.id;

    let {
      title,
      product_name,
      company_name,
      reward,
      deadline,
      description,
      unit_price,
      stock,
      category_id
    } = req.body;

    // ★ サニタイズ処理
    title = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
    product_name = sanitizeHtml(product_name, { allowedTags: [], allowedAttributes: {} });
    company_name = sanitizeHtml(company_name, { allowedTags: [], allowedAttributes: {} });
    description = sanitizeHtml(description, {
      allowedTags: ['b', 'i', 'em', 'strong', 'a', 'br'],
      allowedAttributes: { 'a': ['href', 'target'] }
    });

    const imageFile = req.file ? req.file.filename : null;

    const price = parseInt(unit_price, 10) || 0;
    const company_share = Math.floor(price * 0.5);
    const influencer_share = Math.floor(price * 0.3);
    const platform_share = price - company_share - influencer_share;
    const request_fee = price;

    const sql = `
      INSERT INTO ad_requests
        (title, product_name, company_name, image_url, reward, unit_price,
         company_share, influencer_share, platform_share,
         deadline, description, user_id, request_fee, stock, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      title,
      product_name,
      company_name,
      imageFile,
      reward,
      price,
      company_share,
      influencer_share,
      platform_share,
      deadline,
      description,
      userId,
      request_fee,
      parseInt(stock, 10) || 9999,
      parseInt(category_id, 10) || null
    ], function (err) {
      if (err) {
        console.error('広告依頼の登録に失敗:', err);
        db.all('SELECT * FROM categories', (err2, categories) => {
          if (err2) return res.send('カテゴリの再取得に失敗しました');
          return res.render('ad_request_form', {
            error: '広告依頼の登録に失敗しました',
            adRequest: req.body,
            categories,
            user: req.session.user,
            csrfToken: req.csrfToken()
          });
        });
        return;
      }
      res.redirect('/');
    });
  }
);

// 自分の広告依頼一覧
router.get('/ad_requests/list', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const userId = req.session.user.id;

  const sql = `
    SELECT ar.*, 
           a.id AS application_id
    FROM ad_requests ar
    LEFT JOIN applications a
      ON ar.id = a.ad_request_id AND a.user_id = ?
    WHERE ar.user_id = ?
  `;

  db.all(sql, [userId, userId], (err, rows) => {
    if (err) return res.send('データベースエラー');
    res.render('ad_requests_list', {
      requests: rows,
      user: req.session.user
    });
  });
});

// 企業向け広告管理
router.get('/company/ads', (req, res) => {
  if (!req.session.user || req.session.role !== 'company') {
    return res.send('権限がありません');
  }

  const userId = req.session.user.id;

  const sql = `
    SELECT 
      ar.id,
      ar.title,
      ar.product_name,
      ar.deadline,
      COUNT(DISTINCT a.id) AS application_count,
      COUNT(DISTINCT p.id) AS purchase_count
    FROM ad_requests ar
    LEFT JOIN applications a ON ar.id = a.ad_request_id
    LEFT JOIN purchases p ON ar.id = p.ad_request_id
    WHERE ar.user_id = ?
    GROUP BY ar.id
    ORDER BY ar.id DESC
  `;

  db.all(sql, [userId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.send('DBエラー');
    }
    res.render('company_ads_list', { ads: rows, user: req.session.user });
  });
});

router.get('/ad_requests/:id', ensureLoggedIn, (req, res, next) => {
  const adId = Number(req.params.id);
  db.get('SELECT * FROM ad_requests WHERE id=?', [adId], (err, ad) => {
    if (err) return next(err);
    if (!ad) return res.status(404).render('404');
    res.render('ad_show', {
      ad,
      user: req.session.user,
      csrfToken: (typeof req.csrfToken === 'function') ? req.csrfToken() : ''
    });
  });
});

// --- 公式導線：紹介者付きの購入ページ --------------------------------------
// /purchase/ad/:adId/by/:userId にアクセス → 購入ページを描画し、紹介者名をDBから取得して表示
router.get('/purchase/ad/:adId/by/:userId', csrfProtection, (req, res, next) => {
  const adId   = Number(req.params.adId);
  const userId = Number(req.params.userId); // 紹介者（インフルエンサー）
  if (!Number.isFinite(adId) || !Number.isFinite(userId)) {
    return res.status(400).send('Bad request');
  }

  db.get('SELECT * FROM ad_requests WHERE id=?', [adId], (e1, ad) => {
    if (e1) return next(e1);
    if (!ad) return res.status(404).render('404');

    db.get('SELECT * FROM users WHERE id=?', [userId], (e2, u) => {
      if (e2) return next(e2);

      const raw =
        (u && (u.name || u.display_name || u.username || u.email)) ||
        `ユーザー#${userId}`;
      const refName = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} });

      ad.referrer_name = refName; // purchase_page.ejs が表示する

      // ★ 冪等性トークンを発行して EJS に渡す
      const idemToken = uuidv4();

      return res.render('purchase_page', {
        ad,
        user: req.session?.user || null,
        influencerId: userId,                                   // <%= influencerId %>
        csrfToken: (typeof req.csrfToken === 'function') ? req.csrfToken() : '',
        idemToken                                               // <%= idemToken %>
      });
    });
  });
});

module.exports = router;
