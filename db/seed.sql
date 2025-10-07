-- users（パスワードは init-db.js で "hash(pass1234)" → bcrypt 置換）
INSERT INTO users (role, name, email, password_hash) VALUES
('admin',       'Demo Admin',       'admin@addpick.local',   'hash(pass1234)'),
('company',     'Demo Company',     'company@example.com',   'hash(pass1234)'),
('influencer',  'Demo Influencer',  'influencer@example.com','hash(pass1234)'),
('buyer',       'Demo Buyer',       'buyer@example.com',     'hash(pass1234)');

-- 企業ユーザー(ID=2)が作成した案件
INSERT INTO ad_requests
(user_id, title, description, unit_price, product_name, company_name, deadline, stock, category_id)
VALUES
(2, '新作スイーツPR',     'Instagramで写真＋本文', 3000, '秋のモンブラン', 'Demo Company', '2030-12-31', 50, 1),
(2, 'コーヒー新メニュー', 'Xでのポスト＋画像',   2000, '深煎りブレンド', 'Demo Company', '2030-10-31', 100, 2);

-- インフルエンサー(ID=3)が応募
INSERT INTO applications (user_id, ad_request_id, status) VALUES
(3, 1, 'applied'),
(3, 2, 'accepted');

-- 購入（buyer=ID=4 / 紹介=influencer=ID=3）
INSERT INTO purchases
(ad_request_id, referred_by_user_id, buyer_id, quantity, variant,
 company_amount, influencer_amount, platform_amount, total_price, idempotency_key)
VALUES
(1, 3, 4, 1, 'default', 2400, 300, 300, 3000, 'demo-001'),
(2, 3, 4, 2, 'M',       1600, 200, 200, 4000, 'demo-002');
