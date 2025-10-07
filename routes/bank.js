const express = require('express');
const router = express.Router();
const { encrypt, decrypt, maskAccount } = require('../utils/bankCrypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'database.sqlite'));
const crypto = require('crypto');
const csrf = require('csurf');

const csrfProtection = csrf();

// 口座登録画面
router.get('/bank', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.get('SELECT * FROM bank_accounts WHERE user_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).send('DB error');

    let masked = null;
    if (row) {
      try {
        const acc = decrypt(row.account_number_cipher, row.account_iv, row.account_tag);
        masked = maskAccount(acc);
      } catch (e) {}
    }

    res.render('billing/bank_account_form', {
      pageTitle: '口座振替の設定',
      account: row,
      maskedAccount: masked,
      csrfToken: req.csrfToken(),
      user: req.session.user,
      bankVerified: row?.verified === 1,
      withdrawableJPYFmt: null
    });
  });
});

// 口座登録/更新
router.post('/bank', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  const { bank_code, branch_code, account_type, account_number, holder_kana, accept_mandate } = req.body || {};
  if (!bank_code || !branch_code || !account_type || !account_number || !holder_kana) {
    req.flash?.('error', '未入力の項目があります');
    return res.redirect('/billing/bank');
  }
  if (!/^\d{4}$/.test(bank_code) || !/^\d{3}$/.test(branch_code)) {
    req.flash?.('error', '銀行/支店コードの形式が不正です');
    return res.redirect('/billing/bank');
  }
  if (!['futsu', 'toza', 'chokin'].includes(account_type)) {
    req.flash?.('error', '口座種別が不正です');
    return res.redirect('/billing/bank');
  }
  if (!accept_mandate) {
    req.flash?.('error', '口座振替依頼の同意が必要です');
    return res.redirect('/billing/bank');
  }

  const enc = encrypt(account_number);
  const mandateAt = new Date().toISOString();
  const verifyCode = Math.floor(Math.random() * 99) + 1; // 1-99 の仮認証コード

  const sql = `
    INSERT INTO bank_accounts
      (user_id, bank_code, branch_code, account_type, account_number_cipher, account_iv, account_tag, holder_kana, mandate_accepted_at, verified, verify_code, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      bank_code=excluded.bank_code,
      branch_code=excluded.branch_code,
      account_type=excluded.account_type,
      account_number_cipher=excluded.account_number_cipher,
      account_iv=excluded.account_iv,
      account_tag=excluded.account_tag,
      holder_kana=excluded.holder_kana,
      mandate_accepted_at=excluded.mandate_accepted_at,
      verified=0,
      verify_code=excluded.verify_code,
      updated_at=datetime('now')
  `;
  db.run(sql, [
    userId, bank_code, branch_code, account_type,
    enc.ciphertextHex, enc.ivHex, enc.tagHex,
    holder_kana, mandateAt, verifyCode
  ], function (err) {
    if (err) return res.status(500).send('DB error: ' + err.message);
    req.flash?.('success', '口座情報を保存しました。仮認証を完了してください。');
    res.redirect('/billing/bank/verify');
  });
});

// 仮認証画面
router.get('/bank/verify', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.get(
    'SELECT verified, verify_code FROM bank_accounts WHERE user_id=?',
    [userId],
    (err, row) => {
      if (err) return res.status(500).send('DB error');

      const showHint = process.env.MOCK_PAYMENT === 'true';
      res.render('billing/bank_verify', {
        pageTitle: '口座の仮認証',
        alreadyVerified: row?.verified === 1,
        csrfToken: req.csrfToken(),
        mockCode: showHint ? row?.verify_code : null,
        user: req.session.user
      });
    }
  );
});

// 仮認証の送信
router.post('/bank/verify', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');
  const { amount } = req.body || {};
  const v = parseInt(amount, 10);

  db.get('SELECT verify_code FROM bank_accounts WHERE user_id=?', [userId], (err, row) => {
    if (err) return res.status(500).send('DB error');
    if (!row) {
      req.flash?.('error', '口座情報がありません');
      return res.redirect('/billing/bank');
    }
    if (v === row.verify_code) {
      db.run('UPDATE bank_accounts SET verified=1, updated_at=datetime(\'now\') WHERE user_id=?', [userId], (e) => {
        if (e) return res.status(500).send('DB error');
        req.flash?.('success', '仮認証が完了しました');
        res.redirect('/billing/bank');
      });
    } else {
      req.flash?.('error', '金額が一致しません（モック）');
      res.redirect('/billing/bank/verify');
    }
  });
});

