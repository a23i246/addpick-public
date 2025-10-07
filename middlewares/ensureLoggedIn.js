module.exports = function ensureLoggedIn(req, res, next) {
  if (!req.session?.user) {
    req.session.afterLoginRedirect = req.originalUrl; // 元URLを記憶
    return res.redirect('/login');
  }
  next();
};
