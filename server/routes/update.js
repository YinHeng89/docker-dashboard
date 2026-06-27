// ==================== 容器/Compose 更新路由 ====================
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const { safePath, exists, getSelfContainerId } = require('../lib/utils');

// 日志
const LOG_PREFIX = '[update]';
function log(...args) { console.log(`${LOG_PREFIX} [${new Date().toISOString()}]`, ...args); }
function logError(...args) { console.error(`${LOG_PREFIX} [${new Date().toISOString()}] [ERROR]`, ...args); }

// ==================== 缓存 ====================

// Registry Token 缓存: key = "registry|repo", value = { token, expiresAt }
const tokenCache = new Map();
function getCachedToken(registry, repo) {
  const key = `${registry}|${repo}`;
  const entry = tokenCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    log(`tokenCache → 命中 ${key}`);
    return entry.token;
  }
  tokenCache.delete(key);
  return null;
}
function setCachedToken(registry, repo, token, expiresInSec = 300) {
  const key = `${registry}|${repo}`;
  tokenCache.set(key, { token, expiresAt: Date.now() + expiresInSec * 1000 });
  log(`tokenCache → 缓存 ${key} (${expiresInSec}s)`);
}

// 更新结果缓存: 6 小时，key = "registry/repo:tag"
const RESULT_CACHE_TTL = 6 * 60 * 60 * 1000;
const resultCache = new Map();
function getCachedResult(registry, repo, tag) {
  const key = `${registry}/${repo}:${tag}`;
  const entry = resultCache.get(key);
  if (entry && Date.now() - entry.cachedAt < RESULT_CACHE_TTL) {
    log(`resultCache → 命中 ${key} (${Math.round((Date.now() - entry.cachedAt) / 60000)}m 前)`);
    return entry.data;
  }
  resultCache.delete(key);
  return null;
}
function setCachedResult(registry, repo, tag, data) {
  const key = `${registry}/${repo}:${tag}`;
  resultCache.set(key, { data, cachedAt: Date.now() });
  log(`resultCache → 缓存 ${key}`);
}

// ==================== 工具函数 ====================

// Docker socket 请求
function dockerRequest(method, pathStr, body) {
  const startTime = Date.now();
  const shortPath = pathStr.length > 120 ? pathStr.slice(0, 120) + '...' : pathStr;
  log(`dockerRequest → ${method} ${shortPath}`);
  return new Promise((resolve, reject) => {
    const opts = { socketPath: '/var/run/docker.sock', path: pathStr, method, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            logError(`${method} ${shortPath} → ${res.statusCode} (${elapsed}ms)`, parsed.message || '');
            return reject(new Error(parsed.message || `Docker API 错误 (${res.statusCode})`));
          }
          log(`${method} ${shortPath} → ${res.statusCode} (${elapsed}ms) res: ${data.length > 200 ? data.length + ' bytes' : data}`);
          resolve(parsed);
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Docker socket 超时')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function findComposeFile(projectDir) {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const fp = path.join(projectDir, name);
    if (fs.existsSync(fp)) { log(`findComposeFile → ${fp}`); return fp; }
  }
  return null;
}

// 发送 NDJSON 进度
function sendProgress(res, data) {
  if (res.writableEnded) return;
  res.write(JSON.stringify(data) + '\n');
}

// 执行命令（流式）
function runCommand(cmd, args, cwd, res, label) {
  const startTime = Date.now();
  const cmdStr = `${cmd} ${args.join(' ')}`;
  log(`runCommand → [${label}]: ${cmdStr}`);
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env } });
    let outSize = 0, errSize = 0;
    proc.stdout.on('data', d => { const t = d.toString(); outSize += t.length; sendProgress(res, { type: 'log', container: label, message: t, stream: 'stdout' }); });
    proc.stderr.on('data', d => { const t = d.toString(); errSize += t.length; sendProgress(res, { type: 'log', container: label, message: t, stream: 'stderr' }); });
    proc.on('close', code => {
      const elapsed = Date.now() - startTime;
      const summary = [`runCommand → [${label}] code=${code} (${elapsed}ms)`];
      if (outSize > 0) summary.push(`\nstdout (${outSize}B)`);
      if (errSize > 0) summary.push(`\nstderr (${errSize}B)`);
      log(summary.join(''));
      resolve(code);
    });
    proc.on('error', err => { logError(`runCommand → [${label}] error: ${err.message}`); sendProgress(res, { type: 'log', container: label, message: err.message, stream: 'stderr' }); resolve(-1); });
  });
}

