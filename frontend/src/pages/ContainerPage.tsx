import { useState, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Box, Search, Grid3X3, List, RotateCw, Play,
  Square, Trash2, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Pause, RefreshCw,
  Info, Loader2, Cpu, HardDrive, Clock, Tag, Skull,
  ArrowUpCircle, ShieldCheck, Settings2,
} from 'lucide-react'
import ProjectDetailModal from './ProjectDetailModal'
import ServiceCard from '../components/ServiceCard'
import GroupHeader from '../components/GroupHeader'
import GroupManageModal from '../components/GroupManageModal'
import Toolbar from '../components/Toolbar'
import { useContainersEnhanced } from '../hooks/useContainersEnhanced'
import { useSystemMetrics } from '../hooks/useSystemMetrics'
import { useNotifications } from '../components/NotificationProvider'
import { useSelf } from '../hooks/useSelf'
import { useScrollAnchor } from '../hooks/useScrollAnchor'
import {
  startContainer, stopContainer, restartContainer, removeContainer,
  pauseContainer, unpauseContainer, killContainer,
  checkContainerUpdate, updateContainer,
} from '../api/docker'
import type { ContainerDetailSummary, ContainerUpdateResult, Service } from '../types'
import type { WorkspaceGroup } from '../types'

interface ContainerPageProps {
  groups: WorkspaceGroup[]
  mappings: Record<string, string>
  collapsed: Record<string, boolean>
  favorites: string[]
  showUngrouped: boolean
  groupsLoading: boolean
  createGroup: (id: string, name: string) => Promise<boolean>
  deleteGroup: (id: string) => Promise<boolean>
  renameGroup: (id: string, name: string) => Promise<boolean>
  toggleShowOnDashboard: (id: string, show: boolean) => Promise<boolean>
  toggleShowUngrouped: (show: boolean) => void
  assignToGroup: (assign: Record<string, string>, remove?: string[]) => Promise<boolean>
  unassign: (key: string) => Promise<boolean>
  toggleFavorite: (key: string) => void
  toggleCollapsed: (groupId: string) => void
}

// ========== 容器状态徽标 ==========
type StatusStyle = { dot: string; text: string; icon: React.ElementType; border: string; glow: string }

const statusConfig: Record<string, StatusStyle> = {
  running:  { dot: 'bg-running animate-pulse', text: 'text-running', icon: CheckCircle2, border: 'border-running/30', glow: 'shadow-[0_0_12px_rgba(34,197,94,0.08)]' },
  stopped:  { dot: 'bg-stopped',               text: 'text-stopped', icon: XCircle,       border: 'border-stopped/20', glow: '' },
  warning:  { dot: 'bg-warning animate-pulse', text: 'text-warning', icon: AlertTriangle, border: 'border-warning/30', glow: 'shadow-[0_0_12px_rgba(245,158,11,0.08)]' },
  error:    { dot: 'bg-error animate-pulse',   text: 'text-error',   icon: XCircle,       border: 'border-error/30',  glow: 'shadow-[0_0_12px_rgba(239,68,68,0.08)]' },
}

function getStatusStyle(status: string): StatusStyle {
  return statusConfig[status] ?? statusConfig.stopped!
}

