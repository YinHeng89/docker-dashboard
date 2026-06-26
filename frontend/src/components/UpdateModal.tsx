import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  X, ArrowUpCircle, ShieldCheck, Loader2, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Terminal,
} from 'lucide-react'
import type { Service, ContainerUpdateResult } from '../types'
import { checkContainerUpdate } from '../api/docker'
import { useSelf } from '../hooks/useSelf'
import { useNotifications } from './NotificationProvider'

interface UpdateModalProps {
  service: Service
  isCompose: boolean
  isManaged: boolean
  projectDirName: string
  onClose: () => void
  onRefresh: () => void
}

interface ContainerRow {
  containerId: string
  containerName: string
  image: string
  composeService?: string
}

type RowState = 'idle' | 'checking' | 'hasUpdate' | 'upToDate' | 'updating' | 'done' | 'error'

interface RowData {
  state: RowState
  result?: ContainerUpdateResult
  error?: string
}

interface LogEntry {
  container?: string
  message: string
  stream: 'stdout' | 'stderr'
}

export default function UpdateModal({
  service, isCompose, isManaged, projectDirName, onClose, onRefresh,
}: UpdateModalProps) {
  const { t } = useTranslation()
  const { success, error: showError } = useNotifications()

  // 构建容器列表
  const containerRows: ContainerRow[] = service.containers.map(c => ({
    containerId: c.id,
    containerName: c.name,
    image: '',
    composeService: (c as any).composeService,
  }))

  // 每行状态
  const [rowStates, setRowStates] = useState<Record<string, RowData>>({})
  // 更新进度
  const [overallProgress, setOverallProgress] = useState(0)
  const [overallMessage, setOverallMessage] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  // 自身容器保护
  const { isSelf } = useSelf()
  // 日志
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 自动滚动日志
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, showLogs])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUpdating) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isUpdating, onClose])

  // 检查单个容器更新
  const handleCheckSingle = async (row: ContainerRow) => {
    const id = row.containerId
    setRowStates(prev => ({ ...prev, [id]: { state: 'checking' } }))
    try {
      const result = await checkContainerUpdate(id) as ContainerUpdateResult
      const status = result.status || (result.hasUpdate ? 'update_available' : 'up_to_date')

      if (result.error) {
        // 有错误的检查结果
        setRowStates(prev => ({ ...prev, [id]: { state: 'error', result, error: result.error } }))
        showError(result.error)
      } else if (status === 'update_available') {
        setRowStates(prev => ({ ...prev, [id]: { state: 'hasUpdate', result } }))
        success(t('containers.updateAvailable'))
      } else if (status === 'local_image') {
        setRowStates(prev => ({ ...prev, [id]: { state: 'upToDate', result, error: result.message } }))
      } else {
        setRowStates(prev => ({ ...prev, [id]: { state: 'upToDate', result } }))
      }
    } catch (e: any) {
      setRowStates(prev => ({ ...prev, [id]: { state: 'error', error: e.message } }))
      showError(t('containers.updateError'))
    }
  }

  // 全部检查
  const handleCheckAll = async () => {
    for (const row of containerRows) {
      await handleCheckSingle(row)
    }
  }

  // 获取准备更新的容器列表
  const getContainersToUpdate = (): ContainerRow[] => {
    return containerRows.filter(row => {
      const s = rowStates[row.containerId]
      return s?.state === 'hasUpdate'
    })
  }

  // 执行更新（仅 Compose）
  const handleUpdate = async () => {
    const toUpdate = getContainersToUpdate()
    if (toUpdate.length === 0) return

    setIsUpdating(true)
    setOverallProgress(0)
    setOverallMessage('准备更新...')
    setLogs([])

    const newStates = { ...rowStates }
    for (const row of toUpdate) {
      newStates[row.containerId] = { state: 'updating' }
    }
    setRowStates(newStates)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const body = {
        containers: toUpdate.map(r => ({
          containerId: r.containerId,
          containerName: r.containerName,
          composeService: r.composeService || r.containerName.replace(/^[^-]+-/, '').replace(/-[0-9]+$/, ''),
        })),
        projectName: projectDirName,
      }

      const response = await fetch('/api/update/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            handleProgressMessage(msg)
          } catch { /* skip invalid JSON */ }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setOverallMessage('更新已取消')
      } else {
        setOverallMessage(`更新失败: ${e.message}`)
        showError(`更新失败: ${e.message}`)
      }
    } finally {
      setIsUpdating(false)
      abortRef.current = null
      onRefresh()
    }
  }

  // 处理进度消息
  const handleProgressMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'step': {
        const { container, step, message, percent } = msg
        if (percent !== undefined) {
          setOverallProgress(percent)
        }
        setOverallMessage(message || '')

        // 更新行状态
        setRowStates(prev => {
          const current = prev[container]
          const stateMap: Record<string, RowState> = {
            pulling: 'updating',
            stopping: 'updating',
            recreating: 'updating',
            starting: 'updating',
            done: 'done',
            error: 'error',
          }
          return {
            ...prev,
            [container]: {
              ...current,
              state: stateMap[step] || current?.state || 'updating',
              error: step === 'error' ? message : current?.error,
            },
          }
        })
        break
      }
      case 'log': {
        setLogs(prev => [...prev.slice(-200), {
          container: msg.container,
          message: msg.message,
          stream: msg.stream || 'stdout',
        }])
        break
      }
      case 'all-done': {
        setOverallProgress(100)
        setOverallMessage(msg.message || '更新完成')
        success(t('containers.updateSuccess'))
        break
      }
      case 'all-error': {
        setOverallMessage(msg.message || '更新失败')
        showError(msg.message || t('containers.updateFailed'))
        break
      }
    }
  }, [success, showError, t])

  // 取消更新
  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }

  const hasChecking = Object.values(rowStates).some(s => s.state === 'checking')
  const updateCount = getContainersToUpdate().length

  // 获取行状态图标
  const getRowIcon = (state: RowState) => {
    switch (state) {
      case 'idle': return <ArrowUpCircle className="w-4 h-4 text-textMuted" />
      case 'checking': return <Loader2 className="w-4 h-4 animate-spin text-accent" />
      case 'hasUpdate': return <ArrowUpCircle className="w-4 h-4 text-warning" />
      case 'upToDate': return <ShieldCheck className="w-4 h-4 text-running" />
      case 'updating': return <Loader2 className="w-4 h-4 animate-spin text-accent" />
      case 'done': return <CheckCircle2 className="w-4 h-4 text-running" />
      case 'error': return <XCircle className="w-4 h-4 text-error" />
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={() => { if (!isUpdating) onClose() }}>
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-[680px] max-w-[96vw] flex flex-col animate-fadeInScale"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <ArrowUpCircle className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-textPrimary">
                {t('update.title', '更新')} {service.name}
              </h3>
              <p className="text-xs text-textMuted mt-0.5">
                {isCompose && isManaged
                  ? t('update.composeMode', 'Compose 部署模式 - 将逐服务拉取镜像并重建')
                  : t('update.standaloneMode', '独立容器模式')}
              </p>
            </div>
          </div>
          <button onClick={() => { if (!isUpdating) onClose() }}
            disabled={isUpdating}
            className="p-1.5 rounded-lg hover:bg-border/30 text-textMuted hover:text-textPrimary transition-colors disabled:opacity-30">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 容器列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 min-h-0">
          {containerRows.map((row) => {
            const rs = rowStates[row.containerId]
            const state = rs?.state || 'idle'
            return (
              <div key={row.containerId}
                className="flex items-center gap-3 p-3 rounded-lg bg-panel/50 border border-border/50 hover:border-border transition-colors">
                {/* 容器信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0">{getRowIcon(state)}</span>
                    <span className="text-sm font-medium text-textPrimary truncate">
                      {row.containerName}
                    </span>
                    {row.composeService && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/5 text-textMuted border border-accent/10">
                        {row.composeService}
                      </span>
                    )}
                    {isSelf(row.containerId) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {t('update.self', '自身')}
                      </span>
                    )}
                  </div>
                  {rs?.result?.imageName && (
                    <p className="text-xs text-textMuted font-mono truncate mt-0.5">
                      {rs.result.imageName}
                    </p>
                  )}
                  {rs?.error && (
                    <p className="text-xs text-error mt-0.5">{rs.error}</p>
                  )}
                </div>

                {/* Digest 信息 */}
                {rs?.result?.currentDigest && (
                  <div className="hidden md:flex items-center gap-2 text-[10px] text-textMuted">
                    {rs.result.hasUpdate ? (
                      <>
                        <span className="text-textMuted line-through">{rs.result.currentDigest.slice(7, 19)}</span>
                        <span className="text-accent">→</span>
                        <span className="text-accent">{rs.result.remoteDigest?.slice(7, 19)}</span>
                      </>
                    ) : (
                      <span className="text-textMuted">{rs.result.currentDigest.slice(7, 19)}</span>
                    )}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="shrink-0">
                  {state === 'idle' && !isUpdating && (
                    <button
                      onClick={() => handleCheckSingle(row)}
                      className="action-btn action-btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                      title={t('containers.checkUpdate')}>
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      {t('containers.checkUpdate')}
                    </button>
                  )}
                  {state === 'checking' && (
                    <span className="inline-flex items-center gap-1 text-xs text-accent px-3 py-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t('containers.checking')}
                    </span>
                  )}
                  {state === 'hasUpdate' && !isUpdating && isManaged && isSelf(row.containerId) && (
                    <span className="text-xs text-warning/70 px-3 py-1.5" title={t('update.selfHint', '更新自身容器会导致 Dashboard 中断')}>
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                      {t('update.selfUpdate', '需手动更新')}
                    </span>
                  )}
                  {state === 'hasUpdate' && !isUpdating && isManaged && !isSelf(row.containerId) && (
                    <button
                      onClick={handleUpdate}
                      className="action-btn bg-warning/10 text-warning hover:bg-warning/20 border border-warning/20 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                      title={t('containers.updateContainer')}>
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      {t('containers.updateContainer')}
                    </button>
                  )}
                  {state === 'hasUpdate' && !isUpdating && !isManaged && (
                    <span className="text-xs text-textMuted/70 px-3 py-1.5" title="仅支持 Compose 项目更新">
                      <ArrowUpCircle className="w-3.5 h-3.5 inline mr-1 text-warning/50" />
                      {t('update.composeOnly', '仅 Compose 项目支持更新')}
                    </span>
                  )}
                  {state === 'upToDate' && (
                    <span className="inline-flex items-center gap-1 text-xs text-running px-3 py-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {t('containers.upToDate')}
                    </span>
                  )}
                  {state === 'updating' && (
                    <span className="inline-flex items-center gap-1 text-xs text-accent px-3 py-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t('containers.updating')}
                    </span>
                  )}
                  {state === 'done' && (
                    <span className="inline-flex items-center gap-1 text-xs text-running px-3 py-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t('update.completed', '已完成')}
                    </span>
                  )}
                  {state === 'error' && (
                    <span className="inline-flex items-center gap-1 text-xs text-error px-3 py-1.5">
                      <XCircle className="w-3.5 h-3.5" />
                      {t('update.failed', '失败')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {/* 空状态 */}
          {containerRows.length === 0 && (
            <div className="text-center py-8 text-textMuted text-sm">
              {t('update.noContainers', '没有可更新的容器')}
            </div>
          )}
        </div>

        {/* 进度条区域 */}
        {(isUpdating || overallProgress > 0) && (
          <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">
            {/* 进度条 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-textSecondary">{overallMessage}</span>
                <span className="text-textMuted font-mono">{overallProgress}%</span>
              </div>
              <div className="h-2 bg-panel rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${
                  overallProgress === 100
                    ? 'bg-gradient-to-r from-running to-emerald-400'
                    : 'bg-gradient-to-r from-accent to-blue-400'
                }`}
                  style={{ width: `${overallProgress}%` }} />
              </div>
            </div>

            {/* 日志切换按钮 */}
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="flex items-center gap-1 text-xs text-textMuted hover:text-textPrimary transition-colors">
              <Terminal className="w-3 h-3" />
              {t('update.showLogs', '日志输出')}
              {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* 日志输出 */}
            {showLogs && (
              <div className="bg-black/90 text-green-400 rounded-lg p-3 text-xs font-mono h-40 overflow-y-auto"
                onClick={e => e.stopPropagation()}>
                {logs.length === 0 ? (
                  <span className="text-textMuted">{t('update.waitingLogs', '等待输出...')}</span>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`leading-relaxed whitespace-pre-wrap break-all ${
                      log.stream === 'stderr' ? 'text-red-400' : 'text-green-400'
                    }`}>
                      {log.container && <span className="text-blue-400">[{log.container}] </span>}
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            {!isUpdating && (
              <button onClick={handleCheckAll}
                disabled={hasChecking || isUpdating}
                className="action-btn action-btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border">
                {hasChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                {t('update.checkAll', '全部检查')}
              </button>
            )}
            {isUpdating && (
              <button onClick={handleCancel}
                className="action-btn bg-error/10 text-error hover:bg-error/20 border border-error/20 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg">
                <XCircle className="w-3.5 h-3.5" />
                {t('update.cancel', '取消更新')}
              </button>
            )}
            {updateCount > 0 && !isUpdating && (
              <span className="text-xs text-textMuted flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-warning" />
                {t('update.countHint', '{{count}} 个容器可更新', { count: updateCount })}
              </span>
            )}
          </div>
          <button onClick={() => { if (!isUpdating) onClose() }}
            disabled={isUpdating}
            className="action-btn action-btn-ghost text-xs px-4 py-1.5 rounded-lg disabled:opacity-30">
            {isUpdating ? t('update.updatingClose', '更新中...') : t('update.close', '关闭')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
