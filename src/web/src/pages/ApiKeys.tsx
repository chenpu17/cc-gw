import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Key, Copy, Trash2, Plus, Check } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { apiClient, type ApiError } from '@/services/api'
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="w-6 h-6" />
            {t('apiKeys.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-2xl">
            {t('apiKeys.description')}
          </p>
        </div>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('apiKeys.createNew')}
        </button>
      </div>

      <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('apiKeys.analytics.title')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('apiKeys.analytics.description', { days: rangeDays })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setRangeDays(option.value)}
                className={`rounded px-3 py-1 text-sm transition ${
                  rangeDays === option.value
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('apiKeys.analytics.cards.total')}</p>
            <p className="mt-2 text-2xl font-semibold">{overview ? overview.totalKeys.toLocaleString() : '–'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('apiKeys.analytics.cards.enabled')}</p>
            <p className="mt-2 text-2xl font-semibold">{overview ? overview.enabledKeys.toLocaleString() : '–'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('apiKeys.analytics.cards.active', { days: rangeDays })}
            </p>
            <p className="mt-2 text-2xl font-semibold">{overview ? overview.activeKeys.toLocaleString() : '–'}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 text-base font-semibold">{t('apiKeys.analytics.charts.requests')}</h3>
            {usageQuery.isLoading ? (
              <Loader />
            ) : usage.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('apiKeys.analytics.empty')}</p>
            ) : (
              <ReactECharts option={requestsChartOption} style={{ height: 320 }} notMerge lazyUpdate />
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 text-base font-semibold">{t('apiKeys.analytics.charts.tokens')}</h3>
            {usageQuery.isLoading ? (
              <Loader />
            ) : usage.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('apiKeys.analytics.empty')}</p>
            ) : (
              <ReactECharts option={tokensChartOption} style={{ height: 320 }} notMerge lazyUpdate />
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('apiKeys.list.title')}</h2>
        <div className="grid gap-4">
          {keys.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('apiKeys.list.empty')}</p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-lg">{key.name}</h3>
                      {key.isWildcard && (
                        <span className="px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded">
                          {t('apiKeys.wildcard')}
                        </span>
                      )}
                      <span className={`px-2 py-1 text-xs rounded ${
                        key.enabled
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                      }`}>
                        {key.enabled ? t('apiKeys.status.enabled') : t('apiKeys.status.disabled')}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                        {key.isWildcard ? t('apiKeys.wildcard') : key.maskedKey ?? '********'}
                      </code>
                    </div>

                    {key.isWildcard ? (
                      <p className="mt-2 text-sm text-purple-700 dark:text-purple-200">
                        {t('apiKeys.wildcardHint')}
                      </p>
                    ) : key.description ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                        {key.description}
                      </p>
                    ) : null}

                    <div className="mt-3 grid gap-4 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
                      <div>
                        <span className="font-medium">{t('apiKeys.created')}:</span> {formatDate(key.createdAt)}
                      </div>
                      <div>
                        <span className="font-medium">{t('apiKeys.lastUsed')}:</span> {formatDate(key.lastUsedAt)}
                      </div>
                      <div>
                        <span className="font-medium">{t('apiKeys.requestCount')}:</span> {key.requestCount.toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">{t('apiKeys.totalTokens')}:</span>{' '}
                        {(key.totalInputTokens + key.totalOutputTokens).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleEnabled(key.id, key.enabled)}
                      className={`px-3 py-1 rounded text-sm ${
                        key.enabled ? 'bg-gray-200 dark:bg-gray-700' : 'bg-green-600 text-white'
                      }`}
                    >
                      {key.enabled ? t('apiKeys.actions.disable') : t('apiKeys.actions.enable')}
                    </button>
                    {!key.isWildcard && (
                      <button
                        onClick={() => handleDeleteKey(key.id)}
                        disabled={isDeleting === key.id}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {isCreateDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">{t('apiKeys.createNew')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('apiKeys.createDescription')}
            </p>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t('apiKeys.keyNamePlaceholder')}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 mb-4"
              onKeyPress={(e) => e.key === 'Enter' && handleCreateKey()}
            />
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('apiKeys.descriptionLabel')}
            </label>
            <textarea
              value={newKeyDescription}
              onChange={(e) => setNewKeyDescription(e.target.value)}
              placeholder={t('apiKeys.keyDescriptionPlaceholder')}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 mb-4 min-h-[96px]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsCreateDialogOpen(false)
                  setNewKeyName('')
                  setNewKeyDescription('')
                }}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t('common.actions.cancel')}
              </button>
              <button
                onClick={handleCreateKey}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('apiKeys.createAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {newlyCreatedKey && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center gap-2 mb-4">
              <Check className="w-6 h-6 text-green-600" />
              <h2 className="text-xl font-bold">{t('apiKeys.keyCreated')}</h2>
            </div>
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mb-4">
              {t('apiKeys.saveKeyWarning')}
            </p>
            <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded mb-4">
              <code className="text-sm break-all">{newlyCreatedKey.key}</code>
            </div>
            {newlyCreatedKey.description ? (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 whitespace-pre-wrap">
                {newlyCreatedKey.description}
              </p>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleCopyKey(newlyCreatedKey.key)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {t('common.actions.copy')}
              </button>
              <button
                onClick={() => setNewlyCreatedKey(null)}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
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
