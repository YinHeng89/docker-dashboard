// ==================== 系统指标 API ====================
// CPU / 内存 → metrics.service.js（宿主机 /host/proc）
// 磁盘       → disk.service.js（宿主机 /host/proc/mounts + statfs）
// 网络       → Docker Stats API（突破 netns 隔离，公网流量可见）
// Docker 容器 → 本文件（Docker Socket API）
const http = require('http');
const express = require('express');
const router = express.Router();

const metricsService = require('../services/metrics.service');
const diskService = require('../services/disk.service');

// ==================== Docker Socket 通用请求 ====================
const DOCKER_SOCK = '/var/run/docker.sock';

function dockerApi(path, method = 'GET', timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCK, path, method },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Docker API 超时: ${path}`));
    });
    req.end();
  });
}

// ==================== Docker 磁盘占用 ====================
// 使用 Docker /system/df 获取镜像/容器/卷的磁盘占用
async function getDockerDisk() {
  try {
    const df = await dockerApi('/system/df', 'GET', 5000);

    let imagesSize = 0;
    let containersSize = 0;
    let volumesSize = 0;

    for (const img of df.Images || []) {
      imagesSize += img.Size || 0;
    }
    for (const ct of df.Containers || []) {
      containersSize += ct.SizeRw || 0;
    }
    for (const vol of df.Volumes || []) {
      volumesSize += vol.UsageData?.Size || 0;
    }

    const dockerBytes = imagesSize + containersSize + volumesSize;

    // 宿主机根分区总量（用于百分比参考）
    let hostTotalBytes = 0;
    try {
      const fs = require('fs');
      const stat = fs.statfsSync('/');
      hostTotalBytes = stat.blocks * stat.bsize;
    } catch (_) {}

    const dockerGB = +(dockerBytes / 1024 / 1024 / 1024).toFixed(1);
    const systemTotalGB = +(hostTotalBytes / 1024 / 1024 / 1024).toFixed(1);
    const percent =
      hostTotalBytes > 0
        ? Math.round((dockerBytes / hostTotalBytes) * 1000) / 10
        : 0;

    return {
      percent,
      dockerGB,
      systemTotalGB,
      imagesGB: +(imagesSize / 1024 / 1024 / 1024).toFixed(1),
      containersGB: +(containersSize / 1024 / 1024 / 1024).toFixed(1),
      volumesGB: +(volumesSize / 1024 / 1024 / 1024).toFixed(1),
    };
  } catch (_) {
    return { percent: 0, dockerGB: 0, systemTotalGB: 0, imagesGB: 0, containersGB: 0, volumesGB: 0 };
  }
}

// ==================== 容器级网络速率缓存 ====================
// Key: 容器短ID, Value: { rx, tx, time }
const netRateCache = {};

// ==================== 容器级 CPU/内存/网络 ====================
// 通过 Docker stats API 获取每个容器的 CPU、内存和网络速率
async function getContainerMetrics() {
  try {
    const containers = await dockerApi('/containers/json?all=true');
    const running = containers.filter((c) => c.State === 'running').slice(0, 30);

    const now = Date.now();
    const results = await Promise.allSettled(
      running.map(
        (c) =>
          new Promise((resolve, reject) => {
            const req = http.get(
              {
                socketPath: DOCKER_SOCK,
                path: `/containers/${c.Id}/stats?stream=false&one-shot=true`,
              },
              (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                  try {
                    resolve({ container: c, stats: JSON.parse(data) });
                  } catch (e) {
                    reject(e);
                  }
                });
              }
            );
            req.on('error', reject);
            req.setTimeout(5000, () => {
              req.destroy();
              reject(new Error('超时'));
            });
          })
      )
    );

    const containerStats = {};
    let totalNetDown = 0;
    let totalNetUp = 0;

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { container, stats } = r.value;
      if (!stats) continue;

      // 容器级 CPU
      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
      const cpuCount = stats.cpu_stats?.online_cpus || 1;
      let cpuPercent = 0;
      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent = Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10;
      }

      // 容器级内存
      const memUsage = stats.memory_stats?.usage || 0;
      const memLimit = stats.memory_stats?.limit || 0;
      const memPercent = memLimit > 0 ? Math.round((memUsage / memLimit) * 1000) / 10 : 0;
      const memMB = Math.round(memUsage / 1024 / 1024);

      // 容器级网络 —— 聚合所有接口的 rx_bytes / tx_bytes（累计值）
      const networks = stats.networks || {};
      let network_rx = 0, network_tx = 0;
      for (const iface of Object.values(networks)) {
        network_rx += (iface.rx_bytes || 0);
        network_tx += (iface.tx_bytes || 0);
      }

      // 计算实时速率（速率 = 累计字节差 / 时间差 → MB/s）
      const shortId = container.Id.slice(0, 12);
      const prev = netRateCache[shortId];
      let netDownRate = 0, netUpRate = 0;
      if (prev) {
        const elapsed = (now - prev.time) / 1000;
        if (elapsed > 0) {
          netDownRate = Math.max(0, network_rx - prev.rx) / elapsed / 1024 / 1024;
          netUpRate = Math.max(0, network_tx - prev.tx) / elapsed / 1024 / 1024;
        }
      }
      netRateCache[shortId] = { rx: network_rx, tx: network_tx, time: now };

      totalNetDown += netDownRate;
      totalNetUp += netUpRate;

      containerStats[shortId] = {
        cpu: cpuPercent,
        memory: memMB,
        memoryPercent: memPercent,
      };
    }

    return {
      containerStats,
      totalNetDown: +totalNetDown.toFixed(2),
      totalNetUp: +totalNetUp.toFixed(2),
    };
  } catch (_) {
    return { containerStats: {}, totalNetDown: 0, totalNetUp: 0 };
  }
}

// ==================== 容器统计 ====================
async function getContainerCounts() {
  try {
    const containers = await dockerApi('/containers/json?all=true');
    const total = containers.length;
    const running = containers.filter((c) => c.State === 'running').length;
    const stopped = containers.filter((c) => c.State === 'exited').length;
    const warning = total - running - stopped;

    return {
      total,
      running,
      stopped: Math.max(0, stopped),
      warning: Math.max(0, warning),
    };
  } catch (_) {
    return { total: 0, running: 0, stopped: 0, warning: 0 };
  }
}

// ==================== GET /api/system/metrics ====================
router.get('/', async (req, res) => {
  try {
    // 宿主机指标 —— 同步读取 /host/proc（CPU/Mem/Load/Uptime/磁盘）
    const host = metricsService.getHostMetrics();
    const hostDisk = diskService.getHostDisk();

    // Docker 指标 —— 异步 Docker API（网络走 Docker Stats，突破 netns 隔离）
    const [dockerDisk, containerCounts, containerResult] = await Promise.all([
      getDockerDisk(),
      getContainerCounts(),
      getContainerMetrics(),
    ]);
    const containerMetrics = containerResult.containerStats;
    const hostNetDown = containerResult.totalNetDown;
    const hostNetUp = containerResult.totalNetUp;

    res.json({
      // ===== 宿主机 CPU =====
      cpu: host.cpu,
      cpuCores: host.cpuCores,

      // ===== 宿主机内存 =====
      memory: host.memory,
      memoryUsed: host.memoryUsed,
      memoryTotal: host.memoryTotal,

      // ===== 宿主机负载 =====
      load1: host.load1,
      load5: host.load5,
      load15: host.load15,

      // ===== 宿主机磁盘（与 df -h 一致） =====
      disk: hostDisk.percent,
      diskTotalGB: hostDisk.totalGB,
      diskUsedGB: hostDisk.usedGB,

      // ===== 宿主机磁盘 I/O =====
      diskRead: hostDisk.diskRead,
      diskWrite: hostDisk.diskWrite,

      // ===== Docker 磁盘占用（向后兼容） =====
      diskDockerGB: dockerDisk.dockerGB,
      diskSystemTotalGB: dockerDisk.systemTotalGB,
      diskImagesGB: dockerDisk.imagesGB,
      diskContainersGB: dockerDisk.containersGB,
      diskVolumesGB: dockerDisk.volumesGB,

      // ===== 网络（Docker Stats API 聚合，突破 netns 隔离） =====
      netDown: hostNetDown,
      netUp: hostNetUp,

      // ===== 容器级 CPU/内存 =====
      containerMetrics,

      // ===== 容器统计 =====
      containersTotal: containerCounts.total,
      containersRunning: containerCounts.running,
      containersStopped: containerCounts.stopped,
      containersWarning: containerCounts.warning,

      // ===== 系统运行时间 =====
      systemUptime: host.systemUptime,
    });
  } catch (e) {
    console.error('[Metrics] 获取失败:', e.message);
    res.status(500).json({ error: '获取系统指标失败' });
  }
});

module.exports = router;
