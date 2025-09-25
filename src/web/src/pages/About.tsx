import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import packageJson from '../../../../package.json' assert { type: 'json' }

interface StatusResponse {
  port: number
  host?: string
  providers: number
  activeRequests?: number
}

export default function AboutPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const statusQuery = useApiQuery<StatusResponse, ApiError>(
    ['status', 'gateway'],
    { url: '/api/status', method: 'GET' },
    {
      staleTime: 60_000
    }
  )

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({
        title: t('about.toast.statusError.title'),
        description: statusQuery.error.message,
        variant: 'error'
      })
    }
  }, [statusQuery.isError, statusQuery.error, pushToast, t])

  const appVersion = (packageJson as { version?: string }).version ?? '0.0.0'

  const buildInfo = useMemo(() => {
    const env = import.meta.env
    const buildTime = env.VITE_BUILD_TIME ?? '-'
    const nodeVersion = env.VITE_NODE_VERSION ?? '-'
    return {
      buildTime,
      nodeVersion
    }
  }, [])

  const handleCheckUpdates = () => {
    pushToast({
      title: t('about.toast.updatesPlanned'),
      variant: 'info'
    })
  }

  const infoItems = [
    { label: t('about.app.labels.name'), value: 'cc-local-gw' },
    { label: t('about.app.labels.version'), value: appVersion },
    { label: t('about.app.labels.buildTime'), value: buildInfo.buildTime },
    { label: t('about.app.labels.node'), value: buildInfo.nodeVersion }
  ]

  const runtimeItems = statusQuery.data
    ? [
        {
          label: t('about.status.labels.host'),
          value: statusQuery.data.host ?? '127.0.0.1'
        },
        {
          label: t('about.status.labels.port'),
          value: statusQuery.data.port
        },
        {
          label: t('about.status.labels.providers'),
          value: statusQuery.data.providers
        },
        {
          label: t('about.status.labels.active'),
          value: statusQuery.data.activeRequests ?? 0
        }
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('about.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('about.description')}</p>
      </header>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('about.app.title')}</h2>
          <dl className="grid grid-cols-[160px_1fr] gap-2 text-sm text-slate-600 dark:text-slate-300">
            {infoItems.map((item) => (
              <div key={item.label} className="contents">
                <dt className="font-medium">{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t('about.status.title')}</h2>
          {statusQuery.isLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('about.status.loading')}</p>
          ) : statusQuery.data ? (
            <dl className="grid grid-cols-[160px_1fr] gap-2 text-sm text-slate-600 dark:text-slate-300">
              {runtimeItems.map((item) => (
                <div key={item.label} className="contents">
                  <dt className="font-medium">{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-red-500">{t('about.status.empty')}</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('about.support.title')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('about.support.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={handleCheckUpdates}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t('about.support.actions.checkUpdates')}
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('about.support.description')}</p>
      </section>
    </div>
  )
}
