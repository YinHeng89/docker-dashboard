// ==================== Compose 项目管理路由 ====================
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const yaml = require('js-yaml');
const {
  PROJECTS_DIR, isSelfComposeProject, safePath, validateYaml, ensureDir, readFile, writeFile, exists, listDir, isRelativePathSupported, extractComposeError
} = require('../lib/utils');

const router = express.Router();

// 自我保护中间件：阻止对包含自身容器的 compose 项目执行危险操作
async function selfProtect(req, res, next) {
  try {
    const projectName = req.params.name;
    const dangerousOps = ['stop', 'restart', 'rebuild', 'delete', 'down'];
    const action = req.path.split('/').pop();
    if (dangerousOps.includes(action) && await isSelfComposeProject(projectName)) {
      console.warn(`[compose] 自我保护：拒绝操作 ${projectName} (action=${action})`);
      return res.status(403).json({ error: '不允许操作自身所在项目，这会中断 Dashboard 服务' });
    }
    next();
  } catch { next(); }
}

router.use('/:name', selfProtect);

// WebSocket 关联的 compose 子进程
const composeProcesses = new WeakMap();

/**
 * 查找项目目录下的 compose 配置文件
 */
const fs = require('fs');
function findComposeFile(projectDir) {
  const names = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const name of names) {
    if (fs.existsSync(path.join(projectDir, name))) return path.join(projectDir, name);
  }
  return null;
}

/**
 * 执行 docker compose 命令（流式输出）
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function runCompose(projectDir, args) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('[runCompose] projectDir:', projectDir);

      const composeFile = findComposeFile(projectDir);
      if (!composeFile) return reject(new Error('找不到 compose 配置文件'));

      const proc = spawn('docker', [
        'compose',
        '-f', composeFile,
        ...args
      ], {
        cwd: projectDir,
        env: { ...process.env, COMPOSE_PROJECT_NAME: path.basename(projectDir).toLowerCase() },
      });

      let stdout = '', stderrRaw = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderrRaw += d.toString());
      proc.on('close', code => {
        const stderr = extractComposeError(stderrRaw);
        resolve({ code, stdout, stderr });
      });
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); reject(new Error('命令执行超时')); }, 300000);
    } catch(e) {
      console.error('[runCompose] error:', e);
      reject(e);
    }
  });
}

/**
 * WebSocket 流式执行 docker compose 命令
 * 由 server.js 中的 WS handler 调用
 * @param {WebSocket} ws
 * @param {string} action - up/down/pull/restart
 * @param {string} projectName
 */
async function handleWsCompose(ws, action, projectName) {
  if (!projectName || !/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    ws.send(JSON.stringify({ type: 'error', data: '无效的项目名称' }));
    return;
  }

  const allowedActions = ['up', 'down', 'pull', 'restart', 'stop', 'logs'];
  if (!allowedActions.includes(action)) {
    ws.send(JSON.stringify({ type: 'error', data: `不允许的 compose 操作: ${action}` }));
    return;
  }

  try {
    const projectDir = safePath(projectName);
    if (!await exists(projectDir)) {
      ws.send(JSON.stringify({ type: 'error', data: `项目 ${projectName} 不存在` }));
      return;
    }

    const composeFile = findComposeFile(projectDir);
    if (!composeFile) {
      ws.send(JSON.stringify({ type: 'error', data: '找不到 compose 配置文件' }));
      return;
    }

    console.log(`[WS compose] ${action} ${projectName}`);
    ws.send(JSON.stringify({ type: 'stdout', data: `$ docker compose ${action}\n` }));

    const args = action === 'up' ? ['up', '-d', '--remove-orphans'] : [action];
    const proc = spawn('docker', [
      'compose',
      '-f', composeFile,
      ...args
    ], {
      cwd: projectDir,
      env: { ...process.env, COMPOSE_PROJECT_NAME: path.basename(projectDir).toLowerCase() },
    });

    composeProcesses.set(ws, proc);

    proc.stdout.on('data', (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stdout', data: data.toString() }));
      }
    });

    proc.stderr.on('data', (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stderr', data: data.toString() }));
      }
    });

    proc.on('close', (code) => {
      composeProcesses.delete(ws);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code }));
      }
    });

    proc.on('error', (err) => {
      composeProcesses.delete(ws);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', data: err.message }));
      }
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', data: e.message }));
  }
}

