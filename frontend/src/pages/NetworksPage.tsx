import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Network, Search, Plus, Trash2, RotateCw, Loader2, X,
  Globe, Shield, AlertTriangle, Container, ChevronDown, ChevronUp,
} from 'lucide-react'
import { fetchNetworks, fetchNetworkDetail, createNetwork, removeNetwork, pruneNetworks } from '../api/docker'
import { useNotifications } from '../components/NotificationProvider'
import type { NetworkSummary } from '../types'

export default function NetworksPage() {
  const { t } = useTranslation()
  const { success, error } = useNotifications()
  const [networks, setNetworks] = useState<NetworkSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showPruneConfirm, setShowPruneConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({ Name: '', Driver: 'bridge', Subnet: '', Gateway: '', Internal: false, Attachable: false })
  const [expandedNetwork, setExpandedNetwork] = useState<string | null>(null)
  const load = async () => {
    setLoading(true)
    try {
      const list = await fetchNetworks() as NetworkSummary[]
      // 并行 inspect 每个网络以获取完整容器关联信息
      const enriched = await Promise.all(
        list.map(async (net) => {
          try {
            const detail = await fetchNetworkDetail(net.Id)
            // 用 inspect 返回的 Containers 覆盖列表中的（列表端点可能不包含容器信息）
            if (detail?.Containers) {
              return { ...net, Containers: detail.Containers }
            }
          } catch { /* inspect 失败保留原始数据 */ }
          return net
        })
      )
      setNetworks(enriched)
    } catch {} finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const source = searchQuery.trim()
      ? networks.filter(n => {
          const q = searchQuery.toLowerCase()
          return n.Name.toLowerCase().includes(q) || n.Driver.toLowerCase().includes(q)
        })
      : networks
    // 排序：bridge, host, none 固定在前，其余按名称字母排序
    const builtinOrder = ['bridge', 'host', 'none']
    return [...source].sort((a, b) => {
      const aIdx = builtinOrder.indexOf(a.Name)
      const bIdx = builtinOrder.indexOf(b.Name)
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
      if (aIdx !== -1) return -1
      if (bIdx !== -1) return 1
      return a.Name.toLowerCase().localeCompare(b.Name.toLowerCase())
    })
  }, [networks, searchQuery])

  const builtin = networks.filter(n => ['bridge', 'host', 'none'].includes(n.Name)).length
  const unused = networks.filter(n => !['bridge', 'host', 'none'].includes(n.Name) && Object.keys(n.Containers || {}).length === 0).length

  const handleDelete = (id: string) => {
    setShowDeleteConfirm(id)
  }

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return
    const id = showDeleteConfirm
    setShowDeleteConfirm(null)
    setActionLoading(id)
    try { await removeNetwork(id); success(t('networks.deleteSuccess')); setTimeout(load, 500) }
    catch { error(t('networks.deleteFailed')) }
    finally { setActionLoading(null) }
  }

  const handleCreate = async () => {
    if (!createForm.Name.trim()) return
    try {
      await createNetwork({
        Name: createForm.Name.trim(),
        Driver: createForm.Driver,
        Subnet: createForm.Subnet.trim() || undefined,
        Gateway: createForm.Gateway.trim() || undefined,
        Internal: createForm.Internal,
        Attachable: createForm.Attachable,
      })
      success(t('networks.createSuccess'), createForm.Name.trim()); setShowCreate(false)
      setCreateForm({ Name: '', Driver: 'bridge', Subnet: '', Gateway: '', Internal: false, Attachable: false })
      setTimeout(load, 500)
    } catch { error(t('networks.createFailed')) }
  }

  const handlePrune = async () => {
    try {
      const res = await pruneNetworks() as { NetworksDeleted?: string[] }
      const count = res.NetworksDeleted?.length ?? 0
      if (count > 0) {
        success(t('networks.pruneSuccess', { count }))
      } else {
        success(t('networks.pruneEmpty'))
      }
      setShowPruneConfirm(false)
      setTimeout(load, 500)
    }
    catch { error(t('networks.pruneFailed')) }
  }

  return (
    <main className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {[
          { label: t('networks.total'), value: networks.length, icon: Network, c: 'text-accent', bg: 'bg-accent/10' },
          { label: t('networks.builtin'), value: builtin, icon: Shield, c: 'text-warning', bg: 'bg-warning/10' },
          { label: t('networks.custom'), value: networks.length - builtin, icon: Globe, c: 'text-running', bg: 'bg-running/10' },
          { label: t('networks.unused'), value: unused, icon: Trash2, c: 'text-stopped', bg: 'bg-stopped/10' },
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
          <input type="text" placeholder={t('networks.searchPlaceholder')} value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-textPrimary placeholder:text-textMuted outline-none focus:border-accent/50" />
        </div>
        <button onClick={() => setShowCreate(true)} className="action-btn action-btn-primary flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Plus className="w-3.5 h-3.5 shrink-0" />{t('networks.create')}</button>
        <button onClick={() => setShowPruneConfirm(true)} className="action-btn action-btn-danger flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <Trash2 className="w-3.5 h-3.5 shrink-0" />{t('networks.prune')}</button>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg text-textMuted hover:text-textPrimary hover:bg-border/30 shrink-0">
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="w-6 px-2 py-2" />
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colName')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colDriver')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colScope')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colSubnet')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colGateway')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colContainers')}</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-textMuted">{t('networks.colActions')}</th>
          </tr></thead>
          <tbody>
            {filtered.map(n => {
              const isExpanded = expandedNetwork === n.Id
              const subnet = n.IPAM?.Config?.[0]?.Subnet || '-'
              const gateway = n.IPAM?.Config?.[0]?.Gateway || '-'
              const containerEntries = n.Containers ? Object.entries(n.Containers) : []
              return (
                <>
                  <tr key={n.Id} className={`border-b border-border/50 ${isExpanded ? 'bg-panel/50' : 'hover:bg-panel/30'}`}>
                    <td className="px-2 py-2.5">
                      <button onClick={() => setExpandedNetwork(isExpanded ? null : n.Id)}
                        className="text-textMuted hover:text-textPrimary">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium text-textPrimary">{n.Name}</span>
                      {n.Internal && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-warning/10 text-warning">internal</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-textSecondary">{n.Driver}</td>
                    <td className="px-3 py-2.5 text-xs text-textMuted">{n.Scope}</td>
                    <td className="px-3 py-2.5 text-xs text-textSecondary font-mono">{subnet}</td>
                    <td className="px-3 py-2.5 text-xs text-textSecondary font-mono">{gateway}</td>
                    <td className="px-3 py-2.5 text-xs text-textMuted">
                      {containerEntries.length > 0 ? t('networks.containersCount', { count: containerEntries.length }) : t('networks.noContainers')}
                    </td>
                    <td className="px-3 py-2.5">
                      {!['bridge', 'host', 'none'].includes(n.Name) && containerEntries.length === 0 && (
                        <button onClick={() => handleDelete(n.Id)} disabled={actionLoading === n.Id}
                          className="p-1 rounded hover:bg-error/10 text-textMuted hover:text-error">
                          {actionLoading === n.Id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* 展开行：关联容器详情 */}
                  {isExpanded && (
                    <tr key={`${n.Id}-expanded`} className="border-b border-border/50 bg-panel/50">
                      <td colSpan={8} className="px-6 py-3">
                        {containerEntries.length > 0 ? (
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-textPrimary flex items-center gap-1.5">
                              <Container className="w-3.5 h-3.5 text-accent" />
                              {t('networks.containers')}
                            </h4>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                              {containerEntries.map(([cid, info]) => (
                                <div key={cid} className="flex items-center gap-2 bg-surface rounded px-3 py-2 border border-border/50">
                                  <span className="w-1.5 h-1.5 rounded-full bg-running shrink-0" />
                                  <div className="min-w-0">
                                    <span className="text-textPrimary font-medium truncate block">{info.Name || cid.slice(0, 12)}</span>
                                    <span className="text-textMuted font-mono text-[10px]">{info.IPv4Address || '-'}</span>
                                  </div>
                                  <span className="text-textMuted font-mono text-[10px] ml-auto">{info.MacAddress?.slice(0, 17) || ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-textMuted py-2">{t('networks.noContainers')}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && !loading && <div className="text-center py-10 text-textMuted text-sm">{t('networks.noResults')}</div>}
        {loading && <div className="flex items-center justify-center py-10 text-textMuted"><Loader2 className="w-5 h-5 animate-spin mr-2" />{t('common.loading')}</div>}
      </div>

      {/* Create 弹窗 */}
      {showCreate && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[440px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2"><Plus className="w-4 h-4 text-accent" />{t('networks.create')}</h3>
              <button onClick={() => setShowCreate(false)} className="text-textMuted hover:text-textPrimary"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs text-textMuted block mb-1">{t('networks.createName')}</label>
                <input value={createForm.Name} onChange={e => setCreateForm({ ...createForm, Name: e.target.value })}
                  className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none" /></div>
              <div><label className="text-xs text-textMuted block mb-1">{t('networks.createDriver')}</label>
                <select value={createForm.Driver} onChange={e => setCreateForm({ ...createForm, Driver: e.target.value })}
                  className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none">
                  <option value="bridge">bridge</option><option value="overlay">overlay</option><option value="macvlan">macvlan</option>
                </select></div>
              <div><label className="text-xs text-textMuted block mb-1">{t('networks.createSubnet')}</label>
                <input value={createForm.Subnet} onChange={e => setCreateForm({ ...createForm, Subnet: e.target.value })}
                  placeholder="172.20.0.0/16" className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none font-mono" /></div>
              <div><label className="text-xs text-textMuted block mb-1">{t('networks.createGateway')}</label>
                <input value={createForm.Gateway} onChange={e => setCreateForm({ ...createForm, Gateway: e.target.value })}
                  placeholder="172.20.0.1" className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none font-mono" /></div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-textSecondary">
                  <input type="checkbox" checked={createForm.Internal} onChange={e => setCreateForm({ ...createForm, Internal: e.target.checked })}
                    className="rounded bg-panel border-border" />{t('networks.createInternal')}</label>
                <label className="flex items-center gap-2 text-xs text-textSecondary">
                  <input type="checkbox" checked={createForm.Attachable} onChange={e => setCreateForm({ ...createForm, Attachable: e.target.checked })}
                    className="rounded bg-panel border-border" />{t('networks.createAttachable')}</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handleCreate} disabled={!createForm.Name.trim()}
                className="action-btn action-btn-primary text-xs px-3 py-1.5 rounded">{t('networks.createBtn')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Delete 确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-error" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('networks.delete')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('networks.deleteConfirm', { name: networks.find(n => n.Id === showDeleteConfirm)?.Name || showDeleteConfirm })}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={confirmDelete} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('networks.confirmDelete')}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* Prune 确认 */}
      {showPruneConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowPruneConfirm(false)}>
          <div className="bg-surface border border-border rounded-lg shadow-2xl p-6 w-[400px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-5 h-5 text-warning" />
              <h3 className="text-sm font-semibold text-textPrimary">{t('networks.prune')}</h3></div>
            <p className="text-xs text-textSecondary mb-4">{t('networks.pruneConfirm')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPruneConfirm(false)} className="action-btn-ghost text-xs px-3 py-1.5 rounded">{t('common.cancel')}</button>
              <button onClick={handlePrune} className="action-btn bg-error text-white hover:bg-error/80 text-xs px-3 py-1.5 rounded">{t('networks.confirmPrune')}</button>
            </div>
          </div>
        </div>, document.body
      )}
    </main>
  )
}
