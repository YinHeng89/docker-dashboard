import { useState, useEffect, useCallback } from 'react'
import { fetchSelfContainerId } from '../api/system'

/**
 * 统一的自身容器保护 hook
 * 
 * 用法:
 *   const { selfId, isSelf } = useSelf()
 *   if (isSelf(containerId)) return <span>需手动操作</span>
 */
export function useSelf() {
  const [selfId, setSelfId] = useState<string | null>(null)

  useEffect(() => {
    fetchSelfContainerId().then(setSelfId).catch(() => {})
  }, [])

  const isSelf = useCallback(
    (containerId: string) => {
      if (!selfId || !containerId) return false
      return containerId.slice(0, 12) === selfId
    },
    [selfId]
  )

  return { selfId, isSelf }
}
