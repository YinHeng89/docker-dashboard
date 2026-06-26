// ========== 类型定义 ==========
import type React from 'react'

export type ServiceStatus = 'running' | 'stopped' | 'error' | 'warning'

export interface Container {
  id: string
  name: string
  status: ServiceStatus
  cpu: number
  memory: number
  memoryUnit: string
  uptime: string
  ports?: { private: number; public?: number; type: string }[]
}

export interface Service {
  id: string
  name: string
  description: string
  group: string
  status: ServiceStatus
  containers: Container[]
  containerCount: number
  totalCpu: number
  totalMemory: number
  memoryUnit: string
  totalMemoryPercent?: number
  uptime: string
  favorites?: boolean
}

export interface Alert {
  id: string
  serviceName: string
  type: 'error' | 'warning'
  message: string
  timestamp: string
}

export interface SystemMetrics {
  cpu: number
  cpuCores: number
  memory: number
  memoryUsed: number
  memoryTotal: number
  // 宿主机磁盘（与 df -h 一致）
  disk: number
  diskTotalGB: number
  diskUsedGB: number
  diskRead: number
  diskWrite: number
  // Docker 磁盘占用（向后兼容）
  diskDockerGB: number
  diskSystemTotalGB: number
  diskImagesGB: number
  diskContainersGB: number
  diskVolumesGB: number
  // 宿主机网络（与 iftop/nload 一致）
  netDown: number
  netUp: number
  // 系统负载
  load1: number
  load5: number
  load15: number
  // 容器级指标（容器ID → {cpu, memory}）
  containerMetrics: Record<string, { cpu: number; memory: number; memoryPercent?: number }>
  containersTotal: number
  containersRunning: number
  containersWarning: number
  containersStopped: number
  systemUptime: number
}

export interface SystemInfo {
  dockerVersion: string
  sdkVersion: string
  os: string
  arch: string
  cpus: number
  memoryGB: number
  driver: string
  dockerRoot: string
  hostname: string
  kernel: string
  cgroupDriver: string
  loggingDriver: string
  dockerHost: string
  uptime: string
}

export interface ChartPoint {
  time: string
  value: number
}

export type NavItem = {
  id: string
  label: string
  icon: string
  badge?: number
}

// ========== 容器详情相关类型（Docker inspect 返回） ==========

export interface ContainerPort {
  IP?: string
  PrivatePort: number
  PublicPort?: number
  Type: string
}

export interface ContainerMount {
  Type: string
  Name?: string
  Source: string
  Destination: string
  Mode: string
  RW: boolean
}

export interface ContainerNetwork {
  NetworkID: string
  IPAddress: string
  Gateway: string
  MacAddress: string
  Aliases?: string[]
}

export interface ContainerDetail {
  Id: string
  Name: string
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    StartedAt: string
    FinishedAt: string
    ExitCode: number
    Error: string
  }
  Image: string
  Config: {
    Hostname: string
    Env: string[]
    Cmd: string[]
    Entrypoint: string[]
    ExposedPorts: Record<string, {}>
    Labels: Record<string, string>
    WorkingDir: string
    User: string
    Tty: boolean
  }
  NetworkSettings: {
    IPAddress: string
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>
    Networks: Record<string, ContainerNetwork>
  }
  Mounts: ContainerMount[]
  HostConfig: {
    RestartPolicy: { Name: string; MaximumRetryCount: number }
    Memory: number
    MemorySwap: number
    CpuShares: number
    NanoCpus: number
    Privileged: boolean
    NetworkMode: string
    PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>
    Binds: string[]
    AutoRemove: boolean
  }
  Created: string
  Platform: string
  SizeRw?: number
  SizeRootFs?: number
}

export interface ContainerStats {
  id: string
  name: string
  cpu_percent: number
  memory_percent: number
  memory_usage: number
  memory_limit: number
  network_rx: number
  network_tx: number
  block_read: number
  block_write: number
  pids: number
}

