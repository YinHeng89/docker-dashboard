import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings, Monitor, Shield, Key, Globe, Palette, RefreshCcw, Save, Loader2, CheckCircle2, XCircle,
  Cpu, HardDrive, Network, Activity, AlertTriangle, Plus, Trash2, Server,
  ScrollText, Search, User, Eye, EyeOff, Download, ArrowUpCircle, Zap, Info, Pencil, X,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts'
import { useSystemInfo } from '../hooks/useSystemInfo'
import { changePassword, getCurrentUser } from '../api/auth'
import LangToggle from '../components/LangToggle'
import ThemeToggle from '../components/ThemeToggle'
import { fetchServerInfo, ServerInfo } from '../api/system'
import { useTheme } from '../hooks/useTheme'
import type { AlertRule, SystemInfo, SystemMetrics, Service } from '../types'

// ===== Tab 定义 =====
type SettingsTab = 'docker' | 'monitor' | 'logs' | 'preferences'

interface TabItem {
  id: SettingsTab
  label: string
  icon: React.ElementType
  zhLabel: string
}

const tabs: TabItem[] = [
  { id: 'docker', label: 'about', icon: Info, zhLabel: '关于系统' },
  { id: 'monitor', label: 'monitor', icon: Activity, zhLabel: '监控告警' },
  { id: 'logs', label: 'logs', icon: ScrollText, zhLabel: '系统日志' },
  { id: 'preferences', label: 'preferences', icon: Settings, zhLabel: '偏好设置' },
]

// ===== 监控相关类型 =====
type TimeRange = '5m' | '15m' | '1h' | '6h'
interface MetricsPoint { time: string; cpu: number; memory: number; disk: number; netDown: number; netUp: number }
const windowSize: Record<TimeRange, number> = { '5m': 30, '15m': 90, '1h': 360, '6h': 2160 }
const MAX_POINTS = 720

// ===== 系统日志类型 =====
interface SystemLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  module: string
  message: string
}
// ===== 自动更新检测相关 =====
type UpdateCheckState = 'idle' | 'checking' | 'up_to_date' | 'update_available' | 'error'
interface UpdateInfo { currentVersion: string; latestVersion: string; releaseDate: string; changelog: string[] }

