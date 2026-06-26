/**
 * disk.service.js — 宿主机磁盘监控服务
 *
 * 数据来源：/host/proc/mounts + fs.statfsSync
 *
 * 与 df -h 等标准工具保持一致。
 */

const fs = require('fs');

// ==================== 配置 ====================

const HOST_PROC = '/host/proc';

const inContainer = (() => {
  try {
    return fs.existsSync(HOST_PROC) && fs.statSync(HOST_PROC).dev !== fs.statSync('/proc').dev;
  } catch {
    return false;
  }
})();

function procPath(file) {
  return inContainer ? `${HOST_PROC}/${file}` : `/proc/${file}`;
}

function readProc(file) {
  return fs.readFileSync(procPath(file), 'utf-8');
}

// ==================== 挂载点解析 ====================

/**
 * 解析 /proc/mounts，获取宿主机真实文件系统挂载点
 * 过滤掉虚拟文件系统和 Docker 内部挂载
 */
function parseMounts() {
  const text = readProc('mounts');
  const mounts = [];

  const skipFs = new Set([
    'proc', 'sysfs', 'devpts', 'tmpfs', 'devtmpfs',
    'cgroup', 'cgroup2', 'pstore', 'bpf', 'fuse.gvfsd-fuse',
    'securityfs', 'debugfs', 'tracefs', 'configfs', 'hugetlbfs',
    'mqueue', 'binfmt_misc', 'overlay',
  ]);

  const skipPrefixes = [
    '/proc/', '/sys/', '/dev/', '/run/', '/snap/',
    '/var/lib/docker/', '/var/lib/containerd/',
  ];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    const device = parts[0];
    const mountPoint = parts[1];
    const fsType = parts[2];

    if (skipFs.has(fsType)) continue;
    if (skipPrefixes.some((p) => mountPoint.startsWith(p))) continue;
    if (!device.startsWith('/dev/')) continue;

    mounts.push({ device, mountPoint, fsType });
  }

  // 去重：同一 device 只保留挂载点最短的（通常是根挂载点）
  const seen = new Map();
  for (const m of mounts) {
    const existing = seen.get(m.device);
    if (!existing || m.mountPoint.length < existing.mountPoint.length) {
      seen.set(m.device, m);
    }
  }

  return Array.from(seen.values());
}

// ==================== 磁盘使用率 ====================

/**
 * 获取单个挂载点的磁盘使用情况
 */
function getMountUsage(mountPoint) {
  try {
    // 尝试直接访问宿主机路径；容器内通常共享宿主机根文件系统
    const stat = fs.statfsSync(mountPoint);
    const total = stat.blocks * stat.bsize;
    const available = stat.bavail * stat.bsize;
    const used = total - available;

    return {
      mountPoint,
      totalGB: +(total / 1024 / 1024 / 1024).toFixed(1),
      usedGB: +(used / 1024 / 1024 / 1024).toFixed(1),
      availableGB: +(available / 1024 / 1024 / 1024).toFixed(1),
      percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 获取宿主机磁盘使用概览
 *
 * 返回根文件系统（或其他可访问文件系统）的使用情况。
 * 由于容器通常与宿主机共享根文件系统，statfsSync('/') 可获取宿主机磁盘信息。
 */
function getDiskUsage() {
  const mountPoints = parseMounts();

  // 尝试获取所有可访问挂载点的使用情况
  const partitions = [];
  for (const m of mountPoints) {
    const usage = getMountUsage(m.mountPoint);
    if (usage) {
      partitions.push({ ...usage, device: m.device, fsType: m.fsType });
    }
  }

  // 如果通过 /proc/mounts 没找到，fallback 到根分区
  if (partitions.length === 0) {
    const rootUsage = getMountUsage('/');
    if (rootUsage) {
      partitions.push({ ...rootUsage, device: 'rootfs', fsType: 'ext4' });
    }
  }

  // 汇总：取所有分区总和
  let totalGB = 0;
  let usedGB = 0;
  for (const p of partitions) {
    totalGB += p.totalGB;
    usedGB += p.usedGB;
  }

  const percent = totalGB > 0 ? Math.round((usedGB / totalGB) * 1000) / 10 : 0;

  return {
    percent: Math.max(0, Math.min(100, percent)),
    totalGB: +totalGB.toFixed(1),
    usedGB: +usedGB.toFixed(1),
    partitions,
  };
}

// ==================== 磁盘 I/O 统计 ====================

let prevDiskStats = null;
let prevDiskTime = 0;

/**
 * 解析 /proc/diskstats 获取磁盘 I/O 统计
 * 返回所有物理磁盘的读写速率（MB/s）
 */
function parseDiskstats() {
  const text = readProc('diskstats');
  const disks = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;

    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const name = parts[2];

    // 只统计物理磁盘（sd*/nvme*/vd*/xvd*），跳过分区（末尾带数字）
    const isPhysical = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+)$/.test(name);
    if (!isPhysical) continue;
    // 跳过 loop 设备、ram 设备
    if (name.startsWith('loop') || name.startsWith('ram')) continue;

    // 字段索引（从 0 开始，跳过 major/minor/name）：
    // 3: reads completed, 4: reads merged, 5: sectors read, 6: read ms
    // 7: writes completed, 8: writes merged, 9: sectors written, 10: write ms
    const readSectors = parseInt(parts[5], 10) || 0;
    const writeSectors = parseInt(parts[9], 10) || 0;

    disks.push({ name, readSectors, writeSectors });
  }

  return disks;
}

/**
 * 获取磁盘 I/O 速率（读/写 MB/s）
 * 使用滚动窗口计算
 */
function getDiskIO() {
  const now = Date.now();
  const stats = parseDiskstats();

  if (!prevDiskStats || !prevDiskTime) {
    prevDiskStats = stats;
    prevDiskTime = now;
    return { readMBs: 0, writeMBs: 0 };
  }

  const elapsed = (now - prevDiskTime) / 1000;
  if (elapsed <= 0) return { readMBs: 0, writeMBs: 0 };

  // 按名称匹配磁盘，计算差值
  const prevMap = new Map();
  for (const d of prevDiskStats) {
    prevMap.set(d.name, d);
  }

  let totalReadSectors = 0;
  let totalWriteSectors = 0;

  for (const d of stats) {
    const prev = prevMap.get(d.name);
    if (!prev) continue;
    const readDelta = d.readSectors - prev.readSectors;
    const writeDelta = d.writeSectors - prev.writeSectors;
    if (readDelta > 0) totalReadSectors += readDelta;
    if (writeDelta > 0) totalWriteSectors += writeDelta;
  }

  prevDiskStats = stats;
  prevDiskTime = now;

  // 扇区大小 512 字节，转换为 MB/s
  return {
    readMBs: +((totalReadSectors * 512) / elapsed / 1024 / 1024).toFixed(2),
    writeMBs: +((totalWriteSectors * 512) / elapsed / 1024 / 1024).toFixed(2),
  };
}

// ==================== 统一导出 ====================

function getHostDisk() {
  const usage = getDiskUsage();
  const io = getDiskIO();

  return {
    // 磁盘使用率（兼容前端现有字段）
    percent: usage.percent,
    totalGB: usage.totalGB,
    usedGB: usage.usedGB,

    // 磁盘 I/O
    diskRead: io.readMBs,
    diskWrite: io.writeMBs,

    // 分区详情
    partitions: usage.partitions,
  };
}

module.exports = {
  getDiskUsage,
  getDiskIO,
  getHostDisk,
};
