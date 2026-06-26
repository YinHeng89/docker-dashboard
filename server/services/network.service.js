/**
 * network.service.js — 宿主机网络监控服务
 *
 * 数据来源：/host/proc/net/dev
 *
 * 与 iftop / nload / vnstat 等标准工具保持一致的计算方式。
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

// ==================== 网卡统计解析 ====================

/**
 * 解析 /proc/net/dev
 * 格式:
 *   Inter-|   Receive    |  Transmit
 *    face |bytes packets ...|bytes packets ...
 *     eth0: 123456 789 0 0 0 0 0 0  654321 321 0 0 0 0 0 0
 *
 * 返回 [ { name, rxBytes, txBytes } ]
 */
function parseNetDev() {
  const text = readProc('net/dev');
  const interfaces = [];

  // 跳过的虚拟网卡
  const skipPatterns = [
    /^lo$/,
    /^docker\d+$/,
    /^br-[a-f0-9]+$/,
    /^veth[a-f0-9]+$/,
    /^vnet\d+$/,
    /^virbr\d+$/,
    /^tun\d+$/,
    /^tap\d+$/,
    /^wg\d+$/,
  ];

  const lines = text.split('\n');
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const name = line.substring(0, colonIdx).trim();
    const rest = line.substring(colonIdx + 1).trim().split(/\s+/);

    if (rest.length < 10) continue;

    // 过滤虚拟网卡
    if (skipPatterns.some((p) => p.test(name))) continue;

    const rxBytes = parseInt(rest[0], 10) || 0;
    const txBytes = parseInt(rest[8], 10) || 0;

    interfaces.push({ name, rxBytes, txBytes });
  }

  return interfaces;
}

// ==================== 滚动窗口速率计算 ====================

let prevNetSnapshot = null;
let prevNetTime = 0;

/**
 * 获取宿主机网络速率（下载/上传 MB/s）
 *
 * 使用滚动窗口：缓存上次采样的流量计数器，
 * 与本次采样对比计算实时速率。
 */
function getNetworkRates() {
  const now = Date.now();
  const interfaces = parseNetDev();

  if (!prevNetSnapshot || prevNetTime === 0) {
    prevNetSnapshot = interfaces;
    prevNetTime = now;
    return { downMBs: 0, upMBs: 0, interfaces: [] };
  }

  const elapsed = (now - prevNetTime) / 1000;
  if (elapsed <= 0) {
    return { downMBs: 0, upMBs: 0, interfaces: [] };
  }

  // 按名称匹配网卡
  const prevMap = new Map();
  for (const iface of prevNetSnapshot) {
    prevMap.set(iface.name, iface);
  }

  let totalRxDelta = 0;
  let totalTxDelta = 0;
  const ifaceDetails = [];

  for (const iface of interfaces) {
    const prev = prevMap.get(iface.name);
    if (!prev) continue;

    const rxDelta = iface.rxBytes - prev.rxBytes;
    const txDelta = iface.txBytes - prev.txBytes;

    if (rxDelta >= 0) totalRxDelta += rxDelta;
    if (txDelta >= 0) totalTxDelta += txDelta;

    ifaceDetails.push({
      name: iface.name,
      downMBs: +(rxDelta / elapsed / 1024 / 1024).toFixed(2),
      upMBs: +(txDelta / elapsed / 1024 / 1024).toFixed(2),
    });
  }

  prevNetSnapshot = interfaces;
  prevNetTime = now;

  return {
    downMBs: +(totalRxDelta / elapsed / 1024 / 1024).toFixed(2),
    upMBs: +(totalTxDelta / elapsed / 1024 / 1024).toFixed(2),
    interfaces: ifaceDetails,
  };
}

// ==================== 连接数统计 ====================

/**
 * 获取 TCP 连接数统计（来自 /proc/net/snmp 或 /proc/net/tcp）
 */
function getTcpStats() {
  try {
    // 读取 /proc/net/snmp 获取 TCP 协议统计
    const text = readProc('net/snmp');
    const lines = text.split('\n');

    let tcpKeys = [];
    let tcpValues = [];

    for (const line of lines) {
      if (line.startsWith('Tcp:')) {
        const parts = line.trim().split(/\s+/);
        if (!tcpKeys.length) {
          tcpKeys = parts;
        } else {
          tcpValues = parts;
          break;
        }
      }
    }

    if (tcpKeys.length < 12 || tcpValues.length < 12) {
      return { established: 0, listen: 0, timeWait: 0, close: 0 };
    }

    const getVal = (key) => {
      const idx = tcpKeys.indexOf(key);
      return idx >= 0 ? parseInt(tcpValues[idx], 10) || 0 : 0;
    };

    return {
      established: getVal('CurrEstab'),
      // 累计值（用于告警检测异常增长）
      activeOpens: getVal('ActiveOpens'),
      passiveOpens: getVal('PassiveOpens'),
      inSegs: getVal('InSegs'),
      outSegs: getVal('OutSegs'),
      retransSegs: getVal('RetransSegs'),
      inErrs: getVal('InErrs'),
      outRsts: getVal('OutRsts'),
    };
  } catch {
    return { established: 0, listen: 0, timeWait: 0, close: 0 };
  }
}

// ==================== 统一导出 ====================

function getHostNetwork() {
  const rates = getNetworkRates();
  const tcp = getTcpStats();

  return {
    downMBs: rates.downMBs,
    upMBs: rates.upMBs,
    tcp: {
      established: tcp.established,
      activeOpens: tcp.activeOpens,
      passiveOpens: tcp.passiveOpens,
      retransSegs: tcp.retransSegs,
      inErrs: tcp.inErrs,
    },
    interfaces: rates.interfaces,
  };
}

module.exports = {
  getNetworkRates,
  getTcpStats,
  getHostNetwork,
};
