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

// ==================== 流式单容器更新 ====================
async function handleUpdateStream(req, res) {
  const { id } = req.params;
  console.log(`[UpdateStream] 开始更新容器 ${id.slice(0, 12)}`);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const send = (data) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(data) + '\n');
  };

  try {
    // Step 1: 获取旧容器详情
    send({ type: 'progress', percent: 5, message: '正在获取容器配置...' });
    const old = await dockerRequest('GET', `/containers/${id}/json`);
    const imageName = old.Config?.Image;
    const containerName = old.Name?.replace(/^\//, '');
    if (!imageName || !containerName) throw new Error('无法获取容器配置');
    console.log(`[UpdateStream] 容器 ${containerName}, 镜像 ${imageName}`);

    // Step 2: 拉取最新镜像
    send({ type: 'progress', percent: 10, message: `正在拉取镜像 ${imageName}...` });
    console.log(`[UpdateStream] 开始拉取镜像 ${imageName}`);

    const pullPromise = dockerRequestStream('POST', `/images/create?fromImage=${encodeURIComponent(imageName)}`, (line) => {
      send({ type: 'log', stream: 'stdout', message: line });
    });
    await pullPromise;
    send({ type: 'progress', percent: 50, message: '镜像拉取完成' });
    console.log(`[UpdateStream] 镜像拉取完成`);

    // Step 3: 停止并删除旧容器
    send({ type: 'progress', percent: 55, message: '正在停止旧容器...' });
    try { await dockerRequest('POST', `/containers/${id}/stop`); } catch (_) {
      send({ type: 'log', stream: 'stderr', message: '停止容器时出错（可能已停止）' });
    }
    await new Promise(r => setTimeout(r, 1000));
    send({ type: 'progress', percent: 60, message: '正在删除旧容器...' });
    await dockerRequest('DELETE', `/containers/${id}?force=true`);
    console.log(`[UpdateStream] 旧容器已删除`);

    // Step 4: 提取重建配置
    send({ type: 'progress', percent: 65, message: '正在重建容器配置...' });
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
    if (old.Mounts && old.Mounts.length > 0) {
      createConfig.HostConfig.Mounts = old.Mounts.map(m => ({
        Type: m.Type, Source: m.Source, Target: m.Destination, ReadOnly: !m.RW,
        ...(m.Type === 'bind' ? { BindOptions: m.BindOptions } : {}),
        ...(m.Type === 'volume' ? { VolumeOptions: m.VolumeOptions } : {}),
      }));
    }

    // Step 5: 创建新容器
    send({ type: 'progress', percent: 75, message: '正在创建新容器...' });
    const createResult = await dockerRequest('POST', `/containers/create?name=${encodeURIComponent(containerName)}`, createConfig);
    const newId = createResult.Id;
    if (!newId) throw new Error('创建容器失败：未返回 ID');
    send({ type: 'log', stream: 'stdout', message: `新容器 ID: ${newId.slice(0, 12)}` });
    console.log(`[UpdateStream] 新容器已创建 ${newId.slice(0, 12)}`);

    // Step 6: 连接自定义网络
    send({ type: 'progress', percent: 85, message: '正在连接网络...' });
    for (const [netName, netConfig] of Object.entries(networks)) {
      if (['bridge', 'host', 'none'].includes(netName)) continue;
      try {
        await dockerRequest('POST', `/networks/${netConfig.NetworkID || netName}/connect`, { Container: newId });
        send({ type: 'log', stream: 'stdout', message: `已连接网络: ${netName}` });
      } catch (e) {
        console.warn(`[UpdateStream] 连接网络 ${netName} 失败:`, e.message);
        send({ type: 'log', stream: 'stderr', message: `连接网络 ${netName} 失败: ${e.message}` });
      }
    }

    // Step 7: 启动新容器
    send({ type: 'progress', percent: 90, message: '正在启动新容器...' });
    await dockerRequest('POST', `/containers/${newId}/start`);
    send({ type: 'log', stream: 'stdout', message: '容器已启动' });
    console.log(`[UpdateStream] 更新完成`);

    send({ type: 'progress', percent: 100, message: '更新完成' });
    send({ type: 'all-done', oldId: id, newId, name: containerName, image: imageName });
  } catch (e) {
    console.error(`[UpdateStream] 更新失败: ${e.message}`);
    send({ type: 'all-error', message: e.message });
  }

  res.end();
}

// ==================== dockerRequestStream（流式，逐行回调） ====================
function dockerRequestStream(method, path, onLine) {
  return new Promise((resolve, reject) => {
    const req = require('http').request({
      socketPath: '/var/run/docker.sock',
      method, path,
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { reject(new Error(JSON.parse(body).message || `HTTP ${res.statusCode}`)); }
          catch { reject(new Error(`Docker API 返回 ${res.statusCode}`)); }
        });
        return;
      }
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            // 提取有意义的进度信息
            if (msg.status) {
              const detail = msg.progress ? `${msg.status} ${msg.progress}` : msg.status;
              if (msg.id) onLine(`[${msg.id}] ${detail}`);
              else onLine(detail);
            } else if (msg.error) {
              onLine(`⚠️ ${msg.error}`);
            }
          } catch { /* skip non-JSON lines */ }
        }
      });
      res.on('end', () => {
        // 处理残余 buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer);
            if (msg.status) onLine(msg.status);
          } catch { /* skip */ }
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Docker API 超时')); });
    req.end();
  });
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

module.exports = { handleUpdate, handleUpdateStream };
