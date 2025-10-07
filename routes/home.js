const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }

  // ✅ 両方を確認する
  const role = req.session.role || req.session.user?.role;

  if (!role) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/select_role');
  }

  if (role === 'influencer') {
    return res.redirect('/influencer/home');
  } else if (role === 'company') {
    return res.redirect('/company/home');
  } else if (role === 'admin') {
    return res.redirect('/admin/dashboard');
  } else {
    return res.send('不明なロール');
  }
});

module.exports = router;