// GET /projects — 列出所有 compose 项目
router.get('/', async (req, res, next) => {
  try {
    const entries = await listDir(PROJECTS_DIR);
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDir) continue;
      const dirPath = path.join(PROJECTS_DIR, entry.name);
      // 查找 compose 文件
      const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
        .map(f => ({ name: f, path: path.join(dirPath, f) }));

      let composeContent = null;
      let composeFileName = null;
      for (const f of composeFile) {
        if (await exists(f.path)) {
          composeContent = await readFile(f.path);
          composeFileName = f.name;
          break;
        }
      }

      const files = await listDir(dirPath);
      projects.push({
        name: entry.name,
        hasCompose: !!composeContent,
        composeFile: composeFileName,
        composeContent,
        files: files.map(f => f.name),
      });
    }

    res.json(projects);
  } catch (e) {
    next(e);
  }
});

// POST /projects — 新建项目
router.post('/', async (req, res, next) => {
  try {
    let { name, content, start = false, envContent } = req.body;

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: '项目名称只能包含字母、数字、下划线和短横线' });
    }
    // Docker Compose 要求项目名纯小写
    name = name.toLowerCase();

    const projectDir = safePath(name);
    if (await exists(projectDir)) {
      return res.status(409).json({ error: `项目 ${name} 已存在` });
    }

    // 校验 YAML
    const { warnings } = validateYaml(content);

    // 相对路径检测：不支持时直接拒绝，不创建项目
    if (warnings.length > 0 && !isRelativePathSupported()) {
      return res.status(400).json({
        error: `检测到相对路径卷挂载，当前部署不支持。请改用绝对路径或配置同路径挂载。`,
        warnings,
      });
    }

    // 创建目录并写入 compose 文件
    await ensureDir(projectDir);
    await writeFile(path.join(projectDir, 'docker-compose.yml'), content);

    // 写入 .env 文件（如果提供）
    if (envContent && envContent.trim()) {
      await writeFile(path.join(projectDir, '.env'), envContent.trim());
    }

    let startResult = null;
    let verifyWarning = null;
    if (start) {
      startResult = await runCompose(projectDir, ['up', '-d']);
      if (startResult.code === 0 && !startResult.stderr) {
        const failed = await verifyServicesRunning(projectDir);
        if (failed) {
          if (failed.hard) {
            const logs = await runCompose(projectDir, ['logs', '--tail', '100']).catch(() => null);
            await runCompose(projectDir, ['down']).catch(() => {});
            startResult.stderr = `${failed.message}${logs?.stdout ? `\n--- 最近日志 ---\n${logs.stdout.slice(-2000)}` : ''}`;
          } else {
            // 软失败：容器仍在运行，不销毁，只是提示
            verifyWarning = failed.message;
          }
        }
      }
    }

    const started = start && startResult?.code === 0 && !startResult?.stderr;

    res.json({
      success: true,
      name,
      path: projectDir,
      started,
      startResult,
      verifyWarning,
      composeError: start && !started ? (startResult?.stderr || 'compose 启动失败') : undefined,
    });
  } catch (e) {
    next(e);
  }
});

// GET /projects/:name — 获取项目 compose 文件
router.get('/:name', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    if (!await exists(projectDir)) {
      return res.status(404).json({ error: '项目不存在' });
    }

    // 查找 compose 文件
    const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    let content = null, fileName = null;
    for (const f of candidates) {
      const fp = path.join(projectDir, f);
      if (await exists(fp)) {
        content = await readFile(fp);
        fileName = f;
        break;
      }
    }

    if (!content) {
      return res.status(404).json({ error: '未找到 compose 文件' });
    }

    const files = await listDir(projectDir);
    res.json({ name: req.params.name, composeFile: fileName, content, files });
  } catch (e) {
    next(e);
  }
});

