import { useState, useEffect, useMemo, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import MetricsCards from './components/MetricsCards'
import Toolbar from './components/Toolbar'
import GroupHeader from './components/GroupHeader'
import ServiceCard from './components/ServiceCard'
import AlertPanel from './components/AlertPanel'
import SystemInfoPanel from './components/SystemInfo'
import StatsOverview from './components/StatsOverview'
import Favorites from './components/Favorites'
import ComposeManager from './components/ComposeManager'
import ContainerPage from './pages/ContainerPage'
import ImagesPage from './pages/ImagesPage'
import NetworksPage from './pages/NetworksPage'
import VolumesPage from './pages/VolumesPage'
import SettingsPage from './pages/SettingsPage'
import PluginsPage from './pages/PluginsPage'
import TrashPage from './pages/TrashPage'
import { useContainers } from './hooks/useContainers'
import { useContainersEnhanced } from './hooks/useContainersEnhanced'
import { useGroups } from './hooks/useGroups'
import { useSystemMetrics } from './hooks/useSystemMetrics'
import { useScrollAnchor } from './hooks/useScrollAnchor'
import type { Service, Alert, ContainerGroup } from './types'

export default function App() {
  const [activeNav, setActiveNav] = useState(() => {
    const saved = localStorage.getItem('activeNav')
    // 旧路由重定向到 settings
    if (saved === 'logs' || saved === 'monitor' || saved === 'users') return 'settings'
    return saved || 'dashboard'
  })
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false)

  // 切换导航：持久化到 localStorage，刷新后保持在当前页面
  const [highlightContainerId, setHighlightContainerId] = useState<string | null>(null)
  const handleNavChange = (nav: string, highlightContainerId?: string) => {
    // 旧的路由重定向到 settings
    if (nav === 'logs' || nav === 'monitor' || nav === 'users') {
      nav = 'settings'
    }
    if (nav === 'dashboard' && (activeNav === 'compose' || activeNav === 'containers')) {
      refreshManagedProjects()
      refreshContainers()
    }
    setHighlightContainerId(highlightContainerId || null)
    localStorage.setItem('activeNav', nav)
    setActiveNav(nav)
  }
  const [searchQuery, setSearchQuery] = useState('')
  const { metrics } = useSystemMetrics(10000)
  const { services, refreshContainers } = useContainers(metrics?.containerMetrics)
  const {
    groups, mappings, collapsed, favorites, showUngrouped, loading: groupsLoading,
    createGroup, deleteGroup, renameGroup, toggleShowOnDashboard, toggleShowUngrouped,
    assignToGroup, unassign, toggleFavorite, toggleCollapsed,
  } = useGroups()
  const { workspaceGrouped, stats: enhancedStats } = useContainersEnhanced(metrics?.containerMetrics, groups, mappings, favorites)
  const [dashboardCollapsed, setDashboardCollapsed] = useState<Record<string, boolean>>({})
  const [managedProjects, setManagedProjects] = useState<string[]>([])
  const { scrollRef, anchorToggle } = useScrollAnchor()

  // 加载/刷新已管理的 compose 项目列表
  const refreshManagedProjects = useCallback(() => {
    fetch('/projects')
      .then(r => r.json())
      .then((data: { name: string }[]) => setManagedProjects(data.map(p => p.name)))
      .catch(() => {})
  }, [])

  useEffect(() => { refreshManagedProjects() }, [refreshManagedProjects])

  // 异常告警：从真实容器数据提取
  const alerts: Alert[] = useMemo(() => {
    return services
      .filter(s => s.status === 'error' || s.status === 'warning')
      .map(s => ({
        id: s.id,
        serviceName: s.name,
        type: s.status === 'error' ? 'error' : 'warning',
        message: s.status === 'error' ? '容器异常' : '部分容器未运行',
        timestamp: '',
      }))
  }, [services])

  // 仪表盘显示的分组（仅 showOnDashboard 的 + 收藏 + 未分组/独立容器）
  const dashboardGroups = useMemo(() => {
    return workspaceGrouped.filter(wg => {
      if (wg.groupId === '_favorites' && wg.totalContainers === 0) return false
      if (wg.groupId === '_favorites') return true
      if (wg.groupId === '_independent') return true
      if (wg.groupId === '_ungrouped') return showUngrouped !== false
      const g = groups.find(x => x.id === wg.groupId)
      return g?.showOnDashboard !== false
    })
  }, [workspaceGrouped, groups, showUngrouped])

  // ===== 容器操作 =====

  return (
    <div className="h-screen flex overflow-hidden">
      {/* 侧边栏 */}
      <Sidebar activeNav={activeNav} onNavChange={handleNavChange}
        mobileOpen={sidebarMobileOpen} onMobileToggle={setSidebarMobileOpen} />

      {/* 主体区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <Header metrics={metrics} activeNav={activeNav} onNavChange={handleNavChange} />

        {/* 根据导航切换内容 */}
        {activeNav === 'compose' ? (
          <ComposeManager />
        ) : activeNav === 'containers' ? (
          <ContainerPage
            groups={groups}
            mappings={mappings}
            collapsed={collapsed}
            favorites={favorites}
            showUngrouped={showUngrouped}
            groupsLoading={groupsLoading}
            highlightContainerId={highlightContainerId}
            onClearHighlight={() => setHighlightContainerId(null)}
            createGroup={createGroup}
            deleteGroup={deleteGroup}
            renameGroup={renameGroup}
            toggleShowOnDashboard={toggleShowOnDashboard}
            toggleShowUngrouped={toggleShowUngrouped}
            assignToGroup={assignToGroup}
            unassign={unassign}
            toggleFavorite={toggleFavorite}
            toggleCollapsed={toggleCollapsed}
          />
        ) : activeNav === 'images' ? (
          <ImagesPage />
        ) : activeNav === 'networks' ? (
          <NetworksPage />
        ) : activeNav === 'volumes' ? (
          <VolumesPage />
        ) : activeNav === 'settings' ? (
          <SettingsPage metrics={metrics} services={services} />
        ) : activeNav === 'plugins' ? (
          <PluginsPage />
        ) : activeNav === 'trash' ? (
          <TrashPage />
        ) : (
          <main ref={scrollRef as React.RefObject<HTMLElement>} className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3 md:space-y-5">
            {/* 系统信息 + 容器统计 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <SystemInfoPanel />
              <StatsOverview metrics={metrics} totalApps={enhancedStats?.totalApps ?? 0} />
            </div>

            {/* 指标卡片 */}
            <MetricsCards metrics={metrics} />

            {/* 工具栏 */}
            <Toolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onProjectCreated={refreshManagedProjects}
            />

            {/* 异常告警 */}
            <AlertPanel alerts={alerts} />

            {/* 服务分组 — 工作区模式 */}
            <div>
            {dashboardGroups.map(wg => {
              const isCollapsed = dashboardCollapsed[wg.groupId] === true
              const isComposeProject = (pg: ContainerGroup) =>
                pg.containers.length > 1 || pg.containers[0]?.project !== undefined

              const toService = (pg: ContainerGroup): Service => ({
                id: pg.name,
                name: pg.name,
                description: `${pg.containerCount} 个容器`,
                group: wg.groupName,
                status: (() => {
                  const sts = pg.containers.map(c => c.status)
                  if (sts.some(s => s === 'error')) return 'error'
                  if (sts.some(s => s === 'warning')) return 'warning'
                  if (sts.every(s => s === 'stopped')) return 'stopped'
                  return 'running'
                })(),
                containers: pg.containers.map(c => ({ id: c.id, name: c.name, status: c.status, cpu: c.cpu, memory: c.memory, memoryUnit: c.memoryUnit, uptime: c.uptime, ports: c.ports })),
                containerCount: pg.containerCount,
                totalCpu: +pg.containers.reduce((s, c) => s + c.cpu, 0).toFixed(1),
                totalMemory: Math.round(pg.containers.reduce((s, c) => s + c.memory, 0)),
                memoryUnit: pg.containers[0]?.memoryUnit || 'MB',
                totalMemoryPercent: Math.max(0, ...pg.containers.map(c => c.memoryPercent ?? 0)),
                uptime: pg.containers[0]?.uptime || '-',
              })

              return (
                <section key={wg.groupId} className={isCollapsed ? '' : 'pb-2'}>
                  <GroupHeader
                    group={wg}
                    collapsed={isCollapsed}
                    onToggle={() => anchorToggle(() => setDashboardCollapsed(prev => ({ ...prev, [wg.groupId]: !prev[wg.groupId] })))}
                  />
                  <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3 ${
                    isCollapsed ? 'hidden' : 'mt-3'
                  }`}>
                      {wg.projectGroups.map(pg => {
                        const service = toService(pg)
                        return isComposeProject(pg) && pg.containers[0]?.project ? (
                          <ServiceCard key={pg.name} service={service} managedProjects={managedProjects} />
                        ) : (
                          pg.containers.map(c => {
                            const singleSvc: Service = {
                              id: c.id, name: c.name, description: c.image, group: wg.groupName, status: c.status,
                              containers: [{ id: c.id, name: c.name, status: c.status, cpu: c.cpu, memory: c.memory, memoryUnit: c.memoryUnit, uptime: c.uptime }],
                              containerCount: 1, totalCpu: c.cpu, totalMemory: c.memory, memoryUnit: c.memoryUnit, uptime: c.uptime,
                            }
                            return <ServiceCard key={c.id} service={singleSvc} managedProjects={managedProjects} />
                          })
                        )
                      }).flat()}
                    </div>
                </section>
              )
            })}
            </div>

            {/* 常用服务 */}
            <Favorites services={services} />
          </main>
        )}
      </div>
    </div>
  )
}
