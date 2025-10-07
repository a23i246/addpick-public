const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const csrf = require('csurf');

const csrfProtection = csrf();

const requireCompany = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  if (req.session.role !== 'company') return res.redirect('/login');
  next();
};

router.get('/company/purchases', requireCompany, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const companyId = req.session.user.id;

  db.all(`
    SELECT p.*, ar.title, ar.product_name, ar.unit_price, ar.image_url,
           ar.user_id AS company_id, u.name AS buyer_name, u.email AS buyer_email
    FROM purchases p
    JOIN ad_requests ar ON p.ad_request_id = ar.id
    JOIN users u ON p.buyer_id = u.id
    WHERE ar.user_id = ?
    ORDER BY p.created_at DESC
  `, [companyId], (err, purchases) => {
    db.close();
    if (err) return res.send('購入履歴の取得に失敗しました');
    res.render('company_purchases', { user: req.session.user, purchases });
  });
});

router.post('/company/purchases/:id/handle', requireCompany, csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  db.run('UPDATE purchases SET is_handled = 1 WHERE id = ?', [req.params.id], (err) => {
    db.close();
    if (err) return res.send('対応済みへの更新に失敗しました');
    res.redirect('/company/purchases');
  });
});

//企業統計
router.get('/company/stats', requireCompany, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const companyId = req.session.user.id;

  const sql = `
    SELECT
      COUNT(DISTINCT ar.id) AS total_ads,
      COUNT(DISTINCT a.user_id) AS total_applicants,
      COUNT(DISTINCT p.id) AS total_purchases,
      IFNULL(SUM(p.company_amount), 0) AS total_sales
    FROM ad_requests ar
    LEFT JOIN applications a ON ar.id = a.ad_request_id
    LEFT JOIN purchases p ON ar.id = p.ad_request_id
    WHERE ar.user_id = ?
  `;

  db.get(sql, [companyId], (err, stats) => {
    db.close();
    if (err) {
      console.error('統計SQLエラー:', err);
      return res.send('統計データの取得に失敗しました');
    }
    if (!stats) {
      stats = { total_ads: 0, total_applicants: 0, total_purchases: 0, total_sales: 0 };
    }
    res.render('company_stats', { user: req.session.user, stats });
  });
});

// 企業ホーム
router.get('/company/home', requireCompany, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const companyId = req.session.user.id;

  const sql = `
    SELECT id, title, product_name, deadline, request_fee, stock, image_url
    FROM ad_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.all(sql, [companyId], (err, rows) => {
    db.close();
    if (err) {
      console.error("企業ホームの取得エラー:", err);
      return res.send("企業ホームの取得に失敗しました");
    }
    res.render('company_home', { user: req.session.user, ads: rows || [] });
  });
});

module.exports = router;
