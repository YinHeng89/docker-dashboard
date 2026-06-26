import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  X, Copy, Check, Loader2, RotateCw, Cpu, HardDrive, Clock,
  Info, Settings, Network, Layers, Globe, Tag,
  Monitor, Box, ScrollText, Download, Upload,
} from 'lucide-react'
import { fetchContainer, fetchContainerProcesses, fetchContainerStats } from '../api/docker'
import type { ContainerDetailSummary, ContainerDetail, ContainerStats } from '../types'

interface Props {
  containers: ContainerDetailSummary[]
  onClose: () => void
}

type Tab = 'info' | 'env' | 'ports' | 'volumes' | 'logs' | 'stats' | 'process'

const tabs: { id: Tab; key: string; icon: React.ElementType }[] = [
  { id: 'info', key: 'containers.detail_basicInfo', icon: Info },
  { id: 'stats', key: 'containers.detail_stats', icon: Monitor },
  { id: 'env', key: 'containers.detail_env', icon: Settings },
  { id: 'ports', key: 'containers.detail_ports', icon: Network },
  { id: 'volumes', key: 'containers.detail_volumes', icon: Layers },
  { id: 'process', key: 'containers.detail_process', icon: Box },
  { id: 'logs', key: 'containers.detail_logs', icon: ScrollText },
]

const statusDot: Record<string, string> = {
  running: 'bg-running pulse-dot', stopped: 'bg-stopped',
  error: 'bg-error pulse-dot', warning: 'bg-warning pulse-dot',
}
const statusTextC: Record<string, string> = {
  running: 'text-running', stopped: 'text-stopped',
  error: 'text-error', warning: 'text-warning',
}

