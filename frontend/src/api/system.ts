import client from './client'
import type { SystemMetrics } from '../types'

// 系统启动/运行信息
export interface ServerInfo {
  version: string
  port: number
  projectsDir: string
  dockerSocket: string
  relativePathSupported: boolean
  jwtConfigured: boolean
  nodeVersion: string
  platform: string
  arch: string
}

export async function fetchServerInfo(): Promise<ServerInfo> {
  const { data } = await client.get('/api/system/info')
  return data
}

// 系统指标（CPU / 内存 / 磁盘 / 网络 / 容器统计）
export async function fetchSystemMetrics(): Promise<SystemMetrics> {
  const { data } = await client.get('/api/system/metrics')
  return data
}

// 自身容器 ID
export async function fetchSelfContainerId(): Promise<string> {
  const { data } = await client.get('/api/self')
  return data.containerId
}