// PUT /projects/:name — 更新 compose 文件
router.put('/:name', async (req, res, next) => {
  try {
    const { content, redeploy = false } = req.body;
    const projectDir = safePath(req.params.name);

    if (!await exists(projectDir)) {
      return res.status(404).json({ error: '项目不存在' });
    }

    // 校验 YAML
    const { warnings } = validateYaml(content);

    // 相对路径检测：不支持时直接拒绝，不保存
    if (warnings.length > 0 && !isRelativePathSupported()) {
      return res.status(400).json({
        error: `检测到相对路径卷挂载，当前部署不支持。请改用绝对路径或配置同路径挂载。`,
        warnings,
      });
    }

    // 保存旧内容，若新配置启动失败可回滚
    const composePath = path.join(projectDir, 'docker-compose.yml');
    const previousContent = await exists(composePath) ? await readFile(composePath) : null;
    await writeFile(composePath, content);

    let deployResult = null;
    let actualRedeploy = false;
    let deployError = null;
    let verifyWarning = null;
    if (redeploy) {
      await runCompose(projectDir, ['down']);
      deployResult = await runCompose(projectDir, ['up', '-d']);

      if (deployResult.code === 0 && !deployResult.stderr) {
        const failed = await verifyServicesRunning(projectDir);
        if (failed) {
          if (failed.hard) {
            const logs = await runCompose(projectDir, ['logs', '--tail', '100']).catch(() => null);
            await runCompose(projectDir, ['down']).catch(() => {});
            deployError = `${failed.message}${logs?.stdout ? `\n--- 最近日志 ---\n${logs.stdout.slice(-2000)}` : ''}`;
            // 新配置启动失败，回滚到旧配置文件（不自动重新拉起，避免叠加副作用）
            if (previousContent !== null) {
              await writeFile(composePath, previousContent);
              deployError += '\n（新配置未能成功启动，已回滚 compose 文件，旧服务未自动恢复，请手动 up）';
            }
          } else {
            verifyWarning = failed.message;
          }
        }
      } else {
        deployError = deployResult?.stderr || 'compose 重建失败';
      }
      actualRedeploy = deployResult?.code === 0 && !deployError;
    }

    res.json({ success: true, redeployed: actualRedeploy, deployResult, deployError, verifyWarning });
  } catch (e) {
    next(e);
  }
});

// DELETE /projects/:name — 删除项目
// 查询参数: ?removeFiles=true 同时删除项目文件
router.delete('/:name', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    if (!await exists(projectDir)) {
      return res.status(404).json({ error: '项目不存在' });
    }

    // down -v 清理容器+网络+卷
    const result = await runCompose(projectDir, ['down', '-v']);

    // 可选：删除项目文件
    if (req.query.removeFiles === 'true') {
      await require('fs').promises.rm(projectDir, { recursive: true, force: true });
    }

    res.json({ success: result.code === 0, ...result });
  } catch (e) {
    next(e);
  }
});

// POST /projects/:name/rename — 重命名项目
// body: { newName: string }
router.post('/:name/rename', async (req, res, next) => {
  try {
    const { newName } = req.body;
    if (!newName || !/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return res.status(400).json({ error: '新名称只能包含字母、数字、下划线和短横线' });
    }

    const lowerName = newName.toLowerCase();
    const oldDir = safePath(req.params.name);
    const newDir = safePath(lowerName);

    if (!await exists(oldDir)) {
      return res.status(404).json({ error: '项目不存在' });
    }
    if (await exists(newDir)) {
      return res.status(409).json({ error: '目标项目名已存在' });
    }

    // 先停掉原项目
    await runCompose(oldDir, ['down']);
    // 重命名目录
    await require('fs').promises.rename(oldDir, newDir);

    res.json({ success: true, oldName: req.params.name, newName: lowerName });
  } catch (e) {
    next(e);
  }
});

// POST /projects/:name/clone — 克隆项目
// body: { newName: string }
router.post('/:name/clone', async (req, res, next) => {
  try {
    const { newName } = req.body;
    if (!newName || !/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return res.status(400).json({ error: '新名称只能包含字母、数字、下划线和短横线' });
    }

    const lowerName = newName.toLowerCase();
    const srcDir = safePath(req.params.name);
    const destDir = safePath(lowerName);

    if (!await exists(srcDir)) {
      return res.status(404).json({ error: '源项目不存在' });
    }
    if (await exists(destDir)) {
      return res.status(409).json({ error: '目标项目名已存在' });
    }

    await require('fs').promises.cp(srcDir, destDir, { recursive: true });
    res.json({ success: true, name: lowerName, source: req.params.name });
  } catch (e) {
    next(e);
  }
});

/**
 * 解析单条 compose ports 条目，返回 {hostPort, containerPort}
 * 兼容短语法 "80" / "8005:80" / "127.0.0.1:8005:80" / "[::1]:8005:80" / 带 /tcp 后缀，
 * 以及长语法 { target, published }。
 * 关键修复：短语法下宿主机端口和容器端口永远取“最后两个冒号分隔段”，
 * 而不是简单取第一段——否则带 host IP 前缀（如 127.0.0.1:8005:80）时，
 * parseInt("127.0.0.1") 会被错误解析成端口 127。
 */
function parsePortEntry(p) {
  let hostPort = null, containerPort = null;
  if (typeof p === 'string') {
    const portsPart = p.split('/')[0]; // 去掉 /tcp /udp 协议后缀
    const parts = portsPart.split(':');
    if (parts.length >= 2) {
      containerPort = parseInt(parts[parts.length - 1], 10);
      hostPort = parseInt(parts[parts.length - 2], 10);
    }
  } else if (typeof p === 'object' && p != null) {
    containerPort = p.target ? parseInt(p.target, 10) : null;
    hostPort = p.published ? parseInt(p.published, 10) : null;
  }
  return { hostPort, containerPort };
}

