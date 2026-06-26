// ==================== 工具函数 ====================
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const yaml = require('js-yaml');

// 项目根目录（从环境变量获取）
const PROJECTS_DIR = process.env.PROJECTS_DIR || '/projects';

/**
 * 获取自身 Docker 容器 ID（多种方式兜底，比 os.hostname() 可靠）
 * @returns {string|null} 容器短 ID 或 null
 */
let _selfContainerId = null;
function getSelfContainerId() {
  if (_selfContainerId) return _selfContainerId;

  // 方式1: /proc/self/cgroup — 最可靠
  try {
    const cgroup = fsSync.readFileSync('/proc/self/cgroup', 'utf-8');
    const match = cgroup.match(/docker[\/-]([a-f0-9]{64})/);
    if (match) {
      _selfContainerId = match[1].slice(0, 12);
      return _selfContainerId;
    }
  } catch (_) {}

  // 方式2: /proc/self/mountinfo — 兜底
  try {
    const mountinfo = fsSync.readFileSync('/proc/self/mountinfo', 'utf-8');
    const match = mountinfo.match(/\/docker\/containers\/([a-f0-9]{64})\//);
    if (match) {
      _selfContainerId = match[1].slice(0, 12);
      return _selfContainerId;
    }
  } catch (_) {}

  // 方式3: 环境变量 HOSTNAME — 最后兜底（某些 Docker 环境会设置为容器短 ID）
  if (process.env.HOSTNAME && /^[a-f0-9]{12}$/.test(process.env.HOSTNAME)) {
    _selfContainerId = process.env.HOSTNAME;
    return _selfContainerId;
  }

  return null;
}

/**
 * 判断给定容器 ID 是否自身
 * @param {string} containerId - 容器 ID
 * @returns {boolean}
 */
function isSelfContainer(containerId) {
  const selfId = getSelfContainerId();
  if (!selfId || !containerId) return false;
  return (containerId || '').slice(0, 12) === selfId;
}

/**
 * 判断 compose 项目是否包含自身容器（用于阻止危险操作）
 * @param {string} projectName - compose 项目名
 * @returns {Promise<boolean>}
 */
async function isSelfComposeProject(projectName) {
  const selfId = getSelfContainerId();
  if (!selfId) return false;
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get({
      socketPath: '/var/run/docker.sock',
      path: '/containers/json?all=true',
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const containers = JSON.parse(data);
          for (const c of containers) {
            const labels = c.Labels || {};
            if (labels['com.docker.compose.project'] === projectName) {
              if ((c.Id || '').slice(0, 12) === selfId) return resolve(true);
            }
          }
          resolve(false);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * 校验路径安全性，防止目录遍历攻击
 * 返回安全的绝对路径，如果路径不安全则抛出错误
 */
function safePath(userPath) {
  // 清理用户输入
  const clean = path.normalize(userPath).replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(PROJECTS_DIR, clean);

  // 确保路径在 PROJECTS_DIR 内
  if (!resolved.startsWith(PROJECTS_DIR + path.sep) && resolved !== PROJECTS_DIR) {
    throw new Error('非法路径：不允许访问项目目录之外的文件');
  }

  return resolved;
}

/**
 * 提取 volumes 条目的 source 路径（兼容短语法和长语法）
 */
function extractVolumeSources(services) {
  const warnings = [];
  for (const [svcName, svc] of Object.entries(services)) {
    const volumes = svc.volumes;
    if (!Array.isArray(volumes)) continue;
    for (const v of volumes) {
      let source;
      if (typeof v === 'string') {
        const parts = v.split(':');
        source = parts[0];
        if (!/[/.~]/.test(source)) continue;
      } else if (v && typeof v === 'object') {
        source = v.source;
      }
      if (source && (source.startsWith('./') || source.startsWith('../'))) {
        warnings.push(`[${svcName}] 卷挂载使用了相对路径 "${source}"，不建议在非严格路径映射环境下使用，可能导致文件挂载错误`);
      }
    }
  }
  return warnings;
}

// ---- 同路径挂载检测（启动时执行一次）----
let _samePathMount = null;

async function initSamePathCheck() {
  const projectDir = PROJECTS_DIR;
  const selfId = getSelfContainerId();
  if (!selfId) {
    console.warn('[initSamePathCheck] 无法获取自身容器 ID，默认禁止相对路径');
    _samePathMount = false;
    return;
  }
  const http = require('http');
  return new Promise((resolve) => {
    http.get({ socketPath: '/var/run/docker.sock', path: `/containers/${selfId}/json` }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const mounts = JSON.parse(d).Mounts || [];
          _samePathMount = mounts.some(m => m.Destination === projectDir && m.Source === projectDir);
          console.log(`[initSamePathCheck] PROJECTS_DIR=${projectDir} 同路径挂载: ${_samePathMount ? '✅ 支持相对路径' : '❌ 不支持'}`);
        } catch { _samePathMount = false; }
        resolve();
      });
    }).on('error', () => { _samePathMount = false; resolve(); });
  });
}

function isRelativePathSupported() {
  return _samePathMount === true;
}

/**
 * 校验 YAML 字符串是否合法，检测相对路径卷挂载
 * 返回 { parsed, warnings }
 */
function validateYaml(content) {
  try {
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML 内容必须是一个对象');
    }
    // 基本检查：compose 文件应该包含 services
    if (!parsed.services) {
      throw new Error('Compose 文件缺少 services 字段');
    }
    const warnings = extractVolumeSources(parsed.services);
    return { parsed, warnings };
  } catch (e) {
    if (e.name === 'YAMLException') {
      throw new Error(`YAML 语法错误: ${e.message}`);
    }
    throw e;
  }
}

/**
 * 确保目录存在
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 读取文件内容（UTF-8）
 */
/**
 * 从 docker compose stderr 中提取关键错误信息
 */
function extractComposeError(stderr) {
  if (!stderr) return '';
  const lines = stderr.split('\n').filter(Boolean)
    .map(l => l.trim()).filter(Boolean);
  // 过滤掉 compose 进度信息
  const progressPattern = /^(Network|Volume|Container|Service)\s+\S+\s+(Creating|Created|Starting|Started|Running|Restarting|Recreating|Stopping|Removing|Healthy|Waiting)/;
  const nonProgress = lines.filter(l => !progressPattern.test(l));
  if (nonProgress.length > 0) return nonProgress.join('\n');
  return '';
}

async function readFile(filePath) {
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * 写入文件（UTF-8）
 */
async function writeFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * 检查文件/目录是否存在
 */
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出目录内容
 */
async function listDir(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    isDir: e.isDirectory(),
    isFile: e.isFile(),
  }));
}

module.exports = {
  PROJECTS_DIR,
  getSelfContainerId,
  isSelfContainer,
  isSelfComposeProject,
  safePath,
  validateYaml,
  ensureDir,
  readFile,
  writeFile,
  exists,
  listDir,
  initSamePathCheck,
  isRelativePathSupported,
  extractComposeError,
};
