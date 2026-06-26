// ==================== 容器镜像更新重建 API ====================
// 注意：镜像更新检测逻辑已统一到 routes/update.js，本文件仅保留容器重建功能
const http = require('http');

// ---------- Docker socket 请求封装 ----------
function dockerRequest(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: pathStr,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            return reject(new Error(parsed.message || `Docker API 错误 (${res.statusCode})`));
          }
          resolve(parsed);
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Docker socket 超时')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------- 更新容器：拉取 + 重建（保留原配置） ----------
// 仅用于非 Compose 独立容器；Compose 容器请走 /api/update/stream
async function updateContainer(containerId) {
  // 1. 获取旧容器详情
  const old = await dockerRequest('GET', `/containers/${containerId}/json`);

  const imageName = old.Config?.Image;
  const containerName = old.Name?.replace(/^\//, '');
  if (!imageName || !containerName) throw new Error('无法获取容器配置');

  // 2. 拉取最新镜像
  await dockerRequest('POST', `/images/create?fromImage=${encodeURIComponent(imageName)}`);

  // 3. 停止并删除旧容器（有 restart policy 的容器 stop 后不会自动拉起）
  try { await dockerRequest('POST', `/containers/${containerId}/stop`); } catch (_) {}
  await new Promise(r => setTimeout(r, 1000));
  await dockerRequest('DELETE', `/containers/${containerId}?force=true`);

  // 4. 提取重建配置
  const hostConfig = old.HostConfig || {};
  const networks = old.NetworkSettings?.Networks || {};
  const networkMode = hostConfig.NetworkMode || Object.keys(networks)[0] || 'bridge';

  const createConfig = {
    Image: imageName,
    Cmd: old.Config?.Cmd,
    Entrypoint: old.Config?.Entrypoint,
    Env: old.Config?.Env,
    WorkingDir: old.Config?.WorkingDir,
    User: old.Config?.User,
    Tty: old.Config?.Tty,
    OpenStdin: old.Config?.OpenStdin,
    ExposedPorts: old.Config?.ExposedPorts,
    Labels: old.Config?.Labels,
    HostConfig: {
      NetworkMode: networkMode,
      RestartPolicy: hostConfig.RestartPolicy || { Name: 'no' },
      PortBindings: hostConfig.PortBindings,
      Binds: hostConfig.Binds,
      Memory: hostConfig.Memory,
      MemorySwap: hostConfig.MemorySwap,
      CpuShares: hostConfig.CpuShares,
      NanoCpus: hostConfig.NanoCpus,
      Privileged: hostConfig.Privileged,
      AutoRemove: hostConfig.AutoRemove,
      ExtraHosts: hostConfig.ExtraHosts,
      Dns: hostConfig.Dns,
      VolumesFrom: hostConfig.VolumesFrom,
      CapAdd: hostConfig.CapAdd,
      CapDrop: hostConfig.CapDrop,
      Sysctls: hostConfig.Sysctls,
    },
  };

  // 转发 mounts
  if (old.Mounts && old.Mounts.length > 0) {
    createConfig.HostConfig.Mounts = old.Mounts.map(m => ({
      Type: m.Type,
      Source: m.Source,
      Target: m.Destination,
      ReadOnly: !m.RW,
      ...(m.Type === 'bind' ? { BindOptions: m.BindOptions } : {}),
      ...(m.Type === 'volume' ? { VolumeOptions: m.VolumeOptions } : {}),
    }));
  }

  // 5. 创建新容器（旧容器已删，端口安全）
  const createResult = await dockerRequest(
    'POST',
    `/containers/create?name=${encodeURIComponent(containerName)}`,
    createConfig
  );

  const newId = createResult.Id;
  if (!newId) throw new Error('创建容器失败：未返回 ID');

  // 6. 连接自定义网络
  for (const [netName, netConfig] of Object.entries(networks)) {
    if (['bridge', 'host', 'none'].includes(netName)) continue;
    try {
      await dockerRequest('POST', `/networks/${netConfig.NetworkID || netName}/connect`, { Container: newId });
    } catch (e) {
      console.warn(`[更新] 连接网络 ${netName} 失败:`, e.message);
    }
  }

  // 7. 启动
  await dockerRequest('POST', `/containers/${newId}/start`);

  return { oldId: containerId, newId, name: containerName, image: imageName };
}

// ==================== 导出路由处理函数 ====================
async function handleUpdate(req, res) {
  try {
    const { id } = req.params;
    const result = await updateContainer(id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { handleUpdate };
