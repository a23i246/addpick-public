//ログイン　ログアウト　登録ページ
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');
const db = require('../models/db');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const csrf = require('csurf');

const csrfProtection = csrf();

// ログイン用レート制限（例: 15分で最大5回）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "ログイン試行が多すぎます。15分後に再度お試しください。",
  standardHeaders: true,
  legacyHeaders: false,
});

// パスワードリセット用レート制限（例: 1時間で最大3回）
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "パスワードリセットの試行が多すぎます。1時間後に再度お試しください。",
  standardHeaders: true,
  legacyHeaders: false,
});

// ========================
// ログイン関連
// ========================
router.get('/login', csrfProtection, (req, res) => {
  const nextUrl = req.session.afterLoginRedirect || req.query.next || '';
  const message = req.query.verified ? '登録が完了しました！ログインしてください。' : null;

  res.render('login', {
    pageTitle: 'ログイン',
    nextUrl,
    error: null,
    message,
    csrfToken: req.csrfToken()
  });
});

// usersテーブルのカラム有無を調べる（存在しない列をSELECTしないため）
function inspectUsersTable(db) {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(users);', [], (err, rows) => {
      if (err) return reject(err);
      const names = rows.map(r => r.name);
      resolve({
        hasPwdHash: names.includes('password_hash'),
        hasVerified: names.includes('is_verified')
      });
    });
  });
}

router.post('/login', csrfProtection, async (req, res) => {
  // 入力を正規化（前後空白・改行・タブなどを除去）
  const normalize = (s) =>
    (s || '')
      .trim()
      .replace(/\r/g, '')
      .replace(/\n/g, '')
      .replace(/\t/g, '');
  const normEmail = normalize(req.body?.email);
  const password  = req.body?.password || '';

  // usersテーブルのスキーマ検査（列の有無に対応）
  let hasPwdHash = false, hasVerified = false;
  try {
    const names = await new Promise((resolve, reject)=>{
      db.all('PRAGMA table_info(users);', [], (err, rows)=>{
        if (err) return reject(err);
        resolve(rows.map(r=>r.name));
      });
    });
    hasPwdHash  = names.includes('password_hash');
    hasVerified = names.includes('is_verified');
  } catch (e) { console.warn('[AUTH] users schema inspect failed:', e); }

  const pwdCol      = hasPwdHash ? 'password_hash' : 'password';
  const verifiedExp = hasVerified ? 'is_verified'   : '1';

  // DB側も改行/タブを除去して大小無視で比較
  const whereExpr = `lower(replace(replace(replace(trim(email), char(13), ''), char(10), ''), char(9), '')) = lower(?)`;

  db.all('PRAGMA database_list;', [], (e, rows) => console.log('[AUTH] dblist:', rows));

  // デバッグ：ヒット件数（同じ式でカウント）
  db.get(`SELECT COUNT(1) AS c FROM users WHERE ${whereExpr}`, [normEmail], (e,r)=>{
    console.log('[AUTH] matchCount=', r && r.c, 'input=', normEmail);
  });

  const SQL = `
    SELECT id, name, email, role, profile_image,
           ${verifiedExp} AS is_verified,
           ${pwdCol} AS password_hash
    FROM users
    WHERE ${whereExpr}
    LIMIT 1
  `;

  db.get(SQL, [normEmail], async (err, row) => {
    if (err) {
      console.error('DBエラー:', err);
      return res.render('login', { error: '内部エラーが発生しました', nextUrl: '', csrfToken: req.csrfToken() });
    }

    console.log('[AUTH] fetched:', row && {
      id: row.id, email: row.email, role: row.role, hasHash: !!row?.password_hash, input: normEmail
    });

    if (!row || !row.password_hash) {
      return res.render('login', { error: 'メールアドレスまたはパスワードが間違っています', nextUrl: '', csrfToken: req.csrfToken() });
    }

    try {
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        return res.render('login', { error: 'メールアドレスまたはパスワードが間違っています', nextUrl: '', csrfToken: req.csrfToken() });
      }
    } catch (e) {
      console.error('[AUTH] bcrypt error:', e);
      return res.render('login', { error: '内部エラーが発生しました', nextUrl: '', csrfToken: req.csrfToken() });
    }

    const allow = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const isAdmin = (row.role === 'admin') || allow.includes(String(row.id));

    req.session.user = {
      id: row.id,
      name: row.name,
      email: row.email,
      profile_image: row.profile_image || null,
      role: row.role || null,
      is_admin: !!isAdmin
    };
    req.session.role = row.role || null;

    res.redirect(req.query.next || '/');
  });
});

// ========================
// ユーザー登録
// ========================
router.get('/register', csrfProtection, (req, res) => {
  res.render('register', { error: null, csrfToken: req.csrfToken() });
});

