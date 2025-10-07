require('dotenv').config(); // .env ファイルから環境変数を読み込む
const express = require('express'); // Expressフレームワークを読み込む
const session = require('express-session'); // セッション管理用ミドルウェア
const path = require('path'); // ファイルパス操作用の標準モジュール

const app = express(); // Expressアプリケーションを作成
const PORT = 3000; // サーバーが待ち受けるポート番号
const ensureLoggedIn = require('./middlewares/ensureLoggedIn'); // ログイン済みか確認するカスタムミドルウェア
const ensureAdmin    = require('./middlewares/ensureAdmin'); // 管理者か確認するカスタムミドルウェア
const helmet = require('helmet'); // セキュリティヘッダを自動で設定するミドルウェア
const rateLimit = require('express-rate-limit'); // リクエストレート制限（DoS対策）用ミドルウェア
// const SQLiteStore = require('connect-sqlite3')(session); // SQLiteを使ったセッションストア（コメントアウト中）
// const csp = require('./middlewares/csp'); // CSP（Content Security Policy）を設定するカスタムミドルウェア
// app.use(csp()); // CSPミドルウェアをアプリに適用（コメントアウト中）
const crypto = require('crypto'); // 暗号化・ハッシュ生成用の標準モジュール
const SQLiteStore = require('connect-sqlite3')(session); // SQLiteを使ったセッションストアを有効化
const safeJson = require('./middlewares/safe-json'); // JSONレスポンスで安全にエスケープするカスタムミドルウェア
app.use(safeJson); // safeJsonミドルウェアをアプリに適用

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(helmet({
  contentSecurityPolicy: false,   
  crossOriginEmbedderPolicy: false
}));

// 本番のみ HSTS（localhost/HTTPでは付けない）
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({
    maxAge: 31536000,
    includeSubDomains: true,
    preload: false
  }));
}

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64'); // 例: Lp3F...==
  next();
});

// CSP（使用CDNだけ許可：Bootstrap/JSDelivr/Cdnjs 等）
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      (req, res) => `'nonce-${res.locals.cspNonce}'`,  // ★これを追加
      "https://cdn.jsdelivr.net",
      "https://cdnjs.cloudflare.com"
    ],
    "script-src-attr": ["'none'"],      // インライン属性は禁止のままでOK
    "style-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "data:"],
    "connect-src": ["'self'"],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"]
  }
}));

// セキュリティヘッダをまとめて追加
app.use((req, res, next) => {
  // Permissions-Policy（機能制御）
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // // XSS対策（二重化してもよい）
  // res.setHeader("X-XSS-Protection", "1; mode=block");

  // // クリックジャッキング対策（iframe禁止）
  // res.setHeader("X-Frame-Options", "DENY");

  // X-Frame-Options（将来ダッシュボード埋め込みの余地を残すなら SAMEORIGIN）
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // コンテンツタイプの誤解釈防止
  res.setHeader("X-Content-Type-Options", "nosniff");

  // リファラ制御（外部に送る情報を最小化）
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  next();
});

// middlewares 
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


const cookieParser = require('cookie-parser');
//const csrf = require('csurf');                

app.use(cookieParser());

app.use(session({
  name: 'addpick_sess',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: './models',   // ← セッションDBを保存するフォルダ
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax', // 外部サービス導線を考慮して lax のまま
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000 // 1時間
  }
}));

//const csrfProtection = csrf();
//app.use(csrfProtection);

// ✅ すべてのビューで使えるようにセット
//app.use((req, res, next) => {
//  res.locals.csrfToken = req.csrfToken();
//  next();
//});

app.disable('x-powered-by');  // X-Powered-By を消す

// 429 (レート制限)
const authLimiter  = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100,                 // 100回まで
  standardHeaders: true,
  legacyHeaders: false
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1分
  max: 10,              // 10回まで
  standardHeaders: true,
  legacyHeaders: false
});

// ★ 管理者用の制限を追加（例: 1分で20回まで）
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: "管理者操作の回数が制限を超えました。しばらくしてから再試行してください。",
  standardHeaders: true,
  legacyHeaders: false
});

// 制限を適用
app.use(['/login','/register','/auth'], authLimiter);
app.use(['/purchases','/applications','/billing'], writeLimiter);
app.use('/admin', adminLimiter);

