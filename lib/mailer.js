// lib/mailer.js
const nodemailer = require('nodemailer');

const sqlite3 = require('sqlite3').verbose();

function logStart({ orderId = null, userId = null, channel, to, subject }) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('database.sqlite');
    db.run(
      `INSERT INTO notification_logs (order_id, user_id, channel, to_email, subject, status, attempts)
       VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
      [orderId, userId, channel, to, subject],
      function (err) {
        db.close();
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function logSuccess(id) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('database.sqlite');
    db.run(
      `UPDATE notification_logs
         SET status='delivered', attempts=attempts+1, sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [id],
      function (err) { db.close(); err ? reject(err) : resolve(); }
    );
  });
}

function logFailure(id, error) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('database.sqlite');
    db.run(
      `UPDATE notification_logs
         SET status='failed', attempts=attempts+1, last_error=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [String(error && (error.response || error.message || error))?.slice(0, 2000), id],
      function (err) { db.close(); err ? reject(err) : resolve(); }
    );
  });
}

async function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  // 開発用（環境変数がない場合）
  const test = await nodemailer.createTestAccount();
  console.warn('[mailer] Using Ethereal test account');
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: { user: test.user, pass: test.pass },
  });
}

function renderPlain(order) {
  return [
    `新規注文が入りました（#${order.id}）`,
    `商品: ${order.title} / ${order.product_name}`,
    `数量: ${order.quantity}`,
    `単価: ¥${order.unit_price}`,
    `合計: ¥${order.unit_price * order.quantity}`,
    `購入者: ${order.buyer_name}`,
    `紹介者: ${order.influencer_name}`,
    `購入日時: ${order.created_at}`,
  ].join('\n');
}

async function sendOrderToCompany(to, order) {
  const transporter = await buildTransport();
  const total = (order.unit_price || 0) * (order.quantity || 1);
  const logId = await logStart({
    orderId: order.id, channel: 'company', to, subject: `【AddPick】新しい注文 #${order.id}`
  });
  const html = `
    <div style="font-family:sans-serif;padding:20px;">
      <h2 style="color:#0d6efd;">新しい注文がありました</h2>
      <p><strong>注文番号:</strong> #${order.id}</p>
      <table style="border-collapse:collapse;min-width:320px;margin-top:12px;">
        <tr><td style="padding:6px 8px;">商品</td><td style="padding:6px 8px;">${order.title} / ${order.product_name}</td></tr>
        <tr><td style="padding:6px 8px;">単価</td><td style="padding:6px 8px;">¥${order.unit_price}</td></tr>
        <tr><td style="padding:6px 8px;">数量</td><td style="padding:6px 8px;">${order.quantity}</td></tr>
        <tr><td style="padding:6px 8px;">合計</td><td style="padding:6px 8px;">¥${total}</td></tr>
        <tr><td style="padding:6px 8px;">購入者</td><td style="padding:6px 8px;">${order.buyer_name}</td></tr>
        <tr><td style="padding:6px 8px;">紹介者</td><td style="padding:6px 8px;">${order.influencer_name}</td></tr>
        <tr><td style="padding:6px 8px;">購入日時</td><td style="padding:6px 8px;">${order.created_at}</td></tr>
      </table>
      <p style="margin-top:16px;">
        管理画面で注文詳細を確認できます。
      </p>
      <p>
        <a href="${process.env.APP_BASE_URL || 'http://localhost:3000'}/company/purchases"
           style="background:#0d6efd;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block;">
          購入履歴を開く
        </a>
      </p>
      <p>— AddPick運営</p>
    </div>
  `;
  try{
  const info = await transporter.sendMail({
    from: process.env.FROM_ADDRESS || 'no-reply@addpick.local',
    to,
    subject: `【AddPick】新しい注文 #${order.id}`,
    html
  });
  await logSuccess(logId);
  const nodemailer = require('nodemailer');
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log('[mailer] Preview URL:', preview);
  return info;
  }catch (e) {
    await logFailure(logId, e);
    throw e;
  }
}

