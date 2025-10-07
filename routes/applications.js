// routes/applications.js
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const csrf = require('csurf');
const csrfProtection = csrf();

// ロール必須ミドルウェア（簡易版）
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.role !== role) return res.status(403).send('アクセス権限がありません');
    next();
  };
}

// 応募処理
router.post('/applications/:adRequestId', requireRole('influencer'), csrfProtection, (req, res) => {
  const userId = req.session.user.id;
  const adRequestId = req.params.adRequestId;

  db.run(
    'INSERT OR IGNORE INTO applications (user_id, ad_request_id) VALUES (?, ?)',
    [userId, adRequestId],
    function (err) {
      if (err) return res.send('応募に失敗しました');
      res.redirect('/my_applications');
    }
  );
});

// 応募履歴一覧
// ※ グローバルで csurf を使っていない場合は、ここにも csrfProtection を付けておくと確実です。
router.get('/my_applications', /* csrfProtection, */ (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  const userId = req.session.user.id;

  // テンプレが参照する列をすべて取得し、期待する別名を付ける
 const sql = `
    SELECT
      a.id                    AS id,
      NULL                    AS status,       -- ← まだ列が無いのでダミー
      a.created_at            AS applied_at,   -- ← 応募日時は applications.created_at を使う
      ar.id                   AS request_id,
      ar.title                AS title,
      ar.company_name         AS company_name,
      ar.image_url AS image_url,
      ar.description          AS description,
      ar.created_at           AS created_at
    FROM applications a
    JOIN ad_requests ar ON a.ad_request_id = ar.id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC
  `;

  db.all(sql, [userId], (err, rows) => {
    if (err) return next(err);

    // csurf をグローバルで有効にしていない場合に備えフォールバック
    const token = (typeof req.csrfToken === 'function') ? req.csrfToken() : '';

    // テンプレが期待する 'apps' という名前で渡す（配列で保証）
    res.render('my_applications', { 
      title: '応募一覧',
      apps: Array.isArray(rows) ? rows : [],
      csrfToken: token,
      user: req.session.user,
      cspNonce: res.locals?.cspNonce
    });
  });
});

module.exports = router;
