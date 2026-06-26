import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick, HardDrive, Wifi } from 'lucide-react'
import type { SystemMetrics } from '../types'

interface MetricsCardsProps {
  metrics: SystemMetrics | null
}

function getColor(pct: number): string {
  if (pct >= 90) return 'text-error'
  if (pct >= 70) return 'text-warning'
  return 'text-running'
}
function getBarColor(pct: number): string {
  if (pct >= 90) return 'bg-error'
  if (pct >= 70) return 'bg-warning'
  return 'bg-accent'
}

export default function MetricsCards({ metrics: m }: MetricsCardsProps) {
  const { t } = useTranslation()

  // 加载中显示骨架屏
  if (!m) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3 animate-pulse"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-16 bg-border rounded" />
              <div className="h-4 w-4 bg-border rounded" />
            </div>
            <div className="h-7 w-16 bg-border rounded" />
            <div className="h-1.5 w-full bg-border rounded-full" />
            <div className="h-3 w-24 bg-border rounded" />
          </div>
        ))}
      </div>
    )
  }

  // 磁盘三段计算：Docker占用 / 其他占用 / 空闲
  const diskTotal = m.diskTotalGB || 1
  const dockerGB = m.diskDockerGB || 0
  const otherUsedGB = Math.max(0, (m.diskUsedGB || 0) - dockerGB)
  const freeGB = Math.max(0, diskTotal - (m.diskUsedGB || 0))
  const dockerPercent = Math.min(m.disk, Math.round((dockerGB / diskTotal) * 1000) / 10)
  const otherPercent = Math.max(0, Math.round((m.disk || 0) - dockerPercent))

  const cards = [
    {
      id: 'cpu',
      icon: Cpu,
      value: m.cpu,
      detail: t('metrics.cpuDetail', { cores: m.cpuCores }),
      suffix: '%',
    },
    {
      id: 'memory',
      icon: MemoryStick,
      value: m.memory,
      detail: t('metrics.memoryDetail', {
        used: m.memoryUsed,
        total: m.memoryTotal,
      }),
      suffix: '%',
    },
    {
      id: 'disk',
      icon: HardDrive,
      value: m.disk,
      detail: t('metrics.diskDetail', {
        used: m.diskUsedGB,
        total: m.diskTotalGB,
      }),
      suffix: '%',
    },
    {
      id: 'network',
      icon: Wifi,
      value: null,
      detail: '',
      suffix: '',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
      {cards.map((card) => (
        <div
          key={card.id}
          className="bg-surface border border-border rounded-lg p-3 md:p-4 flex flex-col gap-1.5 md:gap-2"
        >
          {/* 标题行 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-textMuted">{t(`metrics.${card.id}`)}</span>
            <card.icon className="w-4 h-4 text-textMuted" />
          </div>

          {/* 数值 */}
          <div className="flex items-baseline gap-1">
            {card.value !== null ? (
              <>
                <span className={`text-2xl font-bold font-mono ${getColor(card.value)}`}>
                  {card.value}
                </span>
                <span className="text-sm text-textMuted">{card.suffix}</span>
              </>
            ) : (
              <span className="text-lg font-bold font-mono text-textPrimary">
                {card.detail}
              </span>
            )}
          </div>

          {/* 进度条 */}
          {card.value !== null && card.id !== 'disk' && (
            <>
              <div className="metric-bar">
                <div
                  className={`metric-bar-fill ${getBarColor(card.value)}`}
                  style={{ width: `${card.value}%` }}
                />
              </div>
              <span className="text-xs text-textMuted font-mono">{card.detail}</span>
            </>
          )}

          {/* 磁盘专属：三色堆叠进度条 */}
          {card.id === 'disk' && (
            <>
              <div className="metric-bar flex">
                {dockerPercent > 0.05 && (
                  <div
                    className="metric-bar-fill !rounded-r-none"
                    style={{ width: `${Math.max(dockerPercent, 1)}%`, backgroundColor: '#6366f1' }}
                    title={`Docker: ${dockerGB.toFixed(1)}GB`}
                  />
                )}
                {otherPercent > 0.05 && (
                  <div
                    className={`metric-bar-fill !rounded-none ${dockerPercent <= 0.05 ? '!rounded-l-full' : ''}`}
                    style={{ width: `${Math.max(otherPercent, 1)}%`, backgroundColor: '#f59e0b' }}
                    title={`${t('metrics.other')}: ${otherUsedGB.toFixed(1)}GB`}
                  />
                )}
              </div>
              {/* 图例 */}
              <div className="flex items-center gap-2 text-[10px] text-textMuted font-mono flex-wrap">
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: '#6366f1' }} />
                  Docker {dockerGB.toFixed(1)}GB
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: '#f59e0b' }} />
                  {t('metrics.other')} {otherUsedGB.toFixed(1)}GB
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: 'rgb(var(--c-border))' }} />
                  {t('metrics.free')} {freeGB.toFixed(1)}GB
                </span>
              </div>
            </>
          )}

          {/* 网络吞吐的特殊展示：上下行分行、颜色区分 */}
          {card.id === 'network' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-textMuted">↓</span>
                <span className="text-2xl font-bold font-mono text-accent">{m.netDown.toFixed(2)}</span>
                <span className="text-sm text-textMuted">MB/s</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-textMuted">↑</span>
                <span className="text-2xl font-bold font-mono text-running">{m.netUp.toFixed(2)}</span>
                <span className="text-sm text-textMuted">MB/s</span>
              </div>
            </div>
          )}

        </div>
      ))}
    </div>
  )
}