/**
 * 从 compose 文件中提取各 service 显式声明的端口映射（hostPort → containerPort）
 * 仅提取 compose ports 中明确指定了宿主机端口的映射，忽略 EXPOSE-only 端口
 * @param {string} composeContent - compose YAML 文本
 * @returns {Map<string, Array<{hostPort: number, containerPort: number}>>}
 */
function extractPortMappings(composeContent) {
  const mappings = new Map();
  try {
    const parsed = yaml.load(composeContent);
    if (!parsed?.services) return mappings;

    for (const [svcName, svc] of Object.entries(parsed.services)) {
      const ports = svc.ports;
      if (!Array.isArray(ports)) continue;
      const svcMappings = [];
      for (const p of ports) {
        const { hostPort, containerPort } = parsePortEntry(p);
        if (hostPort && !isNaN(hostPort) && containerPort && !isNaN(containerPort)) {
          svcMappings.push({ hostPort, containerPort });
        }
      }
      if (svcMappings.length > 0) {
        mappings.set(svcName, svcMappings);
      }
    }
  } catch (e) {
    console.log(`[verify] 解析 compose ports 失败: ${e.message}`);
  }
  return mappings;
}

/**
 * 判断某个 hostPort 是否已在容器上成功绑定。
 * 优先使用结构化的 Publishers 字段（较新 docker compose 版本才有）；
 * 如果该字段不存在（老版本/精简版 docker compose 的 `ps --format json` 不包含它），
 * 回退到解析字符串形式的 Ports 字段（如 "0.0.0.0:8080->80/tcp, :::8080->80/tcp"）。
 * 修复点：原实现只信任 Publishers，字段缺失时恒判定为“未绑定”，
 * 导致所有声明了端口的服务在该 docker compose 版本下必然被误报失败。
 */
function isHostPortBound(container, hostPort) {
  if (Array.isArray(container.Publishers) && container.Publishers.length > 0) {
    return container.Publishers.some(p => p.PublishedPort === hostPort);
  }
  const portsStr = container.Ports || '';
  return new RegExp(`[:.]${hostPort}->`).test(portsStr);
}

/**
 * 启动后验证：等待容器稳定后，检查是否真的在运行。
 *
 * 返回值:
 *   null                          — 验证通过
 *   { hard: true,  message }      — 硬失败：容器确实退出/崩溃，调用方应当清理
 *   { hard: false, message }      — 软失败：容器仍在运行，只是端口验证超时/不确定，
 *                                    调用方不应该销毁容器，只需要提示用户
 *
 * 修复点：
 * 1. 原来固定等待 2s + 最多重试 1 次（约 3s 总时长），
 *    对启动较慢的镜像（Postgres/MySQL/ES 等）根本不够，会把“还没起来”误判成“失败”。
 *    这里拉长到 6 次 × 2.5s（约 15s），且只要有进展就不提前判失败。
 * 2. 原来不区分“容器已退出”和“容器在跑但端口一时验证不到”，
 *    一律走同一个失败分支后被上层 down 掉。这里拆成 hard/soft 两种，
 *    只有 hard 失败（容器真的退出/持续重启）才建议销毁。
 */
