// models/db.js
const bcrypt = require('bcrypt'); 
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ★ここを修正：env優先、なければ従来パス
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');

const db = new sqlite3.Database(dbPath);

// ユーザーテーブル作成（なければ）
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      notification_email TEXT,  -- 企業が通知で受け取りたいメール
      password TEXT,             -- 仮登録時はNULLにできるよう変更
      role TEXT DEFAULT 'influencer',
      bio TEXT,
      profile_image TEXT,
      is_verified INTEGER DEFAULT 0,
      verify_token TEXT,
      last_email_sent_at INTEGER,
      reset_token TEXT,       -- 🆕 パスワードリセット用トークン
      reset_expires INTEGER   -- 🆕 有効期限（UNIXタイムミリ秒）
    )
  `);

    db.get(`SELECT COUNT(1) AS cnt FROM users WHERE role = 'admin'`, (e, row) => {
      if (e) return console.error('[DB] 管理者カウント取得エラー:', e);
      if (row && row.cnt === 0) {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@addpick.local';
        const adminName  = process.env.ADMIN_NAME  || 'Administrator';
        const adminPass  = process.env.ADMIN_PASSWORD || 'changeme123!';
        const hash = bcrypt.hashSync(adminPass, 10);

        // すでに同じメールが存在したら何もしない
        db.get(`SELECT id FROM users WHERE email = ?`, [adminEmail], (e2, row2) => {
          if (e2) return console.error('[DB] 管理者確認エラー:', e2);
          if (!row2) {
            db.run(
              `INSERT INTO users (name, email, password, role, is_verified)
                VALUES (?, ?, ?, 'admin', 1)`,
              [adminName, adminEmail, hash],
              (ie) => {
                if (ie) console.error('[DB] 管理者作成エラー:', ie);
                else console.log(`[DB] 管理者アカウントを作成しました: ${adminEmail}`);
              }
            );
          } else {
            console.log(`[DB] 管理者アカウントは既に存在しています (${adminEmail})`);
          }
        });
      }
    });
    
    // 広告依頼テーブル作成（なければ）
    db.run(`
        CREATE TABLE IF NOT EXISTS ad_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            reward INTEGER,                     -- 旧報酬（互換用に残す）
            unit_price INTEGER,                -- 単価（新）
            company_share INTEGER,             -- 単価の80%
            influencer_share INTEGER,          -- 単価の10%
            platform_share INTEGER,            -- 残りの10%（端数調整含む）
            request_fee INTEGER DEFAULT 0,     -- 掲載ごとの依頼料
            user_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            product_name TEXT,
            company_name TEXT,
            deadline TEXT,
            image_url TEXT,
            stock INTEGER DEFAULT 99999,  --在庫数
            category_id INTEGER
        );
    `);
    // 応募テーブル作成
    db.run(`
    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ad_request_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, ad_request_id) -- 同じ人が同じ広告に複数回応募できない
    )
    `);

    // 購入記録テーブル（購入者情報ではなく「誰経由で買われたか」を記録）
    db.run(`
    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ad_request_id INTEGER NOT NULL,        -- 購入された広告ID
        referred_by_user_id INTEGER NOT NULL,  -- 誰経由で購入されたか（紹介者）
        buyer_id INTEGER NOT NULL,             -- 実際の購入者
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, -- 購入日時（自動）
        is_handled INTEGER DEFAULT 0,          -- 対応済みフラグ（0=未対応, 1=対応済み）

        -- ✅ 分配報酬の保存カラム（新規追加）
        company_amount INTEGER,
        influencer_amount INTEGER,
        platform_amount INTEGER,
        variant TEXT,       --将来的にサイズ等の設定用
        quantity INTEGER DEFAULT 1
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL, -- フォローする側
        followee_id INTEGER NOT NULL, -- フォローされる側
        UNIQUE(follower_id, followee_id),
        FOREIGN KEY(follower_id) REFERENCES users(id),
        FOREIGN KEY(followee_id) REFERENCES users(id)
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL -- ハッシュ化推奨（bcrypt）
    )
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );
    
    `);

    db.run(`
    CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ad_request_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    `);

    // 通知ログ
    db.run(`
    CREATE TABLE IF NOT EXISTS notification_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,              -- 購入関連は purchases.id
        user_id INTEGER,               -- 任意（未使用ならNULLでOK）
        channel TEXT NOT NULL,         -- 'company' | 'buyer' | 'verify'
        to_email TEXT,
        subject TEXT,
        status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'delivered' | 'failed'
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        sent_at DATETIME,              -- 実送時刻
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON notification_logs(created_at DESC);`);

    db.run(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bank_code TEXT,              -- 銀行コード(4桁)
        branch_code TEXT,            -- 支店コード(3桁)
        account_type TEXT CHECK(account_type IN ('futsu','toza','chokin')) NOT NULL,
        account_number_cipher TEXT NOT NULL,  -- 暗号化済み口座番号(HEX)
        account_iv TEXT NOT NULL,             -- AES-GCM IV(HEX)
        account_tag TEXT NOT NULL,            -- AES-GCM TAG(HEX)
        holder_kana TEXT NOT NULL,
        mandate_accepted_at TEXT,             -- 同意日時
        verified INTEGER DEFAULT 0,           -- 仮認証フラグ
        verify_code INTEGER,                  -- マイクロデポジット金額(1-99) モック用
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      );    
    `);

    db.run(`
      -- 引き落としリクエスト
      CREATE TABLE IF NOT EXISTS bank_debit_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount_jpy INTEGER NOT NULL CHECK(amount_jpy > 0),
        status TEXT CHECK(status IN ('pending','submitted','succeeded','failed','canceled')) NOT NULL DEFAULT 'pending',
        idempotency_key TEXT NOT NULL,        -- 二重請求防止
        scheduled_at TEXT,                    -- 予定日（任意）
        requested_at TEXT DEFAULT (datetime('now')),
        processed_at TEXT,
        failure_reason TEXT,
        UNIQUE(idempotency_key)
      );    
    `);

    db.run(`
      -- 監査ログ（任意）
      CREATE TABLE IF NOT EXISTS bank_debit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debit_id INTEGER NOT NULL,
        type TEXT NOT NULL,                   -- 'created','submitted','succeeded','failed'など
        payload TEXT,                         -- JSON文字列
        occurred_at TEXT DEFAULT (datetime('now'))
      );    
    `);
});




db.get(`SELECT COUNT(*) AS cnt FROM categories`, (e, row) => {
  if (e) return console.error('カテゴリ数取得エラー:', e);
  if (row && row.cnt === 0) {
    const initial = [
      'コスメ','食品','家電','アパレル','スポーツ',
      '書籍','アプリ','サービス','ペット','その他'
    ];
    const placeholders = initial.map(() => '(?)').join(',');
    db.run(`INSERT INTO categories (name) VALUES ${placeholders}`, initial, (ie) => {
      if (ie) console.error('カテゴリ初期投入エラー:', ie);
      else console.log('[DB] カテゴリを初期投入しました');
    });
  }
});

module.exports = db;
