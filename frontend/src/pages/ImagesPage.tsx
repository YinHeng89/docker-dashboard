import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Box, Search, Trash2, Download, RotateCw, Loader2,
  Layers, HardDrive, AlertTriangle,
} from 'lucide-react'
import { fetchImages, fetchContainers, removeImage, pruneImages, pullImage } from '../api/docker'
import { useNotifications } from '../components/NotificationProvider'
import type { ImageSummary } from '../types'

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0; let v = bytes
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]}`
}
function fmtDate(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ImagesPage() {
  const { t } = useTranslation()
  const { success, error } = useNotifications()
  const [images, setImages] = useState<ImageSummary[]>([])
  const [containerImageIds, setContainerImageIds] = useState<string[]>([]) // 所有容器的 ImageID
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showPull, setShowPull] = useState(false)
  const [pullName, setPullName] = useState('')
  const [pulling, setPulling] = useState(false)
  const [showPruneConfirm, setShowPruneConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  /** 根据容器的 ImageID 计算每个镜像被多少个容器使用 */
  const containerCountByImage = useMemo(() => {
    const map = new Map<string, number>()
    for (const cid of containerImageIds) {
      // 标准化镜像 ID（去掉 sha256: 前缀，统一小写）
      const normalized = cid.replace(/^sha256:/i, '').toLowerCase()
      map.set(normalized, (map.get(normalized) || 0) + 1)
    }
    return map
  }, [containerImageIds])

  /** 获取某个镜像的关联容器数（只信任容器列表，不信任 API 的 Containers） */
  const getContainerCount = (img: ImageSummary): number => {
    const id = (img.Id || '').replace(/^sha256:/i, '').toLowerCase()
    return containerCountByImage.get(id) || 0
  }

  const load = () => {
    setLoading(true)
    Promise.all([
      fetchImages(),
      fetchContainers(),
    ]).then(([imgs, containers]) => {
      setImages(imgs as ImageSummary[])
      const ids: string[] = (containers as any[]).map((c: any) => c.ImageID || '').filter(Boolean)
      setContainerImageIds(ids)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  /** 获取排序用名称（与表格显示一致） */
  const getSortName = (img: ImageSummary): string => {
    const tags = (img.RepoTags || []).filter(t => t !== '<none>:<none>')
    if (tags.length > 0) return tags[0]!.toLowerCase()
    const digests = (img.RepoDigests || []).map(d => d.replace(/@.+$/, ''))
    if (digests.length > 0) return digests[0]!.toLowerCase()
    return (img.Id || '').toLowerCase()
  }

  const filtered = useMemo(() => {
    let list = images
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = images.filter(img =>
        img.RepoTags?.some(t => t.toLowerCase().includes(q)) ||
        img.Id?.toLowerCase().includes(q)
      )
    }
    // 排序：使用中优先 > 有名字的 > 悬空的；各自组内按名称字母序
    return [...list].sort((a, b) => {
      const aInUse = getContainerCount(a) > 0
      const bInUse = getContainerCount(b) > 0
      if (aInUse !== bInUse) return aInUse ? -1 : 1  // 使用中排前面
      return getSortName(a).localeCompare(getSortName(b))
    })
  }, [images, searchQuery])

  const totalSize = images.reduce((s, i) => s + i.Size, 0)
  const unused = images.filter(i => getContainerCount(i) === 0).length
  const inUse = images.filter(i => getContainerCount(i) > 0).length

  const handleDelete = (id: string) => {
    setShowDeleteConfirm(id)
  }

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return
    const id = showDeleteConfirm
    setShowDeleteConfirm(null)
    setActionLoading(id)
    try { await removeImage(id, true); success(t('images.deleteSuccess')); setTimeout(load, 500) }
    catch { error(t('images.deleteFailed')) }
    finally { setActionLoading(null) }
  }

  const handlePull = async () => {
    if (!pullName.trim()) return
    setPulling(true)
    try { await pullImage(pullName.trim()); success(t('images.pullSuccess'), pullName.trim()); setShowPull(false); setPullName(''); setTimeout(load, 500) }
    catch { error(t('images.pullFailed'), t('images.pullFailed')) }
    finally { setPulling(false) }
  }

  const handlePrune = async () => {
    try {
      const res = await pruneImages(true) as { SpaceReclaimed?: number }
      const size = fmtBytes(res.SpaceReclaimed ?? 0)
      success(t('images.pruneSuccess', { count: unused, size }))
      setShowPruneConfirm(false)
      setTimeout(load, 500)
    } catch { error(t('images.pruneFailed')) }
  }

  return (
    <main className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
      {/* 统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {[
          { label: t('images.total'), value: images.length, icon: Layers, c: 'text-accent', bg: 'bg-accent/10' },
          { label: t('images.totalSize'), value: fmtBytes(totalSize), icon: HardDrive, c: 'text-warning', bg: 'bg-warning/10' },
          { label: t('images.inUse'), value: inUse, icon: Box, c: 'text-running', bg: 'bg-running/10' },
          { label: t('images.unused'), value: unused, icon: Trash2, c: 'text-stopped', bg: 'bg-stopped/10' },
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

      {/* 工具栏 */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px] max-w-md relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input type="text" placeholder={t('images.searchPlaceholder')} value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-textPrimary placeholder:text-textMuted outline-none focus:border-accent/50" />
        </div>
        <button onClick={() => setShowPull(true)}
          className="action-btn action-btn-primary flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Download className="w-3.5 h-3.5 shrink-0" />{t('images.pullImage')}</button>
        <button onClick={() => setShowPruneConfirm(true)}
          className="action-btn action-btn-danger flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Trash2 className="w-3.5 h-3.5 shrink-0" />{t('images.pruneUnused')}</button>
        <button onClick={load} disabled={loading}
          className="p-2 rounded-lg text-textMuted hover:text-textPrimary hover:bg-border/30 shrink-0">
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {/* 表格 */}
      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colName')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colId')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colSize')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colCreated')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colContainers')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('images.colActions')}</th>
          </tr></thead>
          <tbody>
            {filtered.map(img => {
              // 提取有效 RepoTags（排除 <none>:<none>）
              const rawTags = (img.RepoTags || []).filter(t => t !== '<none>:<none>')
              // 从 RepoDigests 提取镜像名：postgres@sha256:xxx → postgres
              const digestNames = (img.RepoDigests || []).map(d => d.replace(/@.+$/, ''))
              // 悬空：既没有效 RepoTags 也没有 RepoDigests 可识别
              const isDangling = rawTags.length === 0 && digestNames.length === 0
              const containerCount = getContainerCount(img)
              const isInUse = containerCount > 0

              // 显示名优先级：RepoTags > RepoDigests 提取 > 截短 ID
              let name: string
              if (rawTags.length > 0) {
                const t = rawTags[0]!
                const lastColon = t.lastIndexOf(':')
                if (lastColon !== -1 && t.slice(lastColon + 1) === '<none>') {
                  name = t.slice(0, lastColon)
                } else {
                  name = t
                }
              } else if (digestNames.length > 0) {
                name = digestNames[0]!
              } else {
                name = img.Id?.slice(7, 19) || img.Id || '<none>'
              }
              return (
                <tr key={img.Id} className="border-b border-border/50 hover:bg-panel/50">
                  <td className="px-3 py-2.5">
                    <span
                      title={isDangling ? img.Id : (rawTags[0] || digestNames[0] || img.Id)}
                      className={`text-sm font-medium block max-w-[300px] truncate ${
                        isInUse ? 'text-textPrimary' : isDangling ? 'text-textMuted italic' : 'text-textMuted'
                      }`}
                    >{name}</span>
                    {!isDangling && rawTags.length > 1 && <span className="text-[10px] text-textMuted">+{rawTags.length - 1} tags</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-textMuted font-mono">{img.Id?.slice(7, 19) || '-'}</td>
                  <td className="px-3 py-2.5 text-xs text-textSecondary">{fmtBytes(img.Size)}</td>
                  <td className="px-3 py-2.5 text-xs text-textMuted">{fmtDate(img.Created)}</td>
                  <td className="px-3 py-2.5 text-xs text-textMuted">{isInUse ? t('images.usedBy', { count: containerCount }) : '-'}</td>
                  <td className="px-3 py-2.5">
                    {!isInUse ? (
                      <button onClick={() => handleDelete(img.Id)}
                        disabled={actionLoading === img.Id}
                        className="p-1 rounded hover:bg-error/10 text-textMuted hover:text-error">
                        {actionLoading === img.Id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
        {filtered.length === 0 && !loading && (
          <div className="text-center py-10 text-textMuted text-sm">{t('images.noResults')}</div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-10 text-textMuted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />{t('common.loading')}</div>
        )}
      </div>

      {/* Pull 弹窗 */}
      {showPull && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowPull(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[420px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-textPrimary mb-4 flex items-center gap-2">
              <Download className="w-4 h-4 text-accent" />{t('images.pullImage')}</h3>
            <input type="text" value={pullName} onChange={e => setPullName(e.target.value)}
              placeholder={t('images.pullPlaceholder')}
              className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none mb-4"
              onKeyDown={e => e.key === 'Enter' && handlePull()} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPull(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handlePull} disabled={pulling || !pullName.trim()}
                className="action-btn action-btn-primary text-xs px-3 py-1.5 rounded flex items-center gap-1.5">
                {pulling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                {pulling ? t('images.pulling') : t('images.pullBtn')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Delete 确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-error" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('images.delete')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('images.deleteConfirm')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={confirmDelete} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('images.delete')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Prune 未使用确认弹窗 */}
      {showPruneConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowPruneConfirm(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-error" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('images.pruneUnused')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('images.pruneUnusedConfirm', { count: unused })}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPruneConfirm(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handlePrune} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('images.confirmPrune')}</button>
            </div>
          </div>
        </div>, document.body
      )}
    </main>
  )
}
