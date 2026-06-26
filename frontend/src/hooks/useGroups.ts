import { useState, useEffect, useCallback } from 'react'
import type { WorkspaceGroup } from '../types'

interface GroupsStore {
  groups: WorkspaceGroup[]
  mappings: Record<string, string>
  collapsed: Record<string, boolean>
  favorites: string[]
  showUngrouped: boolean
}

export function useGroups() {
  const [store, setStore] = useState<GroupsStore>({ groups: [], mappings: {}, collapsed: {}, favorites: [], showUngrouped: true })
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [groupsRes, collapsedRes, favRes, showUngroupedRes] = await Promise.all([
        fetch('/api/groups').then(r => r.json()),
        fetch('/api/groups/preferences/collapsed').then(r => r.json()),
        fetch('/api/groups/preferences/favorites').then(r => r.json()),
        fetch('/api/groups/preferences/show-ungrouped').then(r => r.json()),
      ])

      setStore(prev => ({
        groups: groupsRes.groups || [],
        mappings: groupsRes.mappings || {},
        collapsed: collapsedRes || prev.collapsed,
        favorites: Array.isArray(favRes) ? favRes : [],
        showUngrouped: showUngroupedRes?.show !== false,
      }))
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const getGroupFor = useCallback((key: string): string | null => {
    return store.mappings[key] || null
  }, [store.mappings])

  // ===== 分组 CRUD =====

  const createGroup = async (id: string, name: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      })
      if (!res.ok) return false
      // 不 fetchData 以免打乱排序，直接追加到本地 store
      setStore(prev => ({
        ...prev,
        groups: [...prev.groups, { id, name, sortOrder: prev.groups.length, isBuiltin: false, showOnDashboard: true }],
      }))
      return true
    } catch { return false }
  }

  const deleteGroup = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' })
      if (!res.ok) return false
      setStore(prev => {
        const newMappings = { ...prev.mappings }
        for (const [key, gid] of Object.entries(newMappings)) {
          if (gid === id) delete newMappings[key]
        }
        return {
          ...prev,
          groups: prev.groups.filter(g => g.id !== id),
          mappings: newMappings,
        }
      })
      return true
    } catch { return false }
  }

  const renameGroup = async (id: string, name: string, sortOrder?: number): Promise<boolean> => {
    try {
      const body: Record<string, unknown> = { name }
      if (sortOrder !== undefined) body.sortOrder = sortOrder
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return false
      setStore(prev => ({
        ...prev,
        groups: prev.groups.map(g => g.id === id ? { ...g, name, sortOrder: sortOrder ?? g.sortOrder } : g),
      }))
      return true
    } catch { return false }
  }

  const toggleShowOnDashboard = async (id: string, show: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showOnDashboard: show }),
      })
      if (!res.ok) return false
      setStore(prev => ({
        ...prev,
        groups: prev.groups.map(g => g.id === id ? { ...g, showOnDashboard: show } : g),
      }))
      return true
    } catch { return false }
  }

  const assignToGroup = async (assign: Record<string, string>, remove?: string[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/groups/mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assign, remove }),
      })
      if (!res.ok) return false

      setStore(prev => {
        const newMappings = { ...prev.mappings, ...assign }
        if (remove) for (const key of remove) delete newMappings[key]
        return { ...prev, mappings: newMappings }
      })
      return true
    } catch { return false }
  }

  const unassign = async (containerKey: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/groups/mappings/unassign', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerKey }),
      })
      if (!res.ok) return false
      setStore(prev => {
        const newMappings = { ...prev.mappings }
        delete newMappings[containerKey]
        return { ...prev, mappings: newMappings }
      })
      return true
    } catch { return false }
  }

  // ===== 收藏（独立于分组，互不影响） =====

  const toggleFavorite = useCallback(async (projectKey: string) => {
    const newFavorites = store.favorites.includes(projectKey)
      ? store.favorites.filter(f => f !== projectKey)
      : [...store.favorites, projectKey]

    setStore(prev => ({ ...prev, favorites: newFavorites }))

    // 异步持久化
    fetch('/api/groups/preferences/favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites: newFavorites }),
    }).catch(() => {})
  }, [store.favorites])

  const toggleShowUngrouped = useCallback(async (show: boolean) => {
    setStore(prev => ({ ...prev, showUngrouped: show }))
    fetch('/api/groups/preferences/show-ungrouped', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show }),
    }).catch(() => {})
  }, [])

  // ===== 折叠状态 =====

  const toggleCollapsed = useCallback(async (groupId: string) => {
    const newCollapsed = {
      ...store.collapsed,
      [groupId]: !store.collapsed[groupId],
    }
    setStore(prev => ({ ...prev, collapsed: newCollapsed }))

    fetch('/api/groups/preferences/collapsed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed: newCollapsed }),
    }).catch(() => {})
  }, [store.collapsed])

  return {
    groups: store.groups,
    mappings: store.mappings,
    collapsed: store.collapsed,
    favorites: store.favorites,
    showUngrouped: store.showUngrouped,
    loading,
    getGroupFor,
    createGroup,
    deleteGroup,
    renameGroup,
    toggleShowOnDashboard,
    toggleShowUngrouped,
    assignToGroup,
    unassign,
    toggleFavorite,
    toggleCollapsed,
    refresh: fetchData,
  }
}