// ==================== Registry API 检查更新（仅查 manifest，零下载） ====================

// 解析 "nginx:latest" → { registry, repo, tag }
function parseImageName(image) {
  if (!image) return null;
  let rest = image, registry = 'registry-1.docker.io';
  const parts = rest.split('/');
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    registry = parts.shift();
    rest = parts.join('/');
  }
  let repo, tag = 'latest';
  if (rest.includes('@sha256:')) {
    const idx = rest.indexOf('@');
    repo = rest.slice(0, idx);
    tag = rest.slice(idx + 1);
  } else if (rest.includes(':')) {
    const idx = rest.lastIndexOf(':');
    repo = rest.slice(0, idx);
    tag = rest.slice(idx + 1);
  } else { repo = rest; }
  if (registry === 'registry-1.docker.io' && !repo.includes('/')) repo = 'library/' + repo;
  return { registry, repo, tag };
}

// 获取本地 RepoDigests（docker image inspect）
async function getLocalRepoDigests(imageName) {
  try {
    const info = await dockerRequest('GET', `/images/${encodeURIComponent(imageName)}/json`);
    const digests = info.RepoDigests || [];
    log(`getLocalRepoDigests → ${imageName}: ${digests.length > 0 ? digests.map(d => d.split('@')[1]?.slice(0, 19)).join(', ') : '无（本地构建）'}`);
    return digests;
  } catch (e) { logError(`getLocalRepoDigests → ${e.message}`); return []; }
}

// ==================== OAuth2 Token 获取（通用，支持所有 Registry） ====================

// 解析 WWW-Authenticate 头 → { realm, service, scope }
// 格式: Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"
function parseWwwAuthenticate(header) {
  if (!header) return null;
  const result = {};
  const bearMatch = header.match(/^\s*Bearer\s+(.+)/i);
  if (!bearMatch) return null;
  const params = bearMatch[1];
  for (const m of params.matchAll(/(\w+)="([^"]*)"/g)) {
    result[m[1]] = m[2];
  }
  return result.realm ? result : null;
}

