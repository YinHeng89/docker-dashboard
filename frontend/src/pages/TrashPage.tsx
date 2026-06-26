import { useTranslation } from 'react-i18next'
import { Trash2, Construction } from 'lucide-react'

export default function TrashPage() {
  const { t } = useTranslation()
  return (
    <main className="flex-1 overflow-y-auto p-3 md:p-5 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-warning/10">
          <Trash2 className="w-10 h-10 text-warning" />
        </div>
        <h2 className="text-xl font-semibold text-textPrimary">{t('nav.trash')}</h2>
        <p className="text-sm text-textMuted flex items-center justify-center gap-1.5">
          <Construction className="w-4 h-4" />
          {t('common.comingSoon')}
        </p>
      </div>
    </main>
  )
}
