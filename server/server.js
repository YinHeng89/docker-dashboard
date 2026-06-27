// ==================== Docker Dashboard 统一服务入口 ====================
// 前端静态文件 + 后端 API + Docker 代理 + WebSocket 一站式服务
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { PROJECTS_DIR, getSelfContainerId, ensureDir, initSamePathCheck, isRelativePathSupported } = require('./lib/utils');
const { parseCookies, JWT_SECRET } = require('./lib/auth');
const { queryOne } = require('./lib/db');
const jwt = require('jsonwebtoken');

const composeModule = require('./routes/compose');
const execRoutes = require('./routes/exec');
const filesRoutes = require('./routes/files');
const authRoutes = require('./routes/auth');
const registryRoutes = require('./routes/registry');
const templatesRoutes = require('./routes/templates');
const metricsRoutes = require('./routes/metrics');
const containerRoutes = require('./routes/containers');
const updateRoutes = require('./routes/update');
const groupsRoutes = require('./routes/groups');
const autoUpdate = require('./services/auto-update.service');

const app = express();
const server = http.createServer(app);

// ==================== 中间件 ====================
// /docker 代理路径 + /files/upload 跳过 JSON 解析
app.use((req, res, next) => {
  if (req.path.startsWith('/docker')) return next();
  if (req.path === '/files/upload' && req.method === 'POST') return next();
  express.json({ limit: '5mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// 安全头（防止 XSS、点击劫持、MIME 嗅探等）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ==================== 健康检查（公开） ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', projectsDir: PROJECTS_DIR });
});

// ==================== 认证中间件 ====================
// 判断是否应重定向到登录页（SPA 页面请求 + 静态资源）
function shouldRedirectToLogin(req) {
  if (req.method !== 'GET') return false;
  // API / WebSocket / 静态资源不重定向，返回 401
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/auth/') ||
      req.path.startsWith('/docker/') ||
      req.path.startsWith('/ws/') ||
      req.path.startsWith('/assets/') ||
      req.path === '/health') return false;
  // 其他所有 GET 请求（SPA 路由）→ 重定向到登录
  return true;
}

// 从请求中提取 token
function extractToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.token) return cookies.token;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

app.use((req, res, next) => {
  // 公开路径无需认证
  const publicPaths = [
    '/auth/login', '/auth/setup', '/auth/status', '/auth/logout',
    '/health', '/login',
  ];
  if (publicPaths.includes(req.path)) return next();
  // React 静态资源公开
  if (req.path.startsWith('/assets/')) return next();

  // 需要重定向的请求类型（SPA 页面请求）
  const redirectOnAuthFail = shouldRedirectToLogin(req);

  // 提取并验证 token
  const token = extractToken(req);
  if (!token) {
    if (redirectOnAuthFail) return res.redirect('/login');
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);

    // 验证用户是否仍存在于数据库中（防止数据库被删除后旧 token 仍有效）
    const dbUser = queryOne('SELECT id FROM users WHERE id = ?', [req.user.id]);
    if (!dbUser) {
      res.clearCookie('token');
      if (redirectOnAuthFail) return res.redirect('/login');
      return res.status(401).json({ error: '用户不存在，请重新登录' });
    }

    // JWT 滑动过期：距离到期不到 1 天时自动续期
    const now = Math.floor(Date.now() / 1000);
    if (req.user.exp && (req.user.exp - now) < 86400) {
      const newToken = jwt.sign(
        { id: req.user.id },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.cookie('token', newToken, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/',
      });
    }

    return next();
  } catch (e) {
    // token 过期或无效 → 清除 cookie
    res.clearCookie('token');
    if (redirectOnAuthFail) return res.redirect('/login');
    const msg = e.name === 'TokenExpiredError'
      ? '登录已过期，请重新登录'
      : '认证无效，请重新登录';
    return res.status(401).json({ error: msg });
  }
});

// ==================== 受保护静态资源 ====================
// React SPA 构建产物（需认证）
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API 路由 ====================
// 自身容器 ID + Docker 连接信息
app.get('/api/self', (req, res) => {
  const dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
  const hostLabel = dockerHost.startsWith('unix://') ? 'local' : dockerHost;
  res.json({
    containerId: getSelfContainerId() || os.hostname(),
    dockerHost: `${hostLabel} - ${dockerHost}`,
  });
});

