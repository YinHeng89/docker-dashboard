import { useState, useEffect } from 'react'
import { Bell, Maximize2, ArrowUpCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../hooks/useTheme'
import LangToggle from './LangToggle'
import ThemeToggle from './ThemeToggle'
import UserMenu from './UserMenu'
import type { SystemMetrics } from '../types'

interface HeaderProps {
  metrics: SystemMetrics | null
  activeNav: string
  onNavChange?: (nav: string) => void
}

const pageTitles: Record<string, { zh: string; en: string }> = {
  dashboard: { zh: '仪表盘', en: 'Dashboard' },
  containers: { zh: '应用管理', en: 'Containers' },
  images: { zh: '镜像管理', en: 'Images' },
  networks: { zh: '网络管理', en: 'Networks' },
  volumes: { zh: '存储管理', en: 'Volumes' },
  compose: { zh: '服务编排', en: 'Compose' },
  settings: { zh: '系统设置', en: 'Settings' },
  plugins: { zh: '插件中心', en: 'Plugins' },
  trash: { zh: '回收站', en: 'Trash' },
}

interface UpdateResult {
  container_id: string
  container_name: string
  image_name: string
  has_update: number
  checked_at: string
}

export default function Header({ metrics: m, activeNav, onNavChange }: HeaderProps) {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  const isZh = (i18n.language || '').startsWith('zh')
  const isDark = theme === 'dark'
  const toggleLang = () => i18n.changeLanguage(isZh ? 'en' : 'zh')

  const pageTitle = pageTitles[activeNav]
    ? (isZh ? pageTitles[activeNav].zh : pageTitles[activeNav].en)
    : t('header.title')

  // 更新检测结果
  const [updateResults, setUpdateResults] = useState<UpdateResult[]>([])
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoInterval, setAutoInterval] = useState(6)
  const [showDropdown, setShowDropdown] = useState(false)
  const [checking, setChecking] = useState(false)
  const hasUpdates = updateResults.some(r => r.has_update === 1)
  const updateCount = updateResults.filter(r => r.has_update === 1).length

  const fetchUpdateStatus = async () => {
    try {
      const res = await fetch('/api/auto-update/status')
      const data = await res.json()
      setUpdateResults((data.results || []) as UpdateResult[])
      if (data.settings) {
        setAutoEnabled(!!data.settings.enabled)
        setAutoInterval(data.settings.intervalHours || 6)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchUpdateStatus()
    const id = setInterval(fetchUpdateStatus, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    try {
      await fetch('/api/auto-update/check', { method: 'POST' })
      setTimeout(async () => { await fetchUpdateStatus(); setChecking(false) }, 3000)
    } catch { setChecking(false) }
  }

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 md:px-5 shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        <h1 className="text-sm md:text-base font-semibold text-textPrimary truncate">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-1.5 md:gap-3">
        {/* 迷你指标 — 移动端简化显示 */}
        <div className="hidden sm:flex items-center gap-2.5 text-xs text-textSecondary">
          <span>CPU <span className="text-textPrimary font-semibold">{m?.cpu ?? '-'}%</span></span>
          <span className="text-border">|</span>
          <span>MEM <span className="text-textPrimary font-semibold">{m?.memory ?? '-'}%</span></span>
          <span className="text-border">|</span>
          <span className="flex items-center gap-1">
            <span className="text-textMuted">↓</span>
            <span>{m?.netDown?.toFixed(1) ?? '-'}</span>
            <span className="text-textMuted">↑</span>
            <span>{m?.netUp?.toFixed(1) ?? '-'}</span>
            <span className="text-textMuted hidden lg:inline">MB/s</span>
          </span>
        </div>

        {/* 移动端紧凑指标 */}
        <div className="sm:hidden flex items-center gap-1.5 text-[11px] text-textSecondary">
          <span className="px-1.5 py-0.5 rounded-md bg-panel text-textPrimary font-mono font-semibold">{m?.cpu ?? '-'}%</span>
          <span className="px-1.5 py-0.5 rounded-md bg-panel text-textPrimary font-mono font-semibold">{m?.memory ?? '-'}%</span>
        </div>

        <div className="w-px h-5 bg-border hidden md:block" />

        <LangToggle
          on={!isZh} onToggle={toggleLang}
          leftLabel={t('header.langLabelZh')} rightLabel={t('header.langLabelEn')}
          title={t('header.switchLang')}
        />

        <div className="w-px h-5 bg-border hidden md:block" />

        <ThemeToggle
          on={isDark} onToggle={toggleTheme}
          leftLabel={t('header.lightLabel')} rightLabel={t('header.darkLabel')}
          title={isDark ? t('header.switchLight') : t('header.switchDark')}
        />

        <div className="w-px h-5 bg-border hidden sm:block" />

        {/* 更新检测铃铛 */}
        <div className="relative">
          <button
            onClick={() => { setShowDropdown(!showDropdown); if (!showDropdown) fetchUpdateStatus() }}
            className="hidden sm:flex w-8 h-8 rounded items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-border/50 transition-colors"
            title={checking ? '检测中...' : hasUpdates ? `${updateCount} 个更新可用` : '暂无更新'}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            {hasUpdates && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-error rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                {updateCount}
              </span>
            )}
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-10 z-50 w-80 bg-surface border border-border rounded-lg shadow-xl overflow-hidden" onMouseLeave={() => setShowDropdown(false)}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-textPrimary">
                  {hasUpdates ? `发现 ${updateCount} 个更新` : '暂无更新'}
                </span>
                <button onClick={handleCheck} disabled={checking}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
                >
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                  立即检测
                </button>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {updateResults.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-textMuted">
                    暂无检测记录，点击"立即检测"开始
                  </div>
                ) : (
                  updateResults.map(r => (
                    <div key={r.container_id} className="px-4 py-2.5 border-b border-border/30 hover:bg-border/10 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-textPrimary truncate">
                              {r.container_name || r.container_id.slice(0, 12)}
                            </span>
                            {r.has_update === 1 && (
                              <span className="w-1.5 h-1.5 bg-warning rounded-full shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-textMuted truncate mt-0.5">{r.image_name}</p>
                        </div>
                        <span className={`text-xs shrink-0 ml-2 ${r.has_update === 1 ? 'text-warning' : 'text-running'}`}>
                          {r.has_update === 1 ? '可更新' : '已最新'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className={`px-4 py-2 border-t border-border text-xs ${autoEnabled ? 'text-textMuted' : 'text-warning'}`}>
                {autoEnabled ? `自动检测间隔：每 ${autoInterval} 小时` : '自动检测已关闭'}
              </div>
            </div>
          )}
        </div>

        <button className="hidden sm:flex w-8 h-8 rounded items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-border/50 transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
        <UserMenu onNavigate={onNavChange} />
      </div>
    </header>
  )
}
