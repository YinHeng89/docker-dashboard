// ==================== 命令执行路由 ====================
// 安全边界说明：本项目把宿主机 docker.sock 以读写方式挂载给容器，
// 因此「已认证用户」本身就等同于宿主机 Docker 管理员（可创建特权容器挂载 /）。
// 下面的命令白名单只用于防止误操作和明显的外带，并非安全隔离边界，
// 且明确允许 sh/bash 供交互式终端使用。不要把它当作多用户权限隔离机制。
const express = require('express');
const { spawn } = require('child_process');
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

// 将命令行解析为 argv（支持单/双引号与反斜杠转义），供参数化 spawn 使用。
// 不使用 shell，避免 `ls; rm -rf /` 这类元字符注入。
function parseCommand(command) {
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const ch of command.trim()) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { parts.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

// POST /exec — 执行命令，返回完整输出（参数化 spawn，不经过 shell）
router.post('/', (req, res, next) => {
  try {
    const { command, cwd, timeout = 30000 } = req.body;

    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: '缺少 command 参数' });
    }

    if (!isAllowedCommand(command)) {
      return res.status(403).json({ error: '命令不在白名单中' });
    }

    const parts = parseCommand(command);
    if (!parts.length) {
      return res.status(400).json({ error: '无法解析命令' });
    }

    let workDir = PROJECTS_DIR;
    if (cwd) {
      try { workDir = safePath(cwd); } catch (_) {}
    }

    const proc = spawn(parts[0], parts.slice(1), {
      cwd: workDir,
      env: { ...process.env },
    });

    const MAX_OUTPUT = 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeout);

    proc.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(0, MAX_OUTPUT);
    });
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(0, MAX_OUTPUT);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      res.json({ success: false, code: err.code, stdout, stderr: stderr || err.message });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        return res.status(408).json({ error: '命令执行超时', stdout, stderr });
      }
      res.json({ success: code === 0, code, stdout, stderr });
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

  // 解析命令为程序名和参数（支持引号，shell: false 不经过 shell）
  const parts = parseCommand(command);
  if (!parts.length) {
    ws.send(JSON.stringify({ type: 'error', data: '无法解析命令' }));
    return;
  }
  const program = parts[0];
  const args = parts.slice(1);

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

  // 超时控制：只有 docker logs -f / --follow 才是持续流式命令
  const isStreaming = /\bdocker\s+logs\b/.test(command) && /(^|\s)(?:-f|--follow)(\s|$)/.test(command);
  let timer = null;
  if (!isStreaming) {
    timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 30000);
  }
  const clearExecTimer = () => { if (timer) clearTimeout(timer); };

  proc.on('close', (code) => {
    clearExecTimer();
    activeProcesses.delete(ws);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
  });

  proc.on('error', (err) => {
    clearExecTimer();
    activeProcesses.delete(ws);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: err.message }));
    }
  });
}

module.exports = { router, handleWsExec, activeProcesses };
