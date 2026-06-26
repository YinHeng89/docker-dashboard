import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, Terminal, Square, Trash2 } from 'lucide-react'

interface TerminalModalProps {
  containerName: string
  onClose: () => void
}

// ==================== ANSI → HTML ====================

const ANSI_COLORS: Record<string, string> = {
  '30': '#e6edf3', '31': '#e74c3c', '32': '#2ecc71', '33': '#f1c40f',
  '34': '#58a6ff', '35': '#9b59b6', '36': '#1abc9c', '37': '#ecf0f1',
  '90': '#7f8c8d', '91': '#ff6b6b', '92': '#69db7c', '93': '#ffd43b',
  '94': '#74c0fc', '95': '#b197fc', '96': '#63e6be', '97': '#fff',
}

function ansiToHtml(text: string): string {
  let html = ''
  let openSpans = 0
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const parts = escaped.split(/(\x1b\[[0-9;]*[A-Za-z])/)
  for (const part of parts) {
    const m = part.match(/^\x1b\[([0-9;]*)m/)
    if (m) {
      const codes = (m[1] || '').split(';').filter(Boolean)
      let styles = ''
      let reset = false
      for (const code of codes) {
        if (code === '0' || code === '') { reset = true; continue }
        if (code === '1') { styles += 'font-weight:bold;'; continue }
        if (ANSI_COLORS[code]) { styles += `color:${ANSI_COLORS[code]};` }
      }
      if (reset && openSpans > 0) { html += '</span>'.repeat(openSpans); openSpans = 0 }
      if (styles) { html += `<span style="${styles}">`; openSpans++ }
    } else {
      html += part.replace(/\n/g, '<br>')
    }
  }
  if (openSpans > 0) html += '</span>'.repeat(openSpans)
  return html
}

// ==================== 命令历史 ====================

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem('cmdHistory') || '[]') }
  catch { return [] }
}

function saveHistory(h: string[]) {
  localStorage.setItem('cmdHistory', JSON.stringify(h.slice(-50)))
}

// ==================== 组件 ====================