// ← ここでDBを初期化し、bankVerifiedをセットするミドルウェアを先に登録
const db = require('./models/db');
// === DEMO LOGIN (公開ミラー用) ===============================
if (process.env.DEMO_MODE === 'true') {
  const ROLE_EMAIL = {
    admin:      'admin@addpick.local',
    company:    'company@example.com',
    influencer: 'influencer@example.com',
    buyer:      'buyer@example.com'
  };

  // 例: /demo-login/company で company ユーザーをセッションに格納
  app.get('/demo-login/:role', (req, res) => {
    const role = String(req.params.role || '').toLowerCase();
    const email = ROLE_EMAIL[role];
    if (!email) return res.status(400).send('Unknown role');

    db.get('SELECT id, role, name, email FROM users WHERE email = ?', [email], (err, user) => {
      if (err) return res.status(500).send('DB error: ' + err.message);
      if (!user) return res.status(404).send('Demo user not found. Run: npm run db:reset');
      user.is_admin = user.role === 'admin' ? 1 : 0; // ここで補完
      req.session.user = user;
      return res.redirect('/');
    });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });
}
// =============================================================

app.use((req, res, next) => {
  // 未ログインなら何も表示しない
  if (!req.session?.user?.id) {
    res.locals.bankVerified = false;
    res.locals.withdrawableJPY = null;
    res.locals.withdrawableJPYFmt = null;
    return next();
  }

  const uid = req.session.user.id;
  const role = req.session.user.role || 'influencer';

  // 1) まず「口座認証バッジ」
  db.get('SELECT verified FROM bank_accounts WHERE user_id=?', [uid], (e1, row1) => {
    res.locals.bankVerified = !!(row1 && row1.verified === 1);

    // 2) 役割に応じて “引き落とし対象売上” を集計
    let eligibleSQL, eligibleParams;
    if (role === 'company') {
      // 企業: 自分が投稿した ad_requests に紐づく購入の company_amount 合計
      eligibleSQL = `
        SELECT COALESCE(SUM(p.company_amount), 0) AS v
        FROM purchases p
        JOIN ad_requests a ON a.id = p.ad_request_id
        WHERE a.user_id = ?
      `;
      eligibleParams = [uid];
    } else {
      // クリエイター: 自分経由の購入の influencer_amount 合計
      eligibleSQL = `
        SELECT COALESCE(SUM(influencer_amount), 0) AS v
        FROM purchases
        WHERE referred_by_user_id = ?
      `;
      eligibleParams = [uid];
    }

    db.get(eligibleSQL, eligibleParams, (e2, r2) => {
      const eligible = Number(r2?.v || 0);

      // 3) すでに引き落とし “確保済み” の額を差し引く（pending/submitted/succeeded）
      const debitedSQL = `
        SELECT COALESCE(SUM(amount_jpy),0) AS v
        FROM bank_debit_requests
        WHERE user_id=? AND status IN ('pending','submitted','succeeded')
      `;
      db.get(debitedSQL, [uid], (e3, r3) => {
        const debited = Number(r3?.v || 0);
        const avail = Math.max(0, eligible - debited);
        res.locals.withdrawableJPY = avail;
        try {
          res.locals.withdrawableJPYFmt = new Intl.NumberFormat('ja-JP').format(avail);
        } catch {
          res.locals.withdrawableJPYFmt = String(avail);
        }
        next();
      });
    });
  });
});

app.use((req, res, next) => {
  const u = req.session?.user;
  const allow = (process.env.ADMIN_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
  res.locals.isAdmin = !!(u && (u.is_admin || allow.includes(String(u.id))));
  next();
});

const ensureIdempotencyKey = require('./migrations/add_idempotency_to_purchases');
ensureIdempotencyKey();  

// routers
const adminRouter = require('./routes/admin');
app.use('/admin', ensureLoggedIn, ensureAdmin, adminRouter);

app.use('/', require('./routes/auth'));//ログイン管理
app.use('/', require('./routes/home'));//ホーム画面の割り当て
app.use('/', require('./routes/ads'));//広告依頼の処理ページ
app.use('/', require('./routes/applications'));//広告応募ページ
app.use('/', require('./routes/purchases'));//購入処理ページ
app.use('/', require('./routes/profile'));//プロフィール関連ページ
//app.use('/', require('./routes/users')); //フォロー機能
app.use('/', require('./routes/company'));//企業の購入後の処理等
app.use('/', require('./routes/influencer'));
//app.use('/', require('./routes/cart'));//カート機能（未完成）
const adminNotifications = require('./routes/admin_notifications');//管理者ページ
app.use(adminNotifications);
const bankRouter = require('./routes/bank');//口座処理
app.use('/billing', bankRouter);  // /billing/bank, /billing/bank/verify
app.use('/', bankRouter);         // /debits, /admin/debits なども拾うなら

app.get('/test', (req, res) => res.render('test_dropdown'));


app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('❌ CSRFトークン不一致');
    console.error('受信した body._csrf =', req.body?._csrf);
    console.error('セッション =', req.session);
    return res.status(403).send('CSRF token mismatch');
  }
  next(err);
});

console.log('[DB_PATH]', process.env.DB_PATH || './dev.sqlite3');

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT} で起動中`);
});