app.use('/auth', authRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/system/metrics', metricsRoutes);

// ==================== 容器进程列表（兜底 Alpine/BusyBox / scratch） ====================
app.get('/docker/containers/:id/top', (req, res) => {
  const { id } = req.params;
  const httpMod = require('http');

  // 先尝试 Docker top API
  const topReq = httpMod.get({
    socketPath: '/var/run/docker.sock',
    path: `/containers/${id}/top`,
  }, (topRes) => {
    let body = '';
    topRes.on('data', c => body += c);
    topRes.on('end', () => {
      if (topRes.statusCode === 200) {
        return res.status(200).json(JSON.parse(body));
      }
      // top API 失败 → docker exec ps 兜底
      const { exec } = require('child_process');
      const empty = { Titles: ['PID', 'USER', 'TIME', 'COMMAND'], Processes: [] };

      const runPs = (cmd) => new Promise((resolve) => {
        exec(`docker exec ${id} ${cmd}`, { timeout: 5000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          const lines = stdout.trim().split('\n');
          if (lines.length < 2) return resolve(null);
          const titles = lines[0].trim().split(/\s+/);
          // ps aux: USER PID ... %CPU %MEM ... START TIME COMMAND（11列）
          const isPsAux = titles.includes('%CPU') || titles.includes('%MEM');
          const procs = lines.slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            if (isPsAux) {
              // ps aux: 取 PID/USER/TIME/COMMAND
              return [parts[1], parts[0], parts[9] || '', parts.slice(10).join(' ')];
            } else {
              // busybox ps: PID USER TIME COMMAND
              return [parts[0], parts[1], parts[2] || '', parts.slice(3).join(' ')];
            }
          });
          resolve({ Titles: ['PID', 'USER', 'TIME', 'COMMAND'], Processes: procs });
        });
      });

      // /proc 兜底（s6-init / 无 ps 的容器）
      const runProc = () => new Promise((resolve) => {
        // 用空格拼接避免 join(';') 破坏 shell for 循环语法
        const script =
          'for d in /proc/[0-9]*; do ' +
          'p=$(basename $d); ' +
          'c=$(cat $d/cmdline 2>/dev/null | tr "\\0" " " | sed "s/ *$//"); ' +
          'u=$(grep "^Uid:" $d/status 2>/dev/null | tr -s "\\t " " " | cut -d" " -f2); ' +
          '[ -n "$c" ] && echo "$p|${u:-0}|0:00|$c"; ' +
          'done';
        exec(`docker exec ${id} sh -c '${script}' 2>/dev/null`, { timeout: 5000 }, (err, stdout) => {
          console.log('[top] /proc fallback for', id.slice(0, 12), 'err:', err?.message, 'len:', stdout?.length);
          if (err || !stdout.trim()) return resolve(null);
          const procs = stdout.trim().split('\n')
            .filter(Boolean)
            .filter(l => !l.includes('/proc/[0-9]'))  // 过滤掉自身 exec 进程
            .map(l => l.split('|'));
          resolve(procs.length ? { Titles: ['PID', 'USER', 'TIME', 'COMMAND'], Processes: procs } : null);
        });
      });

      (async () => {
        const result = await runPs('ps aux')
                    ?? await runPs('ps')
                    ?? await runProc();
        res.json(result ?? empty);
      })();
    });
  });
  topReq.on('error', () => res.json({ Titles: ['PID', 'USER', 'TIME', 'COMMAND'], Processes: [] }));
  topReq.setTimeout(10000, () => { topReq.destroy(); res.json({ Titles: ['PID', 'USER', 'TIME', 'COMMAND'], Processes: [] }); });
});

