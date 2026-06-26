import { Bell, Maximize2 } from 'lucide-react'
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

export default function Header({ metrics: m, activeNav, onNavChange }: HeaderProps) {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  const isZh = (i18n.language || '').startsWith('zh')
  const isDark = theme === 'dark'

  const toggleLang = () => i18n.changeLanguage(isZh ? 'en' : 'zh')

  const pageTitle = pageTitles[activeNav]
    ? (isZh ? pageTitles[activeNav].zh : pageTitles[activeNav].en)
    : t('header.title')

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

        <button className="hidden sm:flex w-8 h-8 rounded items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-border/50 transition-colors relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full" />
        </button>
        <button className="hidden sm:flex w-8 h-8 rounded items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-border/50 transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
        <UserMenu onNavigate={onNavChange} />
      </div>
    </header>
  )
}