// HTTP(S) GET 请求（用于获取 token 等简单场景）
function httpsGet(url, timeout = 10000) {
  log(`httpsGet → ${url}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ statusCode: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// 通用 Registry Token 获取（自动跟随 WWW-Authenticate）
// 流程: /v2/ → 401 + WWW-Authenticate → 请求 realm → token
async function getRegistryToken(registry, repo) {
  // 先查缓存
  const cached = getCachedToken(registry, repo);
  if (cached) return cached;

  // 通过 /v2/ 获取 WWW-Authenticate
  const wwwAuth = await getV2WwwAuth(registry);
  if (!wwwAuth) return null;

  return getTokenFromWwwAuth(registry, repo, wwwAuth);
}

// 请求 /v2/ 获取 WWW-Authenticate 头（无缓存，纯网络请求）
async function getV2WwwAuth(registry) {
  const host = registry === 'registry-1.docker.io' ? 'registry-1.docker.io' : registry;
  try {
    const v2Res = await new Promise((resolve) => {
      const req = https.request({
        hostname: host, path: '/v2/', method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000, rejectUnauthorized: true,
      }, (res) => {
        resolve({ statusCode: res.statusCode, headers: res.headers });
      });
      req.on('error', () => resolve({ statusCode: 0, headers: {} }));
      req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, headers: {} }); });
      req.end();
    });

    if (v2Res.statusCode === 200) {
      // /v2/ 返回 200，Registry 未在此端点要求认证（如 GHCR）
      // 但实际 manifest 请求可能仍需 token，此时由调用方通过 manifest 401 响应获取
      return null;
    }

    const wwwAuth = v2Res.headers['www-authenticate'];
    if (!wwwAuth) {
      logError(`getV2WwwAuth → ${host} 返回 ${v2Res.statusCode} 但无 WWW-Authenticate 头`);
      return null;
    }
    return wwwAuth;
  } catch (e) {
    logError(`getV2WwwAuth → ${host} 连接失败: ${e.message}`);
    return null;
  }
}

// 根据 WWW-Authenticate 头获取 token
async function getTokenFromWwwAuth(registry, repo, wwwAuth) {
  // 先查缓存
  const cached = getCachedToken(registry, repo);
  if (cached) return cached;

  const registryLabel = registry === 'registry-1.docker.io' ? 'Docker Hub' : registry;
  log(`getTokenFromWwwAuth → ${registryLabel} repo=${repo}`);

  const authInfo = parseWwwAuthenticate(wwwAuth);
  if (!authInfo) {
    logError(`getTokenFromWwwAuth → 无法解析 WWW-Authenticate: ${wwwAuth}`);
    return null;
  }
  log(`getTokenFromWwwAuth → realm=${authInfo.realm}, service=${authInfo.service || 'N/A'}`);

  try {
    const scope = `repository:${repo}:pull`;
    const params = new URLSearchParams();
    if (authInfo.service) params.set('service', authInfo.service);
    params.set('scope', scope);
    const realmBase = authInfo.realm.split('?')[0];
    const tokenUrl = `${realmBase}?${params.toString()}`;

    const tokenRes = await httpsGet(tokenUrl, 10000);
    if (tokenRes.statusCode !== 200 || !tokenRes.body?.token) {
      logError(`getTokenFromWwwAuth → realm 返回 ${tokenRes.statusCode}, 无 token`);
      return null;
    }

    const token = tokenRes.body.token;
    const expiresIn = tokenRes.body.expires_in || 300;
    setCachedToken(registry, repo, token, expiresIn);
    log(`getTokenFromWwwAuth → ${registryLabel} 获取成功 (${expiresIn}s)`);
    return token;
  } catch (e) {
    logError(`getTokenFromWwwAuth → realm 请求失败: ${e.message}`);
    return null;
  }
}

// 通过 GET manifest 触发 401 获取 WWW-Authenticate（GHCR 等对 HEAD 返回 404，对 GET 返回 401）
// 拿到 header 后立即中止连接，不下载 manifest 内容
function getAuthFromManifest(registry, repo, tag) {
  const host = registry === 'registry-1.docker.io' ? 'registry-1.docker.io' : registry;
  const p = `/v2/${repo}/manifests/${encodeURIComponent(tag)}`;
  log(`getAuthFromManifest → GET https://${host}${p}`);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path: p, method: 'GET',
      headers: { 'Accept': 'application/vnd.docker.distribution.manifest.v2+json' },
      timeout: 10000, rejectUnauthorized: true,
    }, (res) => {
      const wwwAuth = res.headers['www-authenticate'];
      req.destroy(); // 拿到 header 即中止，不浪费带宽下载 manifest
      resolve(wwwAuth || null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// 请求 Registry Manifest → 返回 { statusCode, digest, wwwAuthenticate, error, body }
// 先用 HEAD 获取 digest（零下载）；非 200 时自动降级 GET 读取错误详情
function fetchRegistryManifest(registry, repo, tag, token) {
  const host = registry === 'registry-1.docker.io' ? 'registry-1.docker.io' : registry;
  const p = `/v2/${repo}/manifests/${encodeURIComponent(tag)}`;
  const headers = {
    'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const fullUrl = `https://${host}${p}`;
  log(`fetchRegistryManifest → HEAD ${fullUrl} token=${token ? 'yes' : 'no'}`);

  return new Promise((resolve) => {
    const reqStart = Date.now();
    const req = https.request({ hostname: host, path: p, method: 'HEAD', headers, timeout: 15000, rejectUnauthorized: true }, async (res) => {
      const digest = res.headers['docker-content-digest'];
      const wwwAuth = res.headers['www-authenticate'];
      const elapsed = Date.now() - reqStart;
      log(`fetchRegistryManifest → HEAD ${res.statusCode} (${elapsed}ms)`);

      // 成功：直接返回
      if (res.statusCode === 200) {
        return resolve({ statusCode: 200, digest: digest || null, wwwAuthenticate: wwwAuth || null, elapsed });
      }

      // 非 200：用 GET 获取响应体，解析 Registry 返回的错误详情
      getWithBody(host, p, headers).then(({ statusCode, body, wwwAuth: getWwwAuth }) => {
        if (body) logError(`fetchRegistryManifest → ${statusCode} 响应体: ${body}`);
        resolve({
          statusCode,
          digest: null,
          wwwAuthenticate: getWwwAuth || wwwAuth || null,
          body: body || null,
          elapsed,
        });
      });
    });
    req.on('error', (e) => {
      const code = e.code || '';
      if (code === 'ENOTFOUND') resolve({ statusCode: 0, digest: null, error: 'dns_error', message: e.message });
      else if (code.includes('CERT') || code.includes('SSL') || code.includes('TLS')) resolve({ statusCode: 0, digest: null, error: 'tls_error', message: e.message });
      else resolve({ statusCode: 0, digest: null, error: 'network_error', message: e.message });
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, digest: null, error: 'network_error', message: '请求超时' }); });
    req.end();
  });
}

// GET 请求并返回 body（用于错误诊断），同时保留 www-authenticate
function getWithBody(host, path, extraHeaders = {}) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path, method: 'GET',
      headers: { ...extraHeaders },
      timeout: 15000, rejectUnauthorized: true,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const wwwAuth = res.headers['www-authenticate'];
        resolve({ statusCode: res.statusCode, body: data.slice(0, 500) || null, wwwAuth: wwwAuth || null });
      });
    });
    req.on('error', () => resolve({ statusCode: 0, body: null }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, body: null }); });
    req.end();
  });
}

