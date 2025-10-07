const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const csrf = require('csurf');
const csrfProtection = csrf();

const requireInfluencer = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  if (req.session.role !== 'influencer') return res.redirect('/login');
  next();
};

// ========================
// インフルエンサーのホーム
// ========================
router.get('/influencer/home', requireInfluencer, csrfProtection, (req, res) => {
  const db = new sqlite3.Database('database.sqlite');
  const userId = req.session.user.id;

  const keyword = req.query.keyword || '';
  const selectedCategory = req.query.category || '';
  const sort = req.query.sort || '';

  let adSql = `
    SELECT ar.id, ar.title, ar.product_name, ar.reward, ar.deadline,
           ar.image_url, ar.stock, ar.category_id,
           ap.id AS application_id   -- ✅ 応募済みなら ID が入る
    FROM ad_requests ar
    LEFT JOIN applications ap 
      ON ar.id = ap.ad_request_id AND ap.user_id = ?
    WHERE ar.deadline >= date('now')
  `;
  const params = [userId];

  if (keyword) {
    adSql += ` AND (ar.title LIKE ? OR ar.product_name LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (selectedCategory) {
    adSql += ` AND ar.category_id = ?`;
    params.push(selectedCategory);
  }

  if (sort === 'price_asc') {
    adSql += ` ORDER BY ar.reward ASC`;
  } else if (sort === 'price_desc') {
    adSql += ` ORDER BY ar.reward DESC`;
  } else {
    adSql += ` ORDER BY ar.created_at DESC`;
  }

  db.all(adSql, params, (err, ads) => {
    if (err) {
      db.close();
      console.error("インフルエンサーホーム取得エラー:", err);
      return res.send("ホームの取得に失敗しました");
    }

    db.all('SELECT id, name FROM categories ORDER BY id', [], (err2, categories) => {
      db.close();
      if (err2) {
        console.error("カテゴリ取得エラー:", err2);
        return res.send("カテゴリ取得に失敗しました");
      }

      res.render('influencer_home', {
        user: req.session.user,
        ads,
        keyword,
        categories,
        selectedCategory,
        sort,
        csrfToken: req.csrfToken()
      });
    });
  });
});

// ========================
// インフルエンサーの報酬ページ（廃止）
// ========================
// router.get('/influencer/rewards', requireInfluencer, (req, res) => {
//   const db = new sqlite3.Database('database.sqlite');
//   const userId = req.session.user.id;

//   const sql = `
//     SELECT ar.title, COUNT(p.id) AS purchase_count, SUM(p.influencer_amount) AS total_reward
//     FROM purchases p
//     JOIN ad_requests ar ON p.ad_request_id = ar.id
//     WHERE p.referred_by_user_id = ?
//     GROUP BY ar.id
//     ORDER BY total_reward DESC
//   `;
//   db.all(sql, [userId], (err, rows) => {
//     db.close();
//     if (err) return res.send('報酬データ取得に失敗しました');

//     const total = rows.reduce((sum, r) => sum + (r.total_reward || 0), 0);
//     res.render('influencer_rewards', { rewards: rows, totalReward: total, user: req.session.user });
//   });
// });

module.exports = router;
