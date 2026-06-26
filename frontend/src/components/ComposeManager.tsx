import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, FileText, ArrowLeft, Save, RefreshCw, Play, Square, Loader2, Upload, ChevronRight, ChevronLeft, Package } from 'lucide-react'
import YamlEditor from './YamlEditor'

interface Project {
  name: string
  hasCompose: boolean
  composeFile: string | null
  composeContent: string | null
  files: string[]
}

interface FileEntry {
  name: string
  isDir: boolean
}

const API_BASE = ''

export default function ComposeManager() {
  const { t } = useTranslation()
  // 列表
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  // 详情
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [projectFiles, setProjectFiles] = useState<FileEntry[]>([])
  const [filesSubPath, setFilesSubPath] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')

  // 状态
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  // 加载项目列表
  const loadProjects = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/projects`)
      const data = await res.json()
      setProjects(data as Project[])
    } catch {
      showToast(t('compose.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProjects() }, [])

  // 加载项目文件（复用 ServiceCard 的 files API 模式）
  const loadProjectFiles = async (name: string, subPath: string = '') => {
    setFilesLoading(true)
    try {
      const pathQuery = subPath ? `${name}/${subPath}` : name
      const res = await fetch(`${API_BASE}/files?path=${pathQuery}`)
      const data = await res.json()
      setProjectFiles((data.entries || []) as FileEntry[])
      setFilesSubPath(subPath)
    } catch {
      showToast(t('compose.loadFilesFailed'), 'error')
    } finally {
      setFilesLoading(false)
    }
  }

  // 打开项目
  const openProject = async (name: string) => {
    setSelectedProject(name)
    setEditingFile(null)
    setFileContent('')
    setOriginalContent('')
    await loadProjectFiles(name, '')
  }

  // 读取文件（复用 ServiceCard 模式，支持目录导航）
  const readFileContent = async (fileName: string) => {
    if (!selectedProject) return
    // 目录：进入子目录
    const entry = projectFiles.find(f => f.name === fileName)
    if (entry?.isDir) {
      const newPath = filesSubPath ? `${filesSubPath}/${fileName}` : fileName
      setEditingFile(null)
      setFileContent('')
      setOriginalContent('')
      await loadProjectFiles(selectedProject, newPath)
      return
    }
    // 文件：读取内容
    setEditingFile(fileName)
    try {
      const filePath = filesSubPath
        ? `${selectedProject}/${filesSubPath}/${fileName}`
        : `${selectedProject}/${fileName}`
      const res = await fetch(`${API_BASE}/files/${filePath}`)
      const data = await res.json()
      if (data.type === 'directory') {
        // 兜底：服务端返回目录则进入
        const newPath = filesSubPath ? `${filesSubPath}/${fileName}` : fileName
        setEditingFile(null)
        await loadProjectFiles(selectedProject, newPath)
      } else {
        const content = data.content as string
        setFileContent(content)
        setOriginalContent(content)
      }
    } catch {
      showToast(t('compose.readFileFailed'), 'error')
    }
  }

  // 返回上级目录
  const goToParentDir = () => {
    const parts = filesSubPath.split('/')
    parts.pop()
    const parentPath = parts.join('/')
    setEditingFile(null)
    setFileContent('')
    setOriginalContent('')
    loadProjectFiles(selectedProject!, parentPath)
  }

  // 保存文件（复用 ServiceCard 模式，支持子路径）
  const saveFile = async () => {
    if (!selectedProject || !editingFile) return
    setSaving(true)
    try {
      const filePath = filesSubPath
        ? `${selectedProject}/${filesSubPath}/${editingFile}`
        : `${selectedProject}/${editingFile}`
      const res = await fetch(`${API_BASE}/files/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
      })
      if (!res.ok) throw new Error(t('compose.saveFailed'))
      setOriginalContent(fileContent)
      showToast(t('compose.saved'))
    } catch (e: any) {
      showToast(e.message || t('compose.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = fileContent !== originalContent

  // Compose 操作（与 ServiceCard 的 doAction 功能一致）
  const composeAction = async (action: string) => {
    if (!selectedProject) return
    setActionLoading(action)
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      const stderr = data.stderr || ''
      const hasStderrError = /error|failed|denied|permission|conflict/i.test(stderr)
      if (data.success !== false && res.ok && !hasStderrError) {
        const actionLabels: Record<string, string> = {
          up: t('service.upSuccess'), down: t('service.downSuccess'), stop: t('service.stopSuccess'), restart: t('service.restartSuccess'), pull: t('compose.pullSuccess'),
        }
        showToast(actionLabels[action] || t('service.operationSuccess'), 'success')
      } else {
        const err = stderr || data.error || t('service.operationFailed')
        showToast(err.length > 200 ? err.slice(0, 200) + '…' : err, 'error')
      }
    } catch (e: any) {
      showToast(e.message || t('service.operationFailed'), 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // ESC 关闭编辑
  useEffect(() => {
    if (!editingFile) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingFile(null)
        setFileContent('')
        setOriginalContent('')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editingFile])

  // 返回列表
  if (!selectedProject) {
    return (
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
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
              <button
                key={p.name}
                onClick={() => openProject(p.name)}
                className="bg-surface border border-border rounded-lg p-4 hover:border-accent/50 hover:bg-accent/5 transition-all group text-left"
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
                  {p.hasCompose && (
                    <span className="text-accent bg-accent/10 px-1.5 py-0.5 rounded text-xs">{p.composeFile}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    )
  }

  // 项目详情
  return (
    <main className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success' ? 'bg-running/20 border border-running/30 text-running' : 'bg-error/20 border border-error/30 text-error'
        }`}>{toast.msg}</div>
      )}

      {/* 面包屑 + 操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedProject(null); setEditingFile(null) }}
            className="flex items-center gap-1 text-sm text-textMuted hover:text-textPrimary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('compose.back')}
          </button>
          <span className="text-border">/</span>
          <span className="text-sm font-semibold text-textPrimary">{selectedProject}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => composeAction('up')}
            disabled={actionLoading === 'up'}
            className="action-btn action-btn-primary flex items-center gap-1.5 !py-1 !text-xs"
          >
            {actionLoading === 'up' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {t('compose.up')}
          </button>
          <button
            onClick={() => composeAction('down')}
            disabled={actionLoading === 'down'}
            className="action-btn action-btn-ghost flex items-center gap-1.5 border border-border !py-1 !text-xs text-warning"
          >
            {actionLoading === 'down' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
            {t('compose.down')}
          </button>
          <button
            onClick={() => composeAction('restart')}
            disabled={actionLoading === 'restart'}
            className="action-btn action-btn-ghost flex items-center gap-1.5 border border-border !py-1 !text-xs"
          >
            {actionLoading === 'restart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {t('compose.restart')}
          </button>
          <button
            onClick={() => composeAction('pull')}
            disabled={actionLoading === 'pull'}
            className="action-btn action-btn-ghost flex items-center gap-1.5 border border-border !py-1 !text-xs"
          >
            {actionLoading === 'pull' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {t('compose.pull')}
          </button>
        </div>
      </div>

      {/* 文件列表 + 编辑器（复用 ServiceCard 浏览文件模式） */}
      <div className="flex gap-4 min-h-[60vh]">
        {/* 文件列表（含目录导航） */}
        <div className="w-52 shrink-0 bg-surface border border-border rounded-lg p-2 flex flex-col gap-0.5">
          {/* 路径栏 + 返回上级 */}
          {filesSubPath ? (
            <>
              <div className="flex items-center gap-1 px-2 py-1 text-xs text-textMuted mb-1">
                <FolderOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">{selectedProject}/{filesSubPath}</span>
              </div>
              <button
                onClick={goToParentDir}
                className="w-full flex items-center gap-1.5 px-2 py-2 rounded text-xs text-textMuted hover:text-textPrimary hover:bg-border/30 transition-colors mb-1"
              >
                <ChevronLeft className="w-3 h-3 shrink-0" />
                <span>{t('service.backToParent')}</span>
              </button>
              <div className="my-1 border-t border-border/50" />
            </>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-textMuted mb-1">
              <FolderOpen className="w-3 h-3 shrink-0" />
              <span className="truncate">{t('compose.projectFiles')}</span>
            </div>
          )}

          {filesLoading ? (
            <div className="flex items-center justify-center py-8 text-textMuted">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            projectFiles.map(f => (
              <button
                key={f.name}
                onClick={() => readFileContent(f.name)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-sm transition-colors ${
                  editingFile === f.name && !f.isDir
                    ? 'bg-accent/10 text-accent'
                    : 'text-textSecondary hover:text-textPrimary hover:bg-border/30'
                }`}
              >
                {f.isDir ? (
                  <FolderOpen className="w-3.5 h-3.5 text-warning shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-textMuted shrink-0" />
                )}
                <span className="truncate text-xs">{f.name}</span>
              </button>
            ))
          )}
        </div>

        {/* 编辑器区域（复用 ServiceCard 编辑器模式） */}
        <div className="flex-1 min-w-0">
          {editingFile ? (
            <div className="flex flex-col h-full gap-3">
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-textPrimary">{editingFile}</span>
                  {hasChanges && (
                    <span className="text-xs text-warning bg-warning/10 px-1.5 rounded">{t('compose.unsaved')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingFile(null); setFileContent(''); setOriginalContent('') }}
                    className="action-btn action-btn-ghost !text-xs !py-1"
                  >
                    {t('compose.close')}
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving || !hasChanges}
                    className="action-btn action-btn-primary flex items-center gap-1.5 !text-xs !py-1"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {t('common.save')}
                  </button>
                </div>
              </div>

              {/* YAML 文件用高亮编辑器，其他用普通 textarea */}
              {editingFile.endsWith('.yml') || editingFile.endsWith('.yaml') ? (
                <YamlEditor
                  value={fileContent}
                  onChange={setFileContent}
                  rows={25}
                />
              ) : (
                <textarea
                  value={fileContent}
                  onChange={e => setFileContent(e.target.value)}
                  rows={25}
                  spellCheck={false}
                  className="w-full bg-panel border border-border rounded px-3 py-2 text-sm font-mono text-textPrimary placeholder:text-textMuted outline-none focus:border-accent transition-colors resize-none leading-relaxed"
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-textMuted py-20">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">{t('compose.selectFile')}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