export default function SettingsPage({ metrics, services }: { metrics: SystemMetrics | null; services: Service[] }) {
  const { t, i18n } = useTranslation()
  const { info: systemInfo } = useSystemInfo()

  // ===== Tab 状态 =====
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const saved = localStorage.getItem('settingsTab')
    return (saved === 'docker' || saved === 'monitor' || saved === 'logs' || saved === 'preferences')
      ? saved as SettingsTab : 'docker'
  })
  const handleTabChange = (tab: SettingsTab) => {
    localStorage.setItem('settingsTab', tab)
    setActiveTab(tab)
  }

  // 如果旧 localStorage 存的是 'users'，重定向
  useEffect(() => {
    if (localStorage.getItem('settingsTab') === 'users') {
      localStorage.setItem('settingsTab', 'preferences')
    }
  }, [])

  // ===== 密码修改状态 =====
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordResult, setPasswordResult] = useState<'success' | 'error' | null>(null)
  const [showOldPass, setShowOldPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)

  const { theme, setTheme } = useTheme()
  const [refreshInterval, setRefreshInterval] = useState(Number(localStorage.getItem('refreshInterval')) || 10)

  // ===== 自动更新检测状态 =====
  const [updateState, setUpdateState] = useState<UpdateCheckState>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({
    currentVersion: '2.1.0',
    latestVersion: '2.2.0',
    releaseDate: '2026-06-20',
    changelog: [
      '新增系统日志中心功能',
      '优化主题切换性能',
      '修复容器状态检测问题',
      '改进侧边栏响应式布局',
      '更新依赖库至最新版本',
    ],
  })
  const [checkProgress, setCheckProgress] = useState(0)

  const checkForUpdates = useCallback(() => {
    setUpdateState('checking')
    setCheckProgress(0)
    const interval = setInterval(() => {
      setCheckProgress(prev => {
        const next = prev + Math.random() * 30
        if (next >= 100) {
          clearInterval(interval)
          setTimeout(() => {
            // 模拟：80% 概率有更新
            const hasUpdate = Math.random() < 0.3
            if (hasUpdate) {
              setUpdateState('update_available')
              setUpdateInfo(prev => ({
                ...prev,
                latestVersion: `${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}`,
              }))
            } else {
              setUpdateState('up_to_date')
            }
          }, 500)
          return 100
        }
        return next
      })
    }, 200)
  }, [])

  // ===== 系统日志状态（真实数据，来自服务端日志缓冲） =====
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem('system-logs')
      if (!saved) return []
      const parsed = JSON.parse(saved)
      // 清除旧版假数据（以 'init-' 开头的 ID 为假日志）
      if (parsed.length > 0 && parsed[0]?.id?.startsWith?.('init-')) {
        localStorage.removeItem('system-logs')
        return []
      }
      return parsed
    } catch { return [] }
  })
  const [logSearch, setLogSearch] = useState('')
  const [logPaused, setLogPaused] = useState(false)
  const [logAutoScroll, setLogAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const lastLogIdRef = useRef<string>('')

  // 从服务端拉取真实日志
  useEffect(() => {
    const fetchLogs = async () => {
      if (lastLogIdRef.current === '__clearing__') return // 清除中，跳过
      try {
        const since = lastLogIdRef.current || undefined
        const url = since ? `/api/system/logs?since=${since}` : '/api/system/logs'
        const res = await fetch(url)
        const data = await res.json()
        const newLogs = (data.logs || []) as SystemLogEntry[]
        if (newLogs.length > 0) {
          lastLogIdRef.current = newLogs[newLogs.length - 1]!.id
          setSystemLogs(prev => {
            // 首次加载：服务端数据替换 localStorage 缓存（避免重复累加）
            const next = since ? [...prev, ...newLogs] : newLogs
            return next.length > 500 ? next.slice(-500) : next
          })
        }
      } catch { /* ignore */ }
    }

    // 初始加载
    fetchLogs()

    // 每 2 秒轮询增量
    const timer = setInterval(() => { if (!logPaused) fetchLogs() }, 2000)
    return () => clearInterval(timer)
  }, [logPaused])

  // 自动滚动
  useEffect(() => {
    if (logAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [systemLogs, logAutoScroll])

  // 持久化日志（localStorage 缓存，刷新不丢）
  useEffect(() => {
    if (systemLogs.length > 0) {
      localStorage.setItem('system-logs', JSON.stringify(systemLogs.slice(-200)))
    }
  }, [systemLogs])

  const clearSystemLogs = () => {
    setSystemLogs([])
    localStorage.removeItem('system-logs')
    // 用服务端最新日志 ID 作为 since 起点，不依赖前端 stale state
    lastLogIdRef.current = '__clearing__'  // 标记正在清除
    fetch('/api/system/logs')
      .then(r => r.json())
      .then(d => {
        const logs = d.logs || []
        lastLogIdRef.current = logs.length > 0 ? logs[logs.length - 1].id : ''
      })
      .catch(() => { lastLogIdRef.current = '' })
  }

  const filteredLogs = useMemo(() => {
    if (!logSearch) return systemLogs
    return systemLogs.filter(log =>
      log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.module.toLowerCase().includes(logSearch.toLowerCase())
    )
  }, [systemLogs, logSearch])

  const logLevelColors: Record<string, string> = {
    info: 'text-textSecondary',
    warn: 'text-warning',
    error: 'text-error',
    success: 'text-running',
  }
  const logLevelBadge: Record<string, string> = {
    info: 'bg-accent/10 text-accent',
    warn: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    success: 'bg-running/10 text-running',
  }
  // 兜底：未知 level 用默认样式
  const getLevelColor = (level: string) => logLevelColors[level] || 'text-textSecondary'
  const getLevelBadge = (level: string) => logLevelBadge[level] || 'bg-border/30 text-textMuted'

  // ===== 服务器运行信息 =====
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)

  useEffect(() => {
    fetchServerInfo().then(setServerInfo).catch(() => {})
  }, [])

  // ===== 用户管理状态 =====
  const [userInfo, setUserInfo] = useState<{ username: string; configured: boolean } | null>(null)

  useEffect(() => {
    getCurrentUser().then(setUserInfo).catch(() => {})
  }, [])

  // ===== 监控状态 =====
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [history, setHistory] = useState<MetricsPoint[]>([])
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => {
    try {
      const saved = localStorage.getItem('alert-rules')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [editingRule, setEditingRule] = useState<Partial<AlertRule> | null>(null)
  const showAlertRules = false // 默认关闭告警规则编辑

  useEffect(() => {
    localStorage.setItem('alert-rules', JSON.stringify(alertRules))
  }, [alertRules])

  useEffect(() => {
    if (!metrics) return
    const now = new Date().toLocaleTimeString()
    setHistory(prev => {
      const next = [...prev, { time: now, cpu: metrics.cpu, memory: metrics.memory, disk: metrics.disk, netDown: metrics.netDown, netUp: metrics.netUp }]
      if (next.length > MAX_POINTS) return next.slice(-MAX_POINTS)
      return next
    })
  }, [metrics])

  const displayData = useMemo(() => {
    const size = windowSize[timeRange]
    return history.slice(-size)
  }, [history, timeRange])

  const containerRanking = useMemo(() => {
    return [...services].filter(s => s.status === 'running').sort((a, b) => b.totalCpu - a.totalCpu).slice(0, 10)
  }, [services])

  const chartColor = { cpu: '#3b82f6', memory: '#f59e0b', disk: '#22c55e', netDown: '#6366f1', netUp: '#ec4899' }

  // ===== 密码修改 =====
  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) { setPasswordResult('error'); return }
    setPasswordSaving(true); setPasswordResult(null)
    try {
      await changePassword(oldPassword, newPassword)
      setPasswordResult('success')
      setOldPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch { setPasswordResult('error') }
    finally { setPasswordSaving(false) }
  }

  // ===== 偏好设置 — 实时生效 =====
  const handleLangChange = (v: string) => {
    localStorage.setItem('lang', v)
    i18n.changeLanguage(v)
  }
  const handleThemeChange = (v: string) => {
    setTheme(v as 'dark' | 'light')
  }
  const handleRefreshChange = (v: number) => {
    setRefreshInterval(v)
    localStorage.setItem('refreshInterval', String(v))
  }

  const fmtGb = (gb: number) => gb > 0 ? `${gb.toFixed(1)} GB` : '-'
  const tabLabel = (tab: TabItem) => t(`settings.tab_${tab.label}`, tab.zhLabel)

  // ===== 渲染 =====
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Tab 导航栏 */}
        <div className="flex items-center gap-1 p-1 bg-surface border border-border rounded-xl overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-accent text-white shadow-sm shadow-accent/20'
                  : 'text-textSecondary hover:text-textPrimary hover:bg-border/30'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tabLabel(tab)}</span>
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div className="animate-slideInUp">
          {activeTab === 'docker' && <DockerEngineTab systemInfo={systemInfo} fmtGb={fmtGb} serverInfo={serverInfo} updateInfo={updateInfo} />}
          {activeTab === 'monitor' && (
            <MonitorTab
              metrics={metrics} timeRange={timeRange} setTimeRange={setTimeRange}
              displayData={displayData} chartColor={chartColor}
              containerRanking={containerRanking}
              alertRules={alertRules} setAlertRules={setAlertRules}
              editingRule={editingRule} setEditingRule={setEditingRule}
              showAlertRules={showAlertRules}
            />
          )}
          {activeTab === 'logs' && (
            <SystemLogsTab
              filteredLogs={filteredLogs} logSearch={logSearch} setLogSearch={setLogSearch}
              logPaused={logPaused} setLogPaused={setLogPaused}
              logAutoScroll={logAutoScroll} setLogAutoScroll={setLogAutoScroll}
              clearSystemLogs={clearSystemLogs}
              getLevelColor={getLevelColor} getLevelBadge={getLevelBadge}
              logContainerRef={logContainerRef}
            />
          )}
          {activeTab === 'preferences' && (
            <PreferencesTab
              theme={theme}
              refreshInterval={refreshInterval}
              onLangChange={handleLangChange}
              onThemeChange={handleThemeChange}
              onRefreshChange={handleRefreshChange}
              updateState={updateState} updateInfo={updateInfo}
              checkProgress={checkProgress} checkForUpdates={checkForUpdates}
              setUpdateState={setUpdateState}
              userInfo={userInfo}
              oldPassword={oldPassword} setOldPassword={setOldPassword}
              newPassword={newPassword} setNewPassword={setNewPassword}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              passwordSaving={passwordSaving} passwordResult={passwordResult}
              showOldPass={showOldPass} setShowOldPass={setShowOldPass}
              showNewPass={showNewPass} setShowNewPass={setShowNewPass}
              handleChangePassword={handleChangePassword}
            />
          )}
        </div>
      </div>
    </main>
  )
}