async function verifyServicesRunning(projectDir) {
  const composeFile = findComposeFile(projectDir);
  let portMappings = new Map();
  if (composeFile) {
    try {
      const content = await readFile(composeFile);
      portMappings = extractPortMappings(content);
      console.log(`[verify] compose 端口映射: ${[...portMappings.entries()].map(([svc, m]) => `${svc}=${m.map(p => `${p.hostPort}→${p.containerPort}`).join(',')}`).join('; ') || '无'}`);
    } catch (e) {
      console.log(`[verify] 读取 compose 文件失败: ${e.message}`);
    }
  }

  const maxAttempts = 6;
  const intervalMs = 2500;
  const initialDelayMs = 1500;

  await new Promise(r => setTimeout(r, initialDelayMs));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, intervalMs));

    const psResult = await runCompose(projectDir, ['ps', '-a', '--format', 'json']);
    console.log(`[verify] 第${attempt + 1}次 ps: code=${psResult.code}`, psResult.stdout.slice(0, 300));
    if (psResult.code !== 0) continue;

    let containers;
    try {
      const lines = psResult.stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;
      containers = JSON.parse(`[${lines.join(',')}]`);
    } catch (e) {
      console.log(`[verify] 解析失败: ${e.message}`);
      continue;
    }

    // 硬失败：容器已退出/崩溃。重启循环给 2 次容忍（可能是慢启动导致的健康检查重启）
    const hardFailed = containers.filter(c => {
      const state = (c.State || '').toLowerCase();
      if (['exited', 'dead'].includes(state)) return true;
      if (state === 'restarting' && attempt >= 2) return true;
      return false;
    });
    if (hardFailed.length > 0) {
      const names = hardFailed.map(c => c.Service || c.Name);
      console.log(`[verify] ❌ 硬失败: ${names.join(', ')}`);
      return { hard: true, message: `以下服务未正常运行: ${names.join(', ')}，请检查端口是否被占用或查看日志` };
    }

    const allRunning = containers.every(c => (c.State || '').toLowerCase() === 'running');

    for (const c of containers) {
      console.log(`[verify] ${c.Service || c.Name}: State=${c.State} Ports="${c.Ports}" Publishers=${JSON.stringify(c.Publishers)}`);
    }

    const portFailed = containers
      .filter(c => (c.State || '').toLowerCase() === 'running')
      .filter(c => {
        const svcName = c.Service || c.Name;
        const expected = portMappings.get(svcName);
        if (!expected || expected.length === 0) return false; // 未声明端口映射，不检查
        const unbound = expected.filter(({ hostPort }) => !isHostPortBound(c, hostPort));
        if (unbound.length > 0) {
          console.log(`[verify] ${svcName}: 端口未绑定 ${unbound.map(p => `${p.hostPort}→${p.containerPort}`).join(', ')}`);
          return true;
        }
        return false;
      })
      .map(c => c.Service || c.Name);

    if (allRunning && portFailed.length === 0) {
      console.log(`[verify] ✅ 全部 running 端口正常`);
      return null;
    }

    // 还没到最后一次尝试，继续等待，不提前判失败
    if (attempt < maxAttempts - 1) continue;

    // 达到最大等待时间仍未就绪：软失败，交给调用方决定（不建议销毁）
    console.log(`[verify] ⚠️ 超时未确认就绪，判定为软失败: portFailed=${portFailed.join(',')}`);
    return {
      hard: false,
      message: portFailed.length > 0
        ? `以下服务端口在 ${(maxAttempts * intervalMs + initialDelayMs) / 1000}s 内未确认绑定: ${portFailed.join(', ')}，容器仍在运行，请手动确认`
        : '部分服务未能在超时时间内确认进入 running 状态，容器仍在运行，请手动检查',
    };
  }
  return null;
}

/**
 * 根据 verifyServicesRunning 的结果，决定是否清理容器，并生成给前端的错误/警告信息。
 * 只有 hard 失败才会自动 down；soft 失败保留容器，仅返回警告文案。
 * 销毁前会先抓取最近日志，避免容器删除后无法排查原因。
 */
async function resolveVerifyResult(projectDir, failed) {
  if (!failed) return { success: true, warning: null, stderr: null };

  if (failed.hard) {
    const logs = await runCompose(projectDir, ['logs', '--tail', '100']).catch(() => null);
    const cleanup = await runCompose(projectDir, ['down']).catch((e) => ({ code: -1, stderr: e.message }));
    if (cleanup.code !== 0 && cleanup.stderr) {
      console.log(`[verify] 清理容器失败: ${cleanup.stderr}`);
    }
    const stderr = `${failed.message}${logs?.stdout ? `\n--- 最近日志 ---\n${logs.stdout.slice(-2000)}` : ''}`;
    return { success: false, warning: null, stderr };
  }

  // 软失败：不销毁，容器继续运行，只提示
  return { success: true, warning: failed.message, stderr: null };
}

/**
 * 巡检当前项目容器状态，返回运行中/硬失败的 service 列表。
 * 与 verifyServicesRunning 共用同一套"硬失败"判定标准（exited/dead），
 * 但这里不做端口校验、不重试——只用于 docker compose 命令本身报错后的一次性诊断。
 */
async function inspectContainerStates(projectDir) {
  const psResult = await runCompose(projectDir, ['ps', '-a', '--format', 'json']).catch(() => null);
  if (!psResult || psResult.code !== 0) return { containers: [], hardFailed: [], running: [], parsed: false };

  try {
    const lines = psResult.stdout.trim().split('\n').filter(Boolean);
    const containers = lines.length ? JSON.parse(`[${lines.join(',')}]`) : [];
    const hardFailed = containers
      .filter(c => ['exited', 'dead'].includes((c.State || '').toLowerCase()))
      .map(c => c.Service || c.Name);
    const running = containers
      .filter(c => (c.State || '').toLowerCase() === 'running')
      .map(c => c.Service || c.Name);
    return { containers, hardFailed, running, parsed: true };
  } catch (e) {
    console.log(`[inspect] 解析失败: ${e.message}`);
    return { containers: [], hardFailed: [], running: [], parsed: false };
  }
}

