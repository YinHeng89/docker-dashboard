import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, XCircle, X } from 'lucide-react'
import type { Alert } from '../types'

interface AlertPanelProps {
  alerts: Alert[]
}

export default function AlertPanel({ alerts }: AlertPanelProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  const prevIdsRef = useRef<string[]>([])

  // 检测是否有新的告警（告警 ID 集合变化），如果有则自动重新显示
  useEffect(() => {
    const currentIds = alerts.map(a => a.id).sort()
    const prevIds = prevIdsRef.current
    // 有新告警出现 → 显示
    const hasNew = currentIds.some(id => !prevIds.includes(id))
    // 告警数增加 → 显示
    const countIncreased = currentIds.length > prevIds.length
    if (hasNew || countIncreased) {
      setDismissed(false)
    }
    prevIdsRef.current = currentIds
  }, [alerts])

  if (alerts.length === 0 || dismissed) return null

  return (
    <div className="bg-error/5 border border-error/20 rounded-lg p-3">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-error" />
          <h3 className="text-base font-semibold text-error">{t('alert.title')}</h3>
          <span className="text-xs bg-error/20 text-error px-1.5 py-0.5 rounded font-medium">
            {alerts.length}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors shrink-0"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 告警列表 - 横排 */}
      <div className="flex items-stretch gap-2">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex-1 flex items-center gap-2 py-2 px-3 bg-surface/50 rounded border border-border/50"
          >
            {alert.type === 'error' ? (
              <XCircle className="w-4 h-4 text-error shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-textPrimary">
                  {alert.serviceName}
                </span>
                <span className="text-xs text-textMuted">{alert.timestamp}</span>
              </div>
              <p className="text-xs text-textSecondary truncate">{alert.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
