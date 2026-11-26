// ==================== 认证路由（单用户模式） ====================
const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, execute } = require('../lib/db');
const { generateToken, cookieOptions } = require('../lib/auth');

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
    res.cookie('token', token, cookieOptions());

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// 登录限流：按 socket IP + 全局失败计数（不信任 X-Forwarded-For），
// 含失败递增延迟与临时锁定，防止分布式爆破和代理头绕过。
const loginAttempts = new Map();
const globalLock = { failures: 0, lockedUntil: 0 };
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  const until = Math.max(entry?.lockedUntil || 0, globalLock.lockedUntil);
  if (until > now) {
    return { allowed: false, retryAfter: Math.ceil((until - now) / 1000) };
  }
  return { allowed: true };
}

async function recordFailure(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) entry = { failures: 0, resetAt: now + WINDOW_MS, lockedUntil: 0 };
  entry.failures++;
  globalLock.failures++;
  if (entry.failures >= MAX_FAILURES) entry.lockedUntil = now + LOCK_MS;
  if (globalLock.failures >= MAX_FAILURES * 3) globalLock.lockedUntil = now + LOCK_MS;
  loginAttempts.set(ip, entry);
  // 失败次数越多延迟越长（1~5 秒），拖慢自动化爆破
  const delay = Math.min(5000, Math.max(0, entry.failures - 2) * 1000);
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
}

function recordSuccess(ip) {
  loginAttempts.delete(ip);
  globalLock.failures = 0;
  globalLock.lockedUntil = 0;
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt && now > entry.lockedUntil) loginAttempts.delete(ip);
  }
  if (globalLock.lockedUntil && now > globalLock.lockedUntil) globalLock.failures = 0;
}, 300000);
cleanupTimer.unref();

// POST /auth/login — 登录
router.post('/login', async (req, res, next) => {
  try {
    // 速率限制（基于 socket IP，不信任客户端伪造的代理头）
    const ip = clientIp(req);
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return res.status(429).json({ error: `登录已临时锁定，请 ${Math.max(1, Math.ceil(rate.retryAfter / 60))} 分钟后再试` });
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
      await recordFailure(ip);
      return res.status(401).json({ error: '密码错误' });
    }

    recordSuccess(ip);
    const token = generateToken(user);

    // 设置 cookie
    res.cookie('token', token, cookieOptions());

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

// POST /auth/revoke-all — 递增 token 版本，吊销所有已签发会话（含当前）
router.post('/revoke-all', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未登录' });
  execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
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
    username: 'admin',
    configured: true,
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

    // 更新密码并递增 token 版本：其他设备的旧 token 立即失效，当前会话换发新 token
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    execute(
      'UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?',
      [hashedPassword, user.id]
    );
    const updated = queryOne('SELECT id, token_version FROM users WHERE id = ?', [user.id]);
    res.cookie('token', generateToken(updated), cookieOptions());

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