router.post('/register', csrfProtection, (req, res) => {  
  console.log("📩 /register hit:", req.body);

  const rawEmail = req.body.email;
  const email = sanitizeHtml(rawEmail, { allowedTags: [], allowedAttributes: {} }); // ★サニタイズ

  if (!email) {
    return res.json({ success: false, error: "メールアドレスが必要です" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  const now = Date.now();

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) return res.json({ success: false, error: "DBエラー" });
    if (user) {
      if (user.is_verified === 1) {
        return res.json({ success: false, error: "このメールはすでに登録済みです" });
      }
      if (user.last_email_sent_at && now - user.last_email_sent_at < 60 * 1000) {
        return res.json({ success: false, error: "1分以内の再送はできません。" });
      }
      db.run("UPDATE users SET verify_token=?, last_email_sent_at=? WHERE email=?",
        [token, now, email],
        (err2) => {
          if (err2) return res.json({ success: false, error: "DB更新失敗" });
          sendVerificationEmail(email, user.name || "ユーザー", verifyUrl)
            .then(() => res.json({ success: true, message: "確認メールを送信しました！" }))
            .catch(() => res.json({ success: false, error: "メール送信に失敗しました" }));
        }
      );
    } else {
      db.run("INSERT INTO users (name, email, password, is_verified, verify_token, last_email_sent_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["", email, null, 0, token, now],
        function(err2) {
          if (err2) return res.json({ success: false, error: "DB登録失敗" });
          sendVerificationEmail(email, "ユーザー", verifyUrl)
            .then(() => res.json({ success: true, message: "確認メールを送信しました！" }))
            .catch(() => res.json({ success: false, error: "メール送信に失敗しました" }));
        }
      );
    }
  });
});

