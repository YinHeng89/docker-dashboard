// ==================== 认证路由（单用户模式） ====================
const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, execute } = require('../lib/db');
const { generateToken } = require('../lib/auth');

const router = express.Router();

// GET /auth/status — 检查系统是否已初始化
router.get('/status', (req, res) => {
  const user = queryOne('SELECT id FROM users LIMIT 1');
  res.json({ initialized: !!user });
});

// POST /auth/setup — 首次设置（仅当无用户时可用）
router.post('/setup', async (req, res, next) => {
  try {
    // 检查是否已有用户
    const existing = queryOne('SELECT id FROM users LIMIT 1');
    if (existing) {
      return res.status(403).json({ error: '系统已初始化，请使用登录功能' });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: '密码不能为空' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    // 创建唯一用户
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = execute(
      'INSERT INTO users (password) VALUES (?)',
      [hashedPassword]
    );

    // 初始化偏好设置
    execute(
      'INSERT INTO preferences (user_id) VALUES (?)',
      [result.lastInsertRowid]
    );

    // 生成 token
    const user = { id: result.lastInsertRowid };
    const token = generateToken(user);

    // 设置 cookie
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
      sameSite: 'lax',
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// 登录速率限制（内存实现，每个 IP 每分钟最多 10 次）
const loginAttempts = new Map();
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60000;
  const maxAttempts = 10;
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count++;
  return true;
}
// 每 5 分钟清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 300000);

// POST /auth/login — 登录
router.post('/login', async (req, res, next) => {
  try {
    // 速率限制
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({ error: '登录尝试过于频繁，请 1 分钟后再试' });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: '密码不能为空' });
    }

    // 单用户模式：查询唯一用户
    const user = queryOne('SELECT * FROM users LIMIT 1');
    if (!user) {
      return res.status(401).json({ error: '系统未初始化' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: '密码错误' });
    }

    const token = generateToken(user);

    // 设置 cookie
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// POST /auth/logout — 登出
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

// GET /auth/me — 获取当前用户信息
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });

  const user = queryOne('SELECT id, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const prefs = queryOne('SELECT * FROM preferences WHERE user_id = ?', [user.id]);

  res.json({
    preferences: { cmdHistory: prefs ? JSON.parse(prefs.cmd_history || '[]') : [] },
  });
});

// PUT /auth/password — 修改密码
router.put('/password', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未登录' });

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '旧密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 个字符' });
    }

    // 验证旧密码
    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: '旧密码错误' });
    }

    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// PUT /auth/prefs — 更新偏好设置
router.put('/prefs', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });

  const { cmdHistory } = req.body;
  const updates = [];
  const params = [];

  if (cmdHistory !== undefined) {
    updates.push('cmd_history = ?');
    params.push(JSON.stringify(cmdHistory));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: '没有要更新的字段' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.user.id);

  execute(`UPDATE preferences SET ${updates.join(', ')} WHERE user_id = ?`, params);
  res.json({ success: true });
});

module.exports = router;
