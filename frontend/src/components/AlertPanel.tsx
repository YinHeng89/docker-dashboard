import { useTranslation } from 'react-i18next'
import { AlertTriangle, XCircle, Wrench, RotateCw } from 'lucide-react'
import type { Alert } from '../types'

interface AlertPanelProps {
  alerts: Alert[]
  onFixAll: () => Promise<void>
  onRestartAll: () => Promise<void>
}

export default function AlertPanel({ alerts, onFixAll, onRestartAll }: AlertPanelProps) {
  const { t } = useTranslation()

  if (alerts.length === 0) return null

  return (
    <div className="bg-error/5 border border-error/20 rounded-lg p-3">
      {/* 标题 + 操作 */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-error" />
          <h3 className="text-base font-semibold text-error">{t('alert.title')}</h3>
          <span className="text-xs bg-error/20 text-error px-1.5 py-0.5 rounded font-medium">
            {alerts.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onFixAll} className="action-btn action-btn-danger flex items-center gap-1.5 !py-1 !text-xs">
            <Wrench className="w-3 h-3" />
            {t('alert.fixAll')}
          </button>
          <button onClick={onRestartAll} className="action-btn bg-error text-white hover:bg-error/80 flex items-center gap-1.5 !py-1 !text-xs">
            <RotateCw className="w-3 h-3" />
            {t('alert.restartAll')}
          </button>
        </div>
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