// ==================== 容器工作目录（多层兜底） ====================
app.get('/api/containers/:id/workingdir', (req, res) => {
  const { id } = req.params;
  const { exec } = require('child_process');

  const inspectReq = http.request({
    socketPath: '/var/run/docker.sock',
    path: `/containers/${id}/json`,
    method: 'GET',
  }, (inspectRes) => {
    let body = '';
    inspectRes.on('data', c => body += c);
    inspectRes.on('end', () => {
      try {
        const info = JSON.parse(body);

        // ① 镜像已设置 WorkingDir
        if (info.Config?.WorkingDir) {
          return res.json({ workingDir: info.Config.WorkingDir });
        }

        // ② 从宿主机 /proc/{pid}/cwd 读 symlink（不依赖容器内任何工具）
        const pid = info.State?.Pid;
        if (pid) {
          try {
            const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
            if (cwd) return res.json({ workingDir: cwd });
          } catch (_) {}
        }

        // ③ docker exec 兜底
        exec(
          `docker exec ${id} sh -c 'readlink /proc/1/cwd 2>/dev/null || pwd 2>/dev/null || echo /'`,
          { timeout: 3000 },
          (_err, stdout) => {
            const cwd = stdout?.trim() || '/';
            res.json({ workingDir: cwd });
          }
        );
      } catch (e) {
        res.json({ workingDir: '/' });
      }
    });
  });

  inspectReq.on('error', () => res.json({ workingDir: '/' }));
  inspectReq.setTimeout(10000, () => { inspectReq.destroy(); res.json({ workingDir: '/' }); });
  inspectReq.end();
});

// ==================== Docker API 代理（需认证） ====================
// 所有 /docker/* 请求通过 Unix socket 直连 Docker Daemon，支持流式响应
// Docker stats 转换：原始 stats → 前端需要的 ContainerStats 格式
function transformStats(raw) {
  const cpuStats = raw.cpu_stats || {};
  const precpuStats = raw.precpu_stats || {};
  const memStats = raw.memory_stats || {};
  const networks = raw.networks || {};

  // CPU 百分比：基于两次采样的差值计算
  const cpuDelta = (cpuStats.cpu_usage?.total_usage || 0) - (precpuStats.cpu_usage?.total_usage || 0);
  const systemDelta = (cpuStats.system_cpu_usage || 0) - (precpuStats.system_cpu_usage || 0);
  const cpuCount = cpuStats.online_cpus || (cpuStats.cpu_usage?.percpu_usage?.length || 1);
  const cpuPercent = systemDelta > 0 && cpuDelta > 0
    ? Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10
    : 0;

  // 内存百分比
  const memPercent = memStats.limit > 0
    ? Math.round((memStats.usage / memStats.limit) * 1000) / 10
    : 0;

  // 网络：聚合所有接口
  let netRx = 0, netTx = 0;
  for (const iface of Object.values(networks)) {
    netRx += iface.rx_bytes || 0;
    netTx += iface.tx_bytes || 0;
  }

  // 块设备 I/O
  const blkio = raw.blkio_stats || {};
  let blockRead = 0, blockWrite = 0;
  for (const s of (blkio.io_service_bytes_recursive || [])) {
    if (s.op === 'read') blockRead += s.value || 0;
    if (s.op === 'write') blockWrite += s.value || 0;
  }

  return {
    id: raw.id || '',
    name: (raw.name || '').replace(/^\//, ''),
    cpu_percent: cpuPercent,
    memory_percent: memPercent,
    memory_usage: memStats.usage || 0,
    memory_limit: memStats.limit || 0,
    network_rx: netRx,
    network_tx: netTx,
    block_read: blockRead,
    block_write: blockWrite,
    pids: raw.pids_stats?.current || 0,
  };
}

app.use('/docker', (req, res) => {
  const contentLength = parseInt(req.headers['content-length'], 10);
  if (contentLength > 50 * 1024 * 1024) {
    return res.status(413).json({ error: '请求体过大，最大 50MB' });
  }

  const targetPath = req.originalUrl.replace(/^\/docker/, '') || '/';
  const proxyOpts = {
    socketPath: '/var/run/docker.sock',
    path: targetPath,
    method: req.method,
    headers: { ...req.headers },
  };

  delete proxyOpts.headers.host;
  delete proxyOpts.headers['cookie'];
  delete proxyOpts.headers['authorization'];
  delete proxyOpts.headers['x-forwarded-for'];
  delete proxyOpts.headers['x-forwarded-proto'];

  // 判断是否为容器 stats 请求（需要转换格式）
  const statsMatch = targetPath.match(/^\/containers\/([a-f0-9]+)\/stats/);
  const isStatsRequest = statsMatch && req.url.includes('stream=false');

  const proxyReq = http.request(proxyOpts, (proxyRes) => {
    if (isStatsRequest && proxyRes.statusCode === 200) {
      // 缓冲响应，转换后返回
      let body = '';
      proxyRes.on('data', c => body += c);
      proxyRes.on('end', () => {
        try {
          const raw = JSON.parse(body);
          const transformed = transformStats(raw);
          res.json(transformed);
        } catch {
          res.status(500).json({ error: 'Stats 数据处理失败' });
        }
      });
    } else {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('[Docker Socket] 错误:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Docker API 不可用: ' + err.message });
    }
  });

  proxyReq.setTimeout(300000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Docker API 请求超时' });
    }
  });

  req.pipe(proxyReq);
});

