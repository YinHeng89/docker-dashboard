import { useEffect, useRef, useCallback } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  divider?: boolean
  disabled?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('contextmenu', onClose)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('contextmenu', onClose)
    }
  }, [handleClickOutside, onClose])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 防止溢出屏幕
  const adjustedX = Math.min(x, window.innerWidth - 200)
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 20)

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} className="my-1 border-t border-border/50" />
        }
        return (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
              item.onClick()
            }}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
              item.danger
                ? 'text-error hover:bg-error/10'
                : 'text-textPrimary hover:bg-border/30'
            } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {item.icon && <span className="w-4 h-4 shrink-0 flex items-center justify-center">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
