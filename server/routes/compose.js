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
    let { name, content, start = false } = req.body;

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

    let startResult = null;
    if (start) {
      startResult = await runCompose(projectDir, ['up', '-d']);
    }

    const started = start && startResult?.code === 0;

    res.json({
      success: true,
      name,
      path: projectDir,
      started,
      startResult,
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

    const composePath = path.join(projectDir, 'docker-compose.yml');
    await writeFile(composePath, content);

    let deployResult = null;
    let actualRedeploy = false;
    let deployError = null;
    if (redeploy) {
      await runCompose(projectDir, ['down']);
      deployResult = await runCompose(projectDir, ['up', '-d']);
      actualRedeploy = deployResult?.code === 0;
      if (!actualRedeploy) {
        deployError = deployResult?.stderr || 'compose 重建失败';
      }
    }

    res.json({ success: true, redeployed: actualRedeploy, deployResult, deployError });
  } catch (e) {
    next(e);
  }
});

// DELETE /projects/:name — 删除项目（仅 down -v，不删文件）
router.delete('/:name', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    if (!await exists(projectDir)) {
      return res.status(404).json({ error: '项目不存在' });
    }

    // down -v 清理容器+网络+卷，保留 compose 文件
    const result = await runCompose(projectDir, ['down', '-v']);

    res.json({ success: result.code === 0, ...result });
  } catch (e) {
    next(e);
  }
});

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
        let hostPort = null, containerPort = null;
        if (typeof p === 'string') {
          // 短语法: "8005:80" 或 "8005:80/tcp"
          const parts = p.split(':');
          if (parts.length >= 2) {
            hostPort = parseInt(parts[0], 10);
            containerPort = parseInt(parts[parts.length - 1].split('/')[0], 10);
          }
        } else if (typeof p === 'object' && p != null) {
          // 长语法: { target: 80, published: 8005 }
          containerPort = p.target ? parseInt(p.target, 10) : null;
          hostPort = p.published ? parseInt(p.published, 10) : null;
        }
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

// 启动后验证：等待容器稳定后，检查是否真的在运行
async function verifyServicesRunning(projectDir) {
  console.log('[verify] 等待 2s 后检查容器状态...');
  await new Promise(r => setTimeout(r, 2000));

  // 解析 compose 文件中显式声明的端口映射
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

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
    const psResult = await runCompose(projectDir, ['ps', '-a', '--format', 'json']);
    console.log(`[verify] 第${attempt + 1}次 ps: code=${psResult.code}`, psResult.stdout.slice(0, 300));
    if (psResult.code !== 0) continue;
    try {
      const lines = psResult.stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;
      const containers = JSON.parse(`[${lines.join(',')}]`);

      // 检查容器状态
      const notRunning = containers
        .filter(c => c.State && c.State !== 'running')
        .map(c => c.Service || c.Name);
      if (notRunning.length > 0) {
        console.log(`[verify] ❌ 未运行: ${notRunning.join(', ')}`);
        return `以下服务未正常运行: ${notRunning.join(', ')}，请检查端口是否被占用`;
      }

      // 检查端口绑定：仅验证 compose 文件中显式声明的端口映射
      for (const c of containers) {
        console.log(`[verify] ${c.Service || c.Name}: State=${c.State} Ports="${c.Ports}" Publishers=${JSON.stringify(c.Publishers)}`);
      }
      const portFailed = containers
        .filter(c => c.State === 'running')
        .filter(c => {
          const svcName = c.Service || c.Name;
          const expected = portMappings.get(svcName);
          // 服务未在 compose 中声明端口映射 → 不必检查
          if (!expected || expected.length === 0) return false;
          // 检查 compose 声明的每个宿主机端口是否都在 Publishers 中绑定成功
          const unbound = expected.filter(({ hostPort }) =>
            !(c.Publishers || []).some(p => p.PublishedPort === hostPort)
          );
          if (unbound.length > 0) {
            console.log(`[verify] ${svcName}: 端口未绑定 ${unbound.map(p => `${p.hostPort}→${p.containerPort}`).join(', ')}`);
            return true;
          }
          return false;
        })
        .map(c => c.Service || c.Name);
      if (portFailed.length > 0) {
        console.log(`[verify] ❌ 端口未绑定: ${portFailed.join(', ')}`);
        return `以下服务端口未成功绑定: ${portFailed.join(', ')}，请检查端口是否被占用`;
      }

      console.log(`[verify] ✅ 全部 running 端口正常`);
      return null;
    } catch (e) { console.log(`[verify] 解析失败: ${e.message}`); }
  }
  return null;
}

// POST /projects/:name/up
router.post('/:name/up', async (req, res, next) => {
  try {
    const projectDir = safePath(req.params.name);
    const result = await runCompose(projectDir, ['up', '-d']);
    console.log(`[up] compose 返回: code=${result.code} stderr="${result.stderr?.slice(0, 100) || ''}"`);

    const needVerify = result.code === 0 && !result.stderr;
    console.log(`[up] 是否需要验证: ${needVerify ? '是' : '否'}`);
    const failedServices = needVerify ? await verifyServicesRunning(projectDir) : null;

    // 验证失败：自动 down 清理已启动但状态异常的容器
    if (failedServices) {
      console.log(`[up] 端口验证失败，清理容器: ${failedServices}`);
      await runCompose(projectDir, ['down']);
    }

    console.log(`[up] 最终: success=${result.code === 0 && !failedServices} stderr="${(failedServices || result.stderr)?.slice(0, 100) || ''}"`);
    res.json({
      ...result,
      success: result.code === 0 && !failedServices,
      stderr: failedServices || result.stderr,
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
    res.json({ success: result.code === 0, ...result });
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

    const needVerify = result.code === 0 && !result.stderr;
    console.log(`[restart] 是否需要验证: ${needVerify ? '是' : '否'}`);
    const failedServices = needVerify ? await verifyServicesRunning(projectDir) : null;

    // 验证失败：自动 down 清理已启动但状态异常的容器
    if (failedServices) {
      console.log(`[restart] 端口验证失败，清理容器: ${failedServices}`);
      await runCompose(projectDir, ['down']);
    }

    console.log(`[restart] 最终: success=${result.code === 0 && !failedServices} stderr="${(failedServices || result.stderr)?.slice(0, 100) || ''}"`);
    res.json({
      ...result,
      success: result.code === 0 && !failedServices,
      stderr: failedServices || result.stderr,
    });
  } catch (e) { next(e); }
});

module.exports = { router, handleWsCompose, composeProcesses };