// ============================================================
// Docker 引擎 Tab
// ============================================================
function DockerEngineTab({ systemInfo, fmtGb, serverInfo, updateInfo }: {
  systemInfo: SystemInfo | null; fmtGb: (gb: number) => string;
  serverInfo: ServerInfo | null; updateInfo: UpdateInfo;
}) {
  const { t } = useTranslation()
  if (!systemInfo) {
    return (
      <div className="flex items-center justify-center py-16 text-textMuted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左列：Docker 引擎信息 */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-textPrimary mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-accent" />{t('settings.dockerEngine')}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          {[
            [t('sys.dockerVersion'), systemInfo.dockerVersion],
            [t('sys.sdkVersion'), systemInfo.sdkVersion],
            [t('sys.os'), systemInfo.os],
            [t('sys.arch'), systemInfo.arch],
            [t('settings.cpuCores'), `${systemInfo.cpus} ${t('containers.detail_core')}`],
            [t('settings.systemMemory'), fmtGb(systemInfo.memoryGB)],
            [t('sys.driver'), systemInfo.driver],
            [t('sys.dockerRoot'), systemInfo.dockerRoot],
            [t('sys.hostname'), systemInfo.hostname],
            [t('settings.kernelVersion'), systemInfo.kernel],
            [t('sys.cgroupDriver'), systemInfo.cgroupDriver],
            [t('sys.loggingDriver'), systemInfo.loggingDriver],
            [t('sys.uptime'), systemInfo.uptime],
            [t('settings.dockerHost'), systemInfo.dockerHost],
          ].map(([label, value], i) => (
            <div key={i} className="flex flex-col gap-0.5 py-1.5 border-b border-border/30 last:border-0">
              <span className="text-textMuted">{label}</span>
              <span className="text-textPrimary font-mono truncate">{value || '-'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 右列：关于系统 + 运行信息 */}
      <div className="space-y-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-textPrimary mb-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-accent" />{t('settings.aboutSystem')}
          </h3>
          <div className="flex flex-col text-xs">
            {[
              [t('settings.appName'), 'Docker Dashboard', false],
              [t('settings.versionNumber'), updateInfo.currentVersion, true],
              [t('settings.frontend'), 'React + TypeScript', false],
              [t('settings.uiFramework'), 'Tailwind CSS', false],
              [t('settings.chartLibrary'), 'Recharts', false],
            ].map(([label, value, isMono], i) => (
              <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                <span className="text-textMuted">{label}</span>
                <span className={`text-textPrimary ${isMono ? 'font-mono' : ''}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {serverInfo && (
          <div className="bg-surface border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-textPrimary mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-accent" />{t('settings.runtimeInfo')}
            </h3>
            <div className="flex flex-col text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.listenPort')}</span>
                <span className="text-textPrimary font-mono">{serverInfo.port}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.projectDir')}</span>
                <span className="text-textPrimary font-mono truncate max-w-[160px]" title={serverInfo.projectsDir}>{serverInfo.projectsDir.split('/').pop()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.dockerSocket')}</span>
                <span className="text-textPrimary font-mono text-[11px]">/var/run/docker.sock</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.nodeVersion')}</span>
                <span className="text-textPrimary font-mono">{serverInfo.nodeVersion}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.platform')}</span>
                <span className="text-textPrimary">{serverInfo.platform} / {serverInfo.arch}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-border/30">
                <span className="text-textMuted">{t('settings.relativePath')}</span>
                <span className={`flex items-center gap-1 ${serverInfo.relativePathSupported ? 'text-running' : 'text-error'}`}>
                  {serverInfo.relativePathSupported
                    ? <><CheckCircle2 className="w-3 h-3" />{t('settings.supported')}</>
                    : <><XCircle className="w-3 h-3" />{t('settings.unsupported')}</>
                  }
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 last:border-0">
                <span className="text-textMuted">JWT</span>
                <span className={`flex items-center gap-1 ${serverInfo.jwtConfigured ? 'text-running' : 'text-warning'}`}>
                  {serverInfo.jwtConfigured
                    ? <><CheckCircle2 className="w-3 h-3" />{t('settings.configured')}</>
                    : <><AlertTriangle className="w-3 h-3" />{t('settings.randomValue')}</>
                  }
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 监控告警 Tab
// ============================================================
function MonitorTab({
  metrics, timeRange, setTimeRange, displayData, chartColor, containerRanking,
  alertRules, setAlertRules, editingRule, setEditingRule, showAlertRules,
}: {
  metrics: any; timeRange: TimeRange; setTimeRange: (r: TimeRange) => void;
  displayData: MetricsPoint[]; chartColor: Record<string, string>;
  containerRanking: any[];
  alertRules: AlertRule[]; setAlertRules: React.Dispatch<React.SetStateAction<AlertRule[]>>;
  editingRule: Partial<AlertRule> | null; setEditingRule: React.Dispatch<React.SetStateAction<Partial<AlertRule> | null>>;
  showAlertRules: boolean;
}) {
  const { t } = useTranslation()
  const addRule = () => {
    const rule: AlertRule = {
      id: Date.now().toString(),
      name: editingRule?.name || `规则 ${alertRules.length + 1}`,
      type: editingRule?.type || 'cpu',
      threshold: editingRule?.threshold || 80,
      enabled: true,
    }
    setAlertRules(prev => [...prev, rule])
    setEditingRule(null)
  }
  const removeRule = (id: string) => setAlertRules(prev => prev.filter(r => r.id !== id))

  return (
    <div className="space-y-4">
      {/* 概览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 items-stretch">
        {metrics ? (
          <>
            {[
              { label: t('monitor.cpu'), value: `${metrics.cpu}%`, icon: Cpu, color: 'text-accent', bg: 'bg-accent/10', barColor: 'bg-accent', sub: `${metrics.cpuCores} ${t('containers.detail_core')}`, percent: metrics.cpu },
              { label: t('monitor.memory'), value: `${metrics.memory}%`, icon: HardDrive, color: 'text-warning', bg: 'bg-warning/10', barColor: 'bg-warning', sub: `${metrics.memoryUsed?.toFixed(1) || '0'} / ${metrics.memoryTotal?.toFixed(1) || '0'} GB`, percent: metrics.memory },
              { label: t('monitor.diskUsage'), value: `${metrics.disk}%`, icon: Monitor, color: 'text-running', bg: 'bg-running/10', barColor: 'bg-running', sub: `${metrics.diskUsedGB?.toFixed(1) || '0'} / ${metrics.diskTotalGB?.toFixed(1) || '0'} GB`, percent: metrics.disk },
            ].map((item, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-4 hover:border-accent/30 transition-all duration-200 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                    </div>
                    <span className="text-xs text-textMuted truncate">{item.label}</span>
                  </div>
                  <span className={`text-sm font-bold font-mono shrink-0 ml-2 ${item.color}`}>{item.value}</span>
                </div>
                <div className="mt-auto pb-4">
                  <div className="metric-bar">
                    <div className={`metric-bar-fill ${item.barColor}`} style={{ width: `${Math.min(item.percent, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-textMuted mt-1.5">{item.sub}</p>
                </div>
              </div>
            ))}
            {/* 网络卡片 — 双 bar */}
            <div className="bg-surface border border-border rounded-xl p-4 hover:border-accent/30 transition-all duration-200 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-border/30 flex items-center justify-center shrink-0">
                    <Network className="w-4 h-4 text-textSecondary" />
                  </div>
                  <span className="text-xs text-textMuted">{t('monitor.networkTraffic')}</span>
                </div>
                <span className="text-[10px] text-textMuted">{t('monitor.networkBaseline')}</span>
              </div>
              <div className="space-y-3 mt-auto">
                {/* 下载 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-textMuted flex items-center gap-1">↓ {t('monitor.download')}</span>
                    <span className="text-[11px] font-mono font-semibold text-indigo-400">{metrics.netDown?.toFixed(1) || '0'} MB/s</span>
                  </div>
                  <div className="metric-bar">
                    <div className="metric-bar-fill bg-indigo-500" style={{ width: `${Math.min((metrics.netDown || 0) / 125 * 100, 100)}%` }} />
                  </div>
                </div>
                {/* 上传 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-textMuted flex items-center gap-1">↑ {t('monitor.upload')}</span>
                    <span className="text-[11px] font-mono font-semibold text-pink-400">{metrics.netUp?.toFixed(1) || '0'} MB/s</span>
                  </div>
                  <div className="metric-bar">
                    <div className="metric-bar-fill bg-pink-500" style={{ width: `${Math.min((metrics.netUp || 0) / 125 * 100, 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-4 flex items-center justify-center py-8 text-textMuted text-sm">{t('monitor.fetchingMetrics')}</div>
        )}
      </div>

      {/* 时间范围选择 */}
      <div className="flex items-center gap-2">
        {(['5m', '15m', '1h', '6h'] as TimeRange[]).map(r => (
          <button key={r} onClick={() => setTimeRange(r)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${timeRange === r ? 'bg-accent text-white' : 'bg-surface border border-border text-textMuted hover:text-textPrimary hover:border-accent/30'}`}>
            {t(`monitor.range${r}`)}
          </button>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-4">
          <h4 className="text-xs font-semibold text-textPrimary mb-3 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-accent" />{t('monitor.chartCpuTitle')}
          </h4>
          <div className="h-44">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">{t('monitor.collectingData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayData}>
                  <defs><linearGradient id="cpuGr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={chartColor.cpu} stopOpacity={0.3} /><stop offset="95%" stopColor={chartColor.cpu} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border) / 0.3)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="cpu" stroke={chartColor.cpu} fill="url(#cpuGr)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4">
          <h4 className="text-xs font-semibold text-textPrimary mb-3 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-warning" />{t('monitor.chartMemoryTitle')}
          </h4>
          <div className="h-44">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">{t('monitor.collectingData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayData}>
                  <defs><linearGradient id="memGr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={chartColor.memory} stopOpacity={0.3} /><stop offset="95%" stopColor={chartColor.memory} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border) / 0.3)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="memory" stroke={chartColor.memory} fill="url(#memGr)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 col-span-2">
          <h4 className="text-xs font-semibold text-textPrimary mb-3 flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-textSecondary" />{t('monitor.chartNetworkTitle')}
          </h4>
          <div className="h-44">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">{t('monitor.collectingData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border) / 0.3)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} unit=" MB/s" />
                  <Tooltip contentStyle={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="netDown" name="下载" stroke={chartColor.netDown} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="netUp" name="上传" stroke={chartColor.netUp} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* 容器排名 + 告警规则 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-4">
          <h4 className="text-xs font-semibold text-textPrimary mb-3 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-accent" />{t('monitor.containerRanking')}
          </h4>
          {containerRanking.length > 0 ? (
            <table className="w-full">
              <thead><tr className="border-b border-border">
                <th className="py-2 text-left text-[10px] text-textMuted font-medium">#</th>
                <th className="py-2 text-left text-[10px] text-textMuted font-medium">{t('monitor.container')}</th>
                <th className="py-2 text-right text-[10px] text-textMuted font-medium">{t('monitor.cpu')}</th>
                <th className="py-2 text-right text-[10px] text-textMuted font-medium">{t('monitor.memory')}</th>
              </tr></thead>
              <tbody>
                {containerRanking.map((s, i) => (
                  <tr key={s.id} className="border-b border-border/20 hover:bg-panel/50 transition-colors">
                    <td className="py-2 text-[10px] text-textMuted">{i + 1}</td>
                    <td className="py-2 text-xs text-textPrimary truncate max-w-[160px]">{s.name}</td>
                    <td className="py-2 text-xs text-textPrimary text-right font-mono">{s.totalCpu}%</td>
                    <td className="py-2 text-xs text-textPrimary text-right font-mono">{s.totalMemory}{s.memoryUnit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-textMuted py-4 text-center">{t('monitor.noRunningContainers')}</p>
          )}
        </div>

        {/* 告警规则 */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />{t('monitor.alertRules')}
            </h4>
            {showAlertRules && (
              <button onClick={() => setEditingRule({})}
                className="text-xs px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-1 transition-colors">
                <Plus className="w-3 h-3" />{t('monitor.addRule')}
              </button>
            )}
          </div>

          {editingRule !== null && (
            <div className="mb-3 p-3 bg-panel rounded-lg space-y-2">
              <input value={editingRule.name || ''} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                placeholder="规则名称"
                className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textPrimary outline-none" />
              <div className="flex gap-2">
                <select value={editingRule.type || 'cpu'} onChange={e => setEditingRule({ ...editingRule, type: e.target.value as AlertRule['type'] })}
                  className="flex-1 bg-surface border border-border rounded px-2 py-1.5 text-xs text-textPrimary outline-none">
                  <option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option><option value="container_down">Container Down</option>
                </select>
                <input type="number" value={editingRule.threshold || ''} onChange={e => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })}
                  placeholder="阈值"
                  className="w-20 bg-surface border border-border rounded px-2 py-1.5 text-xs text-textPrimary outline-none" />
                <span className="text-xs text-textMuted self-center">%</span>
              </div>
              <div className="flex gap-2">
                <button onClick={addRule} className="action-btn action-btn-primary text-xs px-3 py-1.5 rounded">添加</button>
                <button onClick={() => setEditingRule(null)} className="action-btn-ghost text-xs px-3 py-1.5 rounded hover:bg-border/30">取消</button>
              </div>
            </div>
          )}

          {alertRules.length > 0 ? (
            <div className="space-y-1.5">
              {alertRules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-2.5 bg-panel rounded-lg text-xs hover:bg-border/20 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-textPrimary font-medium">{rule.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent font-medium">{rule.type}</span>
                    <span className="text-textMuted">&gt; {rule.threshold}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={rule.enabled} onChange={() => {
                      setAlertRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
                    }} className="rounded" />
                    <button onClick={() => removeRule(rule.id)}
                      className="p-1 text-textMuted hover:text-error rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <AlertTriangle className="w-8 h-8 text-textMuted/20 mx-auto mb-2" />
              <p className="text-xs text-textMuted">{t('monitor.noRules')}</p>
              <p className="text-[10px] text-textMuted/50 mt-1">{t('monitor.noRulesHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 系统日志 Tab
// ============================================================
function SystemLogsTab({
  filteredLogs, logSearch, setLogSearch,
  logPaused, setLogPaused, logAutoScroll, setLogAutoScroll, clearSystemLogs,
  getLevelColor, getLevelBadge, logContainerRef,
}: {
  filteredLogs: SystemLogEntry[]; logSearch: string; setLogSearch: (v: string) => void;
  logPaused: boolean; setLogPaused: (v: boolean) => void;
  logAutoScroll: boolean; setLogAutoScroll: (v: boolean) => void;
  clearSystemLogs: () => void;
  getLevelColor: (level: string) => string; getLevelBadge: (level: string) => string;
  logContainerRef: React.RefObject<HTMLDivElement>;
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input type="text" value={logSearch} onChange={e => setLogSearch(e.target.value)}
            placeholder={t('logs.searchLogs')}
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-textPrimary placeholder:text-textMuted outline-none focus:border-accent/50 transition-colors" />
        </div>
        <button onClick={() => { setLogPaused(!logPaused); setLogAutoScroll(!logPaused) }}
          className={`text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
            logPaused ? 'bg-running/10 text-running border border-running/20' : 'bg-warning/10 text-warning border border-warning/20'
          }`}>
          {logPaused ? t('logs.resumeBtn') : t('logs.pauseBtn')}
        </button>
        <label className="flex items-center gap-1.5 text-[11px] text-textMuted cursor-pointer select-none">
          <input type="checkbox" checked={logAutoScroll} onChange={e => setLogAutoScroll(e.target.checked)} className="rounded" />
          {t('logs.autoScroll')}
        </label>
        <button onClick={clearSystemLogs}
          className="text-xs px-3 py-2 rounded-lg bg-surface border border-border text-textMuted hover:text-textPrimary hover:border-accent/30 transition-colors">
          {t('logs.clear')}
        </button>
      </div>

      {/* 日志列表 */}
      <div ref={logContainerRef}
        className="bg-surface border border-border rounded-xl overflow-hidden"
        style={{ maxHeight: '500px', overflowY: 'auto' }}
      >
        {filteredLogs.length === 0 ? (
          <div key="empty" className="flex flex-col items-center justify-center py-12 text-textMuted gap-2">
            <ScrollText className="w-10 h-10 opacity-20" />
            <p className="text-sm">{t('logs.noLogs')}</p>
            <p className="text-xs opacity-60">{t('logs.noLogsHint')}</p>
          </div>
        ) : (
          <div key="logs" className="font-mono text-xs">
            {filteredLogs.filter(l => l.id && l.message).map(log => (
              <div key={log.id}
                className={`flex items-start gap-3 px-4 py-2.5 border-b border-border/20 hover:bg-panel/50 transition-colors ${getLevelColor(log.level)}`}>
                <span className="text-textMuted shrink-0 w-[140px] select-none">
                  {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                  <span className="ml-1 opacity-40">{new Date(log.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${getLevelBadge(log.level || 'info')}`}>
                  {(log.level || 'INFO').toUpperCase()}
                </span>
                <span className="text-textMuted shrink-0 w-20">{log.module}</span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 偏好设置 Tab（含用户管理）
// ============================================================
function PreferencesTab({
  theme, refreshInterval,
  onLangChange, onThemeChange, onRefreshChange,
  updateState, updateInfo, checkProgress, checkForUpdates, setUpdateState,
  userInfo,
  oldPassword, setOldPassword, newPassword, setNewPassword, confirmPassword, setConfirmPassword,
  passwordSaving, passwordResult, showOldPass, setShowOldPass, showNewPass, setShowNewPass,
  handleChangePassword,
}: {
  theme: string; refreshInterval: number;
  onLangChange: (v: string) => void;
  onThemeChange: (v: string) => void;
  onRefreshChange: (v: number) => void;
  updateState: UpdateCheckState; updateInfo: UpdateInfo;
  checkProgress: number; checkForUpdates: () => void;
  setUpdateState: (v: UpdateCheckState) => void;
  userInfo: { username: string; configured: boolean } | null;
  oldPassword: string; setOldPassword: (v: string) => void;
  newPassword: string; setNewPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  passwordSaving: boolean; passwordResult: 'success' | 'error' | null;
  showOldPass: boolean; setShowOldPass: (v: boolean) => void;
  showNewPass: boolean; setShowNewPass: (v: boolean) => void;
  handleChangePassword: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation()
  const [displayName, setDisplayName] = useState('admin')
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [autoUpdateInterval, setAutoUpdateInterval] = useState(6)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('admin')

  // 加载自动更新设置（与 Header 铃铛完全一致）
  useEffect(() => {
    fetch('/api/auto-update/status')
      .then(r => r.json())
      .then(d => {
        if (d.settings) {
          setAutoUpdateEnabled(!!d.settings.enabled)
          setAutoUpdateInterval(d.settings.intervalHours || 6)
        }
      })
      .catch(() => {})
  }, [])

  // 保存自动更新设置
  const saveAutoUpdate = async (enabled: boolean) => {
    setAutoUpdateEnabled(enabled)
    await fetch('/api/auto-update/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, intervalHours: autoUpdateInterval }),
    })
  }

  useEffect(() => {
    const saved = localStorage.getItem('displayName') || userInfo?.username || 'admin'
    setDisplayName(saved)
    setNameInput(saved)
  }, [userInfo])

  const saveDisplayName = () => {
    const name = nameInput.trim() || 'admin'
    setDisplayName(name)
    localStorage.setItem('displayName', name)
    setEditingName(false)
  }

  // 安全提示：关闭后 30 天自动出现
  const [securityTipVisible, setSecurityTipVisible] = useState(() => {
    const dismissed = localStorage.getItem('security-tip-dismissed')
    if (!dismissed) return true
    const elapsed = Date.now() - Number(dismissed)
    return elapsed > 30 * 24 * 60 * 60 * 1000
  })
  const dismissSecurityTip = () => {
    localStorage.setItem('security-tip-dismissed', String(Date.now()))
    setSecurityTipVisible(false)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* 左侧：用户卡片 + 偏好设置 */}
      <div className="lg:col-span-3 space-y-4">
        {/* 用户卡片 */}
        <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/30 to-purple-500/20 flex items-center justify-center shrink-0">
            <User className="w-7 h-7 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setEditingName(false) }}
                  className="flex-1 min-w-[120px] bg-panel border border-border rounded-lg px-2.5 py-1.5 text-sm text-textPrimary outline-none focus:border-accent/50"
                  autoFocus
                />
                <button onClick={saveDisplayName} className="p-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingName(false)} className="p-1.5 rounded-lg hover:bg-border/30 text-textMuted shrink-0">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h3 className="text-base font-bold text-textPrimary">{displayName}</h3>
                <button onClick={() => { setNameInput(displayName); setEditingName(true) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-border/30 text-textMuted hover:text-textPrimary transition-all">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-xs text-textMuted mt-2 flex items-center gap-1">
              <Shield className="w-3 h-3 text-amber-400" />{t('users.admin')}
              <span className="mx-1.5 text-border">·</span>
              <Monitor className="w-3 h-3" />{t('users.singleUser')}
            </p>
          </div>
        </div>

        {/* 偏好设置 */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-textPrimary mb-5 flex items-center gap-2">
            <Palette className="w-4 h-4 text-accent" />{t('settings.preferences')}
          </h3>
          <div className="space-y-4">
            {/* 显示语言 */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-accent" />
                </div>
                <span className="text-sm text-textPrimary">{t('settings.language')}</span>
              </div>
              <LangToggle
                on={!(i18n.language || 'zh').startsWith('zh')}
                onToggle={() => onLangChange((i18n.language || 'zh').startsWith('zh') ? 'en' : 'zh')}
                leftLabel={t('header.langLabelZh')}
                rightLabel={t('header.langLabelEn')}
                title={t('header.switchLang')}
              />
            </div>

            {/* 主题模式 */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Palette className="w-4 h-4 text-warning" />
                </div>
                <span className="text-sm text-textPrimary">{t('settings.theme')}</span>
              </div>
              <ThemeToggle
                on={theme === 'dark'}
                onToggle={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
                leftLabel={t('settings.themeLightLabel')}
                rightLabel={t('settings.themeDarkLabel')}
              />
            </div>

            {/* 刷新间隔 */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-running/10 flex items-center justify-center">
                  <RefreshCcw className="w-4 h-4 text-running" />
                </div>
                <span className="text-sm text-textPrimary">{t('settings.refreshInterval')}</span>
              </div>
              <div className="ml-auto relative flex items-center h-7 p-0.5 bg-panel border border-border rounded-full">
                {/* 水滴滑动指示器 */}
                <div
                  className="absolute top-0.5 bottom-0.5 left-0.5 bg-surface rounded-full shadow-sm transition-all duration-300 ease-out"
                  style={{
                    width: `calc((100% - 4px) / 4)`,
                    transform: `translateX(${['5','10','30','60'].indexOf(String(refreshInterval)) * 100}%)`,
                  }}
                />
                {[5, 10, 30, 60].map(v => (
                  <button key={v} onClick={() => onRefreshChange(v)}
                    className={`relative flex-1 min-w-[38px] h-full px-1.5 text-xs font-medium rounded-full transition-colors duration-200 z-10 flex items-center justify-center
                      ${refreshInterval === v ? 'text-textPrimary' : 'text-textMuted'}`}> 
                    {v}s
                  </button>
                ))}
              </div>
            </div>

            {/* 自动更新开关 */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Download className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-sm text-textPrimary">{t('settings.autoUpdateApps')}</span>
              </div>
              <div className="lang-group">
                <span className="lang-label right">{t('settings.on')}</span>
                <div className={`lang-track${autoUpdateEnabled ? '' : ' on'}`}
                  onClick={() => saveAutoUpdate(!autoUpdateEnabled)}>
                  <span className="lang-knob">
                    <span className="lang-knob-icon lang-knob-off">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/></svg>
                    </span>
                    <span className="lang-knob-icon lang-knob-on">
                      <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
                    </span>
                  </span>
                </div>
                <span className="lang-label left">{t('settings.off')}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 右侧：修改密码 + 自动更新 */}
      <div className="lg:col-span-2 space-y-4">
        {/* 安全提示 */}
        {securityTipVisible && (
          <div className="bg-gradient-to-r from-warning/10 to-transparent border border-border rounded-xl p-4 flex items-start gap-3 relative group">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4.5 h-4.5 text-warning" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-textPrimary">{t('users.security')}</h4>
              <p className="text-xs text-textSecondary mt-0.5 leading-relaxed">{t('users.securityTip')}</p>
            </div>
            <button onClick={dismissSecurityTip}
              className="absolute top-3 right-3 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-border/30 text-textMuted hover:text-textPrimary transition-all">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* 修改密码 */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-sm font-bold text-textPrimary mb-4 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Key className="w-3.5 h-3.5 text-accent" />
            </div>
            {t('settings.changePassword')}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-textSecondary block mb-1">{t('settings.oldPassword')}</label>
              <div className="relative">
                <input type={showOldPass ? 'text' : 'password'} value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full bg-panel border border-border rounded-xl px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 transition-all" />
                <button onClick={() => setShowOldPass(!showOldPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary">
                  {showOldPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary block mb-1">{t('settings.newPassword')}</label>
              <div className="relative">
                <input type={showNewPass ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full bg-panel border border-border rounded-xl px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 transition-all" />
                <button onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary">
                  {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="mt-1.5 flex gap-1">
                {(() => {
                  const pwd = newPassword || ''
                  let score = 0
                  if (pwd.length >= 8) score++
                  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
                  if (/\d/.test(pwd)) score++
                  if (/[^a-zA-Z0-9]/.test(pwd)) score++
                  // 0:无  1:弱(灰)  2:较差(红)  3:中等(橙)  4:强(绿)
                  const colors = ['', 'bg-slate-500/50', 'bg-error/50', 'bg-warning/50', 'bg-running/50']
                  return [1, 2, 3, 4].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= score ? colors[score] : 'bg-border/20'}`} />
                  ))
                })()}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary block mb-1">{t('settings.confirmPassword')}</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••"
                className="w-full bg-panel border border-border rounded-xl px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 transition-all" />
            </div>
            {passwordResult === 'error' && (
              <div className="flex items-center gap-2 p-2.5 bg-error/10 border border-error/20 rounded-xl">
                <XCircle className="w-3.5 h-3.5 text-error shrink-0" />
                <p className="text-xs text-error">{t('settings.passwordChangeFailed')}</p>
              </div>
            )}
            {passwordResult === 'success' && (
              <div className="flex items-center gap-2 p-2.5 bg-running/10 border border-running/20 rounded-xl">
                <CheckCircle2 className="w-3.5 h-3.5 text-running shrink-0" />
                <p className="text-xs text-running">{t('settings.passwordChangeSuccess')}</p>
              </div>
            )}
            <button onClick={handleChangePassword} disabled={!oldPassword || !newPassword || passwordSaving}
              className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accentDim disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-xl transition-all duration-200 active:scale-[0.98]">
              {passwordSaving ? <><Loader2 className="w-4 h-4 animate-spin" />{t('settings.processing')}</> : <><Save className="w-4 h-4" />{t('settings.savePassword')}</>}
            </button>
          </div>
        </div>

        {/* 自动更新检测 */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-textPrimary mb-3 flex items-center gap-2">
            <Download className="w-4 h-4 text-accent" />{t('settings.checkSystemVersion')}
          </h3>
          {updateState === 'idle' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-textMuted">{t('settings.currentVersion')}</span>
                <span className="text-textPrimary font-mono font-medium">{updateInfo.currentVersion}</span>
              </div>
              <p className="text-xs text-textMuted leading-relaxed">{t('settings.checkUpdateDesc')}</p>
              <button onClick={checkForUpdates}
                className="w-full flex items-center justify-center gap-2 bg-accent/10 text-accent hover:bg-accent/20 text-sm font-medium py-2.5 rounded-xl transition-all">
                <ArrowUpCircle className="w-4 h-4" />{t('settings.checkUpdate')}
              </button>
            </div>
          )}
          {updateState === 'checking' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3"><Loader2 className="w-4 h-4 animate-spin text-accent" /><span className="text-sm text-textPrimary">{t('settings.checking')}</span></div>
              <div className="metric-bar h-2"><div className="metric-bar-fill bg-accent" style={{ width: `${checkProgress}%` }} /></div>
            </div>
          )}
          {updateState === 'up_to_date' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2.5 bg-running/10 border border-running/20 rounded-xl">
                <CheckCircle2 className="w-4 h-4 text-running shrink-0" />
                <div><p className="text-sm font-medium text-running">{t('settings.upToDate')}</p><p className="text-[11px] text-running/70">v{updateInfo.currentVersion}</p></div>
              </div>
              <button onClick={() => setUpdateState('idle')} className="w-full text-xs text-textMuted hover:text-textPrimary">{t('settings.retry')}</button>
            </div>
          )}
          {updateState === 'update_available' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2.5 bg-warning/10 border border-warning/20 rounded-xl">
                <ArrowUpCircle className="w-4 h-4 text-warning shrink-0" />
                <div><p className="text-sm font-medium text-warning">v{updateInfo.latestVersion} 可用</p><p className="text-[11px] text-warning/70">{updateInfo.releaseDate}</p></div>
              </div>
              <div className="bg-panel rounded-lg p-2.5 max-h-28 overflow-y-auto">
                <ul className="space-y-1">{updateInfo.changelog.map((item, i) => (
                  <li key={i} className="text-xs text-textSecondary flex items-start gap-1.5"><span className="text-accent">·</span>{item}</li>
                ))}</ul>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 bg-accent hover:bg-accentDim text-white text-sm py-2 rounded-xl flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" />{t('settings.updateNow')}</button>
                <button onClick={() => setUpdateState('idle')} className="px-4 py-2 text-sm text-textMuted hover:text-textPrimary bg-surface border border-border rounded-xl">{t('settings.later')}</button>
              </div>
            </div>
          )}
          {updateState === 'error' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2.5 bg-error/10 border border-error/20 rounded-xl">
                <XCircle className="w-4 h-4 text-error shrink-0" /><span className="text-sm text-error">{t('settings.checkFailed')}</span>
              </div>
              <button onClick={() => setUpdateState('idle')} className="w-full text-xs text-textMuted hover:text-textPrimary">{t('settings.retry')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