// ==================== 业务路由（需认证） ====================
app.use('/projects', composeModule.router);
app.post('/projects/create-stream', composeModule.handleCreateStream);
app.post('/projects/:name/action-stream', composeModule.handleActionStream);
app.use('/exec', execRoutes.router);
app.use('/files', filesRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/groups', groupsRoutes);

// 容器镜像更新检查（update.js 含缓存） & 安全重建（containers.js 先创建后删除）
app.get('/api/containers/check-updates', updateRoutes.handleCheckAllUpdates);
app.get('/api/containers/:id/check-update', updateRoutes.handleCheckUpdate);
app.post('/api/containers/:id/update', containerRoutes.handleUpdate);
app.post('/api/containers/:id/update-stream', containerRoutes.handleUpdateStream);
app.post('/api/update/stream', updateRoutes.handleUpdateStream);

// ==================== 自动更新检测 ====================
app.get('/api/auto-update/status', (req, res) => {
  res.json({ settings: autoUpdate.getSettings(), results: autoUpdate.getResults() });
});
app.post('/api/auto-update/check', async (req, res) => {
  autoUpdate.runCheck();
  res.json({ success: true, message: '检测已触发' });
});
app.put('/api/auto-update/settings', (req, res) => {
  const { enabled, intervalHours } = req.body;
  autoUpdate.updateSettings(!!enabled, intervalHours || 6);
  res.json({ success: true });
});
app.post('/api/auto-update/clear', (req, res) => {
  autoUpdate.clearResults();
  res.json({ success: true });
});

// ==================== 外部 compose 项目发现 ====================
app.get('/api/discovered', async (req, res) => {
  try {
    const containers = await fetchContainers();
    const discovered = {};

    for (const c of containers) {
      const labels = c.Labels || {};
      const projectName = labels['com.docker.compose.project'];
      if (!projectName) continue;

      // 去重：同一个 compose 项目可能有多个容器
      if (discovered[projectName]) continue;

      const workingDir = labels['com.docker.compose.project.working_dir'] || '';
      const configFiles = labels['com.docker.compose.project.config_files'] || '';

      discovered[projectName] = {
        name: projectName,
        workingDir,
        configFiles,
        source: 'docker-label',
        containerCount: 0,
      };
    }

    // 统计每个项目的容器数量
    for (const c of containers) {
      const projectName = (c.Labels || {})['com.docker.compose.project'];
      if (projectName && discovered[projectName]) {
        discovered[projectName].containerCount++;
      }
    }

    res.json(Object.values(discovered));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 系统运行信息 ====================
const { version } = require('./package.json');

app.get('/api/system/info', (req, res) => {
  res.json({
    version: version || '1.0.0',
    port: process.env.PORT || 3000,
    projectsDir: PROJECTS_DIR,
    dockerSocket: '/var/run/docker.sock',
    relativePathSupported: isRelativePathSupported(),
    jwtConfigured: !!process.env.JWT_SECRET,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });
});

// ==================== SPA 路由回退（需认证） ====================
// 以上未匹配的非 API 路径 → 返回 React index.html，由前端路由接管
app.get('*', (req, res) => {
  // API/WebSocket 路径不应走到这里，返回 404
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/auth/') ||
      req.path.startsWith('/docker/') ||
      req.path.startsWith('/ws/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 错误处理 ====================
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  const status = err.status || 500;
  // 生产环境不暴露内部错误详情
  const message = status === 500 && process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : err.message;
  res.status(status).json({ error: message });
});

// ==================== 启动服务器 ====================
const PORT = process.env.PORT || 3000;

// 确保项目目录存在
ensureDir(PROJECTS_DIR).catch(e => {
  console.warn('无法创建项目目录:', e.message);
});

// 检测同路径挂载状态，再启动服务
initSamePathCheck().then(() => {
  server.listen(PORT, () => {
    console.log('══════════════════════════════════════');
    console.log('  Docker Dashboard 已启动');
    console.log(`  地址:    http://0.0.0.0:${PORT}`);
    console.log(`  项目目录: ${PROJECTS_DIR}`);
    console.log(`  Docker:  /var/run/docker.sock`);
    console.log(`  相对路径: ${isRelativePathSupported() ? '✅ 支持（同路径挂载）' : '❌ 不支持'}`);
    const jwtOk = process.env.JWT_SECRET;
    console.log(`  JWT:     ${jwtOk ? '已配置' : '⚠️  使用随机值（生产环境请设置 JWT_SECRET）'}`);
    console.log('══════════════════════════════════════');
  });
  });
// 启动自动更新检测服务（必须在 async init 后，但要在 API 就绪后）
autoUpdate.init();

// ==================== WebSocket: 流式终端认证 ====================
function verifyWsAuth(req) {
  // 方式1: Cookie 认证
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.token) {
      const decoded = jwt.verify(cookies.token, JWT_SECRET);
      // 验证用户是否仍存在于数据库中
      const dbUser = queryOne('SELECT id FROM users WHERE id = ?', [decoded.id]);
      if (dbUser) return true;
    }
  } catch (_) {}

  // 方式2: URL 参数 token
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      // 验证用户是否仍存在于数据库中
      const dbUser = queryOne('SELECT id FROM users WHERE id = ?', [decoded.id]);
      if (dbUser) return true;
    }
  } catch (_) {}

  return false;
}

// ==================== WebSocket: 流式终端 ====================
// 使用 noServer 模式 + 手动处理 upgrade，解决多 WSS 实例路径匹配问题
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  if (!verifyWsAuth(req)) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  console.log('[WS exec] 客户端已连接');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'exec') {
        execRoutes.handleWsExec(ws, msg.command, msg.cwd);
      } else if (msg.type === 'compose:exec') {
        composeModule.handleWsCompose(ws, msg.action, msg.project);
      } else if (msg.type === 'input') {
        // Ctrl+C：直接发 SIGINT
        if (msg.data === '\x03') {
          const execProc = execRoutes.activeProcesses.get(ws);
          if (execProc) { execProc.kill('SIGINT'); return; }
          const composeProc = composeModule.composeProcesses.get(ws);
          if (composeProc) { composeProc.kill('SIGINT'); return; }
        }
        // 普通 stdin 写入
        const execProc = execRoutes.activeProcesses.get(ws);
        if (execProc && execProc.stdin) {
          execProc.stdin.write(msg.data);
          return;
        }
        const composeProc = composeModule.composeProcesses.get(ws);
        if (composeProc && composeProc.stdin) {
          composeProc.stdin.write(msg.data);
        }
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: e.message }));
    }
  });

  ws.on('close', () => {
    console.log('[WS exec] 客户端断开');
    const execProc = execRoutes.activeProcesses.get(ws);
    if (execProc) {
      execProc.kill();
      execRoutes.activeProcesses.delete(ws);
    }
    const composeProc = composeModule.composeProcesses.get(ws);
    if (composeProc) {
      composeProc.kill();
      composeModule.composeProcesses.delete(ws);
    }
  });
});

