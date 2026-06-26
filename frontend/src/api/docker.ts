import client from './client'

// Docker 容器列表
export async function fetchContainers() {
  const { data } = await client.get('/docker/containers/json?all=true')
  return data
}

// Docker 系统信息
export async function fetchDockerInfo(): Promise<{ data: any; apiVersion: string }> {
  const res = await client.get('/docker/info')
  return { data: res.data, apiVersion: res.headers?.['api-version'] || res.headers?.['Api-Version'] || '-' }
}

// Docker 磁盘占用
export async function fetchDockerSystemDf() {
  const { data } = await client.get('/docker/system/df')
  return data
}

// 容器详情
export async function fetchContainer(id: string) {
  const { data } = await client.get(`/docker/containers/${id}/json`)
  return data
}

// 重启容器
export async function restartContainer(id: string) {
  await client.post(`/docker/containers/${id}/restart`)
}

// 停止容器
export async function stopContainer(id: string) {
  await client.post(`/docker/containers/${id}/stop`)
}

// 启动容器
export async function startContainer(id: string) {
  await client.post(`/docker/containers/${id}/start`)
}

// 镜像列表
export async function fetchImages() {
  const { data } = await client.get('/docker/images/json')
  return data
}

// 卷列表
export async function fetchVolumes() {
  const { data } = await client.get('/docker/volumes')
  return data
}

// 删除容器
export async function removeContainer(id: string) {
  await client.delete(`/docker/containers/${id}?force=true`)
}

// 容器日志
export async function fetchContainerLogs(id: string, tail = 200) {
  const { data } = await client.get(`/docker/containers/${id}/logs?stdout=true&stderr=true&tail=${tail}`, {
    responseType: 'arraybuffer',
  })
  return data
}

// 网络列表
export async function fetchNetworks() {
  const { data } = await client.get('/docker/networks')
  return data
}

// 网络详情（获取完整容器关联信息）
export async function fetchNetworkDetail(id: string) {
  const { data } = await client.get(`/docker/networks/${id}`)
  return data
}

// 暂停容器
export async function pauseContainer(id: string) {
  await client.post(`/docker/containers/${id}/pause`)
}

// 恢复容器
export async function unpauseContainer(id: string) {
  await client.post(`/docker/containers/${id}/unpause`)
}

// 终止容器 (kill)
export async function killContainer(id: string) {
  await client.post(`/docker/containers/${id}/kill`)
}

// 获取容器进程列表
export async function fetchContainerProcesses(id: string) {
  const { data } = await client.get(`/docker/containers/${id}/top`)
  return data
}

// 获取容器实时 stats（一次性）
export async function fetchContainerStats(id: string) {
  const { data } = await client.get(`/docker/containers/${id}/stats?stream=false`)
  return data
}

// 重命名容器
export async function renameContainer(id: string, name: string) {
  await client.post(`/docker/containers/${id}/rename?name=${encodeURIComponent(name)}`)
}

// ========== 镜像操作 ==========

// 删除镜像
export async function removeImage(id: string, force = false) {
  await client.delete(`/docker/images/${encodeURIComponent(id)}?force=${force}`)
}

// 拉取镜像（非流式，简单拉取）
export async function pullImage(name: string) {
  const { data } = await client.post('/docker/images/create', null, {
    params: { fromImage: name },
  })
  return data
}

// 清理镜像（默认仅悬空；allUnused=true 清理所有未使用镜像）
export async function pruneImages(allUnused = false) {
  const { data } = await client.post('/docker/images/prune', null, {
    params: allUnused ? { filters: '{"dangling":["false"]}' } : undefined,
  })
  return data
}

// 镜像历史
export async function fetchImageHistory(id: string) {
  const { data } = await client.get(`/docker/images/${encodeURIComponent(id)}/history`)
  return data
}

// ========== 网络操作 ==========

// 创建网络（将 Subnet/Gateway 包装为 Docker IPAM 格式）
export async function createNetwork(config: {
  Name: string
  Driver?: string
  Subnet?: string
  Gateway?: string
  Internal?: boolean
  Attachable?: boolean
  Labels?: Record<string, string>
}) {
  const body: Record<string, unknown> = {
    Name: config.Name,
    Driver: config.Driver || 'bridge',
    Internal: config.Internal || false,
    Attachable: config.Attachable || false,
  }
  if (config.Labels) body.Labels = config.Labels
  if (config.Subnet || config.Gateway) {
    body.IPAM = {
      Driver: 'default',
      Config: [{
        Subnet: config.Subnet || undefined,
        Gateway: config.Gateway || undefined,
      }],
    }
  }
  const { data } = await client.post('/docker/networks/create', body)
  return data
}

// 删除网络
export async function removeNetwork(id: string) {
  await client.delete(`/docker/networks/${id}`)
}

// 清理未使用网络
export async function pruneNetworks() {
  const { data } = await client.post('/docker/networks/prune')
  return data
}

// 连接容器到网络
export async function connectToNetwork(networkId: string, containerId: string) {
  await client.post(`/docker/networks/${networkId}/connect`, { Container: containerId })
}

// 断开容器从网络
export async function disconnectFromNetwork(networkId: string, containerId: string) {
  await client.post(`/docker/networks/${networkId}/disconnect`, { Container: containerId })
}

// ========== 卷操作 ==========

// 创建卷
export async function createVolume(config: {
  Name: string
  Driver?: string
  DriverOpts?: Record<string, string>
  Labels?: Record<string, string>
}) {
  const { data } = await client.post('/docker/volumes/create', config)
  return data
}

// 删除卷
export async function removeVolume(name: string, force = false) {
  await client.delete(`/docker/volumes/${encodeURIComponent(name)}?force=${force}`)
}

// 清理未使用卷
export async function pruneVolumes() {
  const { data } = await client.post('/docker/volumes/prune')
  return data
}

// ========== 容器更新检查 & 重建 ==========

// 检查单个容器镜像更新
export async function checkContainerUpdate(id: string) {
  const { data } = await client.get(`/api/containers/${id}/check-update`)
  return data
}

// 批量检查所有运行中容器
export async function checkAllContainerUpdates() {
  const { data } = await client.get('/api/containers/check-updates')
  return data
}

// 更新容器（拉取 + 重建）
export async function updateContainer(id: string) {
  const { data } = await client.post(`/api/containers/${id}/update`)
  return data
}