// 引き落とし作成フォーム
router.get('/debits/new', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  db.get('SELECT verified FROM bank_accounts WHERE user_id=?', [userId], (err, row) => {
    if (err) return res.status(500).send('DB error');
    const ok = row?.verified === 1;
    res.render('billing/debit_new', {
      pageTitle: '引き落としを作成',
      canDebit: ok,
      csrfToken: req.csrfToken(),
      idemKey: crypto.randomUUID(),
      user: req.session.user
    });
  });
});

// 引き落としリクエスト
router.post('/debits', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  const { amount_jpy, idempotency_key, scheduled_at } = req.body || {};
  const amt = parseInt(amount_jpy, 10);
  if (!Number.isInteger(amt) || amt <= 0) {
    req.flash?.('error', '金額が不正です');
    return res.redirect('/debits/new');
  }

  db.get('SELECT verified FROM bank_accounts WHERE user_id=?', [userId], (err, row) => {
    if (err) return res.status(500).send('DB error');
    if (row?.verified !== 1) {
      req.flash?.('error', '口座の仮認証が未完了です');
      return res.redirect('/billing/bank');
    }

    const sql = `
      INSERT INTO bank_debit_requests (user_id, amount_jpy, status, idempotency_key, scheduled_at, requested_at)
      VALUES (?, ?, 'pending', ?, ?, datetime('now'))
    `;
    db.run(sql, [userId, amt, idempotency_key || crypto.randomUUID(), scheduled_at || null], function (e) {
      if (e) {
        if (String(e.message).includes('UNIQUE constraint failed: bank_debit_requests.idempotency_key')) {
          req.flash?.('info', '同一リクエストは受理済みです');
          return res.redirect('/debits');
        }
        return res.status(500).send('DB error: ' + e.message);
      }
      db.run('INSERT INTO bank_debit_events (debit_id, type, payload) VALUES (?, ?, ?)',
        [this.lastID, 'created', JSON.stringify({ amount: amt })]);
      req.flash?.('success', '引き落としリクエストを作成しました（モック）');
      res.redirect('/debits');
    });
  });
});

// 引き落とし一覧
router.get('/debits', csrfProtection, (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');
  db.all('SELECT * FROM bank_debit_requests WHERE user_id=? ORDER BY id DESC', [userId], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    res.render('billing/debits_list', {
      pageTitle: '引き落とし履歴',
      rows,
      user: req.session.user,
      csrfToken: req.csrfToken()
    });
  });
});

/** ===== 管理側：結果シミュレート ===== */
router.get('/admin/debits', csrfProtection, (req, res) => {
  db.all('SELECT * FROM bank_debit_requests ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    res.render('admin/debits_list', {
      pageTitle: '引き落とし(モック)管理',
      rows,
      csrfToken: req.csrfToken()
    });
  });
});

router.post('/admin/debits/:id/simulate', csrfProtection, (req, res) => {
  const id = Number(req.params.id);
  const { outcome } = req.body || {}; // 'succeeded' or 'failed'
  if (!['succeeded', 'failed'].includes(outcome)) return res.status(400).send('outcome不正');

  db.run(
    'UPDATE bank_debit_requests SET status=?, processed_at=datetime(\'now\'), failure_reason=? WHERE id=?',
    [outcome, outcome === 'failed' ? 'mock_failure' : null, id],
    function (err) {
      if (err) return res.status(500).send('DB error');
      db.run('INSERT INTO bank_debit_events (debit_id, type, payload) VALUES (?, ?, ?)',
        [id, outcome, JSON.stringify({ by: 'admin-mock' })]);
      req.flash?.('success', `#${id} を ${outcome} に更新しました`);
      res.redirect('/admin/debits');
    }
  );
});

module.exports = router;