console.log('WebSocket 终端就绪 → /ws/exec');

// ==================== WebSocket: 实时推送（Docker 事件 + 容器列表） ====================
const liveWss = new WebSocketServer({ noServer: true });
const liveClients = new Set();

function broadcastLive(msg) {
  const data = JSON.stringify(msg);
  for (const ws of liveClients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// 通过 Docker socket 获取容器列表
function fetchContainers() {
  return new Promise((resolve, reject) => {
    const req = http.get({
      socketPath: '/var/run/docker.sock',
      path: '/containers/json?all=true',
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Docker socket 超时')); });
  });
}

// 监听 Docker 事件流（通过 socket）— 指数退避重连
let eventStreamRetryDelay = 1000;
const MAX_RETRY_DELAY = 30000; // 最大 30 秒
function startDockerEventStream() {
  const req = http.get({
    socketPath: '/var/run/docker.sock',
    path: '/events',
  }, (res) => {
    // 连接成功 → 重置退避时间
    eventStreamRetryDelay = 1000;
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          broadcastLive({ type: 'docker-event', data: evt });

          const containerActions = ['start', 'stop', 'die', 'create', 'destroy', 'pause', 'unpause', 'rename', 'restart'];
          if (evt.Type === 'container' && containerActions.includes(evt.Action)) {
            setTimeout(pushContainerList, 500);
          }
          if (evt.Type === 'image' && ['pull', 'delete', 'tag', 'untag'].includes(evt.Action)) {
            setTimeout(pushContainerList, 500);
          }
        } catch (_) { /* skip invalid JSON */ }
      }
    });
    res.on('end', () => {
      console.log(`[Live] Docker 事件流断开，${(eventStreamRetryDelay / 1000).toFixed(1)}s 后重连...`);
      setTimeout(startDockerEventStream, eventStreamRetryDelay);
      eventStreamRetryDelay = Math.min(eventStreamRetryDelay * 2, MAX_RETRY_DELAY);
    });
    res.on('error', (e) => {
      console.warn('[Live] Docker 事件流错误:', e.message);
      setTimeout(startDockerEventStream, eventStreamRetryDelay);
      eventStreamRetryDelay = Math.min(eventStreamRetryDelay * 2, MAX_RETRY_DELAY);
    });
  });
  req.on('error', (e) => {
    console.warn('[Live] 无法连接 Docker 事件流:', e.message);
    setTimeout(startDockerEventStream, eventStreamRetryDelay);
    eventStreamRetryDelay = Math.min(eventStreamRetryDelay * 2, MAX_RETRY_DELAY);
  });
}

