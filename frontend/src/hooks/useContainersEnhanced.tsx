import { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, Container } from 'lucide-react'
import { fetchContainers, fetchContainerStats } from '../api/docker'
import { connectLive } from '../api/ws'
import type { ContainerDetailSummary, ContainerGroup, ServiceStatus, WorkspaceGroup, WorkspaceGroupedContainers } from '../types'

// Docker API 返回的容器类型
interface DockerContainer {
  Id: string
  Names: string[]
  State: string
  Status: string
  Image: string
  Created: number
  Ports: Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>
  Labels?: Record<string, string>
  Mounts?: Array<{ Type: string; Source: string; Destination: string; Mode: string }>
  NetworkSettings?: {
    Networks: Record<string, { IPAddress: string }>
  }
}

function mapStatus(state: string, ports?: DockerContainer['Ports']): ServiceStatus {
  switch (state) {
    case 'running':
      if (ports && ports.some(p => p.PublicPort === 0)) return 'warning'
      return 'running'
    case 'paused': return 'warning'
    case 'exited':
    case 'created': return 'stopped'
    case 'dead':
    case 'restarting': return 'error'
    default: return 'warning'
  }
}

function cleanName(name: string): string {
  return name.replace(/^\//, '')
}

function parseUptime(status: string): string {
  if (!status) return '-'
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

export function toSummary(c: DockerContainer): ContainerDetailSummary {
  return {
    id: c.Id,
    shortId: c.Id?.slice(0, 12) || c.Id,
    name: cleanName(c.Names?.[0] || 'unknown'),
    image: c.Image || '',
    status: mapStatus(c.State, c.Ports),
    state: c.State,
    uptime: parseUptime(c.Status),
    ports: (c.Ports || []).map(p => ({
      private: p.PrivatePort,
      public: p.PublicPort,
      type: p.Type,
    })),
    cpu: 0,
    memory: 0,
    memoryUnit: 'MB',
    project: c.Labels?.['com.docker.compose.project'] || undefined,
    created: new Date(c.Created * 1000).toISOString(),
    labels: c.Labels || {},
  }
}

type GroupMode = 'project' | 'image' | 'status' | 'none'

export function useContainersEnhanced(
  containerMetrics?: Record<string, { cpu: number; memory: number; memoryPercent?: number }>,
  workspaceGroups?: WorkspaceGroup[],
  groupMappings?: Record<string, string>,
  favorites?: string[],
) {
  const [rawContainers, setRawContainers] = useState<DockerContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'name' | 'cpu' | 'memory' | 'uptime' | 'image' | 'status'>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchContainers()
      .then(data => setRawContainers(data as DockerContainer[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 初始加载 + WebSocket 实时更新
  useEffect(() => {
    refresh()
    const live = connectLive({
      onContainers: (data) => {
        setRawContainers(data as DockerContainer[])
      },
    })
    return () => live.close()
  }, [refresh])

  // 转换为 Summary 并注入指标
  const summaries = useMemo<ContainerDetailSummary[]>(() => {
    return rawContainers.map(c => {
      const s = toSummary(c)
      if (containerMetrics) {
        const m = containerMetrics[c.Id?.slice(0, 12) || c.Id]
        if (m) {
          s.cpu = Math.round(m.cpu * 10) / 10
          s.memory = Math.round(m.memory)
          s.memoryUnit = m.memory > 1024 ? 'GB' : 'MB'
          s.memoryPercent = m.memoryPercent ?? 0
        }
      }
      return s
    })
  }, [rawContainers, containerMetrics])

  // 排序
  const sorted = useMemo(() => {
    const arr = [...summaries]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'cpu': cmp = a.cpu - b.cpu; break
        case 'memory': cmp = a.memory - b.memory; break
        case 'uptime': cmp = a.uptime.localeCompare(b.uptime); break
        case 'image': cmp = a.image.localeCompare(b.image); break
        case 'status': cmp = a.status.localeCompare(b.status); break
      }
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [summaries, sortKey, sortAsc])

  const toggleSort = useCallback((key: typeof sortKey) => {
    setSortKey(prev => {
      if (prev === key) { setSortAsc(a => !a); return prev }
      setSortAsc(true)
      return key
    })
  }, [])

  // ===== 工作区 + 分组 模式 =====
  // 将容器按 compose project 分组，然后分配到工作区分组
  const workspaceGrouped = useMemo<WorkspaceGroupedContainers[]>(() => {
    if (!workspaceGroups || workspaceGroups.length === 0) return []

    // Step 1: 按 compose project 聚合容器
    // compose project 容器 → 按 project name 分组
    // 独立容器 → 各自独立
    const projectMap = new Map<string, ContainerDetailSummary[]>()
    const independentContainers: ContainerDetailSummary[] = []

    for (const c of sorted) {
      if (c.project) {
        const arr = projectMap.get(c.project) ?? []
        arr.push(c)
        projectMap.set(c.project, arr)
      } else {
        independentContainers.push(c)
      }
    }

    // Step 2: 构建每个 compose project 的 ContainerGroup
    function makeProjectGroup(name: string, containers: ContainerDetailSummary[]): ContainerGroup {
      const statuses = containers.map(c => c.status)
      let groupStatus: ServiceStatus = 'running'
      if (statuses.some(s => s === 'error')) groupStatus = 'error'
      else if (statuses.some(s => s === 'warning')) groupStatus = 'warning'
      else if (statuses.every(s => s === 'stopped')) groupStatus = 'stopped'

      return {
        name,
        icon: <Container className="w-4 h-4" />,
        containers,
        status: groupStatus,
        containerCount: containers.length,
      }
    }

    // Step 3: 分配 compose projects 到工作区分组
    const wgMap = new Map<string, WorkspaceGroup>()
    for (const wg of workspaceGroups) {
      wgMap.set(wg.id, wg)
    }

    // 收集每个工作区分组下的 projectGroup
    const groupProjects = new Map<string, ContainerGroup[]>() // groupId → ContainerGroup[]

    for (const [projectName, containers] of projectMap) {
      const assignedGroupId = groupMappings?.[projectName] || null
      // 检查目标分组是否存在
      const targetGroupId = assignedGroupId && wgMap.has(assignedGroupId) ? assignedGroupId : '_ungrouped'

      const arr = groupProjects.get(targetGroupId) ?? []
      arr.push(makeProjectGroup(projectName, containers))
      groupProjects.set(targetGroupId, arr)
    }

    // 独立容器 → 始终进 _independent（独立容器）分组
    if (independentContainers.length > 0) {
      const arr = groupProjects.get('_independent') ?? []
      // 独立容器按名称分组（允许同名前缀容器聚合），也可以直接一个容器一个 group
      // 为了方便，每个独立容器作为一个单独的 "project group"
      for (const c of independentContainers) {
        arr.push(makeProjectGroup(c.name, [c]))
      }
      groupProjects.set('_independent', arr)
    }

    // Step 4: 构建最终结果（按 sortOrder 排序）
    // 未分组排在 _independent 之前
    const result: WorkspaceGroupedContainers[] = []

    for (const wg of workspaceGroups) {
      const projects = groupProjects.get(wg.id)
      if (!projects || projects.length === 0) continue

      let running = 0, stopped = 0, warning = 0, error = 0
      for (const pg of projects) {
        for (const c of pg.containers) {
          switch (c.status) {
            case 'running': running++; break
            case 'stopped': stopped++; break
            case 'warning': warning++; break
            case 'error': error++; break
          }
        }
      }

      result.push({
        groupId: wg.id,
        groupName: wg.name,
        sortOrder: wg.sortOrder,
        isBuiltin: wg.isBuiltin,
        projectGroups: projects,
        totalContainers: projects.reduce((s, p) => s + p.containerCount, 0),
        runningCount: running,
        stoppedCount: stopped,
        warningCount: warning,
        errorCount: error,
      })
    }

    // 未分组（compose projects without workspace group assignment）
    const ungroupedProjects = groupProjects.get('_ungrouped')
    if (ungroupedProjects && ungroupedProjects.length > 0) {
      let running = 0, stopped = 0, warning = 0, error = 0
      for (const pg of ungroupedProjects) {
        for (const c of pg.containers) {
          switch (c.status) {
            case 'running': running++; break
            case 'stopped': stopped++; break
            case 'warning': warning++; break
            case 'error': error++; break
          }
        }
      }
      result.push({
        groupId: '_ungrouped',
        groupName: '未分组',
        sortOrder: 9998,
        isBuiltin: true,
        projectGroups: ungroupedProjects,
        totalContainers: ungroupedProjects.reduce((s, p) => s + p.containerCount, 0),
        runningCount: running,
        stoppedCount: stopped,
        warningCount: warning,
        errorCount: error,
      })
    }

    // 收藏（独立于分组）：有收藏项目时置顶
    if (favorites && favorites.length > 0) {
      const favProjects = favorites
        .filter(f => projectMap.has(f))
        .map(f => makeProjectGroup(f, projectMap.get(f)!))

      if (favProjects.length > 0) {
        let fr = 0, fs = 0, fw = 0, fe = 0
        for (const pg of favProjects) {
          for (const c of pg.containers) {
            switch (c.status) { case 'running': fr++; break; case 'stopped': fs++; break; case 'warning': fw++; break; case 'error': fe++; break; }
          }
        }
        result.unshift({
          groupId: '_favorites',
          groupName: '收藏',
          sortOrder: -1,
          isBuiltin: true,
          projectGroups: favProjects,
          totalContainers: favProjects.reduce((s, p) => s + p.containerCount, 0),
          runningCount: fr, stoppedCount: fs, warningCount: fw, errorCount: fe,
        })
      }
    }

    // 其余分组按 sortOrder
    result.sort((a, b) => a.sortOrder - b.sortOrder)

    return result
  }, [sorted, workspaceGroups, groupMappings, favorites])

  // 统计
  const stats = useMemo(() => {
    // 应用总数 = compose project 数 + 独立容器数
    const projects = new Set<string>()
    let independentCount = 0
    for (const c of summaries) {
      if (c.project) {
        projects.add(c.project)
      } else {
        independentCount++
      }
    }
    return {
      totalApps: projects.size + independentCount,
      running: summaries.filter(c => c.status === 'running').length,
      stopped: summaries.filter(c => c.status === 'stopped').length,
      warning: summaries.filter(c => c.status === 'warning').length,
      error: summaries.filter(c => c.status === 'error').length,
      total: summaries.length,
    }
  }, [summaries])

  // ===== 兼容旧的 groupMode（保留旧功能） =====
  const [groupMode, setGroupMode] = useState<GroupMode>('none')
  const groups = useMemo<ContainerGroup[]>(() => {
    if (groupMode === 'none') return []
    const map = new Map<string, ContainerDetailSummary[]>()
    for (const c of sorted) {
      let key: string
      switch (groupMode) {
        case 'project': key = c.project || '独立容器'; break
        case 'image': key = c.image.split(':')[0] || 'unknown'; break
        case 'status': key = c.status; break
        default: key = '全部'
      }
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    const result: ContainerGroup[] = []
    for (const [name, containers] of map) {
      const statuses = containers.map(c => c.status)
      let groupStatus: ServiceStatus = 'running'
      if (statuses.some(s => s === 'error')) groupStatus = 'error'
      else if (statuses.some(s => s === 'warning')) groupStatus = 'warning'
      else if (statuses.every(s => s === 'stopped')) groupStatus = 'stopped'
      let icon: React.ReactNode = <Box className="w-4 h-4" />
      if (groupMode === 'project') icon = <Container className="w-4 h-4" />
      result.push({ name, icon, containers, status: groupStatus, containerCount: containers.length })
    }
    return result
  }, [sorted, groupMode])

  const fetchStats = useCallback(async (id: string) => {
    try { return await fetchContainerStats(id) }
    catch { return null }
  }, [])

  return {
    containers: sorted,
    groups,
    workspaceGrouped,
    stats,
    loading,
    groupMode,
    sortKey,
    sortAsc,
    setGroupMode,
    toggleSort,
    refresh,
    fetchStats,
  }
}