/**
 * docker compose 命令本身非零退出（up/restart/rebuild 进程失败，而非 verify 阶段失败）后的兜底处理。
 *
 * 修复点：原来这条路径完全不触碰容器——REST 接口只是把原始 stderr 透传给用户，
 * handleActionStream 的 catch 更是直接 all-error 完事，既没有诊断也没有清理，
 * 项目可能停留在"部分 service 起来了、部分死了"的半成品状态，且失败日志随时间被覆盖。
 *
 * 处理原则：只清理确实 exited/dead 的 service，不碰仍在 running 的——
 * 避免重犯"一刀切 down 整个项目"的错误（多 service 项目里其他服务可能是好的）。
 */
async function handleCommandFailure(projectDir, rawErrorMessage) {
  const state = await inspectContainerStates(projectDir);

  if (!state.parsed || state.hardFailed.length === 0) {
    // 巡检不到明确死亡的 service（例如 up 还没来得及创建任何容器就失败），
    // 不做任何容器操作，原样返回命令报错
    return { message: rawErrorMessage, cleaned: [] };
  }

  const logs = await runCompose(projectDir, ['logs', '--tail', '100', ...state.hardFailed]).catch(() => null);
  // 只清理死掉的 service，保留仍在跑的
  const cleanup = await runCompose(projectDir, ['rm', '-f', '-s', ...state.hardFailed]).catch((e) => ({ code: -1, stderr: e.message }));
  if (cleanup?.code !== 0 && cleanup?.stderr) {
    console.log(`[handleCommandFailure] 清理失败 service 出错: ${cleanup.stderr}`);
  }

  const runningNote = state.running?.length ? `（${state.running.join(', ')} 仍在正常运行，未受影响）` : '';
  return {
    message: `${rawErrorMessage}\n以下 service 启动失败已清理: ${state.hardFailed.join(', ')}${runningNote}${logs?.stdout ? `\n--- 失败服务日志 ---\n${logs.stdout.slice(-2000)}` : ''}`,
    cleaned: state.hardFailed,
  };
}

// POST /projects/:name/up
router.post('/:name/up', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['up', '-d']);
    console.log(`[up] compose 返回: code=${result.code} stderr="${result.stderr?.slice(0, 100) || ''}"`);

    // 命令本身失败（非零 code 或有 stderr）：巡检容器状态，只清理真正死掉的 service
    if (result.code !== 0 || result.stderr) {
      const { message } = await handleCommandFailure(projectDir, result.stderr || `compose 退出码 ${result.code}`);
      return res.json({ ...result, success: false, stderr: message });
    }

    const failed = await verifyServicesRunning(projectDir);
    const { success: verifySuccess, warning, stderr: hardStderr } = await resolveVerifyResult(projectDir, failed);

    console.log(`[up] 最终: success=${verifySuccess} stderr="${(hardStderr || result.stderr)?.slice(0, 100) || ''}"`);
    res.json({
      ...result,
      success: verifySuccess,
      stderr: hardStderr || result.stderr,
      warning,
    });
  } catch (e) { next(e); }
});

// POST /projects/:name/rebuild
router.post('/:name/rebuild', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    // 先停止再重建（--force-recreate 确保容器一定会被重建）
    await runCompose(projectDir, ['down']);
    const result = await runCompose(projectDir, ['up', '-d', '--build', '--force-recreate', '--remove-orphans']);

    if (result.code !== 0 || result.stderr) {
      const { message } = await handleCommandFailure(projectDir, result.stderr || `compose 退出码 ${result.code}`);
      return res.json({ ...result, success: false, stderr: message });
    }

    const failed = await verifyServicesRunning(projectDir);
    const { success: verifySuccess, warning, stderr: hardStderr } = await resolveVerifyResult(projectDir, failed);

    res.json({
      ...result,
      success: verifySuccess,
      stderr: hardStderr || result.stderr,
      warning,
    });
  } catch (e) { next(e); }
});

// POST /projects/:name/stop
router.post('/:name/stop', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['stop']);
    res.json({ success: result.code === 0, ...result });
  } catch (e) { next(e); }
});

// POST /projects/:name/down
router.post('/:name/down', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['down']);
    res.json({ success: result.code === 0, ...result });
  } catch (e) { next(e); }
});

