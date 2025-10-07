const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const csrf = require('csurf');

const csrfProtection = csrf();

// カート一覧
router.get('/cart', csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.all(
    `SELECT c.*, ar.title, ar.reward 
       FROM cart c 
       JOIN ad_requests ar ON c.ad_request_id = ar.id
      WHERE c.user_id = ?`,
    [userId],
    (err, rows) => {
      db.close();
      if (err) return res.status(500).send('カート取得失敗');
      res.render('cart', {
        items: rows,
        user: req.session.user,
        csrfToken: req.csrfToken()
      });
    }
  );
});

// カート追加
router.post('/cart/add/:adId', csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.run(
    'INSERT INTO cart (user_id, ad_request_id, created_at) VALUES (?, ?, datetime("now"))',
    [userId, req.params.adId],
    (err) => {
      db.close();
      if (err) return res.status(500).send('追加失敗');
      res.redirect('/cart');
    }
  );
});

// チェックアウト
router.post('/cart/checkout', csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.run(
    'DELETE FROM cart WHERE user_id = ?',
    [userId],
    (err) => {
      db.close();
      if (err) return res.status(500).send('チェックアウト失敗');
      res.redirect('/purchases');
    }
  );
});

module.exports = router;
