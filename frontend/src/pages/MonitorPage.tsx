import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, Cpu, HardDrive, Network, Monitor,
  AlertTriangle, Plus, Trash2,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts'
import { useSystemMetrics } from '../hooks/useSystemMetrics'
import { useContainers } from '../hooks/useContainers'
import type { AlertRule } from '../types'

type TimeRange = '5m' | '15m' | '1h' | '6h'

interface MetricsPoint {
  time: string
  cpu: number
  memory: number
  disk: number
  netDown: number
  netUp: number
}

// 时间窗口对应的数据点数量（10s 间隔）
const windowSize: Record<TimeRange, number> = { '5m': 30, '15m': 90, '1h': 360, '6h': 2160 }
// 最大存储点数
const MAX_POINTS = 720

export default function MonitorPage() {
  const { t } = useTranslation()
  const { metrics } = useSystemMetrics(10000)
  const { services } = useContainers(metrics?.containerMetrics)
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [history, setHistory] = useState<MetricsPoint[]>([])
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => {
    try {
      const saved = localStorage.getItem('alert-rules')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [editingRule, setEditingRule] = useState<Partial<AlertRule> | null>(null)

  // 持久化告警规则
  useEffect(() => {
    localStorage.setItem('alert-rules', JSON.stringify(alertRules))
  }, [alertRules])

  // 收集历史数据点
  useEffect(() => {
    if (!metrics) return
    const now = new Date().toLocaleTimeString()
    setHistory(prev => {
      const next = [...prev, {
        time: now,
        cpu: metrics.cpu,
        memory: metrics.memory,
        disk: metrics.disk,
        netDown: metrics.netDown,
        netUp: metrics.netUp,
      }]
      if (next.length > MAX_POINTS) return next.slice(-MAX_POINTS)
      return next
    })
  }, [metrics])

  // 按时间窗口裁剪
  const displayData = useMemo(() => {
    const size = windowSize[timeRange]
    return history.slice(-size)
  }, [history, timeRange])

  // 容器资源排名
  const containerRanking = useMemo(() => {
    return [...services]
      .filter(s => s.status === 'running')
      .sort((a, b) => b.totalCpu - a.totalCpu)
      .slice(0, 10)
  }, [services])

  // 添加告警规则
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

  const removeRule = (id: string) => {
    setAlertRules(prev => prev.filter(r => r.id !== id))
  }

  const chartColor = { cpu: '#3b82f6', memory: '#f59e0b', disk: '#22c55e', netDown: '#6366f1', netUp: '#ec4899' }

  return (
    <main className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* 概览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {metrics ? [
          { label: t('monitor.cpuDetailed', { usage: metrics.cpu, cores: metrics.cpuCores }), value: `${metrics.cpu}%`, icon: Cpu, color: 'text-accent', bg: 'bg-accent/10', sub: t('monitor.cpuUsage') },
          { label: t('monitor.memoryDetailed', { used: metrics.memoryUsed?.toFixed(1) || '0', total: metrics.memoryTotal?.toFixed(1) || '0', percent: metrics.memory }), value: `${metrics.memory}%`, icon: HardDrive, color: 'text-warning', bg: 'bg-warning/10', sub: t('monitor.memoryUsage') },
          { label: t('monitor.diskDetailed', { used: metrics.diskUsedGB?.toFixed(1) || '0', total: metrics.diskTotalGB?.toFixed(1) || '0', percent: metrics.disk }), value: `${metrics.disk}%`, icon: Monitor, color: 'text-running', bg: 'bg-running/10', sub: t('monitor.diskUsage') },
          { label: t('monitor.networkDetailed', { down: metrics.netDown?.toFixed(1) || '0', up: metrics.netUp?.toFixed(1) || '0' }), value: '', icon: Network, color: 'text-textSecondary', bg: 'bg-border/30', sub: t('monitor.networkTraffic') },
        ].map((item, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <item.icon className={`w-4 h-4 ${item.color}`} />
              <span className="text-xs text-textMuted">{item.sub}</span>
            </div>
            <p className="text-2xl font-bold text-textPrimary">{item.value}</p>
            <p className="text-[10px] text-textMuted mt-0.5">{item.label}</p>
          </div>
        )) : (
          <div className="col-span-4 flex items-center justify-center py-8 text-textMuted text-sm">
            正在获取系统指标...
          </div>
        )}
      </div>

      {/* 时间范围选择 */}
      <div className="flex items-center gap-2">
        {(['5m', '15m', '1h', '6h'] as TimeRange[]).map(r => (
          <button key={r} onClick={() => setTimeRange(r)}
            className={`text-xs px-3 py-1 rounded ${timeRange === r ? 'bg-accent text-white' : 'bg-surface border border-border text-textMuted hover:text-textPrimary'}`}>
            {t(`monitor.range${r}`)}</button>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CPU */}
        <div className="bg-surface border border-border rounded-lg p-3">
          <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-accent" />{t('monitor.cpuUsage')}</h4>
          <div className="h-40">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">收集数据中...</div>
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

        {/* Memory */}
        <div className="bg-surface border border-border rounded-lg p-3">
          <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-warning" />{t('monitor.memoryUsage')}</h4>
          <div className="h-40">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">收集数据中...</div>
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

        {/* Network */}
        <div className="bg-surface border border-border rounded-lg p-3 col-span-2">
          <h4 className="text-xs font-semibold text-textPrimary mb-2 flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-textSecondary" />{t('monitor.networkTraffic')}</h4>
          <div className="h-40">
            {displayData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-textMuted text-xs">收集数据中...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border) / 0.3)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))' }} unit=" MB/s" />
                  <Tooltip contentStyle={{ background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-border))', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="netDown" name={t('monitor.download')} stroke={chartColor.netDown} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="netUp" name={t('monitor.upload')} stroke={chartColor.netUp} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* 容器排名 + 告警规则 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 容器资源排名 */}
        <div className="bg-surface border border-border rounded-lg p-3">
          <h4 className="text-xs font-semibold text-textPrimary mb-3 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-accent" />{t('monitor.containerRanking')}</h4>
          {containerRanking.length > 0 ? (
            <table className="w-full">
              <thead><tr className="border-b border-border">
                <th className="py-1.5 text-left text-[10px] text-textMuted">#</th>
                <th className="py-1.5 text-left text-[10px] text-textMuted">{t('monitor.container')}</th>
                <th className="py-1.5 text-right text-[10px] text-textMuted">{t('monitor.cpu')}</th>
                <th className="py-1.5 text-right text-[10px] text-textMuted">{t('monitor.memory')}</th>
              </tr></thead>
              <tbody>
                {containerRanking.map((s, i) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-1.5 text-[10px] text-textMuted">{i + 1}</td>
                    <td className="py-1.5 text-xs text-textPrimary truncate max-w-[160px]">{s.name}</td>
                    <td className="py-1.5 text-xs text-textPrimary text-right font-mono">{s.totalCpu}%</td>
                    <td className="py-1.5 text-xs text-textPrimary text-right font-mono">{s.totalMemory}{s.memoryUnit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-textMuted py-4 text-center">无运行中的容器</p>
          )}
        </div>

        {/* 告警规则 */}
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />{t('monitor.alertRules')}</h4>
            <button onClick={() => setEditingRule({})}
              className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-1">
              <Plus className="w-3 h-3" />{t('monitor.addRule')}</button>
          </div>

          {/* 编辑规则表单 */}
          {editingRule !== null && (
            <div className="mb-3 p-3 bg-panel rounded-lg space-y-2">
              <input value={editingRule.name || ''} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                placeholder={t('monitor.ruleName')}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-textPrimary outline-none" />
              <div className="flex gap-2">
                <select value={editingRule.type || 'cpu'} onChange={e => setEditingRule({ ...editingRule, type: e.target.value as AlertRule['type'] })}
                  className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs text-textPrimary outline-none">
                  <option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option><option value="container_down">Container Down</option>
                </select>
                <input type="number" value={editingRule.threshold || ''} onChange={e => setEditingRule({ ...editingRule, threshold: Number(e.target.value) })}
                  placeholder={t('monitor.ruleThreshold')}
                  className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs text-textPrimary outline-none" />
                <span className="text-xs text-textMuted self-center">%</span>
              </div>
              <div className="flex gap-2">
                <button onClick={addRule}
                  className="action-btn action-btn-primary text-xs px-3 py-1 rounded">{t('monitor.addRule')}</button>
                <button onClick={() => setEditingRule(null)}
                  className="action-btn-ghost text-xs px-3 py-1 rounded">取消</button>
              </div>
            </div>
          )}

          {/* 规则列表 */}
          {alertRules.length > 0 ? (
            <div className="space-y-1.5">
              {alertRules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-2 bg-panel rounded text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-textPrimary">{rule.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">{rule.type}</span>
                    <span className="text-textMuted">&gt; {rule.threshold}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="checkbox" checked={rule.enabled} onChange={() => {
                      setAlertRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
                    }} className="rounded" />
                    <button onClick={() => removeRule(rule.id)}
                      className="p-0.5 text-textMuted hover:text-error"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-textMuted py-4 text-center">{t('monitor.noRules')}</p>
          )}
        </div>
      </div>
    </main>
  )
}
