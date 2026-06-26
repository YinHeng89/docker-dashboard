import { useState, useEffect, useCallback } from 'react'
import { fetchDockerInfo } from '../api/docker'
import { fetchSystemMetrics } from '../api/system'
import client from '../api/client'
import type { SystemInfo } from '../types'

export function useSystemInfo() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [{ data, apiVersion }, selfRes, metrics] = await Promise.all([
        fetchDockerInfo(),
        client.get('/api/self').catch(() => ({ data: {} })),
        fetchSystemMetrics().catch(() => null),
      ])

      setInfo({
        dockerVersion: data.ServerVersion || '-',
        sdkVersion: apiVersion || '-',
        os: data.OperatingSystem || '-',
        arch: data.Architecture || '-',
        cpus: data.NCPU || 0,
        memoryGB: data.MemTotal ? +(data.MemTotal / 1024 / 1024 / 1024).toFixed(1) : 0,
        driver: data.Driver || '-',
        dockerRoot: data.DockerRootDir || '-',
        hostname: data.Name || '-',
        kernel: data.KernelVersion || '-',
        cgroupDriver: data.CgroupDriver || '-',
        loggingDriver: data.LoggingDriver || '-',
        dockerHost: selfRes.data?.dockerHost || 'unix:///var/run/docker.sock',
        uptime: formatUptime(metrics?.systemUptime ?? 0),
      })
    } catch {
      // 保持 null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => clearInterval(timer)
  }, [refresh])

  return { info, loading, refresh }
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '-'
  const isZh = (localStorage.getItem('lang') || 'zh') === 'zh'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return isZh ? `${days} 天 ${hours} 小时` : `${days}d ${hours}h`
  if (hours > 0) return isZh ? `${hours} 小时 ${minutes} 分钟` : `${hours}h ${minutes}m`
  return isZh ? `${minutes} 分钟` : `${minutes}m`
}
