import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Terminal, ScrollText, RotateCw, RefreshCw, Play, Square, Trash2, Loader2, Pencil, FolderOpen, X, Save, ArrowUpCircle, Cpu, HardDrive, Clock } from 'lucide-react'
import type { Service } from '../types'
import LogsModal from './LogsModal'
import YamlEditor from './YamlEditor'
import TerminalModal from './TerminalModal'
import UpdateModal from './UpdateModal'
import ProjectFileManager from './ProjectFileManager'
import { useSelf } from '../hooks/useSelf'

const statusDot: Record<string, string> = {
  running:  'bg-running pulse-dot',
  stopped:  'bg-stopped',
  error:    'bg-error pulse-dot',
  warning:  'bg-warning pulse-dot',
}

const statusBorder: Record<string, string> = {
  running:  'border-running/30',
  stopped:  'border-stopped/20',
  error:    'border-error/30',
  warning:  'border-warning/30',
}

const statusBadge: Record<string, string> = {
  running:  'text-running border-running/30',
  stopped:  'text-stopped border-stopped/20',
  error:    'text-error border-error/30',
  warning:  'text-warning border-warning/30',
}

interface ServiceCardProps {
  service: Service
  managedProjects: string[]
  onCardClick?: () => void
}

export default function ServiceCard({ service, managedProjects, onCardClick }: ServiceCardProps) {
  const { t } = useTranslation()
  const { isSelf } = useSelf()

  // 判断当前 service 是否包含自身容器
  const isSelfService = service.containers.some(c => isSelf(c.id))
  const [loading, setLoading] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  // 编辑相关状态
  const [editContent, setEditContent] = useState('')
  const [editFile, setEditFile] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  const dot = statusDot[service.status] ?? statusDot['stopped']!
  const sBorder = statusBorder[service.status] ?? statusBorder['stopped']!
  const sBadge = statusBadge[service.status] ?? statusBadge['stopped']!
  const statusLabel = t(`status.${service.status}`, service.status)

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // ESC 关闭弹窗
  useEffect(() => {
    if (!showFiles && !showEdit) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowFiles(false); setShowEdit(false) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showFiles, showEdit])

  // 管理项目的统一操作（compose API）
  const doAction = async (action: string) => {
    if (!isManaged) return
    setLoading(action)
    try {
      const res = action === 'delete'
        ? await fetch(`/projects/${projectDirName}`, { method: 'DELETE' })
        : await fetch(`/projects/${projectDirName}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      const stderr = data.stderr || ''
      const hasStderrError = /error|failed|denied|permission|conflict/i.test(stderr)
      if (data.success === false || !res.ok || hasStderrError) {
        const errMsg = stderr || data.error || '操作失败'
        setToast({ msg: errMsg, type: 'error' })
      } else {
        const actionLabels: Record<string, string> = {
          up: t('service.upSuccess'), down: t('service.downSuccess'), stop: t('service.stopSuccess'), restart: t('service.restartSuccess'), rebuild: t('service.rebuildSuccess'), delete: t('service.deleteSuccess'),
        }
        setToast({ msg: actionLabels[action] || t('service.operationSuccess'), type: 'success' })
      }
    } catch (e: any) {
      setToast({ msg: e.message || t('service.operationFailed'), type: 'error' })
    }
    setLoading(null)
  }

  // 更新完成后刷新（依靠 WebSocket 实时推送自动刷新容器状态）
  const handleUpdateRefresh = () => {
    setShowUpdateModal(false)
  }

  // 打开编辑：加载 compose 文件
  const handleOpenEdit = async () => {
    setEditLoading(true)
    try {
      const res = await fetch(`/projects/${projectDirName}`)
      const data = await res.json()
      setEditContent(data.content || '')
      setEditFile(data.composeFile || 'docker-compose.yml')
      setShowEdit(true)
    } catch {
      // 加载失败不打开弹窗
    }
    finally { setEditLoading(false) }
  }

  const handleSaveEdit = async (redeploy: boolean) => {
    setEditSaving(true)
    try {
      const res = await fetch(`/projects/${projectDirName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent, redeploy }),
      })
      const data = await res.json()
      if (data.warnings?.length) {
        setToast({ msg: data.warnings.join('\n'), type: 'error' })
      }
      if (!res.ok) return
      if (data.deployError) {
        setToast({ msg: data.deployError, type: 'error' })
      }
      setShowEdit(false)
    } catch { /* ignore */ }
    finally { setEditSaving(false) }
  }

  // 打开文件浏览器
  const isRunning = service.status === 'running'
  const isStopped = service.status === 'stopped'
  const hasManyContainers = service.containerCount > 1
  // 聚合去重端口，优先映射过的
  const allPorts = service.containers.flatMap(c => c.ports ?? [])
  const seenPorts = new Set<string>()
  const uniquePorts = allPorts.filter(p => {
    const key = p.public ? `${p.public}:${p.private}` : `${p.private}`
    if (seenPorts.has(key)) return false
    seenPorts.add(key)
    return true
  }).sort((a, b) => {
    if (a.public && !b.public) return -1
    if (!a.public && b.public) return 1
    if (a.public && b.public) return a.public - b.public
    return a.private - b.private
  })
  // Docker 容器 ID 是 12+ 位十六进制字符串，非此格式即为 compose 项目名
  const isCompose = !/^[a-f0-9]{12,}$/.test(service.id) || hasManyContainers
  // Docker Compose v2 会去掉项目名中的连字符，需双向标准化比较
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '')
  const isManaged = isCompose && managedProjects.some(p => normalize(p) === normalize(service.id))
  // compose API 用文件系统目录名（匹配 Docker 标签名 → 目录名）
  const projectDirName = isManaged
    ? (managedProjects.find(p => normalize(p) === normalize(service.id)) || service.id)
    : service.id
  const firstContainerId = isCompose ? (service.containers[0]?.id || service.id) : service.id

  return (
    <>
      {/* Toast */}
      {toast && createPortal(
        <div className={`fixed top-12 right-4 z-[9999] px-5 py-3.5 rounded-lg shadow-xl text-sm max-w-3xl whitespace-pre-wrap backdrop-blur-sm ${
          toast.type === 'success' ? 'bg-running/90 border border-running/40 text-white' : 'bg-error/90 border border-error/40 text-white'
        }`}>{toast.msg}</div>,
        document.body
      )}

      <div
        className={`group relative bg-surface border rounded-xl p-4 flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1 ${sBorder} hover:border-accent/40`}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
          isRunning ? 'bg-gradient-to-r from-running/0 via-running to-running/0' :
          isStopped ? 'bg-gradient-to-r from-stopped/0 via-stopped to-stopped/0' :
          'bg-gradient-to-r from-warning/0 via-warning to-warning/0'
        }`} />

        {/* 上部内容区域 — 点击打开 ProjectDetailModal */}
        <div
          onClick={onCardClick}
          className={`flex flex-col gap-3 flex-1 ${onCardClick ? 'cursor-pointer' : ''}`}
        >
          {/* 头部：名称 + 状态 */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <span className="text-sm font-semibold text-textPrimary truncate">
                  {service.name}
                </span>
              </div>
              <p className="text-[11px] text-textMuted/60 mt-0.5 truncate">
                {service.containers.slice(0, 3).map(c => c.name).join(', ')}
                {service.containers.length > 3 ? ` +${service.containers.length - 3}` : ''}
              </p>
            </div>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${sBadge} bg-panel/50 border shrink-0`}>{statusLabel}</span>
          </div>

          {/* 资源使用 */}
          {isRunning && (
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-textMuted flex items-center gap-1"><Cpu className="w-3 h-3" />CPU</span>
                  <span className="text-textPrimary font-mono font-semibold">{service.totalCpu}%</span>
                </div>
                <div className="metric-bar"><div className="metric-bar-fill bg-accent" style={{ width: `${Math.min(service.totalCpu, 100)}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-textMuted flex items-center gap-1 min-w-0">
                    <HardDrive className="w-3 h-3 shrink-0" />
                    <span className="truncate">MEM {service.totalMemory}{service.memoryUnit}</span>
                  </span>
                  <span className="text-textPrimary font-mono font-semibold shrink-0 ml-1">{(service.totalMemoryPercent ?? 0).toFixed(1)}%</span>
                </div>
                <div className="metric-bar"><div className="metric-bar-fill bg-warning" style={{ width: `${Math.min(service.totalMemoryPercent ?? 0, 100)}%` }} /></div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-textMuted/60 gap-2">
            <span className="flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3" />{service.uptime}
              <span className="text-border/60 mx-0.5">·</span>
              {t('service.containers', { count: service.containerCount })}
            </span>
            {uniquePorts.length > 0 && (
              <span className="flex items-center gap-1 min-w-0 justify-end">
                {uniquePorts.slice(0, 3).map((p, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/5 border border-accent/10 text-textSecondary font-mono shrink-0">
                    {p.public ? `${p.public}:${p.private}` : p.private}
                  </span>
                ))}
                {uniquePorts.length > 3 && <span className="text-textMuted shrink-0">+{uniquePorts.length - 3}</span>}
              </span>
            )}
          </div>
        </div>

        {/* 操作按钮 — 图标 + hover tooltip，阻止冒泡 */}
        <div
          className="flex items-center justify-between gap-1.5 pt-2 mt-auto border-t border-border/50 flex-wrap"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setShowTerminal(true)}
              title={t('service.enter')}
              className="action-btn action-btn-ghost flex items-center p-1.5">
              <Terminal className="w-3.5 h-3.5" />
            </button>

            <button onClick={() => setShowLogs(true)}
              title={t('service.logs')}
              className="action-btn action-btn-ghost flex items-center p-1.5">
              <ScrollText className="w-3.5 h-3.5" />
            </button>

            {/* 更新按钮 — 打开更新弹窗（仅运行中） */}
            {isRunning && (
              <button
                onClick={() => setShowUpdateModal(true)}
                title={t('containers.checkUpdate')}
                className="action-btn action-btn-ghost flex items-center p-1.5"
              >
                <ArrowUpCircle className="w-3.5 h-3.5 text-textMuted" />
              </button>
            )}

            {/* 运行中管理操作（仅管理项目） */}
            {isManaged && isRunning && (
              <>
                <span className="w-px h-4 bg-border/50 mx-0.5" />
                <button onClick={() => doAction('stop')} disabled={loading === 'stop' || isSelfService}
                  title={isSelfService ? t('containers.selfProtection') : t('service.stop')}
                  className={`action-btn flex items-center p-1.5 ${isSelfService ? 'opacity-30 cursor-not-allowed' : 'action-btn-ghost text-error hover:text-error'}`}>
                  {loading === 'stop' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction('restart')} disabled={loading === 'restart' || isSelfService}
                  title={isSelfService ? t('containers.selfProtection') : t('service.restart')}
                  className={`action-btn flex items-center p-1.5 ${isSelfService ? 'opacity-30 cursor-not-allowed' : 'action-btn-ghost'}`}>
                  {loading === 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction('rebuild')} disabled={loading === 'rebuild' || isSelfService}
                  title={isSelfService ? t('containers.selfProtection') : t('service.rebuild')}
                  className={`action-btn flex items-center p-1.5 ${isSelfService ? 'opacity-30 cursor-not-allowed' : 'action-btn-ghost text-accent hover:text-accent'}`}>
                  {loading === 'rebuild' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
              </>
            )}

            {/* 已停止管理操作（仅管理项目） */}
            {isManaged && isStopped && (
              <>
                <span className="w-px h-4 bg-border/50 mx-0.5" />
                <button onClick={() => doAction('up')} disabled={loading === 'up'}
                  title={t('service.start')}
                  className="action-btn action-btn-ghost flex items-center p-1.5 text-running hover:text-running">
                  {loading === 'up' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                {!showDeleteConfirm ? (
                  <button onClick={() => setShowDeleteConfirm(true)}
                    title={t('service.delete')}
                    className="action-btn action-btn-ghost flex items-center p-1.5 text-error hover:text-error">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={() => doAction('delete')} disabled={loading === 'delete'}
                      className="action-btn bg-error text-white hover:bg-error/80 flex items-center gap-1 !text-xs !py-0.5 !px-1.5">
                      {loading === 'delete' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      {t('service.delete')}
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)}
                      className="action-btn action-btn-ghost !text-xs !py-0.5 !px-1.5">{t('service.cancel')}</button>
                  </div>
                )}
              </>
            )}

            {/* 异常/警告管理操作（仅管理项目） */}
            {isManaged && (service.status === 'error' || service.status === 'warning') && (
              <>
                <span className="w-px h-4 bg-border/50 mx-0.5" />
                <button onClick={() => doAction('stop')} disabled={loading === 'stop'}
                  title={t('service.stop')}
                  className="action-btn action-btn-ghost flex items-center p-1.5 text-error hover:text-error">
                  {loading === 'stop' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction('restart')} disabled={loading === 'restart'}
                  title={t('service.restart')}
                  className="action-btn action-btn-primary flex items-center p-1.5">
                  {loading === 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => doAction('rebuild')} disabled={loading === 'rebuild'}
                  title={t('service.rebuild')}
                  className="action-btn action-btn-ghost flex items-center p-1.5 text-accent hover:text-accent">
                  {loading === 'rebuild' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
              </>
            )}
          </div>

          {/* 编辑/文件 — 靠右，仅管理项目显示 */}
          {isManaged && (
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={handleOpenEdit}
                title={t('service.editCompose')}
                className="action-btn action-btn-ghost flex items-center p-1.5 text-accent hover:text-accent hover:bg-accent/10">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowFiles(true)}
                title={t('service.browseFiles')}
                className="action-btn action-btn-ghost flex items-center p-1.5 text-textSecondary hover:text-accent">
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 日志弹窗 */}
      {showLogs && (
        <LogsModal
          containerId={firstContainerId}
          containerName={service.name}
          containers={service.containers.map(c => ({ id: c.id, name: c.name }))}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* 终端弹窗 */}
      {showTerminal && (
        <TerminalModal
          containerName={service.name}
          onClose={() => setShowTerminal(false)}
        />
      )}

      {/* 更新弹窗 */}
      {showUpdateModal && (
        <UpdateModal
          service={service}
          isCompose={isCompose}
          isManaged={isManaged}
          projectDirName={projectDirName}
          onClose={() => setShowUpdateModal(false)}
          onRefresh={handleUpdateRefresh}
        />
      )}

      {/* 编辑 Compose 弹窗 */}
      {showEdit && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div
            className="bg-surface border border-border rounded-lg shadow-2xl w-[800px] max-w-[95vw] flex flex-col"
            style={{ maxHeight: '90vh', height: '75vh' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-textPrimary">{t('service.editCompose')} {editFile || service.name}</h3>
              </div>
              <button onClick={() => setShowEdit(false)}
                className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 flex flex-col min-h-0">
              {editLoading ? (
                <div className="flex items-center justify-center py-16 text-textMuted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                </div>
              ) : (
                <YamlEditor value={editContent} onChange={setEditContent} rows={15} />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
              <button onClick={() => setShowEdit(false)}
                className="action-btn action-btn-ghost text-sm">{t('service.cancel')}</button>
              <button onClick={() => handleSaveEdit(false)}
                disabled={editSaving || editLoading}
                className="action-btn action-btn-ghost flex items-center gap-1.5 text-sm border border-border">
                {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t('service.saveOnly')}
              </button>
              <button onClick={() => handleSaveEdit(true)}
                disabled={editSaving || editLoading || isSelfService}
                title={isSelfService ? t('containers.selfProtection') + ', ' + t('service.saveOnly') : ''}
                className={`action-btn flex items-center gap-1.5 text-sm ${isSelfService ? 'opacity-30 cursor-not-allowed' : 'action-btn-primary'}`}>
                {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t('service.saveAndRebuild')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 文件管理弹窗 - 使用统一的 ProjectFileManager */}
      {showFiles && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div
            className="bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
            style={{ width: '900px', maxWidth: '96vw', height: '82vh', maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-warning shrink-0" />
                <h3 className="text-sm font-semibold text-textPrimary">{service.name}</h3>
              </div>
              <button onClick={() => setShowFiles(false)}
                className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ProjectFileManager (minimal mode: no search, no compose buttons) */}
            <ProjectFileManager
              projectName={service.name}
              minimal
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