// ==================== 核心：检查容器更新 ====================
async function checkContainerUpdate(containerId) {
  log(`checkContainerUpdate → 开始: ${containerId}`);
  const stepStart = Date.now();

  // 1. 获取容器信息（保留 containerName 避免外层重复查询）
  let container, containerName;
  try {
    container = await dockerRequest('GET', `/containers/${containerId}/json`);
    containerName = (container.Name || '').replace(/^\//, '');
  } catch (e) {
    return { hasUpdate: false, status: 'container_error', imageName: '', containerName: '', error: e.message };
  }
  const imageName = container.Config?.Image;
  if (!imageName) return { hasUpdate: false, status: 'container_error', imageName: '', containerName, error: '无法获取镜像名' };
  log(`checkContainerUpdate → 镜像: ${imageName}`);

  // 2. 固定 digest 跳过
  if (imageName.includes('@sha256:')) {
    return { imageName, containerName, status: 'up_to_date', hasUpdate: false, message: '镜像已固定为 digest' };
  }

  // 3. 解析
  const parsed = parseImageName(imageName);
  if (!parsed) return { imageName, containerName, status: 'parse_error', hasUpdate: false, error: '无法解析镜像名' };
  log(`checkContainerUpdate → registry=${parsed.registry}, repo=${parsed.repo}, tag=${parsed.tag}`);

  // 4. 查结果缓存（6 小时内跳过远端查询）
  const cached = getCachedResult(parsed.registry, parsed.repo, parsed.tag);
  if (cached) {
    // 缓存命中，仍需获取本地 RepoDigests 比较
    const localRepoDigests = await getLocalRepoDigests(imageName);
    if (localRepoDigests.length === 0) {
      return { imageName, containerName, status: 'local_image', hasUpdate: false, message: '本地镜像，无法检测更新' };
    }
    const localDigest = localRepoDigests[0]?.split('@')[1] || null;
    const hasUpdate = !localRepoDigests.some(d => d.includes(cached.remoteDigest));
    log(`checkContainerUpdate → 缓存命中 hasUpdate=${hasUpdate} (${Date.now() - stepStart}ms)`);
    return { imageName, containerName, status: hasUpdate ? 'update_available' : 'up_to_date', hasUpdate, currentDigest: localDigest, remoteDigest: cached.remoteDigest, tag: parsed.tag, cached: true };
  }

  // 5. 本地 RepoDigests
  const localRepoDigests = await getLocalRepoDigests(imageName);
  if (localRepoDigests.length === 0) {
    return { imageName, containerName, status: 'local_image', hasUpdate: false, message: '本地镜像，无法检测更新' };
  }
  const localDigest = localRepoDigests[0]?.split('@')[1] || null;

  // 6. 远端 manifest（通用 OAuth2 token 流程，支持 Docker Hub / GHCR / 自建 Registry）
  let remoteResult, token;
  const registryLabel = parsed.registry === 'registry-1.docker.io' ? 'Docker Hub' : parsed.registry;
  try {
    token = await getRegistryToken(parsed.registry, parsed.repo);
    remoteResult = await fetchRegistryManifest(parsed.registry, parsed.repo, parsed.tag, token);

    // 重试策略：manifest 返回 401/404 时，尝试获取/刷新 token
    // 场景 1）无 token + 401/404 → 多路径获取 token
    // 场景 2）有 token + 404 → token 可能无效，尝试无 token 请求或重新获取 token
    if (remoteResult.statusCode === 401 || remoteResult.statusCode === 404) {
      const shouldRetry = !token || remoteResult.statusCode === 404;
      if (shouldRetry) {
        log(`checkContainerUpdate → ${registryLabel} 返回 ${remoteResult.statusCode}，尝试补获/刷新 token 重试`);
        // 多路径尝试获取 WWW-Authenticate
        const wwwAuth = remoteResult.wwwAuthenticate
          || await getAuthFromManifest(parsed.registry, parsed.repo, parsed.tag)
          || await getV2WwwAuth(parsed.registry);
        if (wwwAuth) {
          const newToken = await getTokenFromWwwAuth(parsed.registry, parsed.repo, wwwAuth);
          if (newToken && newToken !== token) {
            log(`checkContainerUpdate → 已获取 token，重试 manifest`);
            remoteResult = await fetchRegistryManifest(parsed.registry, parsed.repo, parsed.tag, newToken);
          }
        }
      }
    }
  } catch (e) {
    logError(`checkContainerUpdate → Registry 连接失败: ${e.message}`);
    return { imageName, containerName, status: 'network_error', hasUpdate: false, currentDigest: localDigest, error: `无法连接 Registry: ${e.message}` };
  }

  // 7. 处理结果
  if (remoteResult.error) {
    return { imageName, containerName, status: remoteResult.error, hasUpdate: false, currentDigest: localDigest, error: remoteResult.message };
  }

  switch (remoteResult.statusCode) {
    case 200:
      if (!remoteResult.digest) {
        return { imageName, containerName, status: 'manifest_error', hasUpdate: false, currentDigest: localDigest, error: '未返回 digest' };
      }
      // 缓存成功的远端 digest
      setCachedResult(parsed.registry, parsed.repo, parsed.tag, { remoteDigest: remoteResult.digest });
      const hasUpdate = !localRepoDigests.some(d => d.includes(remoteResult.digest));
      log(`checkContainerUpdate → 本地=${localDigest?.slice(0, 19)} 远端=${remoteResult.digest.slice(0, 19)} hasUpdate=${hasUpdate} (${Date.now() - stepStart}ms)`);
      return {
        imageName, containerName, status: hasUpdate ? 'update_available' : 'up_to_date', hasUpdate,
        currentDigest: localDigest, remoteDigest: remoteResult.digest, tag: parsed.tag,
      };
    case 404: return { imageName, containerName, status: 'image_not_found', hasUpdate: false, currentDigest: localDigest, error: '镜像或 Tag 不存在' };
    case 401: return { imageName, containerName, status: 'auth_required', hasUpdate: false, currentDigest: localDigest, error: '需要仓库认证' };
    case 429: return { imageName, containerName, status: 'rate_limited', hasUpdate: false, currentDigest: localDigest, error: '请求过于频繁' };
    default:  return { imageName, containerName, status: 'registry_error', hasUpdate: false, currentDigest: localDigest, error: `Registry 返回 ${remoteResult.statusCode}` };
  }
}

// ==================== 流式更新处理（仅 Compose） ====================

async function handleUpdateStream(req, res) {
  const requestStart = Date.now();
  const { containers, projectName } = req.body;
  log(`========== handleUpdateStream 开始 project=${projectName || 'N/A'} containers=${containers?.length} ==========`);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });

  if (!containers?.length || !projectName) {
    sendProgress(res, { type: 'all-error', message: !projectName ? '仅支持 Compose 项目更新' : '缺少容器列表' });
    return res.end();
  }

  const timeoutId = setTimeout(() => { sendProgress(res, { type: 'all-error', message: '更新超时' }); res.end(); }, 10 * 60 * 1000);
  try { await updateComposeServices(containers, projectName, res); }
  catch (e) { sendProgress(res, { type: 'all-error', message: e.message }); }
  clearTimeout(timeoutId);
  res.end();
  log(`========== handleUpdateStream 结束 ${Date.now() - requestStart}ms ==========`);
}

