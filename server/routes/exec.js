// ==================== 命令执行路由 ====================
const express = require('express');
const { exec, spawn } = require('child_process');
const { PROJECTS_DIR, safePath } = require('../lib/utils');

const router = express.Router();

// 存储 WebSocket 关联的子进程
const activeProcesses = new WeakMap();

// 命令白名单（仅可执行二进制文件，不含 shell builtin）
const ALLOWED_COMMANDS = [
  'docker', 'docker-compose',
  // 文件/系统
  'ls', 'cat', 'pwd', 'echo',
  'ps', 'top', 'df', 'du', 'free', 'uptime',
  'whoami', 'id', 'env', 'uname',
  // shell（用于交互终端）
  'sh', 'bash', 'ash',
  // 文本处理
  'grep', 'awk', 'sed', 'head', 'tail', 'wc', 'sort', 'cut', 'find',
  // 网络/工具
  'which', 'ping', 'curl', 'wget', 'clear',
];

function isAllowedCommand(cmd) {
  const trimmed = cmd.trim();
  const parts = trimmed.split(/\s+/);
  const baseCmd = parts[0];
  // docker compose 是两个词的特殊处理
  if (parts.length >= 2 && parts[0] === 'docker' && parts[1] === 'compose') {
    return true;
  }
  return ALLOWED_COMMANDS.includes(baseCmd);
}

// POST /exec — 执行命令，返回完整输出
router.post('/', (req, res, next) => {
  try {
    const { command, cwd, timeout = 30000 } = req.body;

    if (!command) {
      return res.status(400).json({ error: '缺少 command 参数' });
    }

    if (!isAllowedCommand(command)) {
      return res.status(403).json({ error: '命令不在白名单中，仅允许 docker 相关命令' });
    }

    let workDir = PROJECTS_DIR;
    if (cwd) {
      try { workDir = safePath(cwd); } catch (_) {}
    }

    exec(command, {
      cwd: workDir,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env },
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          return res.status(408).json({ error: '命令执行超时', stdout, stderr });
        }
        return res.json({ success: false, code: err.code, stdout, stderr });
      }
      res.json({ success: true, code: 0, stdout, stderr });
    });
  } catch (e) {
    next(e);
  }
});

/**
 * WebSocket 流式执行命令
 * 由 server.js 中的 WS handler 调用
 */
function handleWsExec(ws, command, cwd) {
  if (!command) {
    ws.send(JSON.stringify({ type: 'error', data: '缺少命令' }));
    return;
  }

  if (!isAllowedCommand(command)) {
    ws.send(JSON.stringify({ type: 'error', data: '命令不在白名单中' }));
    return;
  }

  let workDir = PROJECTS_DIR;
  if (cwd) {
    try { workDir = safePath(cwd); } catch (_) {}
  }

  // 解析命令为程序名和参数
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const program = parts[0];
  const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));

  const proc = spawn(program, args, {
    cwd: workDir,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: false,
  });

  // 关联进程到 WebSocket
  activeProcesses.set(ws, proc);

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

  // 超时控制：持续流式命令（logs -f）不设超时，其他命令 30 秒
  const isStreaming = command.includes('docker logs -f') || command.includes('docker logs --tail');
  if (!isStreaming) {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 30000);
    proc.on('close', () => clearTimeout(timer));
  }

  proc.on('close', (code) => {
    if (!isStreaming) clearTimeout(timer);
    activeProcesses.delete(ws);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
  });

  proc.on('error', (err) => {
    if (!isStreaming) clearTimeout(timer);
    activeProcesses.delete(ws);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: err.message }));
    }
  });
}

module.exports = { router, handleWsExec, activeProcesses };