function Activity({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} {...rest} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, val = bytes
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(1)} ${units[i]}`
}

export default function ProjectDetailModal({ containers, onClose }: Props) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState(containers[0]?.id || '')
  const active = containers.find(c => c.id === activeId)!
  const showList = containers.length > 1

  if (!active) return null

  // ===== 容器详情状态 =====
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [detail, setDetail] = useState<ContainerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<ContainerStats | null>(null)
  const [processes, setProcesses] = useState<{ Titles: string[]; Processes: string[][] } | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsPaused, setLogsPaused] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSecrets, setShowSecrets] = useState(false)
  const [resolvedWorkingDir, setResolvedWorkingDir] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // ESC 关闭
  const handleClose = useCallback(onClose, [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleClose])

  // 切换容器时重置状态
  useEffect(() => {
    setLoading(true)
    setDetail(null)
    setStats(null)
    setProcesses(null)
    setLogs('')
    setResolvedWorkingDir(null)
    setActiveTab('info')
    fetchContainer(active.id)
      .then(data => {
        setDetail(data as ContainerDetail)
        // WorkingDir 为空时，调用兜底 API 解析
        const detail = data as ContainerDetail
        if (!detail.Config?.WorkingDir) {
          fetch(`/api/containers/${active.id}/workingdir`)
            .then(r => r.json())
            .then(d => setResolvedWorkingDir(d.workingDir))
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [active.id])

  const loadStats = useCallback(async () => {
    try { setStats(await fetchContainerStats(active.id) as ContainerStats) } catch {}
  }, [active.id])

  const loadProcesses = useCallback(async () => {
    try { setProcesses(await fetchContainerProcesses(active.id) as any) } catch {}
  }, [active.id])

  useEffect(() => {
    if (activeTab === 'stats') loadStats()
    if (activeTab === 'process') loadProcesses()
  }, [activeTab, loadStats, loadProcesses])

  // 环境变量脱敏
  const isSecretValue = (key: string, val: string) => {
    if (!val.trim()) return false
    const sk = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'AUTH', 'CREDENTIAL', 'PRIVATE', 'API_KEY', 'ACCESS_KEY']
    if (sk.some(s => key.toUpperCase().includes(s))) return true
    if (val.length > 30 && /^[A-Za-z0-9+/=_-]+$/.test(val)) return true
    return false
  }

  // ===== 日志 WebSocket =====
  const connectLogWs = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setLogs('')
    setLogsLoading(true)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/exec`)
    ws.onopen = () => {
      setLogsLoading(false)
      ws.send(JSON.stringify({ type: 'exec', command: `docker logs --tail 200 -f ${active.id}`, t: Date.now() }))
    }
    ws.onmessage = (event) => {
      try { const msg = JSON.parse(event.data); if (msg.type === 'stdout' || msg.type === 'stderr') setLogs(prev => prev + (msg.data || '')) } catch {}
    }
    ws.onclose = () => setLogsLoading(false)
    ws.onerror = () => setLogsLoading(false)
    wsRef.current = ws
  }, [active.id])

  useEffect(() => {
    if (activeTab !== 'logs') { if (wsRef.current) { wsRef.current.close(); wsRef.current = null }; setLogs(''); return }
    connectLogWs()
    return () => { if (wsRef.current) { wsRef.current.close(); wsRef.current = null } }
  }, [activeTab, connectLogWs])

  // 日志自动滚到底部
  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, activeTab])

  const toggleLogPause = useCallback(() => {
    if (logsPaused) { connectLogWs(); setLogsPaused(false) }
    else { if (wsRef.current) { wsRef.current.close(); wsRef.current = null }; setLogsPaused(true) }
  }, [logsPaused, connectLogWs])

  const logLines = useMemo(() => logs.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '')), [logs])

  const dot = statusDot[active.status] ?? statusDot.stopped
  const stText = statusTextC[active.status] ?? statusTextC.stopped
  const isRunning = active.status === 'running'

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div className="bg-surface border border-border rounded-lg shadow-2xl flex" onClick={e => e.stopPropagation()}
        style={{ width: showList ? '1080px' : '960px', maxWidth: '96vw', height: '85vh', maxHeight: '92vh' }}>

        {/* ===== 左侧容器列表 ===== */}
        {showList && (
          <div className="w-48 shrink-0 border-r border-border flex flex-col bg-panel/30 rounded-l-lg overflow-hidden">
            <div className="px-3 py-2.5 text-xs font-medium text-textMuted border-b border-border shrink-0">
              {containers.length} {t('containers.detail_containerCount')}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {containers.map(c => {
                const d = statusDot[c.status] ?? statusDot.stopped
                const isActive = c.id === activeId
                return (
                  <button key={c.id} onClick={() => { setActiveId(c.id); setActiveTab('info') }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                      isActive ? 'bg-accent/10 border-r-2 border-accent text-textPrimary' : 'text-textSecondary hover:bg-border/20'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d}`} />
                    <span className="truncate">{c.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ===== 右侧详情 ===== */}
        <div className="flex-1 flex flex-col min-w-0 rounded-r-lg overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-textPrimary truncate">{active.name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-textMuted font-mono">{active.shortId}</span>
                  <button onClick={() => { const doCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 1500) }; const txt = active.id; if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(doCopy).catch(() => {}) } else { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); doCopy() } }}
                    className="p-0.5 hover:text-accent text-textMuted transition-colors shrink-0">
                    {copied ? <Check className="w-3 h-3 text-running" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stText} bg-panel`}>
                {t(`status.${active.status}`, active.status)}
              </span>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-border/30 text-textMuted hover:text-textPrimary transition-colors ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab 导航 */}
          <div className="flex items-center gap-0 px-4 border-b border-border shrink-0 overflow-x-auto">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-textMuted hover:text-textPrimary'
                }`}>
                <tab.icon className="w-3.5 h-3.5" />{t(tab.key)}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && activeTab === 'info' ? (
              <div className="flex items-center justify-center py-16 text-textMuted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('common.loading')}
              </div>
            ) : (
              <>
                {/* ===== 基本信息 ===== */}
                {activeTab === 'info' && detail && (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: t('containers.detail_image'), value: detail.Image || active.image, icon: Box },
                        { label: t('containers.detail_state'), value: detail.State?.Status || active.state, icon: Info },
                        { label: t('containers.colUptime'), value: active.uptime, icon: Clock },
                        { label: t('containers.detail_platform'), value: detail.Platform || '-', icon: Monitor },
                      ].map((item, i) => (
                        <div key={i} className="bg-panel rounded-lg p-3 flex items-center gap-2.5">
                          <item.icon className="w-4 h-4 text-accent shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] text-textMuted">{item.label}</p>
                            <p className="text-xs font-medium text-textPrimary truncate">{item.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {detail.Config && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5 text-accent" />{t('containers.detail_containerConfig')}</h4>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_hostname')}</span><span className="text-textPrimary font-mono truncate">{detail.Config.Hostname || '-'}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_workingDir')}</span><span className="text-textPrimary font-mono truncate">{detail.Config.WorkingDir || resolvedWorkingDir || '-'}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_user')}</span><span className="text-textPrimary font-mono">{detail.Config.User || 'root'}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">TTY</span><span className="text-textPrimary">{detail.Config.Tty ? t('common.yes') : t('common.no')}</span></div>
                          {detail.Config.Entrypoint?.length > 0 && <div className="flex items-center gap-2 col-span-2"><span className="text-textMuted w-24 shrink-0 text-left">Entrypoint</span><span className="text-textPrimary font-mono truncate">{detail.Config.Entrypoint.join(' ')}</span></div>}
                          {detail.Config.Cmd?.length > 0 && <div className="flex items-center gap-2 col-span-2"><span className="text-textMuted w-24 shrink-0 text-left">Cmd</span><span className="text-textPrimary font-mono truncate">{detail.Config.Cmd.join(' ')}</span></div>}
                        </div>
                      </div>
                    )}
                    {detail.HostConfig && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5 text-accent" />{t('containers.detail_hostConfig')}</h4>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_restartPolicy')}</span><span className="text-textPrimary">{detail.HostConfig.RestartPolicy?.Name || 'no'}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_networkMode')}</span><span className="text-textPrimary font-mono">{detail.HostConfig.NetworkMode || 'default'}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_memoryLimit')}</span><span className="text-textPrimary">{detail.HostConfig.Memory > 0 ? `${Math.round(detail.HostConfig.Memory / 1024 / 1024)} MB` : t('containers.detail_unlimited')}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_cpuLimit')}</span><span className="text-textPrimary">{detail.HostConfig.NanoCpus > 0 ? `${(detail.HostConfig.NanoCpus / 1e9).toFixed(2)} ${t('containers.detail_core')}` : t('containers.detail_unlimited')}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_privileged')}</span><span className="text-textPrimary">{detail.HostConfig.Privileged ? t('common.yes') : t('common.no')}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_autoRemove')}</span><span className="text-textPrimary">{detail.HostConfig.AutoRemove ? t('common.yes') : t('common.no')}</span></div>
                        </div>
                      </div>
                    )}
                    {isRunning && stats && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-accent" />{t('containers.detail_realtimeResources')}</h4>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div><span className="text-textMuted">CPU</span><p className="text-textPrimary font-mono font-semibold">{stats.cpu_percent?.toFixed(1)}%</p></div>
                          <div><span className="text-textMuted">{t('monitor.memory')}</span><p className="text-textPrimary font-mono font-semibold">{formatBytes(stats.memory_usage)} / {formatBytes(stats.memory_limit)}</p></div>
                          <div><span className="text-textMuted">{t('containers.detail_networkRx')}</span><p className="text-textPrimary font-mono font-semibold">{formatBytes(stats.network_rx)}</p></div>
                          <div><span className="text-textMuted">{t('containers.detail_networkTx')}</span><p className="text-textPrimary font-mono font-semibold">{formatBytes(stats.network_tx)}</p></div>
                        </div>
                      </div>
                    )}
                    {detail.Config?.Labels && Object.keys(detail.Config.Labels).length > 0 && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-accent" />{t('containers.detail_labels')}</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(detail.Config.Labels).map(([k, v]) => (
                            <span key={k} className="text-[10px] px-2 py-1 rounded bg-surface border border-border text-textSecondary font-mono">
                              <span className="text-accent">{k}</span>={v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== 资源使用 ===== */}
                {activeTab === 'stats' && (
                  <div className="p-4 space-y-4">
                    {detail?.HostConfig && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5 text-accent" />{t('containers.detail_resourceLimits')}</h4>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_cpuLimit')}</span><span className="text-textPrimary font-mono">{detail.HostConfig.NanoCpus > 0 ? `${(detail.HostConfig.NanoCpus / 1e9).toFixed(2)} ${t('containers.detail_core')}` : t('containers.detail_unlimited')}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_cpuWeight')}</span><span className="text-textPrimary font-mono">{detail.HostConfig.CpuShares || 1024}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_memoryLimit')}</span><span className="text-textPrimary font-mono">{detail.HostConfig.Memory > 0 ? formatBytes(detail.HostConfig.Memory) : t('containers.detail_unlimited')}</span></div>
                          <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_memorySwapLimit')}</span><span className="text-textPrimary font-mono">{detail.HostConfig.MemorySwap > 0 ? formatBytes(detail.HostConfig.MemorySwap) : t('containers.detail_unlimited')}</span></div>
                        </div>
                      </div>
                    )}
                    {stats ? (
                      <div className="bg-panel rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-semibold text-textPrimary flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-accent" />{t('containers.detail_realtimeMetrics')}</h4>
                          <button onClick={loadStats} className="p-1 rounded hover:bg-border/30 text-textMuted hover:text-textPrimary"><RotateCw className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-3">
                          <div><div className="flex justify-between text-xs mb-1"><span className="text-textMuted flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</span><span className="text-textPrimary font-mono font-semibold">{stats.cpu_percent?.toFixed(1)}%</span></div>
                            <div className="metric-bar"><div className="metric-bar-fill bg-accent" style={{ width: `${Math.min(stats.cpu_percent || 0, 100)}%` }} /></div></div>
                            <div><div className="flex justify-between text-xs mb-1"><span className="text-textMuted flex items-center gap-1"><HardDrive className="w-3 h-3" /> {t('monitor.memory')}</span><span className="text-textPrimary font-mono font-semibold">{stats.memory_percent?.toFixed(1)}%</span></div>
                            <div className="metric-bar"><div className="metric-bar-fill bg-warning" style={{ width: `${Math.min(stats.memory_percent || 0, 100)}%` }} /></div>
                            <p className="text-[10px] text-textMuted mt-1">{formatBytes(stats.memory_usage)} / {formatBytes(stats.memory_limit)}</p></div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left flex items-center gap-1"><Download className="w-3 h-3" />{t('containers.detail_networkRx')}</span><span className="text-textPrimary font-mono">{formatBytes(stats.network_rx)}</span></div>
                            <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left flex items-center gap-1"><Upload className="w-3 h-3" />{t('containers.detail_networkTx')}</span><span className="text-textPrimary font-mono">{formatBytes(stats.network_tx)}</span></div>
                            <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_blockRead')}</span><span className="text-textPrimary font-mono">{formatBytes(stats.block_read)}</span></div>
                            <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_blockWrite')}</span><span className="text-textPrimary font-mono">{formatBytes(stats.block_write)}</span></div>
                            <div className="flex items-center gap-2 col-span-2"><span className="text-textMuted w-24 shrink-0 text-left">{t('containers.detail_pidsCount')}</span><span className="text-textPrimary font-mono font-semibold">{stats.pids}</span></div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-8 text-textMuted">
                        <Monitor className="w-8 h-8 opacity-30" /><p className="text-sm">{t('containers.detail_clickToRefreshStats')}</p>
                        <button onClick={loadStats} className="action-btn action-btn-primary text-xs">{t('containers.refresh')}</button>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== 环境变量 ===== */}
                {activeTab === 'env' && detail?.Config?.Env && (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-textMuted">{detail.Config.Env.length} {t('containers.detail_envCount')}</span>
                      <button onClick={() => setShowSecrets(prev => !prev)} className={`text-xs px-2 py-1 rounded transition-colors ${showSecrets ? 'bg-warning/10 text-warning' : 'bg-running/10 text-running'}`}>
                        {showSecrets ? t('containers.detail_hideSecrets') : t('containers.detail_showSecrets')}
                      </button>
                    </div>
                    <div className="bg-panel rounded-lg overflow-hidden">
                      <table className="w-full"><thead><tr className="border-b border-border"><th className="px-3 py-2 text-left text-xs font-medium text-textMuted w-1/3">{t('containers.detail_varName')}</th><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_varValue')}</th></tr></thead>
                        <tbody>{detail.Config.Env.map((env, i) => {
                          const eq = env.indexOf('='), key2 = eq >= 0 ? env.slice(0, eq) : env, val = eq >= 0 ? env.slice(eq + 1) : ''
                          const isSecret = isSecretValue(key2, val)
                          return (<tr key={i} className="border-b border-border/30 hover:bg-surface/50"><td className="px-3 py-2 text-xs font-mono text-accent">{isSecret && <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning mr-1.5 align-middle" />}{key2}</td><td className="px-3 py-2 text-xs font-mono text-textSecondary break-all">{isSecret && !showSecrets ? '••••••••' : val}</td></tr>)
                        })}</tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ===== 端口/网络 ===== */}
                {activeTab === 'ports' && detail && (
                  <div className="p-4 space-y-4">
                    <div className="bg-panel rounded-lg p-3">
                      <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-accent" />{t('containers.detail_portMappings')}</h4>
                      {active.ports.length > 0 ? (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{active.ports.map((p, i) => (
                          <div key={i} className="flex items-center gap-2"><span className="font-mono text-textPrimary">{p.public ? `${p.public}:` : ''}{p.private}</span><span className="text-textMuted">/{p.type}</span>{p.public && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-textMuted">→ {p.public}</span>}</div>
                        ))}</div>
                      ) : <p className="text-xs text-textMuted">{t('containers.detail_noPorts')}</p>}
                    </div>
                    {detail.NetworkSettings?.Networks && (
                      <div className="bg-panel rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5"><Network className="w-3.5 h-3.5 text-accent" />{t('containers.detail_networkInterfaces')}</h4>
                        {Object.entries(detail.NetworkSettings.Networks).map(([name, net]: [string, any]) => (
                          <div key={name} className="mb-2 last:mb-0"><p className="text-xs font-medium text-textPrimary mb-1">{name}</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs pl-2">
                              <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">IP</span><span className="text-textPrimary font-mono">{net.IPAddress || '-'}</span></div>
                              <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">Gateway</span><span className="text-textPrimary font-mono">{net.Gateway || '-'}</span></div>
                              <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">MAC</span><span className="text-textPrimary font-mono text-[11px]">{net.MacAddress || '-'}</span></div>
                              <div className="flex items-center gap-2"><span className="text-textMuted w-24 shrink-0 text-left">Network ID</span><span className="text-textPrimary font-mono text-[11px]">{net.NetworkID?.slice(0, 12) || '-'}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ===== 卷/挂载 ===== */}
                {activeTab === 'volumes' && detail?.Mounts && (
                  <div className="p-4">
                    {detail.Mounts.length > 0 ? (
                      <div className="bg-panel rounded-lg overflow-hidden"><table className="w-full"><thead><tr className="border-b border-border"><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_mountType')}</th><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_mountSource')}</th><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_mountDest')}</th><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_mountMode')}</th><th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('containers.detail_mountRw')}</th></tr></thead>
                        <tbody>{detail.Mounts.map((m, i) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-surface/50"><td className="px-3 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.Type === 'volume' ? 'bg-accent/10 text-accent' : m.Type === 'bind' ? 'bg-warning/10 text-warning' : 'bg-border/30 text-textSecondary'}`}>{m.Type}</span></td><td className="px-3 py-2 text-xs font-mono text-textSecondary max-w-[160px] truncate">{m.Source}</td><td className="px-3 py-2 text-xs font-mono text-textPrimary">{m.Destination}</td><td className="px-3 py-2 text-xs text-textMuted">{m.Mode}</td><td className="px-3 py-2 text-xs"><span className={m.RW ? 'text-running' : 'text-warning'}>{m.RW ? 'RW' : 'RO'}</span></td></tr>
                        ))}</tbody></table></div>
                    ) : <div className="text-center py-8 text-textMuted text-sm">{t('containers.detail_noMounts')}</div>}
                  </div>
                )}

                {/* ===== 进程 ===== */}
                {activeTab === 'process' && (
                  <div className="p-4">
                    {processes ? (
                      <div className="bg-panel rounded-lg overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border">{processes.Titles.map((t, i) => <th key={i} className="px-3 py-2 text-left text-xs font-medium text-textMuted whitespace-nowrap">{t}</th>)}</tr></thead>
                        <tbody>{processes.Processes.map((p, i) => <tr key={i} className="border-b border-border/30 hover:bg-surface/50">{p.map((c, j) => <td key={j} className="px-3 py-1.5 text-xs font-mono text-textSecondary whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table></div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-8 text-textMuted"><Box className="w-8 h-8 opacity-30" /><p className="text-sm">{t('containers.detail_clickToRefreshProcess')}</p><button onClick={loadProcesses} className="action-btn action-btn-primary text-xs">{t('containers.refresh')}</button></div>
                    )}
                  </div>
                )}

                {/* ===== 日志 ===== */}
                {activeTab === 'logs' && (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                      <div className="flex items-center gap-2"><ScrollText className="w-3.5 h-3.5 text-accent" /><span className="text-xs text-textSecondary">{t('containers.detail_realtimeLogs')}</span></div>
                      <div className="flex items-center gap-1">
                        <button onClick={toggleLogPause} className={`text-xs px-2 py-1 rounded ${logsPaused ? 'bg-running/10 text-running' : 'bg-warning/10 text-warning'}`}>{logsPaused ? t('logs.resume') : t('logs.pause')}</button>
                        <button onClick={() => setLogs('')} className="text-xs px-2 py-1 rounded bg-border/30 text-textMuted hover:text-textPrimary">{t('logs.clear')}</button>
                      </div>
                    </div>
                    <div className="flex-1 bg-panel p-3 overflow-y-auto font-mono text-xs leading-relaxed" style={{ maxHeight: 'calc(85vh - 160px)' }}>
                      {logsLoading && !logsPaused ? <div className="flex items-center justify-center py-8 text-textMuted"><Loader2 className="w-4 h-4 animate-spin mr-2" />{t('logs.loadingLogs')}</div>
                      : logsPaused && logLines.length === 0 ? <div className="text-textMuted">{t('logs.paused')}</div>
                      : logLines.length === 0 ? <div className="text-textMuted">{t('logs.waitingLogs')}</div>
                      : logLines.map((line, i) => <div key={i} className={`hover:bg-surface/30 py-0.5 ${line.includes('error') || line.includes('Error') ? 'text-error' : 'text-textSecondary'}`}>{line || ' '}</div>)}
                    <div ref={logsEndRef} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
