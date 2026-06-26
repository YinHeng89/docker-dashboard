// ==================== JWT 认证模块 ====================
const jwt = require('jsonwebtoken');

// 生产环境 JWT_SECRET 必须通过环境变量设置，否则使用随机值
const JWT_SECRET = process.env.JWT_SECRET ||
  'docker-dashboard-' + require('crypto').randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = '7d';

/**
 * 生成 JWT token
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id },
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

/**
 * 认证中间件
 * 优先从 httpOnly cookie 中读取 token，其次从 Authorization header
 */
function authMiddleware(req, res, next) {
  let token = null;

  // 1. 从 httpOnly cookie 获取（最安全的方式）
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.token) {
    token = cookies.token;
  }

  // 2. 从 Authorization header 获取（向后兼容）
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    // 区分 token 过期和无效
    const msg = e.name === 'TokenExpiredError'
      ? '登录已过期，请重新登录'
      : '认证无效，请重新登录';
    return res.status(401).json({ error: msg });
  }
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  generateToken,
  authMiddleware,
  parseCookies,
};
