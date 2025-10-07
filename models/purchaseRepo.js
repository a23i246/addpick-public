// models/purchaseRepo.js
const db = require('./db');

exports.updateAdStockOptimistic = (adId, qty) => new Promise((resolve, reject) => {
  const sql = `UPDATE ads SET stock = stock - ?
               WHERE id = ? AND stock >= ?`;
  db.run(sql, [qty, adId, qty], function(err){
    if (err) return reject(err);
    resolve(this.changes); // 1なら成功、0なら在庫不足
  });
});

exports.findPurchaseByIdempotencyKey = (key) => new Promise((resolve, reject) => {
  db.get('SELECT id FROM purchases WHERE idempotency_key = ?', [key],
    (err, row) => err ? reject(err) : resolve(row || null));
});

exports.createPurchase = (p) => new Promise((resolve, reject) => {
  const sql = `INSERT INTO purchases
    (ad_id,buyer_user_id,influencer_id,quantity,unit_price,total_price,
     company_share,influencer_share,platform_share,purchased_at,idempotency_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  const params = [p.ad_id,p.buyer_user_id,p.influencer_id,p.quantity,p.unit_price,p.total_price,
                  p.company_share,p.influencer_share,p.platform_share,p.purchased_at,p.idempotency_key];
  db.run(sql, params, function(err){
    if (err) return reject(err);
    resolve(this.lastID);
  });
});
