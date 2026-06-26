import { useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2, Pencil, Check, FolderOpen, GripVertical, ChevronUp, ChevronDown, Star, Eye, EyeOff } from 'lucide-react'
import type { WorkspaceGroup, ContainerDetailSummary } from '../types'

interface GroupManageModalProps {
  groups: WorkspaceGroup[]
  mappings: Record<string, string>
  favorites: string[]
  containers: ContainerDetailSummary[]
  onCreateGroup: (id: string, name: string) => Promise<boolean>
  onDeleteGroup: (id: string) => Promise<boolean>
  onRenameGroup: (id: string, name: string, sortOrder?: number) => Promise<boolean>
  onAssignToGroup: (assign: Record<string, string>, remove?: string[]) => Promise<boolean>
  onUnassign: (key: string) => Promise<boolean>
  onToggleFavorite: (key: string) => void
  onToggleShowOnDashboard: (id: string, show: boolean) => Promise<boolean>
  onToggleShowUngrouped: (show: boolean) => void
  showUngrouped: boolean
  onClose: () => void
}

export default function GroupManageModal({
  groups,
  mappings: initialMappings,
  favorites,
  containers,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
  onAssignToGroup,
  onUnassign,
  onToggleFavorite,
  onToggleShowOnDashboard,
  onToggleShowUngrouped,
  showUngrouped: showUngroupedSetting,
  onClose,
}: GroupManageModalProps) {
  const { t } = useTranslation()
  const [localFavorites, setLocalFavorites] = useState<string[]>(favorites)
  // 选中的分组 ID 或特殊值 '_ungrouped' / builtin group id
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'groups' | 'favorites'>('groups')

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [localSortOrder, setLocalSortOrder] = useState<Record<string, number>>({})
  const editInputRef = useRef<HTMLInputElement>(null)

  const composeProjects = [...new Set(containers.filter(c => c.project).map(c => c.project!))].sort()

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const sa = localSortOrder[a.id] ?? a.sortOrder
      const sb = localSortOrder[b.id] ?? b.sortOrder
      return sa - sb
    })
  }, [groups, localSortOrder])

  const userGroups = sortedGroups.filter(g => !g.isBuiltin)
  const builtinGroups = sortedGroups.filter(g => g.isBuiltin)
  const selectedGroup = groups.find(g => g.id === selectedKey)

  const getProjectsInGroup = (groupId: string) => composeProjects.filter(p => initialMappings[p] === groupId)
  const getGroupForProject = (project: string) => initialMappings[project] || null

  // 未分组项目
  const ungroupedProjects = composeProjects.filter(p => !initialMappings[p] || !groups.some(g => g.id === initialMappings[p]))

  // 当前右侧显示的项目列表（可能是自定义分组、未分组、或内置分组中的容器）
  const rightPanelProjects = useMemo(() => {
    if (!selectedKey) return null
    if (selectedKey === '_ungrouped') return ungroupedProjects
    // 自定义分组
    const group = groups.find(g => g.id === selectedKey)
    if (group && !group.isBuiltin) return composeProjects // 所有项目（可编辑）
    // 内置分组（独立容器 - 只读）
    if (group && group.isBuiltin) {
      return containers.filter(c => !c.project).map(c => c.project || c.name).filter(Boolean)
    }
    return null
  }, [selectedKey, composeProjects, ungroupedProjects, groups, containers])

  const selectedIsEditable = selectedKey ? groups.some(g => g.id === selectedKey && !g.isBuiltin) : false
  const selectedPanelTitle = (() => {
    if (selectedKey === '_ungrouped') return '未分组'
    return groups.find(g => g.id === selectedKey)?.name || ''
  })()

  const handleCreate = async () => {
    const name = newName.trim() || '新分组'
    const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
    const id = (slug.length > 0 && /[a-z0-9]/.test(slug)) ? slug.substring(0, 30) : 'g' + Date.now().toString(36)
    setCreating(false); setNewName('')
    const ok = await onCreateGroup(id, name)
    if (ok) setSelectedKey(id)
  }

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    await onRenameGroup(id, name.trim())
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该分组？其中的项目将回到"未分组"。')) return
    await onDeleteGroup(id)
    if (selectedKey === id) setSelectedKey(null)
  }

  const toggleAssign = async (projectKey: string, groupId: string) => {
    const cur = initialMappings[projectKey]
    if (cur === groupId) {
      await onUnassign(projectKey)
    } else {
      await onAssignToGroup({ [projectKey]: groupId })
    }
  }

  const toggleFav = (key: string) => {
    setLocalFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
      onToggleFavorite(key)
      return next
    })
  }

  const moveGroup = (groupId: string, direction: 'up' | 'down') => {
    const idx = userGroups.findIndex(g => g.id === groupId)
    if (idx < 0) return
    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    if (newIdx < 0 || newIdx >= userGroups.length) return
    const groupA = userGroups[idx]!
    const groupB = userGroups[newIdx]!
    const updates: Record<string, number> = { [groupId]: newIdx, [groupB.id]: idx }
    setLocalSortOrder(prev => ({ ...prev, ...updates }))
    // 持久化排序到后端
    onRenameGroup(groupA.id, groupA.name, newIdx)
    onRenameGroup(groupB.id, groupB.name, idx)
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-[900px] max-w-[95vw] h-[600px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-textPrimary">{t('containers.manageGroups')}</h3>
            <div className="flex bg-panel rounded-lg p-0.5">
              <button onClick={() => setActiveTab('groups')}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${activeTab === 'groups' ? 'bg-accent text-white' : 'text-textMuted hover:text-textPrimary'}`}>分组</button>
              <button onClick={() => setActiveTab('favorites')}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${activeTab === 'favorites' ? 'bg-accent text-white' : 'text-textMuted hover:text-textPrimary'}`}>收藏</button>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
            <X className="w-4 h-4" /></button>
        </div>

        {/* Tab: 分组管理 */}
        {activeTab === 'groups' && (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* 左侧 */}
            <div className="w-52 shrink-0 border-r border-border flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
                <span className="text-[10px] text-textMuted uppercase tracking-wider">自定义分组</span>
                <button onClick={() => { setCreating(true); setNewName(''); setSelectedKey(null) }} disabled={creating}
                  className="w-5 h-5 flex items-center justify-center rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                  <Plus className="w-3 h-3" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 space-y-1 overflow-x-hidden">
                {userGroups.map((group, idx) => {
                  const count = getProjectsInGroup(group.id).length
                  const isSelected = selectedKey === group.id
                  const isEditing = editingId === group.id
                  return (
                    <div key={group.id}
                      className={`group flex items-center gap-1 px-2 rounded-md cursor-pointer overflow-hidden ${isEditing ? 'py-2 bg-accent/5 border border-accent/20' : isSelected ? 'py-2 bg-accent/10 border border-accent/20' : 'py-2 hover:bg-panel border border-transparent'}`}
                      onClick={() => !isEditing && setSelectedKey(isSelected ? null : group.id)}>
                      <GripVertical className="w-3 h-3 text-textMuted/20 shrink-0" />
                      {isEditing ? (
                        <>
                          <input ref={editInputRef} type="text" value={editName} onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(group.id, editInputRef.current?.value || ''); if (e.key === 'Escape') setEditingId(null) }}
                            autoFocus onClick={e => e.stopPropagation()}
                            className="min-w-0 flex-1 bg-transparent text-xs text-textPrimary placeholder:text-textMuted/40 outline-none" />
                          <button onClick={() => handleRename(group.id, editInputRef.current?.value || '')} className="shrink-0 p-0.5 rounded hover:bg-accent/10 text-accent"><Check className="w-3 h-3" /></button>
                          <button onClick={() => setEditingId(null)} className="shrink-0 p-0.5 rounded hover:bg-error/10 text-textMuted hover:text-error"><X className="w-3 h-3" /></button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-xs text-textPrimary truncate">{group.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 leading-none ${isSelected ? 'bg-accent/20 text-accent' : 'bg-panel text-textMuted'}`}>{count}</span>
                          <span className="w-px h-3 bg-border/30 mx-1 shrink-0" />
                          <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => moveGroup(group.id, 'up')} disabled={idx === 0} className="p-0.5 rounded hover:bg-accent/10 text-textMuted hover:text-accent disabled:opacity-20"><ChevronUp className="w-3 h-3" /></button>
                            <button onClick={() => moveGroup(group.id, 'down')} disabled={idx === userGroups.length - 1} className="p-0.5 rounded hover:bg-accent/10 text-textMuted hover:text-accent disabled:opacity-20"><ChevronDown className="w-3 h-3" /></button>
                            <button
                              onClick={e => { e.stopPropagation(); onToggleShowOnDashboard(group.id, !group.showOnDashboard) }}
                              title={group.showOnDashboard ? '已显示在仪表盘，点击隐藏' : '未显示在仪表盘，点击显示'}
                              className={`p-0.5 rounded transition-colors ${group.showOnDashboard ? 'text-accent hover:bg-accent/10' : 'text-textMuted/40 hover:text-textMuted hover:bg-panel'}`}
                            >
                              {group.showOnDashboard ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
                {creating && (
                  <div className="flex items-center gap-1 px-2 py-2 rounded-md bg-accent/5 border border-accent/20 overflow-hidden">
                    <GripVertical className="w-3 h-3 text-textMuted/20 shrink-0" />
                    <input type="text" placeholder={'输入名称（留空为"新分组"）'} value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
                      autoFocus className="min-w-0 flex-1 bg-transparent text-xs text-textPrimary placeholder:text-textMuted/40 outline-none" />
                    <button onClick={handleCreate} className="shrink-0 p-0.5 rounded hover:bg-accent/10 text-accent"><Check className="w-3 h-3" /></button>
                    <button onClick={() => { setCreating(false); setNewName('') }} className="shrink-0 p-0.5 rounded hover:bg-error/10 text-textMuted hover:text-error"><X className="w-3 h-3" /></button>
                  </div>
                )}
                {userGroups.length === 0 && !creating && (
                  <p className="text-[11px] text-textMuted/50 px-2 py-4 text-center">暂无自定义分组，点击 + 添加</p>
                )}
              </div>
              <div className="border-t border-border px-3 pt-2 pb-3 shrink-0 space-y-0.5">
                {/* 未分组（可点击查看） */}
                <div
                  className={`flex items-center gap-1 px-2 py-2 rounded-md cursor-pointer transition-colors ${selectedKey === '_ungrouped' ? 'bg-accent/10 border border-accent/20' : 'hover:bg-panel border border-transparent text-textMuted'}`}
                  onClick={() => setSelectedKey(selectedKey === '_ungrouped' ? null : '_ungrouped')}>
                  <span className="flex-1 text-xs truncate">未分组</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 leading-none ${selectedKey === '_ungrouped' ? 'bg-accent/20 text-accent' : 'bg-panel text-textMuted/50'}`}>{ungroupedProjects.length}</span>
                  <button
                    onClick={e => { e.stopPropagation(); onToggleShowUngrouped(!showUngroupedSetting) }}
                    title={showUngroupedSetting ? '已显示在仪表盘，点击隐藏' : '未显示在仪表盘，点击显示'}
                    className={`shrink-0 p-0.5 rounded transition-colors ${showUngroupedSetting ? 'text-accent hover:bg-accent/10' : 'text-textMuted/30 hover:text-textMuted hover:bg-panel'}`}
                  >
                    {showUngroupedSetting ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                </div>
                {/* 独立容器（可点击查看容器列表） */}
                {builtinGroups.map(group => (
                  <div key={group.id}
                    className={`flex items-center gap-1 px-2 py-2 rounded-md cursor-pointer transition-colors ${selectedKey === group.id ? 'bg-accent/10 border border-accent/20' : 'hover:bg-panel border border-transparent text-textMuted'}`}
                    onClick={() => setSelectedKey(selectedKey === group.id ? null : group.id)}>
                    <span className="flex-1 text-xs truncate">{group.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${selectedKey === group.id ? 'bg-accent/20 text-accent' : 'bg-panel text-textMuted/50'}`}>内置</span>
                  </div>
                ))}
              </div>
            </div>
            {/* 右侧 */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {selectedKey ? (
                <>
                  <div className="flex items-center px-4 py-2.5 border-b border-border/30 shrink-0 gap-2">
                    {selectedIsEditable && editingId === selectedKey ? (
                      <>
                        <input ref={editInputRef} type="text" value={editName} onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(selectedKey!, editInputRef.current?.value || ''); if (e.key === 'Escape') setEditingId(null) }}
                          autoFocus className="min-w-0 flex-1 bg-transparent text-sm font-medium text-textPrimary outline-none" />
                        <button onClick={() => handleRename(selectedKey!, editInputRef.current?.value || '')} className="shrink-0 p-0.5 rounded hover:bg-accent/10 text-accent"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="shrink-0 p-0.5 rounded hover:bg-error/10 text-textMuted hover:text-error"><X className="w-3.5 h-3.5" /></button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-textPrimary">{selectedPanelTitle}</span>
                        <span className="text-xs text-textMuted">
                          {rightPanelProjects?.length || 0} 个
                        </span>
                        {!selectedIsEditable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel text-textMuted/50">只读</span>
                        )}
                        {selectedIsEditable && (
                          <div className="flex items-center gap-0.5 ml-auto" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { setEditingId(selectedKey!); setEditName(selectedGroup?.name || '') }} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-textMuted hover:text-accent hover:bg-accent/10 transition-colors"><Pencil className="w-3 h-3" />重命名</button>
                            <button onClick={() => handleDelete(selectedKey!)} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-textMuted hover:text-error hover:bg-error/10 transition-colors"><Trash2 className="w-3 h-3" />删除</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {selectedIsEditable ? (
                      <>
                        <p className="text-[11px] text-textMuted mb-2">点击项目以加入/移除此分组：</p>
                        <div className="space-y-1">
                          {composeProjects.length > 0 ? (
                            composeProjects.map(project => {
                              const g = groups.find(x => x.id === selectedKey)!
                              const eg = initialMappings[project]; const inThis = eg === g.id
                              const inOther = eg && eg !== g.id && groups.some(x => x.id === eg)
                              return (
                                <div key={project} onClick={() => toggleAssign(project, g.id)}
                                  className={`flex items-center gap-2 px-3 h-9 rounded-lg cursor-pointer transition-all select-none ${inThis ? 'bg-accent/10 border border-accent/20' : 'bg-panel/50 border border-transparent hover:bg-panel hover:border-border'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inThis ? 'bg-accent' : 'bg-border'}`} />
                                  <span className="text-xs flex-1">{project}</span>
                                  {inThis && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent shrink-0">{g.name}</span>}
                                  {inOther && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning shrink-0">{groups.find(x => x.id === eg)?.name || eg}</span>}
                                </div>
                              )
                            })
                          ) : (<p className="text-xs text-textMuted/50 py-4 text-center">暂无 Compose 项目</p>)}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1">
                        {rightPanelProjects && rightPanelProjects.length > 0 ? (
                          rightPanelProjects.map((name, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-panel/50 border border-transparent">
                              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
                              <span className="text-xs text-textSecondary">{name}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-textMuted/50 py-4 text-center">暂无数据</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-textMuted text-xs">选择左侧项目以查看详情</div>
              )}
            </div>
          </div>
        )}

        {/* Tab: 收藏管理 */}
        {activeTab === 'favorites' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-5">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-textPrimary">收藏的项目</span>
              <span className="text-xs text-textMuted">（与分组互不影响，可同时存在）</span>
            </div>
            {composeProjects.length > 0 ? (
              <div className="flex-1 overflow-y-auto space-y-1">
                {composeProjects.map(project => {
                  const isFav = localFavorites.includes(project)
                  const group = getGroupForProject(project)
                  return (
                    <div key={project} onClick={() => toggleFav(project)}
                      className={`flex items-center gap-2 px-3 h-9 rounded-lg cursor-pointer transition-all select-none ${isFav ? 'bg-amber-400/10 border border-amber-400/20' : 'bg-panel/50 border border-transparent hover:bg-panel hover:border-border'}`}>
                      <Star className={`w-3.5 h-3.5 shrink-0 ${isFav ? 'text-amber-400 fill-amber-400' : 'text-border'}`} />
                      <span className="text-xs flex-1">{project}</span>
                      {isFav && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-600 shrink-0">已收藏</span>}
                      {group && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">{groups.find(g => g.id === group)?.name || group}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (<p className="flex-1 flex items-center justify-center text-xs text-textMuted/50">暂无 Compose 项目</p>)}
          </div>
        )}

        {/* 底部 */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border shrink-0">
          <span className="text-xs text-textMuted">{composeProjects.length} 个 Compose 项目</span>
          <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors font-medium">
            完成</button>
        </div>
      </div>
    </div>, document.body
  )
}
