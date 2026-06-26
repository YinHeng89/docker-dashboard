import { useState, useEffect, useCallback } from 'react'
import { fetchContainers } from '../api/docker'
import { connectLive } from '../api/ws'
import type { Service, ServiceStatus, Container } from '../types'

// Docker 容器 → Container 模型
function toContainer(c: DockerContainer): Container {
  return {
    id: c.Id?.slice(0, 12) || c.Id,
    name: cleanName(c.Names?.[0] || 'unknown'),
    status: mapStatus(c.State, c.Ports),
    cpu: 0,
    memory: 0,
    memoryUnit: 'MB',
    uptime: parseUptime(c.Status),
  }
}

// Docker 容器 JSON → Service 映射
function mapDockerContainers(rawList: DockerContainer[]): Service[] {
  const groupMap = new Map<string, DockerContainer[]>()

  for (const c of rawList) {
    const project = c.Labels?.['com.docker.compose.project'] || '_standalone'
    const arr = groupMap.get(project) ?? []
    arr.push(c)
    groupMap.set(project, arr)
  }

  const services: Service[] = []

  for (const [group, containers] of groupMap) {
    // 独立容器：每个容器单独一张卡片
    if (group === '_standalone') {
      for (const c of containers) {
        services.push({
          id: c.Id?.slice(0, 12) || c.Id,
          name: cleanName(c.Names?.[0] || 'unknown'),
          description: c.Image || '',
          group: '基础服务',
          status: mapStatus(c.State, c.Ports),
          containers: [toContainer(c)],
          containerCount: 1,
          totalCpu: estimateCpu(c),
          totalMemory: estimateMem(c),
          memoryUnit: estimateMem(c) > 1024 ? 'GB' : 'MB',
          uptime: parseUptime(c.Status),
          favorites: false,
        })
      }
    } else {
      // compose 项目（单容器或多容器都统一用项目名作 ID）
      const totalCpu = containers.reduce((s, c) => s + estimateCpu(c), 0)
      const totalMemory = containers.reduce((s, c) => s + estimateMem(c), 0)
      const first = containers[0]!
      services.push({
        id: group,
        name: group,
        description: containers.length === 1 ? containers[0]!.Image || '' : `${containers.length} 个容器`,
        group: mapGroupName(group),
        status: composeStatus(containers),
        containers: containers.map(toContainer),
        containerCount: containers.length,
        totalCpu: Math.round(totalCpu * 10) / 10,
        totalMemory: Math.round(totalMemory),
        memoryUnit: totalMemory > 1024 ? 'GB' : 'MB',
        uptime: parseUptime(first.Status),
        favorites: false,
      })
    }
  }

  return services
}

function cleanName(name: string): string {
  return name.replace(/^\//, '')
}

function mapStatus(state: string, ports?: DockerContainer['Ports']): ServiceStatus {
  switch (state) {
    case 'running':
      if (ports && ports.some(p => p.PublicPort === 0)) return 'warning'
      return 'running'
    case 'exited':
    case 'created': return 'stopped'
    case 'dead':
    case 'restarting': return 'error'
    default: return 'warning'
  }
}

function mapGroupName(g: string): string {
  if (g === '基础服务' || g === '_standalone') return '基础服务'
  return g
}

function composeStatus(containers: DockerContainer[]): ServiceStatus {
  const states = containers.map(c => c.State)
  if (states.some(s => s === 'restarting' || s === 'dead')) return 'error'
  if (states.every(s => s === 'exited' || s === 'created')) return 'stopped'
  if (states.some(s => s === 'exited' || s === 'created')) return 'warning'
  // 检测运行中容器是否有端口绑定失败 (PublicPort=0)
  const hasPortFailure = containers.some(c =>
    c.State === 'running' && c.Ports?.some(p => p.PublicPort === 0)
  )
  if (hasPortFailure) return 'warning'
  if (states.every(s => s === 'running')) return 'running'
  return 'warning'
}

function estimateCpu(_c: DockerContainer): number { return 0 }
function estimateMem(_c: DockerContainer): number { return 0 }

function parseUptime(status: string): string {
  if (!status) return '-'
  // "Up 12 hours" / "Up 3 days" / "Exited (0) 2 days ago"
  const up = status.match(/Up\s+(.+)/)
  const raw = up ? up[1]! : status
  return localizeTimeUnits(raw)
}

function localizeTimeUnits(str: string): string {
  const isZh = (localStorage.getItem('lang') || 'zh') === 'zh'
  if (!isZh) return str
  const units: Record<string, string> = {
    'less than a second': '不到 1 秒',
    'less than a minute': '不到 1 分钟',
    'About a minute': '大约 1 分钟',
    'About an hour': '大约 1 小时',
    'About a day': '大约 1 天',
    'seconds': '秒', 'second': '秒',
    'minutes': '分钟', 'minute': '分钟',
    'hours': '小时', 'hour': '小时',
    'days': '天', 'day': '天',
    'weeks': '周', 'week': '周',
    'months': '月', 'month': '月',
    'years': '年', 'year': '年',
    'healthy': '健康',
    'unhealthy': '异常',
    'health: starting': '启动中',
    'ago': '前',
  }
  let result = str
  for (const [en, zh] of Object.entries(units)) {
    result = result.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), zh)
  }
  return result
}

// Docker API 返回的容器类型
interface DockerContainer {
  Id: string
  Names: string[]
  State: string
  Status: string
  Image: string
  Labels?: Record<string, string>
  Ports?: { IP?: string; PrivatePort: number; PublicPort?: number; Type?: string }[]
}

export function useContainers(containerMetrics?: Record<string, { cpu: number; memory: number; memoryPercent?: number }>) {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)

  const applyMetrics = useCallback((svc: Service[]) => {
    if (!containerMetrics || Object.keys(containerMetrics).length === 0) return svc
    return svc.map(s => {
      let totalCpu = 0
      let totalMem = 0
      for (const c of s.containers) {
        const m = containerMetrics[c.id]
        if (m) { totalCpu += m.cpu; totalMem += m.memory }
      }
      if (totalCpu > 0 || totalMem > 0) {
        return { ...s, totalCpu: Math.round(totalCpu * 10) / 10, totalMemory: Math.round(totalMem), memoryUnit: totalMem > 1024 ? 'GB' : 'MB' }
      }
      return s
    })
  }, [containerMetrics])

  const setFromRaw = useCallback((rawList: DockerContainer[]) => {
    const mapped = mapDockerContainers(rawList)
    setServices(applyMetrics(mapped))
    setLoading(false)
  }, [applyMetrics])

  useEffect(() => {
    setServices(prev => applyMetrics(prev))
  }, [applyMetrics])

  const refreshContainers = useCallback(() => {
    fetchContainers()
      .then(setFromRaw)
      .catch(() => setLoading(false))
  }, [setFromRaw])

  useEffect(() => {
    fetchContainers().then(setFromRaw).catch(() => setLoading(false))
    const live = connectLive({
      onContainers: (data) => {
        const mapped = mapDockerContainers(data as DockerContainer[])
        setServices(applyMetrics(mapped))
      },
    })
    return () => live.close()
  }, [setFromRaw, applyMetrics])

  return { services, loading, refreshContainers }
}
