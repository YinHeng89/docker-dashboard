import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Layers, HardDrive, Network } from 'lucide-react'
import { fetchImages, fetchVolumes, fetchNetworks } from '../api/docker'
import type { SystemMetrics } from '../types'

interface StatsOverviewProps {
  metrics: SystemMetrics | null
  totalApps: number
}

export default function StatsOverview({ metrics, totalApps }: StatsOverviewProps) {
  const { t } = useTranslation()
  const [images, setImages] = useState(0)
  const [volumes, setVolumes] = useState(0)
  const [networks, setNetworks] = useState(0)

  useEffect(() => {
    Promise.allSettled([
      fetchImages().then((d) => setImages(Array.isArray(d) ? d.length : 0)).catch(() => {}),
      fetchVolumes().then((d) => setVolumes(d?.Volumes?.length ?? 0)).catch(() => {}),
      fetchNetworks().then((d) => setNetworks(Array.isArray(d) ? d.length : 0)).catch(() => {}),
    ])
  }, [])

  const items = [
    { icon: Box, label: t('containers.apps'), value: totalApps },
    { icon: Box, label: t('containers.running'), value: metrics?.containersRunning ?? 0, color: 'text-running' },
    { icon: Box, label: t('stats.stopped'), value: metrics?.containersStopped ?? 0, color: 'text-stopped' },
    { icon: Layers, label: t('stats.images'), value: images },
    { icon: HardDrive, label: t('stats.volumes'), value: volumes },
    { icon: Network, label: t('stats.networks'), value: networks },
  ]

  return (
    <div className="bg-surface border border-border rounded-lg p-3 md:p-4 h-full">
      <h3 className="text-sm md:text-base font-semibold text-textPrimary mb-2 md:mb-3">{t('metrics.containers')}</h3>
      <div className="grid grid-cols-3 gap-1.5 md:gap-3">
        {items.map((item) => (
          <div key={item.label} className="bg-border/30 rounded-lg p-2 md:p-4 flex items-center gap-2 md:gap-3">
            <item.icon className={`w-7 h-7 md:w-12 md:h-12 shrink-0 ${item.color ?? 'text-textMuted'}`} />
            <div className="min-w-0">
              <span className="text-base md:text-xl font-bold font-mono text-textPrimary">{item.value}</span>
              <span className="text-[10px] md:text-xs text-textMuted block truncate">{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
