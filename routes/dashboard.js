const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// 企業ダッシュボード
router.get('/', (req, res) => {
  if (!req.session || !req.session.user || req.session.role !== 'company') {
    return res.redirect('/login');
  }

  const companyId = req.session.user.id;
  const stats = {};
  const chartData = { labels: [], data: [] };

  // 1. 月別購入数データ
  db.all(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
    FROM purchases
    WHERE ad_request_id IN (
        SELECT id FROM ad_requests WHERE user_id = ?
    )
    GROUP BY month
    ORDER BY month DESC
    LIMIT 6
  `, [companyId], (err, rows) => {
    if (err) return res.send('月別購入数の取得に失敗しました');

    chartData.labels = rows.map(r => r.month).reverse();
    chartData.data = rows.map(r => r.count).reverse();

    // 2. 広告数
    db.get(`SELECT COUNT(*) AS count FROM ad_requests WHERE user_id = ?`, [companyId], (err, row) => {
      if (err || !row) return res.send('広告数の取得に失敗しました');
      stats.adCount = row.count;

      // 3. 応募数
      db.get(`SELECT COUNT(*) AS count FROM applications WHERE ad_request_id IN (SELECT id FROM ad_requests WHERE user_id = ?)`, [companyId], (err, row2) => {
        if (err || !row2) return res.send('応募数の取得に失敗しました');
        stats.applicationCount = row2.count;

        // 4. 購入数
        db.get(`SELECT COUNT(*) AS count FROM purchases WHERE ad_request_id IN (SELECT id FROM ad_requests WHERE user_id = ?)`, [companyId], (err, row3) => {
          if (err || !row3) return res.send('購入数の取得に失敗しました');
          stats.purchaseCount = row3.count;

          // 5. 総売上（企業取り分）
          db.get(`
            SELECT SUM(company_amount) AS totalReward
            FROM purchases
            WHERE ad_request_id IN (
              SELECT id FROM ad_requests WHERE user_id = ?
            )
          `, [companyId], (err, row4) => {
            if (err) {
              console.error('売上合計取得エラー:', err.message);
              return res.send('売上合計の取得に失敗しました');
            }

            stats.totalReward = row4?.totalReward || 0;

            res.render('dashboard', {
              user: req.session.user,
              stats,
              chartData
            });
          });
        });
      });
    });
  });
});

module.exports = router;
