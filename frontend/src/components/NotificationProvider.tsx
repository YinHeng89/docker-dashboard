import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircle2, XCircle, Info, AlertTriangle, X,
  Package, RotateCw, Power, Play, Square,
} from 'lucide-react'
import { connectLive } from '../api/ws'

export type NotificationType = 'success' | 'error' | 'info' | 'warning'
export type NotificationAction = 'start' | 'stop' | 'restart' | 'remove' | 'create' | 'kill' | 'pause' | 'unpause'

interface Notification {
  id: string
  type: NotificationType
  title: string
  message?: string
  action?: NotificationAction
  timestamp: number
  removing?: boolean
}

interface NotificationContextType {
  notify: (type: NotificationType, title: string, message?: string, action?: NotificationAction) => void
  error: (title: string, message?: string) => void
  success: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  dismissAll: () => void
}

const NotificationContext = createContext<NotificationContextType | null>(null)

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be inside NotificationProvider')
  return ctx
}

const typeConfig: Record<NotificationType, { icon: React.ElementType; border: string; bg: string; text: string }> = {
  success: { icon: CheckCircle2, border: 'border-running/40',  bg: 'bg-running/90',  text: 'text-white' },
  error:   { icon: XCircle,      border: 'border-error/40',    bg: 'bg-error/90',    text: 'text-white' },
  info:    { icon: Info,         border: 'border-accent/40',   bg: 'bg-accent/90',   text: 'text-white' },
  warning: { icon: AlertTriangle,border: 'border-warning/40',  bg: 'bg-warning/90',  text: 'text-white' },
}

const actionIcons: Record<string, React.ElementType> = {
  start: Play, stop: Square, restart: RotateCw, remove: X,
  kill: XCircle, pause: Power, unpause: Play, create: Package,
}

// WebSocket 事件防抖：同一容器 + 同一 action 10秒内只通知一次
const recentEvents = new Map<string, number>()

export default function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const addNotification = useCallback((type: NotificationType, title: string, message?: string, action?: NotificationAction) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const n: Notification = { id, type, title, message, action, timestamp: Date.now() }
    setNotifications(prev => [...prev.slice(-4), n]) // 最多5条

    // 4秒后开始淡出
    const timer = setTimeout(() => {
      setNotifications(prev => prev.map(p => p.id === id ? { ...p, removing: true } : p))
      // 300ms 动画结束后移除
      const removeTimer = setTimeout(() => {
        setNotifications(prev => prev.filter(p => p.id !== id))
      }, 300)
      timersRef.current.set(`${id}-remove`, removeTimer)
    }, 4000)
    timersRef.current.set(id, timer)
  }, [])

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.map(p => p.id === id ? { ...p, removing: true } : p))
    setTimeout(() => {
      setNotifications(prev => prev.filter(p => p.id !== id))
    }, 300)
  }, [])

  const dismissAll = useCallback(() => {
    // 标记所有通知为移除中
    setNotifications(prev => prev.map(p => ({ ...p, removing: true })))
    // 300ms 后清空
    setTimeout(() => setNotifications([]), 300)
  }, [])

  // 清理 timers
  useEffect(() => {
    const timers = timersRef.current
    return () => { timers.forEach(t => clearTimeout(t)) }
  }, [])

  // WebSocket 实时事件通知（带防抖）
  useEffect(() => {
    const live = connectLive({
      onDockerEvent: (event: any) => {
        const ev = event as { Type?: string; Action?: string; Actor?: { ID?: string; Attributes?: Record<string, string> } }
        const attrs = ev?.Actor?.Attributes || {}
        const name = attrs.name || ev?.Actor?.ID?.slice(0, 12) || 'unknown'
        const containerId = ev?.Actor?.ID || ''

        // 防抖：同一容器 + 同一 action 10秒内不重复通知
        const dedupKey = `${containerId}:${ev?.Action}`
        const now = Date.now()
        const lastTime = recentEvents.get(dedupKey)
        if (lastTime && now - lastTime < 10000) return
        recentEvents.set(dedupKey, now)

        // 定期清理旧记录（超过60秒）
        if (recentEvents.size > 100) {
          const cutoff = now - 60000
          for (const [k, t] of recentEvents) {
            if (t < cutoff) recentEvents.delete(k)
          }
        }

        switch (ev?.Action) {
          case 'start':
            addNotification('success', '容器已启动', name, 'start')
            break
          case 'die':
            addNotification('warning', '容器已停止', name, 'stop')
            break
          case 'kill':
            addNotification('error', '容器被强制终止', name, 'kill')
            break
          case 'pause':
            addNotification('info', '容器已暂停', name, 'pause')
            break
          case 'unpause':
            addNotification('success', '容器已恢复', name, 'unpause')
            break
          case 'destroy':
            addNotification('warning', '容器被删除', name, 'remove')
            break
        }
      },
    })
    return () => live.close()
  }, [addNotification])

  const ctx: NotificationContextType = {
    notify: addNotification,
    error: (t, m) => addNotification('error', t, m),
    success: (t, m) => addNotification('success', t, m),
    info: (t, m) => addNotification('info', t, m),
    warning: (t, m) => addNotification('warning', t, m),
    dismissAll,
  }

  return (
    <NotificationContext.Provider value={ctx}>
      {children}

      {/* 通知容器 Portal — 右下角固定 */}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 w-[380px] max-w-[90vw] pointer-events-none">
          {/* 清除全部按钮 — 仅在有通知时显示 */}
          {notifications.length > 0 && (
            <div className="pointer-events-auto flex justify-end">
              <button
                onClick={dismissAll}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-textMuted bg-surface/90 border border-border/50 rounded-lg hover:text-textPrimary hover:border-border transition-colors backdrop-blur shadow-sm"
              >
                <X className="w-3 h-3" />
                清除全部 ({notifications.length})
              </button>
            </div>
          )}
          {notifications.map(n => {
            const cfg = typeConfig[n.type]
            const ActionIcon = n.action ? actionIcons[n.action] : null
            return (
              <div key={n.id}
                className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border backdrop-blur-xl shadow-xl transition-all duration-300 ${
                  n.removing
                    ? 'opacity-0 translate-x-8 scale-95'
                    : 'opacity-100 translate-x-0 scale-100 animate-slideInUp'
                } ${cfg.bg} ${cfg.border}`}>
                <cfg.icon className={`w-5 h-5 ${cfg.text} shrink-0 mt-0.5`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white leading-tight">{n.title}</span>
                    {ActionIcon && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-white/15 text-white/90 border border-white/20">
                        <ActionIcon className="w-3 h-3" />
                        {n.action}
                      </span>
                    )}
                  </div>
                  {n.message && (
                    <p className="text-xs text-white/70 mt-0.5 truncate">{n.message}</p>
                  )}
                </div>

                <button onClick={() => dismiss(n.id)}
                  className="shrink-0 p-0.5 rounded-md text-white/50 hover:text-white hover:bg-white/15 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </NotificationContext.Provider>
  )
}
