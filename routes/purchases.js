// routes/purchases.js
const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const db = require('../models/db');
const { v4: uuidv4 } = require('uuid');
const csrfProtection = require('../middlewares/csrf');

const { sendOrderToCompany, sendPurchaseReceiptToBuyer } = require('../lib/mailer');
const { body, param, validationResult } = require('express-validator');

/* ========================
 *  購入処理（PRG＋冪等性＋二重レス防止）
 * =======================*/
router.post(
  '/purchase/ad/:adId/by/:userId',
  csrfProtection,
  [
    param('adId').isInt({ min: 1 }).withMessage('広告IDが不正です'),
    param('userId').isInt({ min: 1 }).withMessage('紹介者IDが不正です'),
    body('quantity').isInt({ min: 1 }).withMessage('購入数は1以上である必要があります'),
    body('idempotency_key').isString().isLength({ min: 10 }).withMessage('不正な購入リクエストです'),
  ],
  (req, res) => {
    // ★ 二重レス防止ガード
    let replied = false;
    const replyOnce = (fn) => (...args) => {
      if (replied || res.headersSent) return;
      replied = true;
      return fn(...args);
    };
    const redirectOnce = (url) => replyOnce(res.redirect.bind(res, url))();
    const sendOnce = (code, body) => replyOnce(res.status(code).send.bind(res, body))();
    const renderOnce = (view, params) => replyOnce(res.render.bind(res, view, params))();

    // バリデーション
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const { adId, userId } = req.params;
      const influencerId = Number(userId);
      const idemToken = uuidv4();
      return db.get(
        `SELECT ar.*, u.name AS referrer_name
          FROM ad_requests ar
          LEFT JOIN users u ON u.id = ?
          WHERE ar.id = ?`,
        [Number(userId), Number(adId)],
        (e, ad) => {        
          return renderOnce('purchase_page', {
          ad: ad || {},
          influencerId,
          csrfToken: req.csrfToken(),
          idemToken,
          user: req.session.user,
          errors: errors.array(),
        });
      });
    }

    if (!req.session?.user?.id) {
      return redirectOnce('/login');
    }

    const { adId, userId } = req.params;   // userId = 紹介者（インフル）
    const buyerId  = req.session.user.id;  // ログイン中の購入者
    const quantity = parseInt(req.body.quantity || '1', 10);
    const idempo   = String(req.body.idempotency_key || '');

    // この処理内だけで使うSQLite接続
    const local = new sqlite3.Database('database.sqlite');

    const closeLocal = () => {
      try { local.close(); } catch (_) {}
    };

    // 既存の注文を冪等性キーで探す
    const findExistingByIdempo = (cb) => {
      local.get(
        'SELECT id FROM purchases WHERE idempotency_key = ?',
        [idempo],
        (e, row) => cb(e, row)
      );
    };

    // メール送信（非同期・フロー非ブロック）
// 置き換え版：メール送信（非同期・別コネクション）
const sendMailsAsync = (purchaseId) => {
  setImmediate(() => {
    const maildb = new sqlite3.Database('database.sqlite'); // ★ 別接続
    maildb.get(
      `SELECT p.id, p.quantity, p.company_amount, p.influencer_amount, p.platform_amount,
              p.created_at,
              ar.title, ar.product_name, ar.unit_price,
              buyer.email AS buyer_email, buyer.name AS buyer_name,
              comp.email  AS company_email, comp.name AS company_name,
              ref.name    AS influencer_name
       FROM purchases p
       JOIN ad_requests ar ON p.ad_request_id = ar.id
       JOIN users buyer ON p.buyer_id = buyer.id
       JOIN users comp  ON ar.user_id = comp.id
       LEFT JOIN users ref ON p.referred_by_user_id = ref.id
       WHERE p.id = ?`,
      [purchaseId],
      async (e, order) => {
        try {
          if (e || !order) {
            console.error('購入データ取得失敗:', e);
            return;
          }
          await sendOrderToCompany(order.company_email, order);
          await sendPurchaseReceiptToBuyer(order.buyer_email, order);
          console.log('通知メール送信完了');
        } catch (mailErr) {
          console.error('通知メール送信失敗:', mailErr);
        } finally {
          try { maildb.close(); } catch (_) {}
        }
      }
    );
  });
};

    if (process.env.MOCK_PAYMENT !== 'true') {
      closeLocal();
      return sendOnce(501, '仮決済モードではないため、未実装の決済処理が必要です');
    }

    // 本処理（直列化）
    local.serialize(() => {
      // 0) 冪等性キーで既存確認（ネット再送/F5対策）
      findExistingByIdempo((e0, existing) => {
        if (e0) {
          closeLocal();
          console.error(e0);
          return sendOnce(500, '内部エラー');
        }
        if (existing) {
          closeLocal();
          return redirectOnce(`/purchases/complete?orderId=${existing.id}`);
        }

        // 1) 商品取得
        local.get(
          'SELECT ar.*, u.name AS referrer_name FROM ad_requests ar JOIN users u ON u.id = ? WHERE ar.id = ?',
          [userId, adId],
          (err, ad) => {
            if (err || !ad) {
              closeLocal();
              return sendOnce(404, '広告情報の取得に失敗しました');
            }
            if (ad.stock !== null && ad.stock < quantity) {
              closeLocal();
              return sendOnce(400, `在庫が不足しています（残り${ad.stock}個）`);
            }

            // 2) 分配計算
            const total = ad.unit_price * quantity;
            const influencer_amount = Math.floor(total * 0.10);
            const platform_amount   = Math.floor(total * 0.10);
            const company_amount    = total - influencer_amount - platform_amount;

            // 3) 在庫の楽観ロック更新
            local.run(
              'UPDATE ad_requests SET stock = stock - ? WHERE id = ? AND stock >= ?',
              [quantity, adId, quantity],
              function (err2) {
                if (err2) {
                  closeLocal();
                  return sendOnce(500, '在庫更新に失敗しました');
                }
                if (this.changes !== 1) {
                  closeLocal();
                  return sendOnce(400, '在庫不足です');
                }

                // 4) 冪等性キー付きでINSERT（UNIQUEで二重禁止）
                local.run(
                  `INSERT INTO purchases (
                     ad_request_id, referred_by_user_id, buyer_id,
                     company_amount, influencer_amount, platform_amount,
                     quantity, idempotency_key
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    adId, userId, buyerId,
                    company_amount, influencer_amount, platform_amount,
                    quantity, idempo
                  ],
                  function (err3) {
                    if (err3) {
                      if (String(err3.code) === 'SQLITE_CONSTRAINT') {
                        // 冪等性キー重複 → 既存へPRG
                        return findExistingByIdempo((eX, rowX) => {
                          closeLocal();
                          if (rowX) {
                            return redirectOnce(`/purchases/complete?orderId=${rowX.id}`);
                          }
                          console.error('UNIQUE違反だが既存拾えず:', err3);
                          return sendOnce(500, '購入記録に失敗しました');
                        });
                      }
                      closeLocal();
                      return sendOnce(500, '購入記録に失敗しました');
                    }

                    const purchaseId = this.lastID;

                    // 5) メールは非同期
                    sendMailsAsync(purchaseId);

                    // 6) PRG：POST→Redirect→Get
                    closeLocal();
                    return redirectOnce(`/purchases/complete?orderId=${purchaseId}`);
                  }
                );
              }
            );
          }
        );
      });
    });
  }
);

/* ========================
 * 自分の購入履歴
 * =======================*/
// router.get('/my_purchases', csrfProtection, (req, res) => {
//   if (!req.session?.user) return res.redirect('/login');
//   const userId = req.session.user.id;
//   const local = new sqlite3.Database('database.sqlite');

//   const sql = `
//     SELECT p.id, p.quantity, p.company_amount, p.influencer_amount, p.platform_amount,
//            p.created_at,
//            ar.title, ar.product_name, ar.unit_price,
//            comp.name AS company_name
//     FROM purchases p
//     JOIN ad_requests ar ON p.ad_request_id = ar.id
//     JOIN users comp ON ar.user_id = comp.id
//     WHERE p.buyer_id = ?
//     ORDER BY p.created_at DESC
//   `;

//   local.all(sql, [userId], (err, rows) => {
//     local.close();
//     if (err) return res.send('購入履歴の取得に失敗しました');
//     res.render('my_purchases', {
//       purchases: rows, 
//       user: req.session.user, 
//       csrfToken: req.csrfToken() 
//     });
//   });
// });

// routes/purchases.js の /my_purchases ルートを丸ごと置き換え
router.get('/my_purchases', csrfProtection, (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  const userId  = req.session.user.id;

  // --- ページング・パラメータ ---
  const page     = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage  = Math.max(1, Math.min(50, parseInt(req.query.per_page || '10', 10))); // 上限50
  const offset   = (page - 1) * perPage;

  const local = new sqlite3.Database('database.sqlite');

  // 総件数（同一条件で）
  const countSql = `
    SELECT COUNT(*) AS cnt
      FROM purchases
     WHERE buyer_id = ?
  `;

  // 一覧（紹介者名 referrer_name を LEFT JOIN で取得）
  const listSql = `
    SELECT
      p.id, p.quantity, p.company_amount, p.influencer_amount, p.platform_amount,
      p.created_at,
      ar.title, ar.product_name, ar.unit_price,
      comp.name AS company_name,
      ref.name  AS referrer_name
    FROM purchases p
    JOIN ad_requests ar ON p.ad_request_id = ar.id
    JOIN users comp     ON ar.user_id       = comp.id
    LEFT JOIN users ref ON p.referred_by_user_id = ref.id
    WHERE p.buyer_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  local.get(countSql, [userId], (err1, cRow) => {
    if (err1) {
      local.close();
      console.error('count error:', err1);
      return res.status(500).send('購入履歴の取得に失敗しました');
    }
    const total = cRow ? cRow.cnt : 0;
    const pageCount = Math.max(1, Math.ceil(total / perPage));

    local.all(listSql, [userId, perPage, offset], (err2, rows) => {
      local.close();
      if (err2) {
        console.error('list error:', err2);
        return res.status(500).send('購入履歴の取得に失敗しました');
      }
      return res.render('my_purchases', {
        purchases: rows,
        user: req.session.user,
        csrfToken: req.csrfToken(),
        page,
        perPage,
        total,
        pageCount
      });
    });
  });
});

/* ========================
 * インフルエンサーの売上履歴（商品別集計）
 * =======================*/
router.get('/sales_history', csrfProtection, (req, res) => {
  if (!req.session?.user) return res.redirect('/login');
  // 役割チェックを入れている場合は必要に応じて有効化
  // if (req.session.user.role !== 'influencer') {
  //   return res.status(403).send('インフルエンサー専用ページです');
  // }

  const userId = req.session.user.id;
  const db = new sqlite3.Database('database.sqlite');

  // 商品別集計（既存テーブル前提）
  const productSql = `
    SELECT 
      ar.product_name,
      COUNT(p.id) AS total_orders,
      SUM(p.quantity) AS total_quantity,
      SUM(p.influencer_amount) AS total_reward
    FROM purchases p
    JOIN ad_requests ar ON p.ad_request_id = ar.id
    WHERE p.referred_by_user_id = ?
    GROUP BY ar.id, ar.product_name
    ORDER BY total_reward DESC
  `;

  // 日別集計（1日あたりの報酬と数量）
  const dailySql = `
    SELECT DATE(p.created_at) AS day,
           SUM(p.influencer_amount) AS daily_reward,
           SUM(p.quantity) AS daily_quantity
    FROM purchases p
    WHERE p.referred_by_user_id = ?
    GROUP BY DATE(p.created_at)
    ORDER BY DATE(p.created_at)
  `;

  // 期間の合計
  const totalSql = `
    SELECT
      COALESCE(SUM(p.influencer_amount),0) AS total_reward,
      COALESCE(SUM(p.quantity),0)          AS total_quantity,
      MIN(DATE(p.created_at))              AS first_day,
      MAX(DATE(p.created_at))              AS last_day
    FROM purchases p
    WHERE p.referred_by_user_id = ?
  `;

  db.all(productSql, [userId], (err, productRows) => {
    if (err) {
      db.close();
      console.error('売上(商品別)取得エラー:', err);
      return res.send('売上履歴の取得に失敗しました');
    }
    db.all(dailySql, [userId], (e2, dailyRows) => {
      if (e2) {
        db.close();
        console.error('売上(日別)取得エラー:', e2);
        return res.send('売上履歴の取得に失敗しました');
      }
      db.get(totalSql, [userId], (e3, totals) => {
        db.close();
        if (e3) {
          console.error('売上(合計)取得エラー:', e3);
          return res.send('売上履歴の取得に失敗しました');
        }
        res.render('sales_history', {
          sales: productRows,
          daily: dailyRows,
          totals,
          user: req.session.user,
          csrfToken: req.csrfToken(),
          cspNonce: res.locals?.cspNonce // CSPを使っていないなら undefined でOK
        });
      });
    });
  });
});

/* ========================
 * 購入ページ（紹介者IDつき正規導線）
 * =======================*/
router.get('/purchase/ad/:adId/by/:userId', csrfProtection, (req, res) => {
  const { adId, userId } = req.params;
  const influencerId = Number(userId);

  db.get(
    `SELECT ar.*, u.name AS referrer_name
       FROM ad_requests ar
  LEFT JOIN users u ON u.id = ?
      WHERE ar.id = ?`,
    [influencerId, adId],
    (err, ad) => {
      if (err) return res.status(500).send('DB error');
      if (!ad) return res.status(404).render('error_page', { message: '商品が見つかりません' });

      const idemToken = uuidv4();                 // ★ 生成
      return res.render('purchase_page', {
        ad,
        influencerId,
        csrfToken: req.csrfToken(),
        idemToken,                                // ★ 渡す
        user: req.session.user
      });
    }
  );
});

/* ========================
 * 購入ページ（旧URLなど保険導線）
 * =======================*/
router.get('/purchase/ad/:adId', csrfProtection, (req, res) => {
  const { adId } = req.params;
  const influencerId = req.query.ref ? Number(req.query.ref) : (req.session?.user?.id || 0);

  db.get(
    `SELECT ar.*, u.name AS referrer_name
       FROM ad_requests ar
  LEFT JOIN users u ON u.id = ?
      WHERE ar.id = ?`,
    [influencerId, adId],
    (err, ad) => {
      if (err) return res.status(500).send('DB error');
      if (!ad) return res.status(404).render('error_page', { message: '商品が見つかりません' });

      const idemToken = uuidv4();                 // ★ 生成
      return res.render('purchase_page', {
        ad,
        influencerId,
        csrfToken: req.csrfToken(),
        idemToken,                                // ★ 渡す
        user: req.session.user
      });
    }
  );
});

// 購入完了ページ（GET専用）
router.get('/purchases/complete', (req, res) => {
  const orderId = Number(req.query.orderId ?? 0);
  const mockPayment = process.env.MOCK_PAYMENT === 'true';

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.render('purchase_complete', {
      orderId: null,
      mockPayment,
      ad: null,
      quantity: 0,
      user: req.session?.user || null,
      purchased_at: null
    });
  }

  const sql = `
    SELECT
      ar.title,
      ar.product_name,
      ar.unit_price,
      u.name AS referrer_name,
      p.quantity,
      p.created_at AS purchased_at
    FROM purchases p
    JOIN ad_requests ar ON ar.id = p.ad_request_id
    LEFT JOIN users u ON u.id = p.referred_by_user_id
    WHERE p.id = ?
    LIMIT 1
  `;

  db.get(sql, [orderId], (err, row) => {
    if (err) {
      console.error('complete query error:', err);
      return res.render('purchase_complete', {
        orderId,
        mockPayment,
        ad: null,
        quantity: 0,
        user: req.session?.user || null,
        purchased_at: null
      });
    }
    return res.render('purchase_complete', {
      orderId,
      mockPayment,
      ad: row || null,
      quantity: row ? row.quantity : 0,
      user: req.session?.user || null,
      purchased_at: row ? row.purchased_at : null
    });
  });
});


module.exports = router;
