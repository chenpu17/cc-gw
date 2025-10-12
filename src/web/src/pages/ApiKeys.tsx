import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Key, Copy, Trash2, Plus, Check } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { FormField, Input, Button, StatusBadge } from '@/components'
import { apiClient, type ApiError } from '@/services/api'
import { cn } from '@/utils/cn'
import { mutedTextClass, primaryButtonClass, subtleButtonClass, surfaceCardClass, loadingStateClass, emptyStateClass, chartContainerClass } from '@/styles/theme'
import type {
  ApiKeySummary,
  NewApiKeyResponse,
  ApiKeyOverviewStats,
  ApiKeyUsageMetric
} from '@/types/apiKeys'

const RANGE_OPTIONS = [
  { value: 1, labelKey: 'apiKeys.analytics.range.today' },
  { value: 7, labelKey: 'apiKeys.analytics.range.week' },
  { value: 30, labelKey: 'apiKeys.analytics.range.month' }
]

export default function ApiKeysPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyDescription, setNewKeyDescription] = useState('')
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewApiKeyResponse | null>(null)
  const [isDeleting, setIsDeleting] = useState<number | null>(null)
  const [rangeDays, setRangeDays] = useState<number>(7)

  const keysQuery = useApiQuery<ApiKeySummary[], ApiError>(
    ['api-keys'],
    { url: '/api/keys', method: 'GET' }
  )

  const overviewQuery = useApiQuery<ApiKeyOverviewStats, ApiError>(
    ['api-keys', 'overview', rangeDays],
    { url: '/api/stats/api-keys/overview', method: 'GET', params: { days: rangeDays } }
  )

  const usageQuery = useApiQuery<ApiKeyUsageMetric[], ApiError>(
    ['api-keys', 'usage', rangeDays],
    { url: '/api/stats/api-keys/usage', method: 'GET', params: { days: rangeDays, limit: 10 } }
  )

  const keys = keysQuery.data ?? []
  const overview = overviewQuery.data
  const usage = usageQuery.data ?? []
  const hasWildcard = keys.some((item) => item.isWildcard)
  const totalKeysValue = overview ? overview.totalKeys.toLocaleString() : '–'
  const enabledKeysValue = overview ? overview.enabledKeys.toLocaleString() : '–'
  const activeKeysValue = overview ? overview.activeKeys.toLocaleString() : '–'

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      pushToast({ title: t('apiKeys.errors.nameRequired'), variant: 'error' })
      return
    }

    try {
      const response = await apiClient.post<NewApiKeyResponse>('/api/keys', {
        name: newKeyName.trim(),
        description: newKeyDescription.trim() || undefined
      })
      setNewlyCreatedKey(response.data)
      setIsCreateDialogOpen(false)
      setNewKeyName('')
      setNewKeyDescription('')
      keysQuery.refetch()
      overviewQuery.refetch()
      usageQuery.refetch()
      pushToast({ title: t('apiKeys.toast.keyCreated'), variant: 'success' })
    } catch (error: any) {
      pushToast({
        title: t('apiKeys.toast.createFailure', {
          message: error.response?.data?.error || error.message
        }),
        variant: 'error'
      })
    }
  }

  const handleToggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await apiClient.patch(`/api/keys/${id}`, { enabled: !enabled })
      keysQuery.refetch()
      overviewQuery.refetch()
      pushToast({ title: t('apiKeys.toast.keyUpdated'), variant: 'success' })
    } catch (error: any) {
      pushToast({
        title: t('apiKeys.toast.updateFailure', {
          message: error.response?.data?.error || error.message
        }),
        variant: 'error'
      })
    }
  }

  const handleDeleteKey = async (id: number) => {
    if (!confirm(t('apiKeys.confirmDelete'))) return

    setIsDeleting(id)
    try {
      await apiClient.delete(`/api/keys/${id}`)
      keysQuery.refetch()
      overviewQuery.refetch()
      usageQuery.refetch()
      pushToast({ title: t('apiKeys.toast.keyDeleted'), variant: 'success' })
    } catch (error: any) {
      pushToast({
        title: t('apiKeys.toast.deleteFailure', {
          message: error.response?.data?.error || error.message
        }),
        variant: 'error'
      })
    } finally {
      setIsDeleting(null)
    }
  }

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key)
    pushToast({ title: t('apiKeys.toast.keyCopied'), variant: 'success' })
  }

  const formatDate = (isoString: string | null) => {
    if (!isoString) return t('common.noData')
    return new Date(isoString).toLocaleString()
  }

  const requestsChartOption = useMemo<EChartsOption>(() => {
    const categories = usage.map((item) => item.apiKeyName ?? t('apiKeys.analytics.unknownKey'))
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value' },
      series: [
        {
          name: t('apiKeys.analytics.requestsSeries'),
          type: 'bar',
          data: usage.map((item) => item.requests),
          itemStyle: { color: '#2563eb' }
        }
      ]
    }
  }, [usage, t])

  const tokensChartOption = useMemo<EChartsOption>(() => {
    const categories = usage.map((item) => item.apiKeyName ?? t('apiKeys.analytics.unknownKey'))
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: [t('apiKeys.analytics.tokens.input'), t('apiKeys.analytics.tokens.output')]
      },
      grid: { left: 60, right: 20, top: 50, bottom: 40 },
      xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value' },
      series: [
        {
          name: t('apiKeys.analytics.tokens.input'),
          type: 'bar',
          stack: 'tokens',
          itemStyle: { color: '#22c55e' },
          data: usage.map((item) => item.inputTokens)
        },
        {
          name: t('apiKeys.analytics.tokens.output'),
          type: 'bar',
          stack: 'tokens',
          itemStyle: { color: '#0ea5e9' },
          data: usage.map((item) => item.outputTokens)
        }
      ]
    }
  }, [usage, t])

  if (keysQuery.isLoading) {
    return <Loader />
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon={<Key className="h-6 w-6" aria-hidden="true" />}
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
        actions={
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            variant="primary"
            size="lg"
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            className="rounded-full"
          >
            {t('apiKeys.createNew')}
          </Button>
        }
      />

      <PageSection
        title={t('apiKeys.analytics.title')}
        description={t('apiKeys.analytics.description', { days: rangeDays })}
        actions={
          <div className="flex items-center gap-2 rounded-full bg-white/70 px-2 py-1 shadow-sm shadow-slate-200/60 ring-1 ring-slate-200/60 backdrop-blur dark:bg-slate-900/70 dark:ring-slate-700/60">
            {RANGE_OPTIONS.map((option) => {
              const active = rangeDays === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRangeDays(option.value)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition',
                    active
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                      : 'text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  )}
                >
                  {t(option.labelKey)}
                </button>
              )
            })}
          </div>
        }
        contentClassName="gap-6"
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label={t('apiKeys.analytics.cards.total')} value={totalKeysValue} />
          <MetricCard label={t('apiKeys.analytics.cards.enabled')} value={enabledKeysValue} />
          <MetricCard label={t('apiKeys.analytics.cards.active', { days: rangeDays })} value={activeKeysValue} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <AnalyticsChartCard
            title={t('apiKeys.analytics.charts.requests')}
            loading={usageQuery.isLoading}
            empty={usage.length === 0}
            emptyText={t('apiKeys.analytics.empty')}
            option={requestsChartOption}
          />
          <AnalyticsChartCard
            title={t('apiKeys.analytics.charts.tokens')}
            loading={usageQuery.isLoading}
            empty={usage.length === 0}
            emptyText={t('apiKeys.analytics.empty')}
            option={tokensChartOption}
          />
        </div>
      </PageSection>

      <PageSection
        title={t('apiKeys.list.title')}
        description={hasWildcard ? t('apiKeys.wildcardHint') : undefined}
        contentClassName="gap-4"
      >
        {keys.length === 0 ? (
          <div className={cn(surfaceCardClass, 'p-6 text-center')}>
            <p className={cn(mutedTextClass, 'text-sm')}>{t('apiKeys.list.empty')}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {keys.map((key) => {
              const totalTokens = (key.totalInputTokens + key.totalOutputTokens).toLocaleString()
              return (
                <div key={key.id} className={cn(surfaceCardClass, 'space-y-4')}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{key.name}</h3>
                        {key.isWildcard ? (
                          <span className="inline-flex items-center rounded-full bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-600 dark:bg-purple-500/20 dark:text-purple-200">
                            {t('apiKeys.wildcard')}
                          </span>
                        ) : null}
                        <StatusBadge variant={key.enabled ? 'success' : 'info'}>
                          {key.enabled ? t('apiKeys.status.enabled') : t('apiKeys.status.disabled')}
                        </StatusBadge>
                      </div>
                      <code className="inline-flex items-center rounded-2xl bg-slate-900/90 px-4 py-2 font-mono text-sm text-slate-50 shadow-inner shadow-slate-900/30 dark:bg-slate-800/80">
                        {key.isWildcard ? t('apiKeys.wildcard') : key.maskedKey ?? '********'}
                      </code>
                      {key.isWildcard ? (
                        <p className={cn(mutedTextClass, 'text-sm text-purple-600 dark:text-purple-200')}>
                          {t('apiKeys.wildcardHint')}
                        </p>
                      ) : key.description ? (
                        <p className={cn(mutedTextClass, 'whitespace-pre-wrap text-sm')}>{key.description}</p>
                      ) : null}
                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <div className={cn(mutedTextClass, 'flex flex-col gap-1')}>
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {t('apiKeys.created')}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-100">{formatDate(key.createdAt)}</span>
                        </div>
                        <div className={cn(mutedTextClass, 'flex flex-col gap-1')}>
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {t('apiKeys.lastUsed')}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-100">{formatDate(key.lastUsedAt)}</span>
                        </div>
                        <div className={cn(mutedTextClass, 'flex flex-col gap-1')}>
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {t('apiKeys.requestCount')}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-100">
                            {key.requestCount.toLocaleString()}
                          </span>
                        </div>
                        <div className={cn(mutedTextClass, 'flex flex-col gap-1')}>
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {t('apiKeys.totalTokens')}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-100">{totalTokens}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleEnabled(key.id, key.enabled)}
                        className={cn(
                          'inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold transition',
                          key.enabled
                            ? 'bg-slate-200/80 text-slate-700 hover:bg-slate-300 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700/70'
                            : 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 hover:bg-emerald-500/90'
                        )}
                      >
                        {key.enabled ? t('apiKeys.actions.disable') : t('apiKeys.actions.enable')}
                      </button>
                      {!key.isWildcard ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteKey(key.id)}
                          disabled={isDeleting === key.id}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
                          aria-label={t('apiKeys.actions.delete')}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PageSection>

      {isCreateDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className={cn(surfaceCardClass, 'w-full max-w-md space-y-5 p-6 shadow-xl shadow-slate-900/30 dark:shadow-black/40')}>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{t('apiKeys.createNew')}</h2>
              <p className={cn(mutedTextClass, 'text-sm')}>{t('apiKeys.createDescription')}</p>
            </div>
            <div className="space-y-4">
              <FormField label={t('apiKeys.keyNamePlaceholder')} required>
                <Input
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                  placeholder={t('apiKeys.keyNamePlaceholder')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleCreateKey()
                    }
                  }}
                />
              </FormField>
              <FormField label={t('apiKeys.descriptionLabel')}>
                <textarea
                  value={newKeyDescription}
                  onChange={(event) => setNewKeyDescription(event.target.value)}
                  placeholder={t('apiKeys.keyDescriptionPlaceholder')}
                  className="w-full rounded-2xl border border-slate-200/50 bg-white/90 px-4 py-3 text-sm text-slate-800 shadow-sm shadow-slate-200/30 transition-all duration-200 focus:border-blue-400/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:shadow-md focus:shadow-blue-200/40 dark:border-slate-700/50 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-lg dark:shadow-slate-900/30 dark:focus:border-blue-400/70 dark:focus:ring-blue-400/20 min-h-[96px] resize-none"
                />
              </FormField>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setIsCreateDialogOpen(false)
                  setNewKeyName('')
                  setNewKeyDescription('')
                }}
                variant="subtle"
                className="rounded-full"
              >
                {t('common.actions.cancel')}
              </Button>
              <Button
                onClick={() => void handleCreateKey()}
                variant="primary"
                className="rounded-full"
              >
                {t('apiKeys.createAction')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {newlyCreatedKey && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className={cn(surfaceCardClass, 'w-full max-w-md space-y-5 p-6 shadow-xl shadow-slate-900/30 dark:shadow-black/40')}>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/20 text-emerald-600 dark:bg-emerald-500/30 dark:text-emerald-200">
                <Check className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{t('apiKeys.keyCreated')}</h2>
            </div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('apiKeys.saveKeyWarning')}</p>
            <div className="rounded-2xl bg-slate-900/95 px-4 py-3 font-mono text-sm text-slate-50 shadow-inner shadow-slate-900/40 dark:bg-slate-800/90">
              {newlyCreatedKey.key}
            </div>
            {newlyCreatedKey.description ? (
              <p className={cn(mutedTextClass, 'whitespace-pre-wrap text-sm')}>{newlyCreatedKey.description}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleCopyKey(newlyCreatedKey.key)}
                className={cn(primaryButtonClass, 'h-10 rounded-full px-4')}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t('common.actions.copy')}
              </button>
              <button
                type="button"
                onClick={() => setNewlyCreatedKey(null)}
                className={cn(subtleButtonClass, 'h-10 rounded-full px-4')}
              >
                {t('common.actions.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(surfaceCardClass, 'p-6')}>
      <p className={cn(mutedTextClass, 'text-xs font-semibold uppercase tracking-[0.18em]')}>{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  )
}

interface AnalyticsChartCardProps {
  title: string
  option: EChartsOption
  loading: boolean
  empty: boolean
  emptyText: string
}

function AnalyticsChartCard({ title, option, loading, empty, emptyText }: AnalyticsChartCardProps) {
  const { t } = useTranslation()

  return (
    <div className={cn(surfaceCardClass, 'space-y-4 p-6')}>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
      {loading ? (
        <div className={loadingStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{t('common.loadingShort')}</span>
        </div>
      ) : empty ? (
        <div className={emptyStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{emptyText}</span>
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 280 }}
          notMerge
          lazyUpdate
          className={chartContainerClass}
        />
      )}
    </div>
  )
}