async function sendVerificationEmail(to, name, verifyUrl) {
  const transporter = await buildTransport();
  const logId = await logStart({
    orderId: null, channel: 'verify', to, subject: '【AddPick】メールアドレスの確認'
  });

  const html = `
    <div style="font-family: sans-serif; padding: 20px;">
      <h2 style="color:#0d6efd;">メールアドレス確認のお願い</h2>
      <p><strong>${name} 様</strong></p>
      <p>AddPick にご登録いただきありがとうございます。</p>
      <p>以下のボタンをクリックして、登録を完了してください。</p>
      <p style="margin:20px 0;">
        <a href="${verifyUrl}" style="background:#0d6efd;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block;">
          メールアドレスを確認する
        </a>
      </p>
      <p>このリンクは一定時間で無効になる場合があります。</p>
      <p>— AddPick運営</p>
    </div>`;
    try{
  const info = await transporter.sendMail({
    from: process.env.FROM_ADDRESS || 'no-reply@addpick.local',
    to,
    subject: '【AddPick】メールアドレスの確認',
    html
  });
  console.log("📨 sendMail result:", info);
  await logSuccess(logId);
  const nodemailer = require('nodemailer');
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log('[mailer] Preview URL:', preview);
  return info;
  } catch (e) {
    await logFailure(logId, e);
    throw e;
  }
}

async function sendPurchaseReceiptToBuyer(to, order) {
  const transporter = await buildTransport();
  const total = (order.unit_price || 0) * (order.quantity || 1);
  const logId = await logStart({
    orderId: order.id, channel: 'buyer', to, subject: '【AddPick】ご注文内容のご案内'
  });
  const html = `
    <div style="font-family:sans-serif;padding:20px;">
      <h2 style="color:#0d6efd;">ご購入ありがとうございます</h2>
      <p><strong>${order.buyer_name} 様</strong></p>
      <p>以下の内容でご注文を承りました。</p>
      <table style="border-collapse:collapse;min-width:320px">
        <tr><td style="padding:6px 8px;">注文番号</td><td style="padding:6px 8px;">#${order.id}</td></tr>
        <tr><td style="padding:6px 8px;">商品</td><td style="padding:6px 8px;">${order.title} / ${order.product_name}</td></tr>
        <tr><td style="padding:6px 8px;">単価</td><td style="padding:6px 8px;">¥${order.unit_price}</td></tr>
        <tr><td style="padding:6px 8px;">数量</td><td style="padding:6px 8px;">${order.quantity}</td></tr>
        <tr><td style="padding:6px 8px;">合計</td><td style="padding:6px 8px;">¥${total}</td></tr>
        <tr><td style="padding:6px 8px;">購入日時</td><td style="padding:6px 8px;">${order.created_at}</td></tr>
      </table>
      <p style="margin-top:16px;">マイページの購入履歴でも確認できます。</p>
      <p><a href="${process.env.APP_BASE_URL || 'http://localhost:3000'}/my_purchases" style="background:#0d6efd;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block;">購入履歴を開く</a></p>
      <p>— AddPick運営</p>
    </div>
  `;
  try{
  const info = await transporter.sendMail({
    from: process.env.FROM_ADDRESS || 'no-reply@addpick.local',
    to,
    subject: '【AddPick】ご注文内容のご案内',
    html
  });
  await logSuccess(logId);
  const nodemailer = require('nodemailer');
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log('[mailer] Preview URL:', preview);
  return info;
  } catch (e) {
    await logFailure(logId, e);
    throw e;
  }
}

async function sendPasswordResetEmail(to, resetUrl) {
  const transporter = await buildTransport();
  const logId = await logStart({
    orderId: null,
    channel: 'reset',
    to,
    subject: '【AddPick】パスワードリセットのご案内'
  });

  const html = `
    <div style="font-family: sans-serif; padding: 20px;">
      <h2 style="color:#0d6efd;">パスワードリセットのご案内</h2>
      <p><strong>${to} 様</strong></p>
      <p>パスワードのリセットをリクエストいただきました。</p>
      <p>以下のボタンをクリックして、新しいパスワードを設定してください。</p>
      <p style="margin:20px 0;">
        <a href="${resetUrl}" style="background:#0d6efd;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block;">
          パスワードをリセットする
        </a>
      </p>
      <p>※このリンクは30分で期限切れになります。</p>
      <p>— AddPick運営</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: process.env.FROM_ADDRESS || 'no-reply@addpick.local',
      to,
      subject: '【AddPick】パスワードリセットのご案内',
      html
    });
    await logSuccess(logId);

    const preview = require('nodemailer').getTestMessageUrl(info);
    if (preview) console.log('[mailer] Preview URL:', preview);

    return info;
  } catch (e) {
    await logFailure(logId, e);
    throw e;
  }
}


module.exports = {
  sendOrderToCompany,
  sendVerificationEmail,      
  sendPurchaseReceiptToBuyer,
  sendPasswordResetEmail  
};