let pushTimer = null;
let pushInProgress = false;
let pushPending = false;
async function pushContainerList() {
  // 防抖：300ms 内的多次调用合并为一次
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    // 并发保护：如果上一次推送还在进行中，标记 pending 等待完成后再推
    if (pushInProgress) {
      pushPending = true;
      return;
    }
    pushInProgress = true;
    try {
      const containers = await fetchContainers();
      broadcastLive({ type: 'containers', data: containers });
    } catch (e) {
      console.warn('[Live] 容器列表推送失败:', e.message);
    } finally {
      pushInProgress = false;
      // 如果在推送期间又有新事件，再推一次
      if (pushPending) {
        pushPending = false;
        pushContainerList();
      }
    }
  }, 300);
}

// ==================== WebSocket 心跳检测 ====================
// 每 30 秒 ping 所有客户端，60 秒无 pong 则断开
const WS_HEARTBEAT_INTERVAL = 30000;
const WS_HEARTBEAT_TIMEOUT = 60000;

setInterval(() => {
  const now = Date.now();
  for (const ws of liveClients) {
    if (!ws._lastPong) ws._lastPong = now;
    if (now - ws._lastPong > WS_HEARTBEAT_TIMEOUT) {
      console.log('[Live] 客户端心跳超时，断开');
      ws.terminate();
      liveClients.delete(ws);
    } else if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }
}, WS_HEARTBEAT_INTERVAL);

liveWss.on('connection', (ws, req) => {
  if (!verifyWsAuth(req)) {
    console.log('[Live] 认证失败，关闭连接');
    ws.close(4001, 'Unauthorized');
    return;
  }
  ws._lastPong = Date.now();
  ws.on('pong', () => { ws._lastPong = Date.now(); });
  liveClients.add(ws);
  pushContainerList();
  ws.on('close', () => liveClients.delete(ws));
});

// ==================== 统一处理 WebSocket upgrade ====================
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/ws/exec') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/live') {
    liveWss.handleUpgrade(req, socket, head, (ws) => {
      liveWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

startDockerEventStream();
console.log('WebSocket 实时推送就绪 → /ws/live');