// ========== 容器分组相关 ==========

export interface ContainerGroup {
  name: string
  icon: React.ReactNode
  containers: ContainerDetailSummary[]
  status: ServiceStatus
  containerCount: number
}

// ========== 工作区分组（持久化） ==========

export interface WorkspaceGroup {
  id: string
  name: string
  sortOrder: number
  isBuiltin: boolean
  showOnDashboard: boolean
}

export interface GroupsData {
  groups: WorkspaceGroup[]
  mappings: Record<string, string>  // container_key → group_id
}

export interface WorkspaceGroupedContainers {
  groupId: string
  groupName: string
  sortOrder: number
  isBuiltin: boolean
  projectGroups: ContainerGroup[]
  totalContainers: number
  runningCount: number
  stoppedCount: number
  warningCount: number
  errorCount: number
}

export interface ContainerDetailSummary {
  id: string
  shortId: string
  name: string
  image: string
  status: ServiceStatus
  state: string
  uptime: string
  ports: { private: number; public?: number; type: string }[]
  cpu: number
  memory: number
  memoryUnit: string
  memoryPercent?: number
  project?: string
  created: string
  labels: Record<string, string>
}

// ========== 镜像管理 ==========

export interface ImageSummary {
  Id: string
  RepoTags: string[]
  RepoDigests: string[]
  Created: number
  Size: number
  SharedSize: number
  VirtualSize: number
  Containers: number
  Labels?: Record<string, string>
}

// ========== 网络管理 ==========

export interface NetworkSummary {
  Id: string
  Name: string
  Driver: string
  Scope: string
  Internal: boolean
  Attachable: boolean
  Ingress: boolean
  IPAM?: {
    Driver: string
    Config: Array<{ Subnet?: string; Gateway?: string; IPRange?: string }>
  }
  Containers?: Record<string, { Name: string; EndpointID: string; MacAddress: string; IPv4Address: string; IPv6Address: string }>
  Labels?: Record<string, string>
  Created: string
}

// ========== 存储卷管理 ==========

export interface VolumeSummary {
  Name: string
  Driver: string
  Mountpoint: string
  Scope: string
  CreatedAt: string
  Labels?: Record<string, string>
  UsageData?: {
    Size: number
    RefCount: number
  }
}

// ========== 监控告警 ==========

export interface MetricsHistory {
  timestamps: string[]
  cpu: number[]
  memory: number[]
  disk: number[]
  netDown: number[]
  netUp: number[]
}

export interface AlertRule {
  id: string
  name: string
  type: 'cpu' | 'memory' | 'disk' | 'container_down'
  threshold: number
  enabled: boolean
}

// ========== 系统设置 ==========

export interface UserPreferences {
  language: string
  theme: 'dark' | 'light'
  refreshInterval: number
  alertsEnabled: boolean
  cmdHistory: string[]
}

// ========== 容器更新检查 ==========

export type UpdateStatus =
  | 'up_to_date'
  | 'update_available'
  | 'checking'
  | 'local_image'
  | 'image_not_found'
  | 'auth_required'
  | 'rate_limited'
  | 'network_error'
  | 'tls_error'
  | 'manifest_error'
  | 'registry_unsupported'
  | 'registry_error'
  | 'parse_error'
  | 'container_error'

export interface ContainerUpdateResult {
  containerId?: string
  containerName?: string
  imageName: string
  currentDigest?: string
  remoteDigest?: string | null
  hasUpdate: boolean
  status?: UpdateStatus
  tag?: string
  registry?: string
  repo?: string
  error?: string
  message?: string
}

export interface BatchUpdateResult {
  results: ContainerUpdateResult[]
  summary: {
    total: number
    hasUpdate: number
    checked: number
    skipped: number
    message?: string
  }
}

export interface UpdateResult {
  success: boolean
  oldId: string
  newId: string
  name: string
  image: string
}
