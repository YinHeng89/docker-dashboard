import { useRef, useCallback } from 'react'

/**
 * 解决展开/折叠分组时页面内容跳动的问题。
 *
 * 核心思路：不测量分组元素自身，而是找一个“视口内锚点元素”，
 * 记录它在展开/折叠前后的视口位置变化，用这个 delta 补偿 scrollTop。
 *
 * 这样不依赖具体 DOM 结构，不关心分组 key 变化、layout reorder，
 * 只关心“用户正在看的内容”在屏幕上的位置是否发生了偏移。
 */
export function useScrollAnchor() {
  const scrollRef = useRef<HTMLElement | null>(null)

  const anchorToggle = useCallback((toggleFn: () => void) => {
    const container = scrollRef.current
    if (!container) {
      toggleFn()
      return
    }

    // 1. 在视口中央找一个锚点元素（避开顶部的固定区域，确保落在分组内容内）
    const anchor = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight / 2,
    )

    if (!anchor) {
      toggleFn()
      return
    }

    // 2. 记录锚点在视口中的位置
    const before = anchor.getBoundingClientRect().top

    // 3. 执行状态更新（触发 React 重渲染，分组展开/折叠）
    toggleFn()

    // 4. 等 DOM 更新 + 布局完成
    requestAnimationFrame(() => {
      const after = anchor.getBoundingClientRect().top
      const delta = after - before

      // 5. 补偿：如果锚点被向下推了（delta > 0），scrollTop 也增加同样的量
      if (delta !== 0) {
        container.scrollTop += delta
      }
    })
  }, [])

  return { scrollRef, anchorToggle }
}