// 確認メール再送
router.post('/resend-confirmation', csrfProtection, (req, res) => {
  const rawEmail = req.body.email;
  const email = sanitizeHtml(rawEmail, { allowedTags: [], allowedAttributes: {} }); // ★サニタイズ

  if (!email) {
    return res.json({ success: false, error: 'メールアドレスが必要です' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    
    if (err || !user) return res.json({ success: false, error: 'ユーザーが見つかりません' });
    if (user.is_verified === 1) {
      return res.json({ success: false, error: 'すでに確認済みです' });
    }

    console.log('[AUTH] fetched:', user && {
    id: user.id, email: user.email, role: user.role, hasHash: !!user?.password_hash
  });

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/verify?token=${user.verify_token}`;

    sendVerificationEmail(email, user.name, verifyUrl)
      .then(() => res.json({ success: true, message: '確認メールを再送しました！' }))
      .catch(() => res.json({ success: false, error: '再送に失敗しました' }));
  });
});

// 忘れたパスワード画面（フォーム表示）
router.get('/forgot-password', csrfProtection, (req, res) => {
  res.render('forgot_password', { error: null, message: null, csrfToken: req.csrfToken() });
});

// パスワードリセット申請
router.post('/forgot-password', resetLimiter, csrfProtection, (req, res) => {
  const rawEmail = req.body.email;
  const email = sanitizeHtml(rawEmail, { allowedTags: [], allowedAttributes: {} }); // ★サニタイズ

  if (!email) {
    return res.render('forgot_password', { error: 'メールを入力してください', message: null, csrfToken: req.csrfToken() });
  }

  db.get("SELECT * FROM users WHERE email=?", [email], (err, user) => {
    if (err) return res.render('forgot_password', { error: '内部エラー', message: null, csrfToken: req.csrfToken() });
    if (!user) {
      return res.render('forgot_password', { error: null, message: 'リセット用メールを送信しました。', csrfToken: req.csrfToken() });
    }

    const now = Date.now();
    if (user.last_email_sent_at && now - user.last_email_sent_at < 60 * 1000) {
      return res.render('forgot_password', { error: '1分以内の再送はできません。', message: null, csrfToken: req.csrfToken() });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = now + 1000 * 60 * 30;

    db.run("UPDATE users SET reset_token=?, reset_expires=?, last_email_sent_at=? WHERE email=?",
      [token, expires, now, email],
      (err2) => {
        if (err2) return res.render('forgot_password', { error: '内部エラー', message: null, csrfToken: req.csrfToken() });
        const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
        const resetUrl = `${baseUrl}/reset-password?token=${token}`;
        sendPasswordResetEmail(email, resetUrl).catch(e => console.error("メール送信失敗:", e));
        res.render('forgot_password', { error: null, message: 'リセット用メールを送信しました。', csrfToken: req.csrfToken() });
      });
  });
});

// ★ これを auth.js の末尾あたりに追加（module.exports の前）
// パスワード再設定フォーム表示
router.get('/reset-password', csrfProtection, (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.render('forgot_password', {
      error: '無効なアクセスです',
      message: null,
      csrfToken: req.csrfToken()
    });
  }
  const now = Date.now();
  db.get(
    'SELECT id, email FROM users WHERE reset_token = ? AND reset_expires > ?',
    [token, now],
    (err, user) => {
      if (err || !user) {
        return res.render('forgot_password', {
          error: 'リンクが無効または期限切れです',
          message: null,
          csrfToken: req.csrfToken()
        });
      }
      // ★ ビューが email を hidden で受けるので渡しておく
      res.render('reset_password', {
        token,
        email: user.email,
        error: null,
        csrfToken: req.csrfToken()
      });
    }
  );
});

// パスワード再設定 実行
router.post('/reset-password', csrfProtection, (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.render('reset_password', {
      token,
      email: '', // 任意
      error: '未入力があります',
      csrfToken: req.csrfToken()
    });
  }

  const now = Date.now();
  db.get(
    'SELECT id, email FROM users WHERE reset_token = ? AND reset_expires > ?',
    [token, now],
    (err, user) => {
      if (err || !user) {
        return res.render('forgot_password', {
          error: 'リンクが無効または期限切れです',
          message: null,
          csrfToken: req.csrfToken()
        });
      }
      const hash = bcrypt.hashSync(password, 10);
      db.run(
        'UPDATE users SET password=?, reset_token=NULL, reset_expires=NULL WHERE id=?',
        [hash, user.id],
        (e2) => {
          if (e2) {
            return res.render('reset_password', {
              token,
              email: user.email,
              error: '保存に失敗しました',
              csrfToken: req.csrfToken()
            });
          }
          res.redirect('/login?verified=1');
        }
      );
    }
  );
});

// ========================
// ロール選択
// ========================
router.get('/select_role', csrfProtection, (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('select_role', { user: req.session.user, error: null, csrfToken: req.csrfToken() });
});

router.post('/select_role', csrfProtection, (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const role = req.body.role;

  if (role !== 'influencer' && role !== 'company') {
    return res.render('select_role', { user: req.session.user, error: '無効な役割です' });
  }

  const db = require('../models/db');
  db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.session.user.id], (err) => {
    if (err) {
      console.error('役割更新エラー:', err);
      return res.render('select_role', { user: req.session.user, error: '更新に失敗しました' });
    }

    // セッション更新
    req.session.user.role = role;
    req.session.role = role;

    // リダイレクト先を決定
    let redirectTo = req.session.returnTo;
    delete req.session.returnTo;
    if (!redirectTo) {
      redirectTo = role === 'company' ? '/company/home' : '/influencer/home';
    }

    res.redirect(redirectTo);
  });
});

// ========================
// ログアウト
// ========================
router.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("セッション削除失敗:", err);
      return res.redirect('/');
    }
    res.clearCookie('addpick_sess');
    res.redirect('/login');
  });
});

// ========================
// メールアドレス確認
// ========================
router.get('/verify', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.render('login', { error: '無効なリクエストです', nextUrl: '' });
  }

  db.get('SELECT * FROM users WHERE verify_token = ?', [token], (err, user) => {
    if (err) {
      console.error('verify DBエラー:', err);
      return res.render('login', { error: '内部エラー', nextUrl: '' });
    }
    if (!user) {
      return res.render('login', { error: 'トークンが無効です', nextUrl: '' });
    }

    // まだ未確認なら is_verified を更新
    db.run('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id], (err2) => {
      if (err2) {
        console.error('verify 更新失敗:', err2);
        return res.render('login', { error: '確認処理に失敗しました', nextUrl: '' });
      }

      // ✅ ログイン画面ではなくパスワード設定画面へ
      res.redirect(`/set-password?token=${token}`);
    });
  });
});

// ========================
// パスワード・ユーザー名設定
// ========================
router.get('/set-password', csrfProtection, (req, res) => {
  const token = req.query.token;
  if (!token) return res.send('無効なアクセスです');
  db.get('SELECT id FROM users WHERE verify_token = ?', [token], (err, user) => {
    if (!user) return res.send('無効なトークンです');
    res.render('set_password', { token, error: null, csrfToken: req.csrfToken() });
  });
});

// パスワード・ユーザー名設定ページ
router.post('/set-password', csrfProtection, (req, res) => {
  const { token, password, username } = req.body;
  if (!token || !password || !username) {
    return res.render('set_password', { token, error: 'すべて入力してください' });
  }

  db.get('SELECT * FROM users WHERE verify_token = ?', [token], (err, user) => {
    if (err || !user) {
      return res.render('set_password', { token, error: '無効なトークンです' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run(
      'UPDATE users SET password=?, name=?, verify_token=NULL WHERE id=?',
      [hash, username, user.id],
      (err2) => {
        if (err2) {
          console.error('パスワード更新エラー:', err2);
          return res.render('set_password', { token, error: '保存に失敗しました' });
        }
        // ✅ 成功時はログインページへリダイレクト
        res.redirect('/login?verified=1');
      }
    );
  });
});

module.exports = router;

