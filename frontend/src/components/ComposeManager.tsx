import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, ChevronRight, Package, X, Check, Pencil, Trash2, Copy, RefreshCw } from 'lucide-react'
import ContextMenu from './ContextMenu'
import ProjectFileManager from './ProjectFileManager'

interface Project {
  name: string
  hasCompose: boolean
  composeFile: string | null
  composeContent: string | null
  files: string[]
}

const API_BASE = ''

export default function ComposeManager() {
  const { t } = useTranslation()

  // --- Project list ---
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  // --- Selected project ---
  const [selectedProject, setSelectedProject] = useState<string | null>(null)

  // --- Toast ---
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // --- Project context menu ---
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; projectName: string } | null>(null)
  const [projectRenameTarget, setProjectRenameTarget] = useState<string | null>(null)
  const [projectRenameValue, setProjectRenameValue] = useState('')
  const projectRenameInputRef = useRef<HTMLInputElement>(null)

  // --- Compose action ---
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  // ==================== Project List ====================

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/projects`)
      setProjects(await res.json() as Project[])
    } catch { showToast(t('compose.loadFailed'), 'error') }
    finally { setLoading(false) }
  }, [t, showToast])

  useEffect(() => { loadProjects() }, [loadProjects])

  const openProject = useCallback((name: string) => {
    setSelectedProject(name)
  }, [])

  // ==================== Project Actions ====================

  const handleProjectRename = useCallback(async () => {
    if (!projectRenameTarget || !projectRenameValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/projects/${projectRenameTarget}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: projectRenameValue.trim() }),
      })
      const data = await res.json()
      if (data.success) { showToast(t('compose.renameSuccess')); loadProjects() }
      else showToast(data.error || t('compose.renameFailed'), 'error')
    } catch (e: any) { showToast(e.message || t('compose.renameFailed'), 'error') }
    setProjectRenameTarget(null)
  }, [projectRenameTarget, projectRenameValue, showToast, loadProjects])

  const handleProjectClone = useCallback(async (name: string) => {
    const newName = prompt(t('compose.clone') + ':', `${name}-copy`)
    if (!newName) return
    try {
      const res = await fetch(`${API_BASE}/projects/${name}/clone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName }),
      })
      const data = await res.json()
      if (data.success) { showToast(`${t('compose.clone')}: ${data.name}`); loadProjects() }
      else showToast(data.error || t('compose.renameFailed'), 'error')
    } catch (e: any) { showToast(e.message || t('compose.renameFailed'), 'error') }
  }, [showToast, loadProjects])

  const handleProjectDelete = useCallback(async (name: string) => {
    if (!window.confirm(t('compose.confirmDeleteProject', { name }))) return
    try {
      await fetch(`${API_BASE}/projects/${name}?removeFiles=true`, { method: 'DELETE' })
      showToast(t('compose.deleteSuccess')); loadProjects()
    } catch (e: any) { showToast(e.message || t('compose.deleteFailed'), 'error') }
  }, [showToast, loadProjects])

  // ==================== Compose Actions ====================

  const composeAction = useCallback(async (action: string) => {
    if (!selectedProject) return
    setActionLoading(action)
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      const stderr = data.stderr || ''
      const hasStderrError = /error|failed|denied|permission|conflict/i.test(stderr)
      if (data.success !== false && res.ok && !hasStderrError) {
        const labels: Record<string, string> = {
          up: t('service.upSuccess'), down: t('service.downSuccess'),
          stop: t('service.stopSuccess'), restart: t('service.restartSuccess'),
          pull: t('compose.pullSuccess'), rebuild: t('service.rebuildSuccess'),
        }
        showToast(labels[action] || t('service.operationSuccess'))
      } else {
        const err = stderr || data.error || t('service.operationFailed')
        showToast(err.length > 200 ? err.slice(0, 200) + '…' : err, 'error')
      }
    } catch (e: any) { showToast(e.message || t('service.operationFailed'), 'error') }
    finally { setActionLoading(null) }
  }, [selectedProject, t, showToast])

  // ==================== Escape key ====================

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && projectRenameTarget) { setProjectRenameTarget(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [projectRenameTarget])

  // ==================== Render: Project List ====================

  if (!selectedProject) {
    return (
      <main className="flex-1 overflow-y-auto p-5 space-y-4"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-project-card]')) return
          e.preventDefault()
          setProjectMenu({ x: e.clientX, y: e.clientY, projectName: '' })
        }}>
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === 'success' ? 'bg-running/20 border border-running/30 text-running' : 'bg-error/20 border border-error/30 text-error'
          }`}>{toast.msg}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-textMuted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('common.loading')}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-textMuted">
            <Package className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">{t('compose.noProjects')}</p>
            <p className="text-xs mt-1">{t('compose.createHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map(p => (
              <div key={p.name} data-project-card
                onClick={() => openProject(p.name)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setProjectMenu({ x: e.clientX, y: e.clientY, projectName: p.name }) }}
                className="bg-surface border border-border rounded-lg p-4 hover:border-accent/50 hover:bg-accent/5 transition-all group text-left cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-warning shrink-0" />
                    <span className="text-sm font-semibold text-textPrimary">{p.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-textMuted group-hover:text-accent transition-colors" />
                </div>
                <div className="flex items-center gap-3 text-xs text-textMuted">
                  <span>{p.files.length} {t('compose.fileCount')}</span>
                  {p.hasCompose && <span className="text-accent bg-accent/10 px-1.5 py-0.5 rounded text-xs">{p.composeFile}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Project context menus */}
        {projectMenu && projectMenu.projectName && (
          <ContextMenu x={projectMenu.x} y={projectMenu.y}
            items={[
              { label: t('compose.open'), icon: <FolderOpen className="w-3.5 h-3.5" />, onClick: () => openProject(projectMenu.projectName) },
              { label: '', divider: true, onClick: () => {} },
              { label: t('compose.rename'), icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => { setProjectRenameTarget(projectMenu.projectName); setProjectRenameValue(projectMenu.projectName); setTimeout(() => projectRenameInputRef.current?.focus(), 50) } },
              { label: t('compose.clone'), icon: <Copy className="w-3.5 h-3.5" />, onClick: () => handleProjectClone(projectMenu.projectName) },
              { label: '', divider: true, onClick: () => {} },
              { label: t('compose.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => handleProjectDelete(projectMenu.projectName) },
            ]}
            onClose={() => setProjectMenu(null)}
          />
        )}
        {projectMenu && !projectMenu.projectName && (
          <ContextMenu x={projectMenu.x} y={projectMenu.y}
            items={[
              { label: t('compose.projectCount', { count: projects.length }), disabled: true, onClick: () => {} },
              { label: t('compose.refreshList'), icon: <RefreshCw className="w-3.5 h-3.5" />, onClick: () => { loadProjects(); setProjectMenu(null) } },
            ]}
            onClose={() => setProjectMenu(null)}
          />
        )}

        {/* Project rename dialog */}
        {projectRenameTarget && (
          <div className="fixed inset-0 z-[90] bg-black/20 flex items-center justify-center" onClick={() => setProjectRenameTarget(null)}>
            <div className="bg-surface border border-border rounded-lg shadow-xl p-4 min-w-[320px]" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-textPrimary mb-3">{t('compose.renameProject')}</h3>
              <div className="flex items-center gap-2">
                <input ref={projectRenameInputRef} value={projectRenameValue} onChange={e => setProjectRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleProjectRename(); if (e.key === 'Escape') setProjectRenameTarget(null) }}
                  placeholder={t('compose.fileName')}
                  className="flex-1 bg-panel border border-border rounded px-2 py-1.5 text-sm text-textPrimary outline-none focus:border-accent"
                />
                <button onClick={handleProjectRename} disabled={!projectRenameValue.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-40"
                ><Check className="w-3 h-3" /> {t('common.confirm')}</button>
                <button onClick={() => setProjectRenameTarget(null)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded hover:bg-border/20"
                ><X className="w-3 h-3" /> {t('common.cancel')}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  // ==================== Render: Project Detail ====================

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <ProjectFileManager
        projectName={selectedProject}
        onBack={() => setSelectedProject(null)}
        onComposeAction={composeAction}
        composeActionLoading={actionLoading}
      />
    </main>
  )
}
