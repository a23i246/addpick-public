const crypto = require('crypto');

const keyHex = process.env.BANKDATA_KEY;
if (!keyHex || keyHex.length !== 64) {
  console.warn('[WARN] BANKDATA_KEY が未設定 or 長さ不正です（32byteのhex想定）');
}
const KEY = Buffer.from(keyHex || '0'.repeat(64), 'hex'); // 開発時ガード

exports.encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertextHex: enc.toString('hex'),
    ivHex: iv.toString('hex'),
    tagHex: tag.toString('hex'),
  };
};

exports.decrypt = (ciphertextHex, ivHex, tagHex) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
};

exports.maskAccount = (num) => {
  // 口座番号を下4桁だけ表示
  const s = String(num || '');
  return s.length > 4 ? '****' + s.slice(-4) : '****';
};
