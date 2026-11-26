// WebSocket 连接工具

// /ws/live 为共享单例：App、容器页、通知中心等订阅方复用同一条连接，
// 避免每个 hook 各建一条导致后端重复推送全量容器列表。
interface LiveHandlers {
  onContainers?: (containers: unknown[]) => void
  onDockerEvent?: (event: unknown) => void
}

interface LiveSubscription {
  handlers: LiveHandlers
}

let liveSocket: WebSocket | null = null
const liveSubscriptions = new Set<LiveSubscription>()
let latestContainers: unknown[] | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function openLiveSocket(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`)
  liveSocket = ws

  ws.onopen = () => console.log('[WS live] 已连接')

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { type: string; data: unknown }
      if (msg.type === 'containers') {
        latestContainers = msg.data as unknown[]
        for (const sub of liveSubscriptions) sub.handlers.onContainers?.(latestContainers)
      } else if (msg.type === 'docker-event') {
        for (const sub of liveSubscriptions) sub.handlers.onDockerEvent?.(msg.data)
      }
    } catch {
      console.warn('[WS live] 非 JSON 消息:', event.data)
    }
  }

  ws.onclose = (event) => {
    console.log('[WS live] 已断开', event.reason)
    if (liveSocket === ws) liveSocket = null
    // 还有订阅方时自动重连；最后一个订阅方退出时 close() 会先摘掉 onclose，不会触发
    if (liveSubscriptions.size > 0 && reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (liveSubscriptions.size > 0) openLiveSocket()
      }, 3000)
    }
  }

  ws.onerror = (err) => console.error('[WS live] 错误', err)
  return ws
}

export function connectLive(handlers: LiveHandlers): { ws: WebSocket; close: () => void } {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const subscription: LiveSubscription = { handlers }
  liveSubscriptions.add(subscription)

  const ws = liveSocket && liveSocket.readyState <= WebSocket.OPEN
    ? liveSocket
    : openLiveSocket()

  // 后加入的订阅方复用现有连接，回放最近一次容器列表，无需等待下一次事件推送
  if (latestContainers && liveSocket?.readyState === WebSocket.OPEN) {
    const cached = latestContainers
    queueMicrotask(() => {
      if (liveSubscriptions.has(subscription)) handlers.onContainers?.(cached)
    })
  }

  return {
    ws,
    close: () => {
      liveSubscriptions.delete(subscription)
      if (liveSubscriptions.size > 0) return

      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const socket = liveSocket
      liveSocket = null
      latestContainers = null
      if (socket) {
        // 摘掉回调，避免主动关闭被识别为断线并重连
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
      }
    },
  }
}
