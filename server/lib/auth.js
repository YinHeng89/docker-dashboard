// ==================== JWT 认证模块 ====================
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// 未设置 JWT_SECRET 时每次启动使用随机值（重启后旧 token 自动失效）
const JWT_SECRET = process.env.JWT_SECRET ||
  'docker-dashboard-' + crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = '7d';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// HTTPS 反代部署时设置 COOKIE_SECURE=1，让浏览器只通过 HTTPS 回传 cookie
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: TOKEN_MAX_AGE,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
  };
}

/**
 * 生成 JWT token（ver 用于改密/登出所有设备后使旧 token 失效）
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, ver: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * 解析 cookies
 */
function parseCookies(cookieStr) {
  if (!cookieStr) return {};
  const cookies = {};
  cookieStr.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      cookies[key] = decodeURIComponent(val || '');
    }
  });
  return cookies;
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  TOKEN_MAX_AGE,
  COOKIE_SECURE,
  generateToken,
  cookieOptions,
  parseCookies,
};
