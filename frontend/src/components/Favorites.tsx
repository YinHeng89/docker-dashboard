import { useTranslation } from 'react-i18next'
import { Star, Plus } from 'lucide-react'
import type { Service } from '../types'

interface FavoritesProps {
  services: Service[]
}

export default function Favorites({ services }: FavoritesProps) {
  const { t } = useTranslation()
  const favs = services.filter((s) => s.favorites)
  if (favs.length === 0) return null

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-4 h-4 text-warning" />
        <h3 className="text-base font-semibold text-textPrimary">{t('favorites.title')}</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {favs.map((s) => (
          <button
            key={s.id}
            onClick={() => { /* TODO */ }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-border/40 text-xs text-textSecondary hover:text-textPrimary hover:bg-border/70 transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              s.status === 'running' ? 'bg-running' : s.status === 'error' ? 'bg-error' : 'bg-stopped'
            }`} />
            {s.name}
          </button>
        ))}
        <button className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-textMuted hover:text-textSecondary border border-dashed border-border/60 hover:border-border transition-colors">
          <Plus className="w-3 h-3" />
          {t('favorites.add')}
        </button>
      </div>
    </div>
  )
}
