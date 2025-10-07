// E:\addpick\middlewares\csrf.js
const csurf = require('csurf');

// 例: セッションストアを使う一般的な設定（クッキーを使う場合は { cookie: true }でもOK）
module.exports = csurf();
