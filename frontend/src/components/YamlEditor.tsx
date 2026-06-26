import { useRef, useEffect, useCallback } from 'react'

interface YamlEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}

// ==================== YAML 语法高亮 ====================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightValue(val: string): string {
  const t = val.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return `<span class="yh-number">${escapeHtml(val)}</span>`
  }
  if (/^(true|false|yes|no|on|off|null|~)$/i.test(t)) {
    return `<span class="yh-bool">${escapeHtml(val)}</span>`
  }
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) {
    return `<span class="yh-string">${escapeHtml(val)}</span>`
  }
  if (/\$\{[^}]+\}/.test(val)) {
    return '<span class="yh-value">' + escapeHtml(val).replace(
      /(\$\{[^}]+\})/g,
      '<span class="yh-variable">$1</span>'
    ) + '</span>'
  }
  return `<span class="yh-value">${escapeHtml(val)}</span>`
}

function highlightLine(line: string): string {
  if (!line.trim()) return ''

  const indentMatch = line.match(/^(\s*)/)
  const indent = indentMatch ? indentMatch[0] : ''
  const content = line.slice(indent.length)

  // 注释
  if (content.trim().startsWith('#')) {
    return indent + `<span class="yh-comment">${escapeHtml(content)}</span>`
  }

  // YAML 标记 --- / ...
  if (/^(---|\.\.\.)$/.test(content.trim())) {
    return indent + `<span class="yh-punctuation">${escapeHtml(content)}</span>`
  }

  // 列表项 - xxxx
  if (/^-\s/.test(content)) {
    const dash = content.match(/^(- )/)![0]
    const rest = content.slice(dash.length)
    return (
      indent +
      `<span class="yh-punctuation">${escapeHtml(dash.trimEnd())}</span> ` +
      highlightValue(rest)
    )
  }

  // 键值对 key: value
  const kvMatch = content.match(/^([\w_-]+)\s*:\s*(.*)$/)
  if (kvMatch) {
    const key = kvMatch[1]!
    const colonIdx = content.indexOf(':')
    const afterColon = content.slice(colonIdx + 1)
    const spaceAfter = afterColon.match(/^(\s*)/)![0]
    const value = afterColon.slice(spaceAfter.length)
    let html = (
      indent +
      `<span class="yh-key">${escapeHtml(key)}</span>` +
      `<span class="yh-punctuation">:</span>` +
      spaceAfter
    )
    if (value) {
      html += highlightValue(value)
    }
    return html
  }

  // 纯值
  return indent + highlightValue(content)
}

function highlight(text: string): string {
  if (!text) return ''
  return text.split('\n').map(highlightLine).join('\n')
}

// ==================== 组件 ====================

export default function YamlEditor({ value, onChange, placeholder, rows = 14 }: YamlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLPreElement>(null)

  // textarea 自动撑高 + overlay 同步
  const sync = useCallback(() => {
    const ta = textareaRef.current
    const overlay = overlayRef.current
    const container = containerRef.current
    if (!ta || !overlay || !container) return

    // textarea 无滚动条，自适应高度
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'

    // overlay 内容同步
    overlay.innerHTML = highlight(ta.value) + '\n'

    // overlay 滚动跟随容器
    overlay.scrollTop = container.scrollTop
    overlay.scrollLeft = container.scrollLeft
  }, [])

  // 外部 value 变化时同步（如选模板）
  useEffect(() => {
    sync()
  }, [value, sync])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    // 在下一帧同步，确保 DOM 更新完成
    requestAnimationFrame(sync)
  }, [onChange, sync])

  const handleContainerScroll = useCallback(() => {
    const overlay = overlayRef.current
    const container = containerRef.current
    if (!overlay || !container) return
    overlay.scrollTop = container.scrollTop
    overlay.scrollLeft = container.scrollLeft
  }, [])

  // Tab 键插入 2 空格
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newValue = value.slice(0, start) + '  ' + value.slice(end)
      onChange(newValue)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [value, onChange])

  return (
    <div
      ref={containerRef}
      onScroll={handleContainerScroll}
      className="relative flex-1 bg-panel border border-border rounded focus-within:border-accent transition-colors overflow-y-auto"
      style={{ minHeight: `${rows * 1.625}rem` }}
    >
      {/* 高亮层 — 容器负责滚动，overlay 只做装饰 */}
      <pre
        ref={overlayRef}
        aria-hidden="true"
        className="yh-overlay absolute top-0 left-0 right-0 px-3 py-2 text-sm font-mono leading-relaxed overflow-hidden pointer-events-none whitespace-pre-wrap break-words"
        style={{ color: 'transparent' }}
      />

      {/* 输入框 — 无滚动条，自适应高度 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className="yh-textarea block w-full px-3 py-2 text-sm font-mono leading-relaxed outline-none resize-none bg-transparent placeholder:text-textMuted overflow-hidden"
        style={{ color: value ? 'transparent' : undefined, caretColor: '#60a5fa' }}
      />
    </div>
  )
}