export default function ContainerPage({
  groups, mappings, collapsed, favorites, showUngrouped, groupsLoading,
  createGroup, deleteGroup, renameGroup, toggleShowOnDashboard, toggleShowUngrouped,
  assignToGroup, unassign, toggleFavorite, toggleCollapsed,
}: ContainerPageProps) {
  const { t } = useTranslation()
  const { success, error } = useNotifications()
  const { isSelf } = useSelf()
  const { metrics } = useSystemMetrics(10000)

  const {
    containers, workspaceGrouped, stats, loading,
    sortKey, sortAsc, toggleSort, refresh,
  } = useContainersEnhanced(metrics?.containerMetrics, groups, mappings, favorites)

  const [viewMode, setViewMode] = useState<'card' | 'table'>('card')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showGroupManage, setShowGroupManage] = useState(false)
  const { scrollRef, anchorToggle } = useScrollAnchor()

  // 更新检查状态
  const [updateResults, setUpdateResults] = useState<Record<string, ContainerUpdateResult>>({})
  const [checkingSingle, setCheckingSingle] = useState<Set<string>>(new Set())
  const [updatingContainer, setUpdatingContainer] = useState<string | null>(null)
  const [showUpdateConfirm, setShowUpdateConfirm] = useState<ContainerDetailSummary | null>(null)

  // 项目详情弹窗
  const [projectDetail, setProjectDetail] = useState<ContainerDetailSummary[] | null>(null)

  // 已管理的 Compose 项目列表
  const [managedProjects, setManagedProjects] = useState<string[]>([])
  const refreshManagedProjects = useCallback(() => {
    fetch('/projects')
      .then(r => r.json())
      .then((data: { name: string }[]) => setManagedProjects(data.map(p => p.name)))
      .catch(() => {})
  }, [])
  useEffect(() => { refreshManagedProjects() }, [refreshManagedProjects])

  // ContainerGroup → Service 转换
  const groupToService = (name: string, groupContainers: ContainerDetailSummary[]): Service => ({
    id: name,
    name,
    description: `${groupContainers.length} 个容器`,
    group: '基础服务',
    status: (() => {
      const statuses = groupContainers.map(c => c.status)
      if (statuses.some(s => s === 'error')) return 'error'
      if (statuses.some(s => s === 'warning')) return 'warning'
      if (statuses.every(s => s === 'stopped')) return 'stopped'
      return 'running'
    })(),
    containers: groupContainers.map(c => ({
      id: c.id, name: c.name, status: c.status,
      cpu: c.cpu, memory: c.memory, memoryUnit: c.memoryUnit, uptime: c.uptime, ports: c.ports,
    })),
    containerCount: groupContainers.length,
    totalCpu: +groupContainers.reduce((s, c) => s + c.cpu, 0).toFixed(1),
    totalMemory: Math.round(groupContainers.reduce((s, c) => s + c.memory, 0)),
    memoryUnit: groupContainers[0]?.memoryUnit || 'MB',
    totalMemoryPercent: Math.max(0, ...groupContainers.map(c => c.memoryPercent ?? 0)),
    uptime: groupContainers[0]?.uptime || '-',
  })

  // 搜索+过滤（扁平容器列表，用于表格视图）
  const filtered = useMemo(() => {
    let arr = containers
    if (statusFilter !== 'all') arr = arr.filter(c => c.status === statusFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      arr = arr.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.shortId.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        (c.project && c.project.toLowerCase().includes(q))
      )
    }
    return arr
  }, [containers, searchQuery, statusFilter])

  // 过滤后的工作区分组
  const filteredWorkspaceGroups = useMemo(() => {
    if (!searchQuery.trim() && statusFilter === 'all') return workspaceGrouped

    return workspaceGrouped.map(wg => {
      const filteredPg = wg.projectGroups.map(pg => {
        const filteredContainers = pg.containers.filter(c => {
          if (statusFilter !== 'all' && c.status !== statusFilter) return false
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            return c.name.toLowerCase().includes(q) ||
              c.shortId.toLowerCase().includes(q) ||
              c.image.toLowerCase().includes(q)
          }
          return true
        })
        return { ...pg, containers: filteredContainers, containerCount: filteredContainers.length }
      }).filter(pg => pg.containers.length > 0)

      // 重新计算聚合状态
      let running = 0, stopped = 0, warning = 0, error = 0
      for (const pg of filteredPg) {
        for (const c of pg.containers) {
          switch (c.status) { case 'running': running++; break; case 'stopped': stopped++; break; case 'warning': warning++; break; case 'error': error++; break; }
        }
      }

      return {
        ...wg,
        projectGroups: filteredPg,
        totalContainers: filteredPg.reduce((s, p) => s + p.containerCount, 0),
        runningCount: running,
        stoppedCount: stopped,
        warningCount: warning,
        errorCount: error,
      }
    }).filter(wg => wg.projectGroups.length > 0)
  }, [workspaceGrouped, searchQuery, statusFilter])

  // ===== 单个容器操作 =====
  const actionLabels: Record<string, string> = {
    start: t('containers.action_start', '启动'),
    stop: t('containers.action_stop', '停止'),
    restart: t('containers.action_restart', '重启'),
    pause: t('containers.action_pause', '暂停'),
    unpause: t('containers.action_unpause', '恢复'),
    kill: t('containers.action_kill', '强制终止'),
    remove: t('containers.action_remove', '删除'),
  }

  const doAction = async (id: string, action: string) => {
    setActionLoading(`${id}:${action}`)
    try {
      switch (action) {
        case 'start': await startContainer(id); break
        case 'stop': await stopContainer(id); break
        case 'restart': await restartContainer(id); break
        case 'pause': await pauseContainer(id); break
        case 'unpause': await unpauseContainer(id); break
        case 'kill': await killContainer(id); break
        case 'remove': await removeContainer(id); break
      }
      success(actionLabels[action] || action)
      setTimeout(refresh, 800)
    } catch {
      error(t('containers.actionFailed', { action: actionLabels[action] || action }))
    } finally {
      setActionLoading(null)
    }
  }

  const doCheckSingle = async (id: string) => {
    setCheckingSingle(prev => new Set(prev).add(id))
    try {
      const result = await checkContainerUpdate(id) as ContainerUpdateResult
      setUpdateResults(prev => ({ ...prev, [id]: result }))
      if (result.hasUpdate) success(t('containers.updateAvailable'))
    } catch {
      setUpdateResults(prev => ({ ...prev, [id]: { imageName: '', currentDigest: '', remoteDigest: null, hasUpdate: false, tag: '', error: t('containers.updateError') } }))
    } finally {
      setCheckingSingle(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const doUpdate = async (c: ContainerDetailSummary) => {
    if (c.project) {
      error(t('containers.composeUpdateHint', 'Compose 项目容器请通过"服务编排"页面更新'))
      return
    }
    setUpdatingContainer(c.id)
    try {
      await updateContainer(c.id)
      success(t('containers.updateSuccess'))
      setShowUpdateConfirm(null)
      setUpdateResults(prev => { const n = { ...prev }; delete n[c.id]; return n })
      setTimeout(refresh, 1500)
    } catch {
      error(t('containers.updateFailed'))
    } finally {
      setUpdatingContainer(null)
    }
  }

  const SortHeader = ({ label, field }: { label: string; field: typeof sortKey }) => (
    <th className="px-3 py-2 text-left text-xs font-medium text-textMuted cursor-pointer hover:text-textPrimary select-none"
      onClick={() => toggleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === field && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  )

  // ===== 渲染容器卡片 =====
  const renderCard = (c: ContainerDetailSummary) => {
    const cfg = getStatusStyle(c.status)
    const isRunning = c.status === 'running'
    const isStopped = c.status === 'stopped'
    const isPaused = c.state === 'paused'
    const prefix = `${c.id}:`
    const updateInfo = updateResults[c.id]
    const isChecking = checkingSingle.has(c.id)

    return (
      <div key={c.id}
        className={`group relative bg-surface border rounded-xl p-4 flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1 ${cfg.border} ${cfg.glow} hover:shadow-xl hover:border-accent/40`}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
          isRunning ? 'bg-gradient-to-r from-running/0 via-running to-running/0' :
          isStopped ? 'bg-gradient-to-r from-stopped/0 via-stopped to-stopped/0' :
          'bg-gradient-to-r from-warning/0 via-warning to-warning/0'
        }`} />

        <div onClick={() => setProjectDetail([c])} className="flex flex-col gap-3 cursor-pointer flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                <span className="text-sm font-semibold text-textPrimary truncate">{c.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isRunning && isChecking && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />{t('containers.checking')}
                </span>
              )}
              {isRunning && !isChecking && updateInfo?.hasUpdate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 border border-warning/30 text-warning flex items-center gap-1 animate-pulse">
                  <ArrowUpCircle className="w-2.5 h-2.5" />{t('containers.updateAvailable')}
                </span>
              )}
              {isRunning && !isChecking && updateInfo && !updateInfo.hasUpdate && !updateInfo.error && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-running/10 border border-running/20 text-running flex items-center gap-1">
                  <ShieldCheck className="w-2.5 h-2.5" />{t('containers.upToDate')}
                </span>
              )}
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cfg.text} bg-panel/50 border ${cfg.border}`}>
                {t(`status.${c.status}`, c.status)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-panel/50 min-w-0">
            <Tag className="w-3 h-3 text-accent/60 shrink-0" />
            <span className="text-xs text-textSecondary truncate">{c.image}</span>
          </div>

          {c.ports.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.ports.slice(0, 3).map((p, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-accent/5 border border-accent/10 text-textSecondary font-mono">
                  {p.public ? `${p.public}:${p.private}` : p.private}
                </span>
              ))}
              {c.ports.length > 3 && <span className="text-[10px] text-textMuted">+{c.ports.length - 3}</span>}
            </div>
          )}

          {isRunning && (
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-textMuted flex items-center gap-1"><Cpu className="w-3 h-3" />CPU</span>
                  <span className="text-textPrimary font-mono font-semibold">{c.cpu}%</span>
                </div>
                <div className="metric-bar"><div className="metric-bar-fill bg-accent" style={{ width: `${Math.min(c.cpu, 100)}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-textMuted flex items-center gap-1 min-w-0">
                    <HardDrive className="w-3 h-3 shrink-0" />
                    <span className="truncate">MEM {c.memory}{c.memoryUnit}</span>
                  </span>
                  <span className="text-textPrimary font-mono font-semibold shrink-0 ml-1">{(c.memoryPercent ?? 0).toFixed(1)}%</span>
                </div>
                <div className="metric-bar"><div className="metric-bar-fill bg-warning" style={{ width: `${Math.min(c.memoryPercent ?? 0, 100)}%` }} /></div>
              </div>
            </div>
          )}

          <p className="text-[10px] text-textMuted/90 flex items-center gap-1 min-w-0">
            <Clock className="w-3 h-3 shrink-0" />{c.uptime}
            <span className="text-border/60 mx-0.5 shrink-0">·</span>
            <span className="font-mono truncate">{c.shortId}</span>
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-0.5 pt-2 mt-auto border-t border-border/30"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-0.5 flex-1">
            {isRunning && !isPaused && (
              <>
                {!updateInfo || !updateInfo.hasUpdate ? (
                  <button onClick={() => doCheckSingle(c.id)} disabled={isChecking}
                    title={t('containers.checkUpdate')} className="p-1.5 rounded-lg hover:bg-accent/10 text-textMuted hover:text-accent transition-all duration-200">
                    {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <button onClick={() => setShowUpdateConfirm(c)}
                    title={t('containers.updateContainer')} className="p-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all duration-200">
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="w-px h-4 bg-border/30" />
                <button onClick={() => doAction(c.id, 'pause')} disabled={actionLoading === prefix + 'pause'}
                  title={t('containers.action_pause', '暂停')} className="p-1.5 rounded-lg hover:bg-warning/10 text-textMuted hover:text-warning transition-all duration-200">
                  {actionLoading === prefix + 'pause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction(c.id, 'stop')} disabled={actionLoading === prefix + 'stop' || isSelf(c.id)}
                    title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_stop', '停止')} className={`p-1.5 rounded-lg transition-all duration-200 ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                  {actionLoading === prefix + 'stop' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction(c.id, 'restart')} disabled={actionLoading === prefix + 'restart' || isSelf(c.id)}
                  title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_restart', '重启')} className={`p-1.5 rounded-lg transition-all duration-200 ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-accent/10 text-textMuted hover:text-accent'}`}>
                  {actionLoading === prefix + 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction(c.id, 'kill')} disabled={actionLoading === prefix + 'kill' || isSelf(c.id)}
                  title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_kill', '强制终止')} className={`p-1.5 rounded-lg transition-all duration-200 ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                  {actionLoading === prefix + 'kill' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Skull className="w-3.5 h-3.5" />}
                </button>
              </>
            )}
            {isStopped && (
              <>
                <button onClick={() => doAction(c.id, 'start')} disabled={actionLoading === prefix + 'start'}
                  title={t('containers.action_start', '启动')} className="p-1.5 rounded-lg bg-running/10 text-running hover:bg-running/20 transition-all duration-200">
                  {actionLoading === prefix + 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction(c.id, 'remove')} disabled={actionLoading === prefix + 'remove' || isSelf(c.id)}
                  title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_remove', '删除')} className={`p-1.5 rounded-lg transition-all duration-200 ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                  {actionLoading === prefix + 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </>
            )}
            {isPaused && (
              <button onClick={() => doAction(c.id, 'unpause')} disabled={actionLoading === prefix + 'unpause'}
                title={t('containers.action_unpause', '恢复')} className="p-1.5 rounded-lg bg-running/10 text-running hover:bg-running/20 transition-all duration-200">
                {actionLoading === prefix + 'unpause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            )}
            {c.status === 'error' && (
              <button onClick={() => doAction(c.id, 'restart')} disabled={actionLoading === prefix + 'restart' || isSelf(c.id)}
                title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_restart', '重启')} className={`p-1.5 rounded-lg transition-all duration-200 ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-accent/10 text-textMuted hover:text-accent'}`}>
                {actionLoading === prefix + 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          <button onClick={() => setProjectDetail([c])}
            title={t('containers.detail')} className="p-1.5 rounded-lg hover:bg-accent/10 text-textMuted hover:text-accent transition-all duration-200 opacity-0 group-hover:opacity-100">
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  // 加载状态
  const isLoading = loading || groupsLoading

  return (
    <main ref={scrollRef as React.RefObject<HTMLElement>} className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
      {/* 统计栏 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
        {[
          { label: 'apps', value: stats.totalApps, icon: Box, c: 'text-accent', bg: 'bg-accent/10' },
          { label: 'running', value: stats.running, icon: Play, c: 'text-running', bg: 'bg-running/10' },
          { label: 'warning', value: stats.warning, icon: AlertTriangle, c: 'text-warning', bg: 'bg-warning/10' },
          { label: 'stopped', value: stats.stopped, icon: Square, c: 'text-stopped', bg: 'bg-stopped/10' },
          { label: 'error', value: stats.error, icon: XCircle, c: 'text-error', bg: 'bg-error/10' },
        ].map(item => (
          <div key={item.label}
            className="group relative overflow-hidden bg-surface border border-border rounded-lg p-3 md:p-4 flex items-center gap-3 hover:border-accent/30 hover:shadow-sm transition-all duration-200">
            <div className={`absolute -bottom-4 -right-4 w-16 h-16 rounded-full ${item.bg} opacity-40 group-hover:scale-110 transition-transform duration-300`} />
            <div className={`relative w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
              <item.icon className={`w-4.5 h-4.5 ${item.c}`} />
            </div>
            <div className="relative min-w-0">
              <p className="text-lg md:text-2xl font-bold text-textPrimary leading-none">{item.value}</p>
              <p className="text-[10px] md:text-[11px] text-textMuted mt-1 truncate">
                {t(`containers.${item.label}`, item.label)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px] max-w-md relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input type="text"
            placeholder={t('containers.searchPlaceholder', '搜索容器名称 / ID / 镜像...')}
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-3 py-2 md:py-2.5 text-sm text-textPrimary placeholder:text-textMuted/90 outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/5 transition-all" />
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="shrink-0 bg-surface border border-border rounded-xl px-2 md:px-3 py-2 md:py-2.5 text-xs md:text-sm text-textPrimary outline-none cursor-pointer">
          <option value="all">{t('containers.filterAll', '全部状态')}</option>
          <option value="running">{t('status.running', '运行中')}</option>
          <option value="warning">{t('status.warning', '警告')}</option>
          <option value="stopped">{t('status.stopped', '已停止')}</option>
          <option value="error">{t('status.error', '异常')}</option>
        </select>

        {/* 分组管理按钮 */}
        <button onClick={() => setShowGroupManage(true)}
          className="shrink-0 bg-surface border border-border rounded-xl px-3 py-2 md:py-2.5 text-xs md:text-sm text-textPrimary hover:bg-accent/5 hover:border-accent/30 transition-colors flex items-center gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          {t('containers.manageGroups')}
        </button>

        <div className="hidden sm:flex items-center bg-surface border border-border rounded-xl p-0.5 shrink-0">
          <button onClick={() => setViewMode('card')}
            className={`p-1.5 rounded-lg ${viewMode === 'card' ? 'bg-accent text-white shadow-sm' : 'text-textMuted hover:text-textPrimary'} transition-all`}>
            <Grid3X3 className="w-4 h-4" /></button>
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded-lg ${viewMode === 'table' ? 'bg-accent text-white shadow-sm' : 'text-textMuted hover:text-textPrimary'} transition-all`}>
            <List className="w-4 h-4" /></button>
        </div>

        <Toolbar hideSearch searchQuery={searchQuery} onSearchChange={setSearchQuery} onProjectCreated={refresh} />
      </div>

      {/* 加载状态 */}
      {isLoading && containers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-textMuted gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <span className="text-sm">{t('containers.loading')}</span>
        </div>
      )}

      {/* ===== 卡片视图：工作区+分组 ===== */}
      {viewMode === 'card' && !isLoading && (
        <div className="flex flex-col">
          {filteredWorkspaceGroups.map(wg => {
            const isCollapsed = collapsed[wg.groupId] === true

            return (
              <section key={wg.groupId} className={`${isCollapsed ? '' : 'pb-2'}`}>
                {/* 分组头 */}
                <GroupHeader
                  group={wg}
                  collapsed={isCollapsed}
                  onToggle={() => anchorToggle(() => toggleCollapsed(wg.groupId))}
                />

                {/* 分组内容 */}
                <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-4 border-l-2 border-border/30 ${
                  isCollapsed ? 'hidden' : 'mt-3'
                }`}>
                    {wg.projectGroups.map(pg => {
                      const isComposeProject = pg.containers.length > 1 ||
                        pg.containers[0]?.project !== undefined
                      const service = groupToService(pg.name, pg.containers)

                      // Compose 项目：用 ServiceCard
                      if (isComposeProject && pg.containers[0]?.project) {
                        return (
                          <ServiceCard
                            key={pg.name}
                            service={service}
                            managedProjects={managedProjects}
                            onCardClick={() => setProjectDetail(pg.containers)}
                          />
                        )
                      }

                      // 独立容器：直接用卡片
                      return pg.containers.map(c => renderCard(c))
                    }).flat()}
                  </div>
              </section>
            )
          })}

          {filteredWorkspaceGroups.length === 0 && (
            <div className="text-center py-16 text-textMuted">
              <Box className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t('containers.noResults', '没有匹配的容器')}</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 表格视图（桌面端） ===== */}
      {viewMode === 'table' && (
        <div className="hidden sm:block bg-surface border border-border/50 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-border/50">
              <th className="w-4 px-2 py-3" />
              <SortHeader label={t('containers.colName', '名称')} field="name" />
              <th className="px-3 py-3 text-left text-xs font-medium text-textMuted">{t('containers.colId', '容器 ID')}</th>
              <SortHeader label={t('containers.colImage', '镜像')} field="image" />
              <th className="px-3 py-3 text-left text-xs font-medium text-textMuted">{t('containers.colStatus', '状态')}</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-textMuted">{t('containers.colPorts', '端口')}</th>
              <SortHeader label="CPU" field="cpu" />
              <SortHeader label={t('containers.colMemory', '内存')} field="memory" />
              <SortHeader label={t('containers.colUptime', '上线时间')} field="uptime" />
              <th className="px-3 py-3 text-left text-xs font-medium text-textMuted">{t('containers.colActions', '操作')}</th>
            </tr></thead>
            <tbody>
              {filtered.map(c => {
                const cfg = getStatusStyle(c.status)
                const isRunning = c.status === 'running'
                const isStopped = c.status === 'stopped'
                const isPaused = c.state === 'paused'
                const prefix = `${c.id}:`
                return (
                  <tr key={c.id} className="border-b border-border/30 hover:bg-accent/[0.02] transition-colors cursor-pointer"
                    onClick={() => setProjectDetail([c])}>
                    <td className="px-2 py-3"><span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} /></td>
                    <td className="px-3 py-3">
                      <span className="text-sm font-medium text-textPrimary truncate block max-w-[180px]">{c.name}</span>
                      {c.project && <span className="text-[10px] text-textMuted bg-panel px-1.5 py-0.5 rounded-md mt-0.5 inline-block">{c.project}</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-textMuted font-mono">{c.shortId}</td>
                    <td className="px-3 py-3 text-xs text-textSecondary truncate max-w-[200px]">{c.image}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.text} border ${cfg.border}`}>
                        {t(`status.${c.status}`, c.status)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-0.5">
                        {c.ports.slice(0, 2).map((p, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-panel text-textMuted font-mono">{p.public ? `${p.public}:` : ''}{p.private}</span>
                        ))}
                        {c.ports.length > 2 && <span className="text-[10px] text-textMuted">+{c.ports.length - 2}</span>}
                        {c.ports.length === 0 && <span className="text-[10px] text-textMuted">-</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-textPrimary font-mono">{isRunning ? `${c.cpu}%` : '-'}</td>
                    <td className="px-3 py-3 text-xs text-textPrimary font-mono">{isRunning ? `${c.memory}${c.memoryUnit}` : '-'}</td>
                    <td className="px-3 py-3 text-xs text-textMuted">{c.uptime}</td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        {isRunning && !isPaused && (
                          <>
                            <button onClick={() => doAction(c.id, 'pause')} disabled={actionLoading === prefix + 'pause'}
                              className="p-1 rounded-lg hover:bg-warning/10 text-textMuted hover:text-warning">
                              {actionLoading === prefix + 'pause' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}</button>
                            <button onClick={() => doAction(c.id, 'stop')} disabled={actionLoading === prefix + 'stop' || isSelf(c.id)}
                              title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_stop', '停止')}
                              className={`p-1 rounded-lg ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                              {actionLoading === prefix + 'stop' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}</button>
                            <button onClick={() => doAction(c.id, 'kill')} disabled={actionLoading === prefix + 'kill' || isSelf(c.id)}
                              title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_kill', '强制终止')}
                              className={`p-1 rounded-lg ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                              {actionLoading === prefix + 'kill' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Skull className="w-3 h-3" />}</button>
                          </>
                        )}
                        {isStopped && (
                          <>
                            <button onClick={() => doAction(c.id, 'start')} disabled={actionLoading === prefix + 'start'}
                              className="p-1 rounded-lg bg-running/10 text-running hover:bg-running/20">
                              {actionLoading === prefix + 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}</button>
                            <button onClick={() => doAction(c.id, 'remove')} disabled={actionLoading === prefix + 'remove' || isSelf(c.id)}
                              title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_remove', '删除')}
                              className={`p-1 rounded-lg ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-error/10 text-textMuted hover:text-error'}`}>
                              {actionLoading === prefix + 'remove' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}</button>
                          </>
                        )}
                        {isPaused && (
                          <button onClick={() => doAction(c.id, 'unpause')} disabled={actionLoading === prefix + 'unpause'}
                            className="p-1 rounded-lg bg-running/10 text-running hover:bg-running/20">
                            {actionLoading === prefix + 'unpause' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}</button>
                        )}
                        {(c.status === 'error' || c.status === 'warning') && !isPaused && (
                          <button onClick={() => doAction(c.id, 'restart')} disabled={actionLoading === prefix + 'restart' || isSelf(c.id)}
                            title={isSelf(c.id) ? t('containers.selfProtection') : t('containers.action_restart', '重启')}
                            className={`p-1 rounded-lg ${isSelf(c.id) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-accent/10 text-textMuted hover:text-accent'}`}>
                            {actionLoading === prefix + 'restart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-textMuted text-sm">{t('containers.noResults', '没有匹配的容器')}</div>
          )}
        </div>
      )}

      {/* 更新确认弹窗 */}
      {showUpdateConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowUpdateConfirm(null)}>
          <div className="bg-surface border border-border rounded-xl shadow-2xl p-6 w-[440px] max-w-[95vw] animate-fadeInScale" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <ArrowUpCircle className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-textPrimary">{t('containers.updateConfirmTitle')}</h3>
                <p className="text-xs text-textMuted mt-0.5">{showUpdateConfirm.name}</p>
              </div>
            </div>
            <div className="bg-panel rounded-lg p-3 space-y-2 mb-4 text-xs">
              <div className="flex justify-between">
                <span className="text-textMuted">{t('containers.colImage')}</span>
                <span className="text-textPrimary font-mono">{showUpdateConfirm.image}</span>
              </div>
              {updateResults[showUpdateConfirm.id]?.currentDigest && (
                <div className="flex justify-between">
                  <span className="text-textMuted">{t('containers.currentDigest', '当前 Digest')}</span>
                  <span className="text-textPrimary font-mono">{updateResults[showUpdateConfirm.id]?.currentDigest?.slice(0, 19)}</span>
                </div>
              )}
              {updateResults[showUpdateConfirm.id]?.remoteDigest && (
                <div className="flex justify-between">
                  <span className="text-textMuted">{t('containers.latestDigest', '最新 Digest')}</span>
                  <span className="text-accent font-mono">{updateResults[showUpdateConfirm.id]?.remoteDigest?.slice(0, 19)}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-textSecondary mb-4 leading-relaxed flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              {t('containers.updateConfirmDesc')}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowUpdateConfirm(null)}
                className="action-btn action-btn-ghost text-xs px-3 py-1.5 rounded-lg">
                {t('containers.cancel', '取消')}
              </button>
              <button onClick={() => doUpdate(showUpdateConfirm)}
                disabled={updatingContainer === showUpdateConfirm.id}
                className="action-btn action-btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg">
                {updatingContainer === showUpdateConfirm.id ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('containers.updating')}</>
                ) : (
                  <><ArrowUpCircle className="w-3.5 h-3.5" />{t('containers.updateContainer')}</>
                )}
              </button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* 分组管理弹窗 */}
      {showGroupManage && (
        <GroupManageModal
          groups={groups}
          mappings={mappings}
          favorites={favorites}
          containers={containers}
          onCreateGroup={createGroup}
          onDeleteGroup={deleteGroup}
          onRenameGroup={renameGroup}
          onAssignToGroup={assignToGroup}
          onUnassign={unassign}
          onToggleFavorite={toggleFavorite}
          onToggleShowOnDashboard={toggleShowOnDashboard}
          onToggleShowUngrouped={toggleShowUngrouped}
          showUngrouped={showUngrouped}
          onClose={() => setShowGroupManage(false)}
        />
      )}

      {projectDetail && (
        <ProjectDetailModal containers={projectDetail} onClose={() => setProjectDetail(null)} />
      )}
    </main>
  )
}
