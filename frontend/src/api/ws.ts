// WebSocket 连接工具

type MessageHandler = (data: unknown) => void

type WsType = 'live' | 'exec'

export function createWsConnection(type: WsType, onMessage: MessageHandler): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = type === 'live' ? '/ws/live' : '/ws/exec'
  const url = `${protocol}//${window.location.host}${path}`

  const ws = new WebSocket(url)

  ws.onopen = () => {
    console.log(`[WS ${type}] 已连接`)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      onMessage(msg)
    } catch {
      console.warn(`[WS ${type}] 非 JSON 消息:`, event.data)
    }
  }

  ws.onclose = (event) => {
    console.log(`[WS ${type}] 已断开`, event.reason)
  }

  ws.onerror = (err) => {
    console.error(`[WS ${type}] 错误`, err)
  }

  return ws
}

// 实时容器列表 WebSocket（/ws/live）
export function connectLive(handlers: {
  onContainers?: (containers: unknown[]) => void
  onDockerEvent?: (event: unknown) => void
}): { ws: WebSocket; close: () => void } {
  const ws = createWsConnection('live', (msg) => {
    const m = msg as { type: string; data: unknown }
    if (m.type === 'containers') {
      handlers.onContainers?.(m.data as unknown[])
    } else if (m.type === 'docker-event') {
      handlers.onDockerEvent?.(m.data)
    }
  })

  return {
    ws,
    close: () => ws.close(),
  }
}
