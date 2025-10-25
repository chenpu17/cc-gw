import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, LifeBuoy, RefreshCw, Sparkles } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { Button } from '@/components'
import { cn } from '@/utils/cn'
import { mutedTextClass } from '@/styles/theme'
import packageJson from '../../../../package.json' assert { type: 'json' }

interface StatusResponse {
  port: number
  host?: string
  providers: number
  activeRequests?: number
}

interface InfoGridItem {
  label: string
  value: ReactNode
  hint?: ReactNode
}

function InfoGrid({ items }: { items: InfoGridItem[] }) {
  if (items.length === 0) {
    return null
  }
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-slate-200/50 bg-white p-4 shadow-sm shadow-slate-200/30 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200/70 hover:shadow-md hover:shadow-slate-200/40 dark:border-slate-700/50 dark:bg-slate-900/80 dark:shadow-lg dark:shadow-slate-900/30 dark:hover:border-slate-600/70"
        >
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            {item.label}
          </dt>
          <dd className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            {item.value}
          </dd>
          {item.hint ? <p className={cn(mutedTextClass, 'mt-2 text-xs leading-relaxed')}>{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  )
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

  const infoItems = useMemo<InfoGridItem[]>(
    () => [
      {
        label: t('about.app.labels.name'),
        value: <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">cc-gw</span>
      },
      {
        label: t('about.app.labels.version'),
        value: <span className="font-mono text-sm font-semibold text-blue-700 dark:text-blue-200">v{appVersion}</span>
      },
      {
        label: t('about.app.labels.buildTime'),
        value: buildInfo.buildTime,
        hint: t('about.app.hint.buildTime')
      },
      {
        label: t('about.app.labels.node'),
        value: <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{buildInfo.nodeVersion}</span>
      }
    ],
    [appVersion, buildInfo.buildTime, buildInfo.nodeVersion, t]
  )

  const runtimeItems = useMemo<InfoGridItem[]>(() => {
    if (!statusQuery.data) {
      return []
    }
    return [
      {
        label: t('about.status.labels.host'),
        value: statusQuery.data.host ?? '127.0.0.1'
      },
      {
        label: t('about.status.labels.port'),
        value: statusQuery.data.port.toLocaleString()
      },
      {
        label: t('about.status.labels.providers'),
        value: statusQuery.data.providers.toLocaleString()
      },
      {
        label: t('about.status.labels.active'),
        value: (statusQuery.data.activeRequests ?? 0).toLocaleString(),
        hint: t('about.status.hint.active')
      }
    ]
  }, [statusQuery.data, t])

  const handleCheckUpdates = () => {
    pushToast({
      title: t('about.toast.updatesPlanned'),
      variant: 'info'
    })
  }

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Info className="h-6 w-6" aria-hidden="true" />}
        title={t('about.title')}
        description={t('about.description')}
        badge={`v${appVersion}`}
        actions={
          <Button
            variant="primary"
            icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            onClick={handleCheckUpdates}
          >
            {t('about.support.actions.checkUpdates')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PageSection
          title={t('about.app.title')}
          description={t('about.app.subtitle')}
          className="h-full"
          contentClassName="gap-4"
        >
          <InfoGrid items={infoItems} />
        </PageSection>

        <PageSection
          title={t('about.status.title')}
          description={t('about.status.subtitle')}
          className="h-full"
          contentClassName="gap-4"
          actions={
            <Button
              variant="subtle"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              onClick={() => statusQuery.refetch()}
              loading={statusQuery.isFetching}
            >
              {statusQuery.isFetching ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          }
        >
          {statusQuery.isLoading ? (
            <div className="flex h-36 flex-col items-center justify-center gap-3 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500/30 border-t-blue-600 dark:border-blue-400/20 dark:border-t-blue-300" />
              <p className={cn(mutedTextClass, 'text-sm')}>{t('about.status.loading')}</p>
            </div>
          ) : runtimeItems.length > 0 ? (
            <InfoGrid items={runtimeItems} />
          ) : (
            <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200/60 bg-white p-6 text-center shadow-inner dark:border-slate-700/60 dark:bg-slate-900/60">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('about.status.empty')}</p>
              <p className={cn(mutedTextClass, 'text-xs')}>{t('common.actions.refresh')}</p>
            </div>
          )}
        </PageSection>
      </div>

      <PageSection
        title={t('about.support.title')}
        description={
          <span className="space-y-1">
            <span className="block text-sm font-semibold text-blue-600 dark:text-blue-300">
              {t('about.support.subtitle')}
            </span>
            <span>{t('about.support.description')}</span>
          </span>
        }
        className="relative overflow-hidden"
        contentClassName="gap-6"
      >
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/50 bg-white p-6 shadow-lg shadow-slate-200/30 backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/80 dark:shadow-slate-900/40">
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-600 shadow-inner dark:text-blue-200">
              <LifeBuoy className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className={cn(mutedTextClass, 'text-sm leading-6')}>
              {t('about.support.tip')}
            </p>
          </div>
          <code className="inline-flex items-center gap-2 self-start rounded-full border border-blue-200/50 bg-blue-50/80 px-4 py-2 text-xs font-semibold tracking-wide text-blue-700 shadow-sm dark:border-blue-500/30 dark:bg-blue-900/30 dark:text-blue-200">
            ~/.cc-gw/config.json
          </code>
        </div>
      </PageSection>
    </div>
  )
}
