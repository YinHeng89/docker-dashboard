/**
 * metrics.service.js — 宿主机系统监控服务
 *
 * 数据来源：/host/proc/* （容器需挂载宿主机 /proc）
 *
 * 与 top / htop / free 等标准工具保持一致的计算方式。
 */

const fs = require('fs');
const os = require('os');

// ==================== 配置 ====================

// 宿主机 /proc 挂载路径（docker-compose 中挂载 /proc:/host/proc:ro）
const HOST_PROC = '/host/proc';

// 是否运行在容器内（有 /host/proc 且不同于 /proc）
const inContainer = (() => {
  try {
    return fs.existsSync(HOST_PROC) && fs.statSync(HOST_PROC).dev !== fs.statSync('/proc').dev;
  } catch {
    return false;
  }
})();

// 根据环境选择数据源路径
function procPath(file) {
  return inContainer ? `${HOST_PROC}/${file}` : `/proc/${file}`;
}

// 读取 proc 文件，返回字符串
function readProc(file) {
  return fs.readFileSync(procPath(file), 'utf-8');
}

// ==================== CPU 监控 ====================

/**
 * 解析 /proc/stat 中各 CPU 行
 * 格式: cpu  user nice system idle iowait irq softirq steal guest guest_nice
 * 返回 [{ idle, total }] 数组（cpu 总行 + 各核心行）
 */
function parseCpuStat() {
  const text = readProc('stat');
  const cpus = [];

  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    // parts[0] = "cpu" 或 "cpu0", parts[1..] = 数字
    const values = parts.slice(1).map(Number);
    if (values.length < 4) continue;

    // idle 字段是第 4 个（索引 3），即 parts[4]
    const idle = values[3];                       // idle
    const total = values.reduce((a, b) => a + b, 0);

    cpus.push({ idle, total });
  }

  return cpus; // [aggregate, core0, core1, ...]
}

// 滚动窗口：缓存上一次快照
let prevCpuSnapshot = null;

/**
 * 获取宿主机 CPU 使用率（百分比，0-100，精确到 0.1）
 *
 * 使用滚动窗口：用上一次请求的快照作为起点，
 * 采样间隔 = 两次请求之间的自然间隔（通常 5-10 秒）
 *
 * 算法与 top / htop / node_exporter 一致：
 *   cpu% = 100 × (1 - idleDelta / totalDelta)
 */
function getCpuUsage() {
  const snapshot = parseCpuStat();
  if (snapshot.length === 0) return { percent: 0, cores: 0 };

  // 只使用第一行（cpu 总行）计算整体使用率
  const current = snapshot[0];
  const cores = snapshot.length - 1; // 减去 aggregate 行

  if (!prevCpuSnapshot || prevCpuSnapshot.length === 0) {
    prevCpuSnapshot = snapshot;
    return { percent: 0, cores };
  }

  const prev = prevCpuSnapshot[0];
  prevCpuSnapshot = snapshot;

  const idleDelta = current.idle - prev.idle;
  const totalDelta = current.total - prev.total;

  if (totalDelta <= 0) return { percent: 0, cores };

  const percent = Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
  return {
    percent: Math.max(0, Math.min(100, percent)),
    cores,
  };
}

// ==================== 内存监控 ====================

/**
 * 解析 /proc/meminfo
 * 返回 { MemTotal, MemAvailable, ... } 键值对（单位 KB）
 */
function parseMeminfo() {
  const text = readProc('meminfo');
  const info = {};

  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const valStr = line.substring(colonIdx + 1).replace('kB', '').trim();
    info[key] = parseInt(valStr, 10) || 0;
  }

  return info;
}

/**
 * 获取宿主机内存使用情况
 *
 * 使用 MemAvailable 而非 MemFree：
 *   MemAvailable = MemFree + 可回收的 Cache/Buffer
 *   这是内核估算的"新进程可以立刻分配到的内存"
 *
 * 与 free / htop / top 显示结果一致。
 */
function getMemoryUsage() {
  const info = parseMeminfo();
  const total = info.MemTotal || 0;          // KB
  const available = info.MemAvailable || 0;   // KB
  const used = total - available;

  if (total === 0) {
    return { percent: 0, usedGB: 0, totalGB: 0 };
  }

  const totalGB = +(total / 1024 / 1024).toFixed(1);
  const usedGB = +(used / 1024 / 1024).toFixed(1);
  const percent = Math.round((used / total) * 1000) / 10;

  return {
    percent: Math.max(0, Math.min(100, percent)),
    usedGB,
    totalGB,
  };
}

// ==================== 系统负载 ====================

/**
 * 获取系统平均负载（/proc/loadavg）
 * 返回 { load1, load5, load15 }
 */
function getLoadAvg() {
  try {
    const text = readProc('loadavg');
    const parts = text.trim().split(/\s+/);
    return {
      load1: parseFloat(parts[0]) || 0,
      load5: parseFloat(parts[1]) || 0,
      load15: parseFloat(parts[2]) || 0,
    };
  } catch {
    return { load1: 0, load5: 0, load15: 0 };
  }
}

// ==================== 系统运行时间 ====================

/**
 * 获取宿主机运行时间（秒）
 */
function getUptime() {
  try {
    const text = readProc('uptime');
    const parts = text.trim().split(/\s+/);
    return parseFloat(parts[0]) || os.uptime();
  } catch {
    return os.uptime();
  }
}

// ==================== 统一导出 ====================

/**
 * 获取所有宿主机系统指标
 * 返回对象可直接用于 API 响应
 */
function getHostMetrics() {
  const cpu = getCpuUsage();
  const memory = getMemoryUsage();
  const load = getLoadAvg();
  const uptime = getUptime();

  return {
    cpu: cpu.percent,
    cpuCores: cpu.cores,
    memory: memory.percent,
    memoryUsed: memory.usedGB,
    memoryTotal: memory.totalGB,
    load1: load.load1,
    load5: load.load5,
    load15: load.load15,
    systemUptime: uptime,
  };
}

module.exports = {
  // 单个指标方法
  getCpuUsage,
  getMemoryUsage,
  getLoadAvg,
  getUptime,

  // 统一接口
  getHostMetrics,

  // 供调试
  inContainer,
  procPath,
};
