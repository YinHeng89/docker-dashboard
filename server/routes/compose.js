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

/**
 * POST /projects/create-stream — 流式创建项目 + 启动
 * NDJSON 响应，每次写入一行 JSON
 */
async function handleCreateStream(req, res) {
  // 校验输入
  let { name, content } = req.body;
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

    // Step 3: 验证服务
    const failed = await verifyServicesRunning(projectDir);
    if (failed) {
      send({ type: 'log', stream: 'stderr', message: `⚠️ ${failed}` });
      await runCompose(projectDir, ['down']);
      send({ type: 'all-error', message: failed });
    } else {
      send({ type: 'progress', percent: 100, message: '启动完成' });
      send({ type: 'all-done', name });
    }
  } catch (e) {
    send({ type: 'all-error', message: e.message });
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

    // 验证（仅 up/restart/rebuild 需要）
    if (['up', 'restart', 'rebuild'].includes(action)) {
      send({ type: 'progress', percent: 80, message: '正在验证服务...' });
      const failed = await verifyServicesRunning(projectDir);
      if (failed) {
        send({ type: 'log', stream: 'stderr', message: `⚠️ ${failed}` });
        await runCompose(projectDir, ['down']);
        send({ type: 'all-error', message: failed });
      } else {
        send({ type: 'progress', percent: 100, message: '操作完成' });
        send({ type: 'all-done', action });
      }
    } else {
      send({ type: 'progress', percent: 100, message: '拉取完成' });
      send({ type: 'all-done', action });
    }
  } catch (e) {
    send({ type: 'all-error', message: e.message });
  }

  res.end();
}

module.exports = { router, handleWsCompose, composeProcesses, handleCreateStream, handleActionStream };
