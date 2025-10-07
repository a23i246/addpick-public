const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../database.sqlite');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const csrf = require('csurf');

const upload = multer({
  dest: path.join(__dirname, '../public/uploads'),
  limits: { fileSize: 1 * 1024 * 1024 } // 最大1MB
});

// CSRFミドルウェア（このルート専用）
const csrfProtection = csrf();

// ログイン必須
const requireLogin = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

// // プロフィール表示
router.get('/profile', requireLogin, (req, res, next) => {
  const db = new sqlite3.Database(dbPath);
  const me = req.session.user;
  if (!me) return res.redirect('/login');

  db.get(
    'SELECT id, name, email, bio, profile_image FROM users WHERE id = ?',
    [me.id],
    (err, user) => {
      if (err) { db.close(); return next(err); }
      if (!user) { db.close(); return res.status(404).send('User not found'); }

      db.get(
        `
        SELECT
          (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
          (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers
        `,
        [me.id, me.id],
        (err2, counts) => {
          db.close();
          if (err2) return next(err2);

          res.render('profile', {
            user,
            counts,
            csrfToken: req.csrfToken ? req.csrfToken() : undefined
          });
        }
      );
    }
  );
});

// プロフィール編集画面
router.get('/profile/edit', requireLogin, csrfProtection, (req, res) => {
  const db = new sqlite3.Database(dbPath);
  db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
    db.close();
    if (err || !user) return res.send('ユーザー情報の取得に失敗しました');
    res.render('profile_edit', {
      user,
      csrfToken: req.csrfToken(),
      cspNonce: res.locals?.cspNonce
    });
  });
});

// プロフィール編集処理
router.post(
  '/profile/edit',
  requireLogin,
  upload.single('profile_image'), // 先に multer
  csrfProtection,                 // 次に CSRF チェック
  (req, res) => {
    const { name, bio } = req.body;
    const userId = req.session.user.id;
    const profileImage = req.file ? req.file.filename : null;

    // bioをサニタイズ
    const cleanBio = sanitizeHtml(bio, {
      allowedTags: ['b', 'i', 'em', 'strong', 'a', 'br'],
      allowedAttributes: { 'a': ['href', 'target'] }
    });

    const db = new sqlite3.Database(dbPath);
    const sql = profileImage
      ? 'UPDATE users SET name = ?, bio = ?, profile_image = ? WHERE id = ?'
      : 'UPDATE users SET name = ?, bio = ? WHERE id = ?';
    const params = profileImage
      ? [name, cleanBio, profileImage, userId]
      : [name, cleanBio, userId];

    db.run(sql, params, function (err) {
      db.close();
      if (err) return res.send('更新に失敗しました');
      // セッション更新
      req.session.user.name = name;
      if (profileImage) req.session.user.profile_image = profileImage;
      res.redirect('/profile');
    });
  }
);

module.exports = router;
