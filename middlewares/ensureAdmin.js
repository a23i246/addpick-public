// ensureAdmin.js（置き換え）
module.exports = function ensureAdmin(req, res, next) {
  const u = req.session?.user;
  const allow = (process.env.ADMIN_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const isAdmin = !!(u && (u.role === 'admin' || u.is_admin === true || allow.includes(String(u.id))));
  if (!isAdmin) return res.sendStatus(403);

  res.locals.isAdmin = true;
  next();
};
