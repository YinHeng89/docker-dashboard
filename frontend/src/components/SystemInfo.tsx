import { useTranslation } from 'react-i18next'
import { useSystemInfo } from '../hooks/useSystemInfo'

export default function SystemInfoPanel() {
  const { t } = useTranslation()
  const { info, loading } = useSystemInfo()

  const left = [
    { label: t('sys.dockerVersion'), value: info?.dockerVersion },
    { label: t('sys.sdkVersion'),    value: info?.sdkVersion },
    { label: t('sys.os'),            value: info?.os },
    { label: t('sys.kernel'),        value: info?.kernel },
    { label: t('sys.arch'),          value: info?.arch },
    { label: t('sys.driver'),        value: info?.driver },
  ]

  const right = [
    { label: t('sys.memoryTotal'),   value: info?.memoryGB ? `${info.memoryGB} GB` : null },
    { label: t('sys.dockerRoot'),    value: info?.dockerRoot },
    { label: t('sys.loggingDriver'), value: info?.loggingDriver },
    { label: t('sys.cgroupDriver'),  value: info?.cgroupDriver },
    { label: t('sys.dockerHost'),    value: info?.dockerHost },
    { label: t('sys.uptime'),        value: info?.uptime },
  ]

  return (
    <div className="bg-surface border border-border rounded-lg p-3 md:p-4 h-full">
      <h3 className="text-sm md:text-base font-semibold text-textPrimary mb-2 md:mb-3">{t('sys.title')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 md:gap-x-6 gap-y-1.5 md:gap-y-2">
        {/* 左列 */}
        <div className="space-y-1.5 md:space-y-2">
          {left.map((row, i) => (
            <div key={i} className="flex items-start gap-2 md:gap-2.5">
              <span className="text-[11px] md:text-xs text-textMuted w-20 md:w-24 shrink-0 pt-px">{row.label}</span>
              {loading || !info ? (
                <div className="h-3 flex-1 bg-border rounded animate-pulse" />
              ) : (
                <span className="text-xs font-mono text-textSecondary break-all leading-relaxed">{row.value ?? '-'}</span>
              )}
            </div>
          ))}
        </div>

        {/* 右列 */}
        <div className="space-y-1.5 md:space-y-2">
          {right.map((row, i) => (
            <div key={i} className="flex items-start gap-2 md:gap-2.5">
              <span className="text-[11px] md:text-xs text-textMuted w-20 md:w-24 shrink-0 pt-px">{row.label}</span>
              {loading || !info ? (
                <div className="h-3 flex-1 bg-border rounded animate-pulse" />
              ) : (
                <span className="text-xs font-mono text-textSecondary break-all leading-relaxed">{row.value ?? '-'}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