// POST /projects/:name/pull
router.post('/:name/pull', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['pull']);
    res.json({ success: result.code === 0, ...result });
  } catch (e) { next(e); }
});

// POST /projects/:name/restart
router.post('/:name/restart', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['restart']);
    console.log(`[restart] compose 返回: code=${result.code} stderr="${result.stderr?.slice(0, 100) || ''}"`);

    if (result.code !== 0 || result.stderr) {
      const { message } = await handleCommandFailure(projectDir, result.stderr || `compose 退出码 ${result.code}`);
      return res.json({ ...result, success: false, stderr: message });
    }

    const failed = await verifyServicesRunning(projectDir);
    const { success: verifySuccess, warning, stderr: hardStderr } = await resolveVerifyResult(projectDir, failed);

    console.log(`[restart] 最终: success=${verifySuccess} stderr="${(hardStderr || result.stderr)?.slice(0, 100) || ''}"`);
    res.json({
      ...result,
      success: verifySuccess,
      stderr: hardStderr || result.stderr,
      warning,
    });
  } catch (e) { next(e); }
});

/**
 * POST /projects/create-stream — 流式创建项目 + 启动
 * NDJSON 响应，每次写入一行 JSON
 */
async function handleCreateStream(req, res) {
  // 校验输入
  let { name, content, envContent } = req.body;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: '项目名称只能包含字母、数字、下划线和短横线' });
  }
  name = name.toLowerCase();

  const projectDir = safePath(name);
  if (await exists(projectDir)) {
    return res.status(409).json({ error: `项目 ${name} 已存在` });
  }

  // 校验 YAML
  const { warnings } = validateYaml(content);
  if (warnings.length > 0 && !isRelativePathSupported()) {
    return res.status(400).json({
      error: `检测到相对路径卷挂载，当前部署不支持。`,
      warnings,
    });
  }

  // NDJSON 响应头
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const send = (data) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(data) + '\n');
  };

  try {
    // Step 1: 创建目录和文件
    send({ type: 'progress', percent: 20, message: '正在创建项目文件...' });
    await ensureDir(projectDir);
    await writeFile(path.join(projectDir, 'docker-compose.yml'), content);

    // 写入 .env 文件（如果提供）
    if (envContent && envContent.trim()) {
      await writeFile(path.join(projectDir, '.env'), envContent.trim());
    }

    send({ type: 'progress', percent: 40, message: '项目文件已创建' });

    // Step 2: docker compose up -d
    send({ type: 'progress', percent: 50, message: '正在启动服务...' });

    const composeFile = path.join(projectDir, 'docker-compose.yml');
    const proc = spawn('docker', [
      'compose', '-f', composeFile, 'up', '-d', '--remove-orphans',
    ], {
      cwd: projectDir,
      env: { ...process.env, COMPOSE_PROJECT_NAME: name },
    });

    let stdout = '', stderrRaw = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      text.trim().split('\n').filter(Boolean).forEach(line => {
        send({ type: 'log', stream: 'stdout', message: line });
      });
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrRaw += text;
      text.trim().split('\n').filter(Boolean).forEach(line => {
        send({ type: 'log', stream: 'stderr', message: line });
      });
    });

    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) {
          send({ type: 'progress', percent: 80, message: '容器已启动，正在验证...' });
          resolve();
        } else {
          const stderr = extractComposeError(stderrRaw);
          send({ type: 'log', stream: 'stderr', message: stderr || `compose 退出码 ${code}` });
          reject(new Error(stderr || `compose 启动失败 (code ${code})`));
        }
      });
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); reject(new Error('命令执行超时')); }, 300000);
    });

    // Step 3: 验证服务（区分硬失败/软失败，软失败不销毁容器）
    const failed = await verifyServicesRunning(projectDir);
    if (failed?.hard) {
      // 验证硬失败：复用 handleCommandFailure，只清理真正死掉的 service，不碰仍在运行的
      const { message } = await handleCommandFailure(projectDir, failed.message);
      send({ type: 'log', stream: 'stderr', message: `⚠️ ${message}` });
      send({ type: 'all-error', message });
    } else if (failed && !failed.hard) {
      // 软失败：容器仍在运行，仅提示，不销毁，不清理项目文件
      send({ type: 'warning', message: failed.message });
      send({ type: 'progress', percent: 100, message: '启动完成（端口验证未完全确认）' });
      send({ type: 'all-done', name });
    } else {
      send({ type: 'progress', percent: 100, message: '启动完成' });
      send({ type: 'all-done', name });
    }
  } catch (e) {
    send({ type: 'all-error', message: e.message });
    // 清理失败的项目文件，避免留下僵尸项目（仅在 compose 命令本身失败时才清理目录，
    // 软失败分支不会走到这里，因为上面已经 return 了）
    try {
      if (await exists(projectDir)) {
        await require('fs').promises.rm(projectDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error(`[create-stream] 清理项目目录失败: ${cleanupErr.message}`);
    }
  }

  res.end();
}

/**
 * POST /projects/:name/action-stream — 流式执行 compose 操作（up/pull/restart/rebuild）
 */
async function handleActionStream(req, res) {
  const projectName = req.params.name;
  const { action } = req.body;
  const streamActions = ['up', 'pull', 'restart', 'rebuild'];
  if (!streamActions.includes(action)) {
    return res.status(400).json({ error: `不支持的操作: ${action}` });
  }

  // 自我保护
  const dangerousOps = ['restart', 'rebuild'];
  if (dangerousOps.includes(action) && await isSelfComposeProject(projectName)) {
    return res.status(403).json({ error: '不允许操作自身所在项目' });
  }

  const projectDir = safePath(projectName);
  if (!await exists(projectDir)) {
    return res.status(404).json({ error: '项目不存在' });
  }

  const composeFile = findComposeFile(projectDir);
  if (!composeFile) {
    return res.status(404).json({ error: '找不到 compose 文件' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const send = (data) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(data) + '\n');
  };

  try {
    let args;
    if (action === 'up') {
      args = ['up', '-d', '--remove-orphans'];
    } else if (action === 'pull') {
      args = ['pull'];
    } else if (action === 'restart') {
      args = ['restart'];
    } else if (action === 'rebuild') {
      send({ type: 'progress', percent: 10, message: '正在停止服务...' });
      const downResult = await runCompose(projectDir, ['down']);
      if (downResult.code !== 0 && downResult.stderr) {
        send({ type: 'log', stream: 'stderr', message: `⚠️ 停止警告: ${downResult.stderr.slice(0, 200)}` });
      }
      send({ type: 'progress', percent: 30, message: '正在重建...' });
      args = ['up', '-d', '--build', '--force-recreate', '--remove-orphans'];
    }

    send({ type: 'progress', percent: action === 'rebuild' ? 30 : 10, message: `正在执行: docker compose ${args.join(' ')}` });

    const proc = spawn('docker', [
      'compose', '-f', composeFile, ...args,
    ], {
      cwd: projectDir,
      env: { ...process.env, COMPOSE_PROJECT_NAME: projectName.toLowerCase() },
    });

    let stderrRaw = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      text.trim().split('\n').filter(Boolean).forEach(line => {
        send({ type: 'log', stream: 'stdout', message: line });
      });
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrRaw += text;
      text.trim().split('\n').filter(Boolean).forEach(line => {
        send({ type: 'log', stream: 'stderr', message: line });
      });
    });

    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else {
          const stderr = extractComposeError(stderrRaw);
          reject(new Error(stderr || `compose 退出码 ${code}`));
        }
      });
      proc.on('error', reject);
      setTimeout(() => { proc.kill(); reject(new Error('命令执行超时')); }, 300000);
    });

    // 验证（仅 up/restart/rebuild 需要），区分硬失败/软失败
    if (['up', 'restart', 'rebuild'].includes(action)) {
      send({ type: 'progress', percent: 80, message: '正在验证服务...' });
      const failed = await verifyServicesRunning(projectDir);
      if (failed?.hard) {
        // 验证硬失败：复用 handleCommandFailure，只清理真正死掉的 service，不碰仍在运行的
        const { message } = await handleCommandFailure(projectDir, failed.message);
        send({ type: 'log', stream: 'stderr', message: `⚠️ ${message}` });
        send({ type: 'all-error', message });
      } else if (failed && !failed.hard) {
        send({ type: 'warning', message: failed.message });
        send({ type: 'progress', percent: 100, message: '操作完成（端口验证未完全确认）' });
        send({ type: 'all-done', action });
      } else {
        send({ type: 'progress', percent: 100, message: '操作完成' });
        send({ type: 'all-done', action });
      }
    } else {
      send({ type: 'progress', percent: 100, message: '拉取完成' });
      send({ type: 'all-done', action });
    }
  } catch (e) {
    // 命令本身失败：巡检容器状态，只清理真正死掉的 service（不碰仍在跑的），带日志诊断
    const { message } = await handleCommandFailure(projectDir, e.message);
    send({ type: 'all-error', message });
  }

  res.end();
}

module.exports = { router, handleWsCompose, composeProcesses, handleCreateStream, handleActionStream };