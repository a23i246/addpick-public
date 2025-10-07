const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const csrf = require('csurf');

const csrfProtection = csrf();

// 管理者通知一覧
router.get('/admin/notifications', (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  db.all('SELECT * FROM admin_notifications ORDER BY created_at DESC', (err, rows) => {
    db.close();
    if (err) return res.status(500).send('通知取得失敗');
    res.render('admin_notifications', {
      notifications: rows,
      user: req.session.user,
      csrfToken: req.csrfToken() // ← GETでもフォームがあるなら渡す
    });
  });
});

// 通知再送
router.post('/admin/notifications/:id/resend', csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  db.run(
    'UPDATE admin_notifications SET resent_at = datetime("now") WHERE id = ?',
    [req.params.id],
    (err) => {
      db.close();
      if (err) return res.status(500).send('再送失敗');
      res.redirect('/admin/notifications');
    }
  );
});

// 購入確認画面
router.get('/purchase/ad/:adId/by/:userId', csrfProtection, (req, res) => {
  const { adId, userId } = req.params;

  db.get(
    `SELECT * FROM ads WHERE id = ?`,
    [adId],
    (err, ad) => {
      if (err) {
        console.error(err);
        return res.status(500).send("DB error");
      }
      if (!ad) {
        return res.status(404).send("広告が見つかりません");
      }

      res.render('purchase_confirm', {
        ad,
        userId,
        csrfToken: req.csrfToken()
      });
    }
  );
});

// 購入実行
router.post('/purchase/ad/:adId/by/:userId', csrfProtection, (req, res) => {
  const { adId, userId } = req.params;
  const { quantity } = req.body;

  db.run(
    `INSERT INTO purchases (ad_id, user_id, quantity, purchased_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [adId, userId, quantity],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).send("DB insert error");
      }

      console.log("購入完了:", { adId, userId, quantity });
      res.redirect('/my_purchases'); // 購入履歴ページへ
    }
  );
});

module.exports = router;