async function updateComposeServices(containers, projectName, res) {
  const startTime = Date.now();
  const projectDir = safePath(projectName);
  if (!await exists(projectDir)) { sendProgress(res, { type: 'all-error', message: `项目 ${projectName} 不存在` }); return; }
  const composeFile = findComposeFile(projectDir);
  if (!composeFile) { sendProgress(res, { type: 'all-error', message: '找不到 compose 文件' }); return; }
  const composeBaseArgs = ['compose', '-f', composeFile];

  // 按 compose service 分组
  // 优先级：
  //   1. 前端传入的 composeService（来自 label）
  //   2. docker inspect 读取 Config.Labels['com.docker.compose.service']
  // 绝不再通过容器名称推导（container_name 会破坏推导）
  const serviceMap = new Map();
  for (const c of containers) {
    let svcName = c.composeService;
    if (!svcName && c.containerId) {
      try {
        const containerInfo = await dockerRequest('GET', `/containers/${c.containerId}/json`);
        svcName = containerInfo.Config?.Labels?.['com.docker.compose.service'];
        if (svcName) {
          log(`[label 获取] ${c.containerName} → compose service = ${svcName}`);
        }
      } catch (e) {
        logError(`无法 inspect ${c.containerName}: ${e.message}`);
      }
    }
    if (!svcName) {
      logError(`无法获取 ${c.containerName} 的 compose service，跳过该容器`);
      sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: 'error', message: `无法识别 Compose Service: ${c.containerName}`, percent: 0 });
      continue;
    }
    if (!serviceMap.has(svcName)) serviceMap.set(svcName, []);
    serviceMap.get(svcName).push(c);
  }
  const serviceNames = [...serviceMap.keys()];
  let done = 0;
  const selfId = getSelfContainerId()?.slice(0, 12); // 自身容器短 ID

  for (const svcName of serviceNames) {
    const svcContainers = serviceMap.get(svcName);

    // 自身保护：不更新包含自己的 service（重建会中断 API）
    if (selfId && svcContainers.some(c => (c.containerId || '').slice(0, 12) === selfId)) {
      log(`[自我保护] 跳过 ${svcName}（包含自身容器 ${selfId}）`);
      for (const c of svcContainers) sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: 'skipped', message: '自身容器，需手动更新', percent: Math.round(((done + 1) / serviceNames.length) * 100) });
      done++;
      continue;
    }

    for (const c of svcContainers) sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: 'pulling', message: `拉取 ${svcName}...`, percent: Math.round((done / serviceNames.length) * 100) });
    const pc = await runCommand('docker', [...composeBaseArgs, 'pull', svcName], projectDir, res, svcName);
    if (pc !== 0) { for (const c of svcContainers) sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: 'error', message: `${svcName} pull 失败`, percent: Math.round((done / serviceNames.length) * 100) }); done++; continue; }
    for (const c of svcContainers) sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: 'recreating', message: `重建 ${svcName}...`, percent: Math.round(((done + 0.5) / serviceNames.length) * 100) });
    const uc = await runCommand('docker', [...composeBaseArgs, 'up', '-d', '--no-deps', svcName], projectDir, res, svcName);
    for (const c of svcContainers) sendProgress(res, { type: 'step', container: c.containerId, containerName: c.containerName, step: uc === 0 ? 'done' : 'error', message: uc === 0 ? `${svcName} 完成` : `${svcName} 失败`, percent: Math.round(((done + 1) / serviceNames.length) * 100) });
    done++;
  }
  sendProgress(res, { type: 'all-done', message: '所有服务更新完成', percent: 100 });
  log(`── updateComposeServices 结束 ${Date.now() - startTime}ms ──`);
}

