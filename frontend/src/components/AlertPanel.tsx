import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, XCircle, X } from 'lucide-react'
import type { Alert } from '../types'

interface AlertPanelProps {
  alerts: Alert[]
}

export default function AlertPanel({ alerts }: AlertPanelProps) {
  const { t } = useTranslation()
  const DISMISS_KEY = 'alert_dismissed_ids'
  const [dismissed, setDismissed] = useState(false)

  // 从 localStorage 恢复关闭状态，并检测新告警
  useEffect(() => {
    const currentIds = alerts.map(a => a.id).sort()
    if (currentIds.length === 0) return
    try {
      const stored = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]
      // 如果当前告警中有任意一个不在已关闭列表中 → 重新显示
      const hasNew = currentIds.some(id => !stored.includes(id))
      setDismissed(!hasNew)
    } catch {
      setDismissed(false)
    }
  }, [alerts])

  // 关闭时持久化当前告警 ID
  const handleDismiss = () => {
    const currentIds = alerts.map(a => a.id)
    localStorage.setItem(DISMISS_KEY, JSON.stringify(currentIds))
    setDismissed(true)
  }

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
          onClick={handleDismiss}
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
