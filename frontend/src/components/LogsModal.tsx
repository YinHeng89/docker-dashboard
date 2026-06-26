import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, Loader2, Pause, Play, ScrollText } from 'lucide-react'

interface LogsModalProps {
  containerId: string
  containerName: string
  onClose: () => void
}

export default function LogsModal({ containerId, containerName, onClose }: LogsModalProps) {
  const { t } = useTranslation()
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pausedBuffer = useRef<string[]>([])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/exec`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setLoading(false)
      // docker logs -f: follow 模式，tail=200 先取最近 200 行
      ws.send(JSON.stringify({
        type: 'exec',
        command: `docker logs -f --tail 200 ${containerId}`,
        cwd: '/',
      }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          const text = msg.data as string
          const newLines = text.split('\n').filter((l: string) => l.length > 0)
          if (pausedRef.current) {
            pausedBuffer.current.push(...newLines)
          } else {
            setLines(prev => [...prev, ...newLines])
          }
        } else if (msg.type === 'exit') {
          setConnected(false)
          if (pausedBuffer.current.length > 0) {
            setLines(prev => [...prev, ...pausedBuffer.current])
            pausedBuffer.current = []
          }
        } else if (msg.type === 'error') {
          setLines(prev => [...prev, `\x1b[31m${msg.data}\x1b[0m`])
          setConnected(false)
        }
      } catch { /* ignore */ }
    }

    ws.onerror = () => {
      setLines(prev => [...prev, `\x1b[31m${t('logs.connectFailed')}\x1b[0m`])
      setLoading(false)
    }

    ws.onclose = () => setConnected(false)

    return () => { ws.close() }
  }, [containerId])

  // 用 ref 跟踪暂停状态（避免闭包问题）
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])

  // 恢复时刷新缓冲区
  const togglePause = () => {
    if (paused) {
      // 恢复：刷新缓冲的行
      if (pausedBuffer.current.length > 0) {
        setLines(prev => [...prev, ...pausedBuffer.current])
        pausedBuffer.current = []
      }
    }
    setPaused(!paused)
  }

  // 自动滚动
  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, paused])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border rounded-lg shadow-2xl w-[800px] max-w-[95vw] h-[600px] flex flex-col overflow-hidden"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText className="w-3.5 h-3.5 shrink-0 text-accent" />
            <span className="text-sm font-medium text-textPrimary truncate">{containerName}</span>
            <span className="text-xs text-textMuted font-mono truncate">{containerId}</span>
            {connected && (
              <span className="flex items-center gap-1 text-xs text-running">
                <span className="w-1.5 h-1.5 rounded-full bg-running animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={togglePause}
              title={paused ? t('logs.resume') : t('logs.pause')}
              className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button onClick={onClose}
              className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 日志内容 — 保持深色终端风格 */}
        <div className="flex-1 overflow-auto p-3 text-xs leading-relaxed bg-[#16202f] text-[#e6edf3]">
          {loading ? (
            <div className="flex items-center justify-center h-full text-[#8b949e]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              {t('logs.loadingLogs')}
            </div>
          ) : lines.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#8b949e]">{t('logs.waitingLogs')}</div>
          ) : (
            <>
              {lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all" style={{ color: line.startsWith('\x1b[31m') ? '#f85149' : '#e6edf3' }}>
                  {line.replace('\x1b[31m', '').replace('\x1b[0m', '')}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* 状态栏 */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border shrink-0 text-xs text-textMuted">
          <span>{lines.length} {t('logs.lineCount')}</span>
          <span>{paused ? t('logs.pausedBar') : connected ? t('logs.liveBar') : t('logs.disconnectedBar')}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
