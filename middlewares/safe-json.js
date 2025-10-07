// middleware/safe-json.js
function toSafeJSON(obj) {
  return JSON
    .stringify(obj)
    .replace(/[<>&\u2028\u2029]/g, (c) => ({
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029'
    }[c]))
    .replace(/-->/g, '--\\u003e')
    .replace(/<!/g, '\\u003c!');
}

module.exports = function safeJson(req, res, next) {
  res.locals.safeJSON = toSafeJSON;
  next();
};
