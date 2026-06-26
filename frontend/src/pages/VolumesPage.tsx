import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  HardDrive, Search, Plus, Trash2, RotateCw, Loader2, X,
  Layers, FolderOpen, AlertTriangle,
} from 'lucide-react'
import { fetchVolumes, createVolume, removeVolume, pruneVolumes, fetchDockerSystemDf } from '../api/docker'
import { useNotifications } from '../components/NotificationProvider'
import type { VolumeSummary } from '../types'

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0; let v = bytes
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]}`
}

export default function VolumesPage() {
  const { t } = useTranslation()
  const { success, error } = useNotifications()
  const [volumes, setVolumes] = useState<VolumeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showPruneConfirm, setShowPruneConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({ Name: '', Driver: 'local' })
  const [totalSize, setTotalSize] = useState(0)
  const [volSizeMap, setVolSizeMap] = useState<Record<string, number>>({})
  const load = async () => {
    setLoading(true)
    try {
      const [volData, dfData] = await Promise.all([fetchVolumes(), fetchDockerSystemDf().catch(() => null)])
      const volList = (volData as any)?.Volumes || (volData as VolumeSummary[]) || []

      // 从 system/df 获取准确的 Size 和 RefCount，合并到卷列表
      if (dfData) {
        const df = dfData as { Volumes?: Array<{ Name?: string; UsageData?: { Size: number; RefCount: number } }> }
        const sizeMap: Record<string, number> = {}
        let total = 0
        for (const v of (df.Volumes || [])) {
          const sz = v.UsageData?.Size || 0
          const ref = v.UsageData?.RefCount ?? 0
          if (v.Name) {
            sizeMap[v.Name] = sz
            // 用 df 的准确 RefCount 覆盖卷列表里的（可能为空）
            const vol = volList.find((x: VolumeSummary) => x.Name === v.Name)
            if (vol) {
              vol.UsageData = { Size: sz, RefCount: ref }
            }
          }
          total += sz
        }
        setVolSizeMap(sizeMap)
        setTotalSize(total)
      }

      setVolumes(volList)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let list = volumes
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = volumes.filter(v => v.Name?.toLowerCase().includes(q) || v.Driver?.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => (a.Name || '').toLowerCase().localeCompare((b.Name || '').toLowerCase()))
  }, [volumes, searchQuery])

  const inUse = volumes.filter(v => (v.UsageData?.RefCount || 0) > 0).length
  const unused = volumes.filter(v => (v.UsageData?.RefCount || 0) === 0).length

  const handleDelete = async (name: string) => {
    setShowDeleteConfirm(name)
  }

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return
    const name = showDeleteConfirm
    setShowDeleteConfirm(null)
    setActionLoading(name)
    try { await removeVolume(name); success(t('volumes.deleteSuccess'), name); setTimeout(load, 500) }
    catch { error(t('volumes.deleteFailed')) }
    finally { setActionLoading(null) }
  }

  const handleCreate = async () => {
    if (!createForm.Name.trim()) return
    try { await createVolume({ Name: createForm.Name.trim(), Driver: createForm.Driver })
      success(t('volumes.createSuccess'), createForm.Name.trim()); setShowCreate(false); setCreateForm({ Name: '', Driver: 'local' }); setTimeout(load, 500) }
    catch { error(t('volumes.createFailed')) }
  }

  const handlePrune = async () => {
    try { const res = await pruneVolumes() as { VolumesDeleted?: string[]; SpaceReclaimed?: number }
      const count = res.VolumesDeleted?.length ?? 0
      if (count > 0) {
        success(t('volumes.pruneSuccess', { count }))
      } else {
        success(t('volumes.pruneEmpty'))
      }
      setShowPruneConfirm(false); setTimeout(load, 500) }
    catch { error(t('volumes.pruneFailed')) }
  }

  return (
    <main className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {[
          { label: t('volumes.total'), value: volumes.length, icon: HardDrive, c: 'text-accent', bg: 'bg-accent/10' },
          { label: t('volumes.totalSize'), value: fmtBytes(totalSize), icon: Layers, c: 'text-warning', bg: 'bg-warning/10' },
          { label: t('volumes.inUse'), value: inUse, icon: FolderOpen, c: 'text-running', bg: 'bg-running/10' },
          { label: t('volumes.unused'), value: unused, icon: Trash2, c: 'text-stopped', bg: 'bg-stopped/10' },
        ].map(item => (
          <div key={item.label} className="group relative overflow-hidden bg-surface border border-border rounded-lg p-3 md:p-4 flex items-center gap-3 hover:border-accent/30 hover:shadow-sm transition-all duration-200">
            <div className={`absolute -bottom-4 -right-4 w-16 h-16 rounded-full ${item.bg} opacity-40 group-hover:scale-110 transition-transform duration-300`} />
            <div className={`relative w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center shrink-0`}>
              <item.icon className={`w-4.5 h-4.5 ${item.c}`} />
            </div>
            <div className="relative min-w-0">
              <p className="text-lg md:text-2xl font-bold text-textPrimary leading-none">{item.value}</p>
              <p className="text-[10px] md:text-[11px] text-textMuted mt-1 truncate">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px] max-w-md relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input type="text" placeholder={t('volumes.searchPlaceholder')} value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-textPrimary placeholder:text-textMuted outline-none focus:border-accent/50" />
        </div>
        <button onClick={() => setShowCreate(true)} className="action-btn action-btn-primary flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Plus className="w-3.5 h-3.5 shrink-0" />{t('volumes.create')}</button>
        <button onClick={() => setShowPruneConfirm(true)} className="action-btn action-btn-danger flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Trash2 className="w-3.5 h-3.5 shrink-0" />{t('volumes.prune')}</button>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg text-textMuted hover:text-textPrimary hover:bg-border/30 shrink-0">
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colName')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colDriver')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colMountpoint')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colSize')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colRefs')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colCreated')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('volumes.colActions')}</th>
          </tr></thead>
          <tbody>
            {filtered.map(v => {
              const created = v.CreatedAt ? new Date(v.CreatedAt).toLocaleDateString() : '-'
              const volSize = volSizeMap[v.Name]
              return (
                <tr key={v.Name} className="border-b border-border/50 hover:bg-panel/30">
                  <td className="px-3 py-2.5"><span className="text-sm font-medium text-textPrimary">{v.Name}</span></td>
                  <td className="px-3 py-2.5 text-xs text-textSecondary">{v.Driver}</td>
                  <td className="px-3 py-2.5 text-xs text-textMuted font-mono max-w-[200px] truncate">{v.Mountpoint}</td>
                  <td className="px-3 py-2.5 text-xs text-textSecondary">{volSize !== undefined ? fmtBytes(volSize) : '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-textMuted">{v.UsageData?.RefCount ?? 0}</td>
                  <td className="px-3 py-2.5 text-xs text-textMuted">{created}</td>
                  <td className="px-3 py-2.5">
                    {(v.UsageData?.RefCount || 0) === 0 ? (
                      <button onClick={() => handleDelete(v.Name)} disabled={actionLoading === v.Name}
                        className="p-1 rounded hover:bg-error/10 text-textMuted hover:text-error">
                        {actionLoading === v.Name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    ) : (
                      <span className="text-[10px] text-textMuted">-</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && !loading && <div className="text-center py-10 text-textMuted text-sm">{t('volumes.noResults')}</div>}
        {loading && <div className="flex items-center justify-center py-10 text-textMuted"><Loader2 className="w-5 h-5 animate-spin mr-2" />{t('common.loading')}</div>}
      </div>

      {/* Create 弹窗 */}
      {showCreate && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2"><Plus className="w-4 h-4 text-accent" />{t('volumes.create')}</h3>
              <button onClick={() => setShowCreate(false)} className="text-textMuted hover:text-textPrimary"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs text-textMuted block mb-1">{t('volumes.createName')}</label>
                <input value={createForm.Name} onChange={e => setCreateForm({ ...createForm, Name: e.target.value })}
                  className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none" /></div>
              <div><label className="text-xs text-textMuted block mb-1">{t('volumes.createDriver')}</label>
                <input value={createForm.Driver} onChange={e => setCreateForm({ ...createForm, Driver: e.target.value })}
                  className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handleCreate} disabled={!createForm.Name.trim()}
                className="action-btn action-btn-primary text-xs px-3 py-1.5 rounded">{t('volumes.createBtn')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Delete 确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-error" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('volumes.delete')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('volumes.deleteConfirm', { name: showDeleteConfirm })}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={confirmDelete} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('volumes.confirmDelete')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Prune 确认 */}
      {showPruneConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowPruneConfirm(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-warning" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('volumes.prune')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('volumes.pruneUnusedConfirm', { count: unused })}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPruneConfirm(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handlePrune} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('volumes.confirmPrune')}</button>
            </div>
          </div>
        </div>, document.body
      )}
    </main>
  )
}
