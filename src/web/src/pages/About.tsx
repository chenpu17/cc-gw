import { useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, LifeBuoy, RefreshCw, Sparkles } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="pt-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              {item.value}
            </dd>
            {item.hint && (
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            )}
          </CardContent>
        </Card>
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
        value: <span className="font-mono">cc-gw</span>
      },
      {
        label: t('about.app.labels.version'),
        value: <span className="font-mono text-primary">v{appVersion}</span>
      },
      {
        label: t('about.app.labels.buildTime'),
        value: buildInfo.buildTime,
        hint: t('about.app.hint.buildTime')
      },
      {
        label: t('about.app.labels.node'),
        value: <span className="font-mono">{buildInfo.nodeVersion}</span>
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
    <div className="space-y-6">
      <PageHeader
        icon={<Info className="h-5 w-5" aria-hidden="true" />}
        title={t('about.title')}
        description={t('about.description')}
        badge={`v${appVersion}`}
        actions={
          <Button onClick={handleCheckUpdates}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('about.support.actions.checkUpdates')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PageSection
          title={t('about.app.title')}
          description={t('about.app.subtitle')}
        >
          <InfoGrid items={infoItems} />
        </PageSection>

        <PageSection
          title={t('about.status.title')}
          description={t('about.status.subtitle')}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => statusQuery.refetch()}
              disabled={statusQuery.isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${statusQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              {statusQuery.isFetching ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          }
        >
          {statusQuery.isLoading ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">{t('about.status.loading')}</p>
            </div>
          ) : runtimeItems.length > 0 ? (
            <InfoGrid items={runtimeItems} />
          ) : (
            <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">{t('about.status.empty')}</p>
              <p className="text-xs text-muted-foreground">{t('common.actions.refresh')}</p>
            </div>
          )}
        </PageSection>
      </div>

      <PageSection
        title={t('about.support.title')}
        description={
          <span className="space-y-1">
            <span className="block text-sm font-medium text-primary">
              {t('about.support.subtitle')}
            </span>
            <span>{t('about.support.description')}</span>
          </span>
        }
      >
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LifeBuoy className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="flex-1 text-sm text-muted-foreground">
                {t('about.support.tip')}
              </p>
            </div>
            <code className="inline-flex self-start rounded-md bg-muted px-3 py-1.5 text-xs font-medium">
              ~/.cc-gw/config.json
            </code>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}
