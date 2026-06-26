import { useState, useRef, useEffect } from 'react'
import { User, LogOut, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { logout } from '../api/auth'

export default function UserMenu({ onNavigate }: { onNavigate?: (nav: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = localStorage.getItem('displayName') || 'admin'

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const handleLogout = async () => {
    try {
      await logout()
    } catch (_) {
      // 即使请求失败也跳转登录页
    }
    window.location.href = '/login'
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="hidden sm:flex items-center gap-1.5 ml-1 px-2 py-1.5 rounded text-sm text-textSecondary hover:text-textPrimary hover:bg-border/50 transition-colors"
      >
        <User className="w-4 h-4" />
        <span className="text-xs">{displayName}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 animate-fadeInScale">
          <button
            onClick={() => { setOpen(false); onNavigate?.('settings') }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-textSecondary hover:text-textPrimary hover:bg-border/30 transition-colors"
          >
            <Settings className="w-4 h-4" />
            {t('header.settings')}
          </button>
          <div className="border-t border-border my-1" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-error hover:bg-error/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {t('header.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