// ==================== API 处理函数 ====================

async function handleCheckUpdate(req, res) {
  const { id } = req.params;
  const startTime = Date.now();
  log(`handleCheckUpdate → ${id}`);
  try {
    const result = await checkContainerUpdate(id); // 已包含 containerName
    const response = { containerId: id, containerName: result.containerName || id, ...result };
    log(`handleCheckUpdate → 完成 (${Date.now() - startTime}ms) status=${result.status}${result.cached ? ' (cached)' : ''}`);
    res.json(response);
  } catch (e) { logError(`handleCheckUpdate → ${e.message}`); res.status(500).json({ error: e.message }); }
}

async function handleCheckAllUpdates(req, res) {
  const startTime = Date.now();
  log(`handleCheckAllUpdates → 开始`);
  try {
    const all = await dockerRequest('GET', '/containers/json?all=true');
    const running = all.filter(c => c.State === 'running');
    if (!running.length) return res.json({ results: [], summary: { total: 0, hasUpdate: 0 } });
    const toCheck = running.slice(0, 10);
    const results = [];
    for (const c of toCheck) {
      try {
        const r = await checkContainerUpdate(c.Id);
        results.push({ containerId: c.Id, containerName: (c.Names?.[0] || '').replace(/^\//, ''), ...r });
      } catch (e) { results.push({ containerId: c.Id, containerName: (c.Names?.[0] || '').replace(/^\//, ''), error: e.message, hasUpdate: false }); }
    }
    const skipped = Math.max(0, running.length - 10);
    const summary = { total: results.length, hasUpdate: results.filter(r => r.hasUpdate).length, checked: toCheck.length, skipped };
    if (skipped > 0) {
      summary.message = `共有 ${running.length} 个运行中容器，为避免频繁请求，本次仅检查前 10 个，还有 ${skipped} 个未检查`;
    }
    log(`handleCheckAllUpdates → 完成 (${Date.now() - startTime}ms) 可更新: ${summary.hasUpdate}/${summary.total}`);
    res.json({ results, summary });
  } catch (e) { logError(`handleCheckAllUpdates → ${e.message}`); res.status(500).json({ error: e.message }); }
}

module.exports = { handleUpdateStream, handleCheckUpdate, handleCheckAllUpdates, checkContainerUpdate };
