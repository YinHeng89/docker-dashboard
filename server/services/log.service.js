// ==================== 系统日志缓冲区 ====================
// 内存环形缓冲，最近 500 条，通过 API 提供给前端

const MAX_ENTRIES = 500;
const buffer = [];

// 添加日志条目
function addLog(level, module, message) {
  const entry = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    level,  // 'info' | 'warn' | 'error' | 'success'
    module,
    message,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

// 获取日志（支持 since 参数增量拉取）
function getLogs(since) {
  if (since) {
    let idx = buffer.findIndex(e => e.id === since);
    if (idx === -1) return [];  // ID 已被逐出 → 返回空，不返回旧数据
    return buffer.slice(idx + 1);
  }
  return buffer.slice(-200);
}

// 捕获 console 输出到缓冲区
function captureConsole() {
  const levels = { log: 'info', warn: 'warn', error: 'error' };
  for (const [method, level] of Object.entries(levels)) {
    const original = console[method];
    console[method] = (...args) => {
      original.apply(console, args);
      const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 0))).join(' ');
      if (msg.length > 300) return; // 跳过太长（如 JSON 响应体）
      addLog(level, 'server', msg.slice(0, 200));
    };
  }
}

// 初始化真实日志
captureConsole();

module.exports = { addLog, getLogs };
