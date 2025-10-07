// middleware/sanitize.js
const sanitizeHtml = require('sanitize-html');

// 「プレーンテキストのみ許可」のフィールドにタグが混ざっていたら弾く
function rejectHtmlIn(fields = []) {
  const tagRe = /<[^>]*>/;
  return (req, res, next) => {
    for (const name of fields) {
      const v = req.body?.[name];
      if (typeof v === 'string' && tagRe.test(v)) {
        req.flash?.('error', `${name} にHTMLタグは使えません。`);
        return res.status(400).redirect('back');
      }
    }
    next();
  };
}

// 「許可HTMLのみOK」のフィールドをクリーンにして上書き
function sanitizeHtmlFields(fields = []) {
  return (req, res, next) => {
    for (const name of fields) {
      const v = req.body?.[name];
      if (typeof v === 'string') {
        req.body[name] = sanitizeHtml(v, {
          // 許可するタグを最小限に（必要に応じて増やす）
          allowedTags: [
            'b', 'i', 'em', 'strong', 'u',
            'p', 'br', 'ul', 'ol', 'li',
            'code', 'pre', 'blockquote',
            'a'
          ],
          allowedAttributes: {
            a: ['href', 'title', 'target', 'rel']
          },
          allowedSchemes: ['http', 'https', 'mailto'],
          allowProtocolRelative: false,
          // <a> には常に rel を足しておく（タブ乗っ取り対策）
          transformTags: {
            'a': (tagName, attribs) => ({
              tagName: 'a',
              attribs: {
                ...attribs,
                rel: 'noopener noreferrer nofollow'
              }
            })
          }
        });
      }
    }
    next();
  };
}

module.exports = {
  rejectHtmlIn,
  sanitizeHtmlFields
};
