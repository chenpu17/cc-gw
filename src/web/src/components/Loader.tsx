import { useTranslation } from 'react-i18next'

export function Loader() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center p-12" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      </div>
    </div>
  )
}

export function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600" />
      <span>{t('common.loading')}</span>
    </div>
  )
}
