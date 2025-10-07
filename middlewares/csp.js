// middleware/csp.js
const crypto = require('crypto');
const helmet = require('helmet');

function csp() {
  return [
    // リクエストごとにnonceを発行し、テンプレートで使えるようにする
    (req, res, next) => {
      res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
      next();
    },
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],

          // インラインscriptはnonce付きのみ許可
          scriptSrc: [
            "'self'",
            (req, res) => `'nonce-${res.locals.cspNonce}'`,
            // CDNを使うならここに限定許可（できれば自前ホストがベター）
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com"
          ],

          // CSS もインラインstyleを避ける。必要なら <style nonce="..."> で
          styleSrc: [
            "'self'",
            (req, res) => `'nonce-${res.locals.cspNonce}'`,
            "https://cdn.jsdelivr.net",
            "https://fonts.googleapis.com"
          ],

          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],

          // 可能なら有効化（Chrome/Edgeで効く）。JSインジェクションをさらに縛る
          requireTrustedTypesFor: ["'script'"],
          trustedTypes: ["appjs"],

          // http → https 自動アップグレード
          upgradeInsecureRequests: []
        }
      },

      // 既存構成との相性で無効化が必要な場合は適宜調整
      crossOriginEmbedderPolicy: false
    })
  ];
}

module.exports = csp;
