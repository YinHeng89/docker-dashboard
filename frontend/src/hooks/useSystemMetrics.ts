import { useState, useEffect, useCallback } from 'react'
import { fetchSystemMetrics } from '../api/system'
import type { SystemMetrics } from '../types'

export function useSystemMetrics(refreshInterval = 10000) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSystemMetrics()
      setMetrics(data)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, refreshInterval)
    return () => clearInterval(timer)
  }, [refresh, refreshInterval])

  return {
    metrics,
    loading,
    error,
    refresh,
  }
}
