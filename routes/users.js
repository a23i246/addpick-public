// const express = require('express');
// const router = express.Router();
// const sqlite3 = require('sqlite3').verbose();
// const path = require('path');
// const dbPath = path.join(__dirname, '../database.sqlite');
// const csrf = require('csurf');

// const csrfProtection = csrf();

// const requireLogin = (req, res, next) => {
//   if (!req.session?.user) return res.redirect('/login');
//   next();
// };

// router.get('/users', requireLogin, csrfProtection, (req, res) => {
//   const search = req.query.search || '';
//   const db = new sqlite3.Database(dbPath);
//   const q = `
//     SELECT users.id, users.name, users.profile_image,
//           EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = users.id) AS is_following
//     FROM users
//     WHERE name LIKE ? AND users.id != ?
//     ORDER BY users.name ASC
//   `;
//   db.all(q, [req.session.user.id, `%${search}%`, req.session.user.id], (err, users) => {
//     db.close();
//     if (err) return res.status(500).send('DBエラー');
//       res.render('user_list', {
//         users,
//         search,
//         user: req.session.user,
//         csrfToken: req.csrfToken()
//     });
//   });
// });

// router.post('/follow/:id', requireLogin, csrfProtection, (req, res) => {
//   const followerId = req.session.user.id;
//   const followeeId = parseInt(req.params.id, 10);
//   if (followerId === followeeId) return res.redirect('/users');

//   const db = new sqlite3.Database(dbPath);
//   db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)',
//     [followerId, followeeId], (err) => {
//       db.close();
//       if (err) return res.status(500).send('フォローに失敗しました');
//       res.redirect('/users');
//     });
// });

// router.post('/unfollow/:id', requireLogin, csrfProtection, (req, res) => {
//   const followerId = req.session.user.id;
//   const followeeId = parseInt(req.params.id, 10);

//   const db = new sqlite3.Database(dbPath);
//   db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?',
//     [followerId, followeeId], (err) => {
//       db.close();
//       if (err) return res.status(500).send('フォロー解除に失敗しました');
//       res.redirect('/users');
//     });
// });

// router.get('/following', requireLogin, csrfProtection, (req, res) => {
//   const db = new sqlite3.Database(dbPath);
//   const sql = `
//     SELECT u.id, u.name, u.profile_image
//     FROM follows f JOIN users u ON f.followee_id = u.id
//     WHERE f.follower_id = ? ORDER BY u.name
//   `;
//   db.all(sql, [req.session.user.id], (err, rows) => {
//     db.close();
//     if (err) return res.status(500).send('フォロー中ユーザーの取得に失敗しました');
//       res.render('following_list', {
//         followingUsers: rows,
//         user: req.session.user,
//         csrfToken: req.csrfToken()
//     });
//   });
// });

// router.get('/followers', requireLogin, csrfProtection, (req, res) => {
//   const db = new sqlite3.Database(dbPath);
//   const sql = `
//     SELECT u.id, u.name, u.profile_image
//     FROM follows f JOIN users u ON f.follower_id = u.id
//     WHERE f.followee_id = ? ORDER BY u.name
//   `;
//   db.all(sql, [req.session.user.id], (err, rows) => {
//     db.close();
//     if (err) return res.status(500).send('フォロワーの取得に失敗しました');
//       res.render('followers_list', {
//         followers: rows,
//         user: req.session.user,
//         csrfToken: req.csrfToken()
//     });
//   });
// });

// module.exports = router;