export default function TerminalModal({ containerName, onClose }: TerminalModalProps) {
  const { t } = useTranslation()
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stopBtnRef = useRef<HTMLButtonElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const historyRef = useRef<string[]>(loadHistory())
  const historyIdxRef = useRef(historyRef.current.length)
  const composingRef = useRef(false)
  const autoScrollRef = useRef(true)
  const rawLineRef = useRef<HTMLDivElement | null>(null)
  const runningRef = useRef(false)

  // 更新终止按钮可见性
  const setRunning = useCallback((v: boolean) => {
    runningRef.current = v
    const btn = stopBtnRef.current
    if (!btn) return
    if (v) {
      btn.className = 'p-1 rounded transition-colors shrink-0 text-error hover:text-error/80'
    } else {
      btn.className = 'p-1 rounded transition-colors shrink-0 invisible'
    }
  }, [])

  // DOM 工具
  const appendLine = useCallback((html: string, className = '') => {
    const el = outputRef.current
    if (!el) return
    const div = document.createElement('div')
    div.className = className
    div.innerHTML = html
    el.appendChild(div)
    while (el.children.length > 2000) el.firstChild?.remove()
    rawLineRef.current = null
    if (autoScrollRef.current) el.scrollTop = el.scrollHeight
  }, [])

  const appendRaw = useCallback((html: string) => {
    const el = outputRef.current
    if (!el) return
    if (rawLineRef.current && rawLineRef.current.classList.contains('terminal-raw')) {
      rawLineRef.current.innerHTML += html
    } else {
      const div = document.createElement('div')
      div.className = 'terminal-raw'
      div.innerHTML = html
      el.appendChild(div)
      while (el.children.length > 2000) el.firstChild?.remove()
      rawLineRef.current = div
    }
    if (autoScrollRef.current) el.scrollTop = el.scrollHeight
  }, [])

  const clearOutput = useCallback(() => {
    const el = outputRef.current
    if (el) { el.innerHTML = ''; rawLineRef.current = null }
  }, [])

  const showHelp = useCallback(() => {
    appendLine(`<span style="color:#58a6ff;font-size:13px;font-weight:600">${t('terminal.helpTitle')}</span>`, 'terminal-output')
    appendLine('', 'terminal-empty')
    for (const [cmd, desc] of [
      ['docker ps', t('terminal.helpPs')], ['docker compose', t('terminal.helpCompose')],
      ['docker logs <id>', t('terminal.helpLogs')], ['ls / cat / pwd', t('terminal.helpFiles')],
      ['ps / top / df', t('terminal.helpSys')], ['sh / bash / ash', t('terminal.helpShell')],
      ['curl / wget / ping', t('terminal.helpNet')],
    ]) {
      appendLine(`<span style="color:#e6edf3;min-width:140px;display:inline-block">${cmd}</span><span style="color:#8b949e">${desc}</span>`, 'terminal-output')
    }
    appendLine('', 'terminal-empty')
    appendLine(`<span style="color:#6b7280">${t('terminal.hintBar')}</span>`, 'terminal-output')
    appendLine('', 'terminal-empty')
  }, [appendLine])

  // 滚动检测
  const handleScroll = useCallback(() => {
    const el = outputRef.current
    if (!el) return
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])

  const execute = useCallback((cmd: string) => {
    if (!cmd) return
    if (cmd === 'clear' || cmd === '清屏') { clearOutput(); showHelp(); return }
    const h = historyRef.current
    h.push(cmd); if (h.length > 50) h.shift()
    historyIdxRef.current = h.length; saveHistory(h)

    appendLine(`<span style="color:#58a6ff">$ ${cmd}</span>`, 'terminal-cmd')
    autoScrollRef.current = true
    setRunning(true)

    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'exec', command: cmd }))
  }, [appendLine, clearOutput, showHelp, setRunning])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !composingRef.current) {
      e.preventDefault()
      execute(inputRef.current?.value || '')
      if (inputRef.current) inputRef.current.value = ''
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const h = historyRef.current
      if (historyIdxRef.current > 0) {
        historyIdxRef.current--
        if (inputRef.current) inputRef.current.value = h[historyIdxRef.current] || ''
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const h = historyRef.current
      if (historyIdxRef.current < h.length - 1) {
        historyIdxRef.current++
        if (inputRef.current) inputRef.current.value = h[historyIdxRef.current] || ''
      } else {
        historyIdxRef.current = h.length
        if (inputRef.current) inputRef.current.value = ''
      }
    }
  }, [execute])

  // WebSocket + 初始化
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/exec`)
    wsRef.current = ws

    ws.onopen = () => { appendLine(t('terminal.connected'), 'terminal-dim'); appendLine('', 'terminal-empty'); showHelp() }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'stdout') appendRaw(ansiToHtml(msg.data as string))
        else if (msg.type === 'stderr') appendRaw(`<span style="color:#e74c3c">${msg.data as string}</span>`)
        else if (msg.type === 'exit') { setRunning(false); if (msg.code !== 0) appendLine(`[exit: ${msg.code}]`, 'terminal-dim'); appendLine('', 'terminal-empty') }
        else if (msg.type === 'error') { setRunning(false); appendLine(`[${t('terminal.error')}: ${msg.data}]`, 'terminal-error'); appendLine('', 'terminal-empty') }
      } catch { /* ignore */ }
    }

    ws.onclose = () => appendLine(`[${t('terminal.disconnected')}]`, 'terminal-dim')
    ws.onerror = () => appendLine(`[${t('terminal.connectFailed')}]`, 'terminal-error')

    setTimeout(() => inputRef.current?.focus(), 100)
    return () => { ws.close(); wsRef.current = null }
  }, [appendLine, appendRaw, showHelp, setRunning])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div
        className="bg-surface border border-border rounded-lg shadow-2xl w-[800px] max-w-[95vw] h-[550px] max-h-[85vh] flex flex-col overflow-hidden"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 text-running shrink-0" />
            <span className="text-sm font-medium text-textPrimary truncate">{t('terminal.title')} · {containerName}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { clearOutput(); showHelp() }} title={t('terminal.clearScreen')}
              className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose}
              className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div ref={outputRef} onScroll={handleScroll}
          className="flex-1 overflow-auto p-3 text-xs leading-relaxed select-text bg-[#16202f] text-[#e6edf3]"
        />

        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border shrink-0">
          <span className="text-xs font-mono shrink-0 text-accent">$</span>
          <input
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            placeholder={t('terminal.promptPlaceholder')}
            spellCheck={false}
            autoFocus
            className="flex-1 bg-transparent text-xs text-textPrimary outline-none font-mono placeholder:text-textMuted"
          />
          <button ref={stopBtnRef} onClick={() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'input', data: '\x03' }))
            }
          }} title={t('terminal.stopCommand')}
            className="p-1 rounded transition-colors shrink-0 invisible">
            <Square className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
