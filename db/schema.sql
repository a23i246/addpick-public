PRAGMA foreign_keys = ON;

-- users: 役割（company/influencer/buyer/admin）を持つユーザー
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT NOT NULL DEFAULT 'influencer',
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,                         -- bcryptで保持（seed時にハッシュ化）
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ad_requests: 企業が作る案件（単価や締切など）
CREATE TABLE IF NOT EXISTS ad_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,                     -- 企業ユーザー
  title            TEXT NOT NULL,
  description      TEXT,
  unit_price       INTEGER,
  product_name     TEXT,
  company_name     TEXT,
  deadline         TEXT,                        -- ISO8601文字列
  image_url        TEXT,
  stock            INTEGER DEFAULT 99999,
  category_id      INTEGER,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- applications: インフルエンサーの応募
CREATE TABLE IF NOT EXISTS applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,              -- influencer
  ad_request_id  INTEGER NOT NULL,
  status         TEXT DEFAULT 'applied',        -- applied/accepted/rejected/completed
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, ad_request_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_request_id) REFERENCES ad_requests(id) ON DELETE CASCADE
);

-- purchases: 紹介経由の購入（企業/インフルエンサー/プラットフォームの分配を保持）
CREATE TABLE IF NOT EXISTS purchases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_request_id         INTEGER NOT NULL,
  referred_by_user_id   INTEGER NOT NULL,       -- 誰の紹介か（influencer）
  buyer_id              INTEGER NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 1,
  variant               TEXT,
  company_amount        INTEGER,
  influencer_amount     INTEGER,
  platform_amount       INTEGER,
  total_price           INTEGER,
  created_at            TEXT DEFAULT CURRENT_TIMESTAMP,
  idempotency_key       TEXT,                   -- 冪等性キー（将来の二重登録防止）
  FOREIGN KEY (ad_request_id) REFERENCES ad_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
