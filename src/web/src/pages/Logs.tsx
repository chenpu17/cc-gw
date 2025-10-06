import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiError } from '@/services/api'
import type { LogDetail, LogListResponse, LogRecord } from '@/types/logs'
import type { ApiKeySummary } from '@/types/apiKeys'
import { Loader } from '@/components/Loader'

interface ProviderSummary {
  id: string
  label?: string
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

type StatusFilter = 'all' | 'success' | 'error'

type DateInput = string

function toTimestamp(value: DateInput, endOfDay = false): number | undefined {
  if (!value) return undefined
  const base = endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`
  const timestamp = Date.parse(base)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString()
}

function formatLatency(value: number | null | undefined, suffix: string): string {
  const formatted = formatNumber(value)
  return formatted === '-' ? '-' : `${formatted} ${suffix}`
}

function formatStreamLabel(stream: boolean): string {
  return stream ? 'true' : 'false'
}

function formatPayloadDisplay(value: string | null | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback
  }
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}

export default function LogsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [modelFilter, setModelFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [fromDate, setFromDate] = useState<DateInput>('')
  const [toDate, setToDate] = useState<DateInput>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedApiKeys, setSelectedApiKeys] = useState<number[]>([])

  useEffect(() => {
    setPage(1)
  }, [providerFilter, modelFilter, statusFilter, fromDate, toDate, pageSize, selectedApiKeys])

  const queryParams = useMemo(() => {
    const params: Record<string, unknown> = {
      limit: pageSize,
      offset: (page - 1) * pageSize
    }
    if (providerFilter !== 'all') {
      params.provider = providerFilter
    }
    if (modelFilter.trim().length > 0) {
      params.model = modelFilter.trim()
    }
    if (statusFilter !== 'all') {
      params.status = statusFilter
    }
    const fromTs = toTimestamp(fromDate)
    const toTs = toTimestamp(toDate, true)
    if (fromTs !== undefined) {
      params.from = fromTs
    }
    if (toTs !== undefined) {
      params.to = toTs
    }
    if (selectedApiKeys.length > 0) {
      params.apiKeys = selectedApiKeys.join(',')
    }
    return params
  }, [providerFilter, modelFilter, statusFilter, fromDate, toDate, page, pageSize, selectedApiKeys])

  const logsQuery = useApiQuery<LogListResponse, ApiError>(
    ['logs', queryParams],
    { url: '/api/logs', method: 'GET', params: queryParams }
  )

  const providersQuery = useApiQuery<ProviderSummary[], ApiError>(
    ['providers', 'all'],
    { url: '/api/providers', method: 'GET' }
  )

  const apiKeysQuery = useApiQuery<ApiKeySummary[], ApiError>(
    ['api-keys'],
    { url: '/api/keys', method: 'GET' }
  )

  useEffect(() => {
    if (logsQuery.isError && logsQuery.error) {
      pushToast({
        title: t('logs.toast.listError.title'),
        description: t('logs.toast.listError.desc', { message: logsQuery.error.message }),
        variant: 'error'
      })
    }
  }, [logsQuery.isError, logsQuery.error, pushToast, t])

  useEffect(() => {
    if (providersQuery.isError && providersQuery.error) {
      pushToast({
        title: t('logs.toast.providerError.title'),
        description: t('logs.toast.providerError.desc', { message: providersQuery.error.message }),
        variant: 'error'
      })
    }
  }, [providersQuery.isError, providersQuery.error, pushToast, t])

  const total = logsQuery.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0
  const items = logsQuery.data?.items ?? []

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [totalPages, page])

  const providerOptions = providersQuery.data ?? []
  const providerLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of providerOptions) {
      if (provider.id) {
        map.set(provider.id, provider.label ?? provider.id)
      }
    }
    return map
  }, [providerOptions])

  const apiKeys = apiKeysQuery.data ?? []
  const apiKeyMap = useMemo(() => {
    const map = new Map<number, ApiKeySummary>()
    for (const key of apiKeys) {
      map.set(key.id, key)
    }
    return map
  }, [apiKeys])

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('logs.filters.statusAll') },
      { value: 'success', label: t('logs.filters.statusSuccess') },
      { value: 'error', label: t('logs.filters.statusError') }
    ],
    [t]
  )

  const handleResetFilters = () => {
    setProviderFilter('all')
    setModelFilter('')
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
    setSelectedApiKeys([])
  }

  const handleOpenDetail = useCallback((id: number) => {
    setSelectedLogId(id)
    setIsDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setIsDetailOpen(false)
    setSelectedLogId(null)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t('logs.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('logs.description')}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            <span>{t('logs.summary.total', { value: total.toLocaleString() })}</span>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={() => logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              {logsQuery.isFetching ? t('common.actions.refreshing') : t('logs.actions.manualRefresh')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col text-sm">
            <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('logs.filters.provider')}
            </label>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
            >
              <option value="all">{t('logs.filters.statusAll')}</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label ?? provider.id}
                </option>
              ))}
            </select>
          </div>

          <ApiKeyFilter
            apiKeys={apiKeys}
            selected={selectedApiKeys}
            disabled={apiKeysQuery.isLoading}
            onChange={setSelectedApiKeys}
          />

          <div className="flex flex-col text-sm">
            <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('logs.filters.modelId')}
            </label>
            <input
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              placeholder={t('logs.filters.modelPlaceholder')}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
            />
          </div>

          <div className="flex flex-col text-sm">
            <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('logs.filters.status')}
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col text-sm">
            <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('logs.filters.startDate')}
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
            />
          </div>

          <div className="flex flex-col text-sm">
            <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('logs.filters.endDate')}
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
            />
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={handleResetFilters}
              className="rounded-md border border-slate-200 px-3 py-2 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {t('common.actions.reset')}
            </button>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <caption className="sr-only">{t('logs.title')}</caption>
            <thead className="bg-slate-100 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.time')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.provider')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.requestedModel')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.routedModel')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.apiKey')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.inputTokens')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.cachedTokens')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.outputTokens')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.stream')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.latency')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.ttft')}</th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.tpot')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.status')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.error')}</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">{t('logs.table.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {logsQuery.isPending ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-sm text-slate-400">
                    {t('logs.table.loading')}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-sm text-slate-400">
                    {t('logs.table.empty')}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <LogRow
                    key={item.id}
                    record={item}
                    providerLabelMap={providerLabelMap}
                    apiKeyMap={apiKeyMap}
                    onSelect={handleOpenDetail}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span>{t('logs.table.pagination.perPage')}</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>{t('logs.table.pagination.unit')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-200 px-3 py-1 transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
            >
              {t('logs.table.pagination.previous')}
            </button>
            <span>
              {t('logs.table.pagination.pageLabel', {
                page: totalPages === 0 ? 0 : page,
                total: totalPages
              })}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => (totalPages === 0 ? prev : Math.min(prev + 1, totalPages)))}
              disabled={totalPages === 0 || page >= totalPages}
              className="rounded-md border border-slate-200 px-3 py-1 transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
            >
              {t('logs.table.pagination.next')}
            </button>
          </div>
        </div>
      </section>

      <LogDetailsDrawer
        open={isDetailOpen}
        logId={selectedLogId}
        onClose={handleCloseDetail}
        providerLabelMap={providerLabelMap}
        apiKeyMap={apiKeyMap}
      />
    </div>
  )
}

function LogRow({
  record,
  providerLabelMap,
  apiKeyMap,
  onSelect
}: {
  record: LogRecord
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  onSelect: (id: number) => void
}) {
  const { t } = useTranslation()
  const providerLabel = providerLabelMap.get(record.provider) ?? record.provider
  const isError = Boolean(record.error)
  const requestedModel = record.client_model ?? t('logs.table.requestedModelFallback')
  const apiKeyMeta = record.api_key_id != null ? apiKeyMap.get(record.api_key_id) : undefined
  const apiKeyLabel = (() => {
    if (record.api_key_id == null) {
      return t('logs.table.apiKeyUnknown')
    }
    if (apiKeyMeta?.isWildcard) {
      return t('apiKeys.wildcard')
    }
    if (apiKeyMeta?.name) {
      return apiKeyMeta.name
    }
    if (record.api_key_name) {
      return record.api_key_name
    }
    return t('logs.table.apiKeyUnknown')
  })()

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(record.timestamp)}</td>
      <td className="px-4 py-2">{providerLabel}</td>
      <td className="px-4 py-2">{requestedModel}</td>
      <td className="px-4 py-2">{record.model}</td>
      <td className="px-4 py-2">
        <span className="block truncate" title={apiKeyLabel}>
          {apiKeyLabel}
        </span>
      </td>
      <td className="px-4 py-2 text-right">{formatNumber(record.input_tokens)}</td>
      <td className="px-4 py-2 text-right">{formatNumber(record.cached_tokens)}</td>
      <td className="px-4 py-2 text-right">{formatNumber(record.output_tokens)}</td>
      <td className="px-4 py-2 text-right">{formatStreamLabel(record.stream)}</td>
      <td className="px-4 py-2 text-right">{formatLatency(record.latency_ms, t('common.units.ms'))}</td>
      <td className="px-4 py-2 text-right">{formatLatency(record.ttft_ms, t('common.units.ms'))}</td>
      <td className="px-4 py-2 text-right">{formatLatency(record.tpot_ms, t('common.units.msPerToken'))}</td>
      <td className="px-4 py-2">
        <StatusBadge success={!isError} statusCode={record.status_code} />
      </td>
      <td className="max-w-xs px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="block truncate" title={record.error ?? ''}>
          {record.error ? record.error : '-'}
        </span>
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={() => onSelect(record.id)}
          aria-haspopup="dialog"
          className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {t('logs.actions.detail')}
        </button>
      </td>
    </tr>
  )
}

function StatusBadge({ success, statusCode }: { success: boolean; statusCode: number | null }) {
  const { t } = useTranslation()
  const baseClass = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium'
  const style = success
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
  return (
    <span className={`${baseClass} ${style}`}>
      {success ? t('common.status.success') : t('common.status.error')}
      {statusCode ? ` · ${statusCode}` : ''}
    </span>
  )
}

function LogDetailsDrawer({
  open,
  logId,
  onClose,
  providerLabelMap,
  apiKeyMap
}: {
  open: boolean
  logId: number | null
  onClose: () => void
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
}) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const logDetailQuery = useApiQuery<LogDetail, ApiError>(
    ['log-detail', logId],
    { url: `/api/logs/${logId}`, method: 'GET' },
    {
      enabled: open && logId !== null,
      staleTime: 30_000
    }
  )

  useEffect(() => {
    if (logDetailQuery.isError && logDetailQuery.error) {
      pushToast({
        title: t('logs.detail.loadError'),
        description: logDetailQuery.error.message,
        variant: 'error'
      })
    }
  }, [logDetailQuery.isError, logDetailQuery.error, pushToast, t])

  useEffect(() => {
    if (!open) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (open && closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [open, logId])

  const handleCopy = useCallback(
    async (label: string, content: string | null | undefined, successKey: string) => {
      if (!content) {
        pushToast({ title: t('logs.detail.copy.empty', { label: label }), variant: 'info' })
        return
      }
      try {
        await navigator.clipboard.writeText(content)
        pushToast({ title: t(successKey), variant: 'success' })
      } catch (error) {
        pushToast({
          title: t('logs.detail.copy.failure'),
          description: error instanceof Error ? error.message : t('logs.detail.copy.failureFallback'),
          variant: 'error'
        })
      }
    },
    [pushToast, t]
  )

  if (!open) {
    return null
  }

  const record = logDetailQuery.data
  const providerLabel = record ? providerLabelMap.get(record.provider) ?? record.provider : ''
  const apiKeyMeta = record && record.api_key_id != null ? apiKeyMap.get(record.api_key_id) : undefined

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-detail-title"
        aria-describedby="log-detail-content"
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl transition-transform dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="log-detail-title" className="text-lg font-semibold">
              {t('logs.detail.title')}
            </h2>
            {record ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.id', { id: record.id })}</p>
            ) : null}
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t('common.actions.close')}
          </button>
        </header>
        <div id="log-detail-content" className="flex-1 overflow-y-auto">
          {logDetailQuery.isPending ? (
            <Loader />
          ) : !record ? (
            <div className="flex h-full items-center justify.center p-8 text-sm text-slate-500 dark:text-slate-400">
              {t('logs.detail.loadError')}
            </div>
          ) : (
            <div className="flex flex-col gap-6 px-6 py-5 text-sm">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('logs.detail.infoSection')}
                </h3>
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-100">
                    {t('logs.detail.summary.route', {
                      from: record.client_model ?? t('logs.detail.info.noRequestedModel'),
                      to: record.model
                    })}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('logs.detail.summary.latency', {
                      value: formatLatency(record.latency_ms, t('common.units.ms'))
                    })}
                  </span>
                  {record.ttft_ms !== null ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t('logs.detail.summary.ttft', {
                        value: formatLatency(record.ttft_ms, t('common.units.ms'))
                      })}
                    </span>
                  ) : null}
                  {record.tpot_ms !== null ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t('logs.detail.summary.tpot', {
                        value: formatLatency(record.tpot_ms, t('common.units.msPerToken'))
                      })}
                    </span>
                  ) : null}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('logs.detail.summary.stream', { value: formatStreamLabel(record.stream) })}
                  </span>
                  <StatusBadge success={!record.error} statusCode={record.status_code} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.time')}</dt>
                    <dd className="font-medium">{formatDateTime(record.timestamp)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.sessionId')}</dt>
                    <dd className="font-medium">{record.session_id ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.provider')}</dt>
                    <dd className="font-medium">{providerLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.requestedModel')}</dt>
                    <dd className="font-medium">{record.client_model ?? t('logs.detail.info.noRequestedModel')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.model')}</dt>
                    <dd className="font-medium">{record.model}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.stream')}</dt>
                    <dd className="font-medium">{formatStreamLabel(record.stream)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.inputTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.input_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.cachedTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.cached_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.outputTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.output_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.ttft')}</dt>
                    <dd className="font-medium">{formatLatency(record.ttft_ms, t('common.units.ms'))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.tpot')}</dt>
                    <dd className="font-medium">{formatLatency(record.tpot_ms, t('common.units.msPerToken'))}</dd>
                  </div>
                </dl>
                {record.error ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.info.error')}</p>
                    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700 dark:border-red-800/70 dark:bg-red-900/40 dark:text-red-200">
                      {record.error}
                    </p>
                  </div>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('logs.detail.apiKey.title')}
                </h3>
                <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.apiKey.name')}</dt>
                    <dd className="font-medium">
                      {record.api_key_id == null && !record.api_key_name
                        ? t('logs.detail.apiKey.missing')
                        : apiKeyMeta?.isWildcard
                          ? t('apiKeys.wildcard')
                          : apiKeyMeta?.name ?? record.api_key_name ?? t('logs.detail.apiKey.missing')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.apiKey.identifier')}</dt>
                    <dd className="font-medium">{record.api_key_id ?? t('common.noData')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.apiKey.masked')}</dt>
                    <dd className="font-medium">
                      {apiKeyMeta?.isWildcard
                        ? t('apiKeys.wildcard')
                        : apiKeyMeta?.maskedKey ?? record.api_key_name ?? t('logs.detail.apiKey.maskedUnavailable')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{t('logs.detail.apiKey.lastUsed')}</dt>
                    <dd className="font-medium">
                      {apiKeyMeta?.lastUsedAt ? new Date(apiKeyMeta.lastUsedAt).toLocaleString() : t('common.noData')}
                    </dd>
                  </div>
                </dl>
                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {t('logs.detail.apiKey.raw')}
                    </p>
                    <p className="mt-1 text-xs">
                      {record.api_key_value ? record.api_key_value : t('logs.detail.apiKey.rawUnavailable')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!record.api_key_value}
                    onClick={() =>
                      handleCopy(
                        t('logs.detail.apiKey.raw'),
                        record.api_key_value,
                        'logs.detail.copy.keySuccess'
                      )
                    }
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {t('common.actions.copy')}
                  </button>
                </div>
              </section>

              <section className="space-y-2">
                <header className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('logs.detail.payload.request')}
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        t('logs.detail.payload.request'),
                        record.payload?.prompt,
                        'logs.detail.copy.requestSuccess'
                      )
                    }
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {t('common.actions.copy')}
                  </button>
                </header>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200">
                  {formatPayloadDisplay(record.payload?.prompt, t('logs.detail.payload.emptyRequest'))}
                </pre>
              </section>

              <section className="space-y-2">
                <header className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t('logs.detail.payload.response')}
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        t('logs.detail.payload.response'),
                        record.payload?.response,
                        'logs.detail.copy.responseSuccess'
                      )
                    }
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {t('common.actions.copy')}
                  </button>
                </header>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200">
                  {formatPayloadDisplay(record.payload?.response, t('logs.detail.payload.emptyResponse'))}
                </pre>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function ApiKeyFilter({
  apiKeys,
  selected,
  onChange,
  disabled
}: {
  apiKeys: ApiKeySummary[]
  selected: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handle = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handle)
    return () => window.removeEventListener('mousedown', handle)
  }, [open])

  const selectedLabels = useMemo(() => {
    if (selected.length === 0) return []
    const mapping = new Map<number, ApiKeySummary>()
    for (const key of apiKeys) {
      mapping.set(key.id, key)
    }
    return selected
      .map((id) => {
        const key = mapping.get(id)
        if (!key) return null
        if (key.isWildcard) {
          return t('apiKeys.wildcard')
        }
        return key.name
      })
      .filter((value): value is string => Boolean(value))
  }, [apiKeys, selected, t])

  const summaryText = selected.length === 0
    ? t('logs.filters.apiKeyAll')
    : t('logs.filters.apiKeySelected', { count: selected.length })

  const handleToggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="relative flex flex-col text-sm" ref={containerRef}>
      <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t('logs.filters.apiKey')}
      </label>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled || apiKeys.length === 0}
        title={t('logs.filters.apiKeyHint')}
        className={`flex w-48 items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-blue-400/40 ${
          selected.length > 0 ? 'border-blue-500 dark:border-blue-500' : 'border-slate-200'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">
          {summaryText}
          {selectedLabels.length > 0 && (
            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
              {selectedLabels.join(', ')}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 text-slate-500 transition-transform dark:text-slate-300 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
            <span>{summaryText}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
            >
              {t('common.actions.reset')}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto px-2 py-2">
            {apiKeys.map((key) => {
              const label = key.isWildcard ? t('apiKeys.wildcard') : key.name
              const checked = selected.includes(key.id)
              return (
                <label
                  key={key.id}
                  className={`flex items-center gap-2 rounded px-2 py-2 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800 ${checked ? 'bg-slate-100 dark:bg-slate-800/70' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => handleToggle(key.id)}
                  />
                  <span className="truncate">{label}</span>
                </label>
              )
            })}
            {apiKeys.length === 0 && (
              <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">
                {t('logs.filters.apiKeyAll')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
