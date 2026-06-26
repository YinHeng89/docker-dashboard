import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Box, Layers, Network, HardDrive,
  Workflow, Settings, ChevronLeft, ChevronRight,
  Plug, Trash2, Menu, X,
} from 'lucide-react'
const navItems = [
  { id: 'dashboard', label: '仪表盘', icon: 'LayoutDashboard' },
  { id: 'containers', label: '应用管理', icon: 'Box' },
  { id: 'images', label: '镜像管理', icon: 'Layers' },
  { id: 'networks', label: '网络管理', icon: 'Network' },
  { id: 'volumes', label: '存储管理', icon: 'HardDrive' },
  { id: 'compose', label: '服务编排', icon: 'Workflow' },
  { id: 'settings', label: '系统设置', icon: 'Settings' },
]

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Box, Layers, Network, HardDrive,
  Workflow, Settings,
}

interface SidebarProps {
  activeNav: string
  onNavChange: (id: string) => void
  mobileOpen: boolean
  onMobileToggle: (open: boolean) => void
}

export default function Sidebar({ activeNav, onNavChange, mobileOpen, onMobileToggle }: SidebarProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const extraItems = [
    { id: 'plugins', icon: Plug },
    { id: 'trash', icon: Trash2 },
  ]

  const handleNavClick = (id: string) => {
    onNavChange(id)
    if (isMobile) onMobileToggle(false)
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Box className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-base font-semibold text-textPrimary whitespace-nowrap">
              Docker Dashboard
            </span>
          )}
        </div>
        {/* 移动端关闭按钮 */}
        {isMobile && (
          <button onClick={() => onMobileToggle(false)}
            className="p-1 rounded-lg hover:bg-border/30 text-textMuted hover:text-textPrimary transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = iconMap[item.icon] ?? LayoutDashboard
          const isActive = activeNav === item.id
          const label = t(`nav.${item.id}`, item.label)
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent border-r-2 border-accent'
                  : 'text-textSecondary hover:text-textPrimary hover:bg-border/30'
              } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              {(!collapsed || isMobile) && (
                <span className="truncate">{label}</span>
              )}
            </button>
          )
        })}

        {/* 分割线 */}
        <div className="my-2 mx-4 border-t border-border" />

        {/* 额外导航 */}
        {extraItems.map((item) => {
          const label = t(`nav.${item.id}`)
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-textSecondary hover:text-textPrimary hover:bg-border/30 ${
                collapsed && !isMobile ? 'justify-center px-0' : ''
              }`}
              title={collapsed ? label : undefined}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              {(!collapsed || isMobile) && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Collapse toggle — 仅桌面端显示 */}
      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-10 flex items-center justify-center border-t border-border text-textMuted hover:text-textPrimary transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      )}
    </>
  )

  return (
    <>
      {/* 移动端遮罩层 */}
      {isMobile && mobileOpen && (
        <div className="sidebar-overlay open" onClick={() => onMobileToggle(false)} />
      )}

      {/* 桌面端侧边栏 + 移动端滑出菜单 */}
      <aside
        className={`bg-surface border-r border-border flex flex-col shrink-0 transition-all duration-200 ${
          isMobile
            ? `sidebar-mobile w-64 ${mobileOpen ? 'open' : ''}`
            : collapsed ? 'w-16' : 'w-52'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* 移动端汉堡菜单按钮 */}
      {isMobile && !mobileOpen && (
        <button
          onClick={() => onMobileToggle(true)}
          className="fixed bottom-4 left-4 z-50 w-12 h-12 rounded-2xl bg-accent shadow-lg shadow-accent/30 text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
    </>
  )
}
