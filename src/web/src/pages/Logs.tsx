import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { FileText, RefreshCw, Download, X } from 'lucide-react'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { apiClient, type ApiError, toApiError } from '@/services/api'
import type { LogDetail, LogListResponse, LogRecord } from '@/types/logs'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

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
  const [endpointFilter, setEndpointFilter] = useState<string>('all')
  const [modelFilter, setModelFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [fromDate, setFromDate] = useState<DateInput>('')
  const [toDate, setToDate] = useState<DateInput>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedApiKeys, setSelectedApiKeys] = useState<number[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [providerFilter, endpointFilter, modelFilter, statusFilter, fromDate, toDate, pageSize, selectedApiKeys])

  const queryParams = useMemo(() => {
    const params: Record<string, unknown> = {
      limit: pageSize,
      offset: (page - 1) * pageSize
    }
    if (providerFilter !== 'all') {
      params.provider = providerFilter
    }
    if (endpointFilter !== 'all') {
      params.endpoint = endpointFilter
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
  }, [providerFilter, endpointFilter, modelFilter, statusFilter, fromDate, toDate, page, pageSize, selectedApiKeys])

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

  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    ['custom-endpoints'],
    { url: '/api/custom-endpoints', method: 'GET' }
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

  const handleResetFilters = () => {
    setProviderFilter('all')
    setModelFilter('')
    setEndpointFilter('all')
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
    setSelectedApiKeys([])
  }

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const exportLimit = total > 0 ? Math.min(total, 5000) : 1000
      const payload: Record<string, unknown> = { ...queryParams, limit: exportLimit, offset: 0 }
      const response = await apiClient.post('/api/logs/export', payload, {
        responseType: 'blob'
      })
      const blob = new Blob([response.data], { type: 'application/zip' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cc-gw-logs-${timestamp}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      pushToast({
        title: t('logs.toast.exportSuccess.title'),
        description: t('logs.toast.exportSuccess.desc'),
        variant: 'success'
      })
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('logs.toast.exportError.title'),
        description: t('logs.toast.exportError.desc', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setExporting(false)
    }
  }, [exporting, pushToast, queryParams, t, total])

  const handleOpenDetail = useCallback((id: number) => {
    setSelectedLogId(id)
    setIsDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setIsDetailOpen(false)
    setSelectedLogId(null)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        title={t('logs.title')}
        description={t('logs.description')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleExport} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? t('common.actions.loading') : t('logs.actions.export')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('logs.summary.total', { value: total.toLocaleString() })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', logsQuery.isFetching && 'animate-spin')} />
              {logsQuery.isFetching ? t('common.actions.refreshing') : t('logs.actions.manualRefresh')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{t('logs.filtersTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('logs.filtersDescription')}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetFilters}>
              {t('common.actions.reset')}
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>{t('logs.filters.provider')}</Label>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.providerAll')}</SelectItem>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label ?? provider.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.endpoint')}</Label>
              <Select value={endpointFilter} onValueChange={setEndpointFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.endpointAll')}</SelectItem>
                  <SelectItem value="anthropic">{t('logs.filters.endpointAnthropic')}</SelectItem>
                  <SelectItem value="openai">{t('logs.filters.endpointOpenAI')}</SelectItem>
                  {customEndpointsQuery.data?.endpoints?.map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      {ep.label || ep.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ApiKeyFilter
              className="md:col-span-2"
              apiKeys={apiKeys}
              selected={selectedApiKeys}
              disabled={apiKeysQuery.isLoading}
              onChange={setSelectedApiKeys}
            />

            <div className="space-y-2">
              <Label>{t('logs.filters.modelId')}</Label>
              <Input
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                placeholder={t('logs.filters.modelPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.status')}</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.statusAll')}</SelectItem>
                  <SelectItem value="success">{t('logs.filters.statusSuccess')}</SelectItem>
                  <SelectItem value="error">{t('logs.filters.statusError')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.startDate')}</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.endDate')}</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.time')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.endpoint')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.provider')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.requestedModel')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.routedModel')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.apiKey')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.inputTokens')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.cacheReadTokens')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.cacheCreationTokens')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.outputTokens')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.latency')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.ttft')}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">{t('logs.table.columns.tpot')}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t('logs.table.columns.status')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t('logs.table.columns.error')}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t('logs.table.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logsQuery.isPending ? (
                  <tr>
                    <td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {t('logs.table.loading')}
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {t('logs.table.empty')}
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => (
                    <LogRow
                      key={item.id}
                      record={item}
                      providerLabelMap={providerLabelMap}
                      apiKeyMap={apiKeyMap}
                      onSelect={handleOpenDetail}
                      isEven={index % 2 === 0}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('logs.table.pagination.perPage')}</span>
              <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={page <= 1}
              >
                {t('logs.table.pagination.previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('logs.table.pagination.pageLabel', {
                  page: totalPages === 0 ? 0 : page,
                  total: totalPages
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => (totalPages === 0 ? prev : Math.min(prev + 1, totalPages)))}
                disabled={totalPages === 0 || page >= totalPages}
              >
                {t('logs.table.pagination.next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
  onSelect,
  isEven
}: {
  record: LogRecord
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  onSelect: (id: number) => void
  isEven: boolean
}) {
  const { t } = useTranslation()
  const providerLabel = providerLabelMap.get(record.provider) ?? record.provider
  const endpointLabel = record.endpoint || '-'
  const isError = Boolean(record.error)
  const statusCode = record.status_code
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
    <tr className={cn('transition-colors', isEven ? 'bg-muted/30' : '', 'hover:bg-muted/50')}>
      <td className="px-3 py-2 text-xs">{formatDateTime(record.timestamp)}</td>
      <td className="px-3 py-2 text-xs">{endpointLabel}</td>
      <td className="px-3 py-2 text-xs">
        <div className="max-w-[100px] truncate" title={providerLabel}>{providerLabel}</div>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <div className="max-w-[120px] truncate" title={requestedModel}>{requestedModel}</div>
      </td>
      <td className="px-3 py-2 text-xs">
        <div className="max-w-[120px] truncate" title={record.model}>{record.model}</div>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <div className="max-w-[90px] truncate" title={apiKeyLabel}>{apiKeyLabel}</div>
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatNumber(record.input_tokens)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatNumber(record.cache_read_tokens)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatNumber(record.cache_creation_tokens)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatNumber(record.output_tokens)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatLatency(record.latency_ms, 'ms')}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatLatency(record.ttft_ms, 'ms')}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{formatLatency(record.tpot_ms, 'ms/tk')}</td>
      <td className="px-3 py-2 text-center">
        <Badge variant={isError ? 'destructive' : 'default'} className="text-xs">
          {statusCode ?? (isError ? 500 : 200)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <div className="max-w-[100px] truncate" title={record.error ?? ''}>
          {record.error ? record.error : '-'}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <Button variant="outline" size="sm" onClick={() => onSelect(record.id)}>
          {t('logs.actions.detail')}
        </Button>
      </td>
    </tr>
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
        await copyToClipboard(content)
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

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        className="flex h-full w-full max-w-xl flex-col border-l bg-card shadow-xl"
      >
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{t('logs.detail.title')}</h2>
            {record && (
              <p className="text-xs text-muted-foreground">{t('logs.detail.id', { id: record.id })}</p>
            )}
          </div>
          <Button ref={closeButtonRef} variant="outline" size="sm" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            {t('common.actions.close')}
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {logDetailQuery.isPending ? (
            <Loader />
          ) : !record ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              {t('logs.detail.loadError')}
            </div>
          ) : (
            <div className="flex flex-col gap-6 px-6 py-5 text-sm">
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('logs.detail.infoSection')}
                </h3>
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-xs">
                  <span className="font-medium">
                    {t('logs.detail.summary.route', {
                      from: record.client_model ?? t('logs.detail.info.noRequestedModel'),
                      to: record.model
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {t('logs.detail.summary.latency', {
                      value: formatLatency(record.latency_ms, t('common.units.ms'))
                    })}
                  </span>
                  {record.ttft_ms !== null && (
                    <span className="text-muted-foreground">
                      TTFT: {formatLatency(record.ttft_ms, t('common.units.ms'))}
                    </span>
                  )}
                  <Badge variant={record.error ? 'destructive' : 'default'}>
                    {(record.status_code ?? (record.error ? 500 : 200)).toString()}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.time')}</dt>
                    <dd className="font-medium">{formatDateTime(record.timestamp)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.sessionId')}</dt>
                    <dd className="font-medium">{record.session_id ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.endpoint')}</dt>
                    <dd className="font-medium">{record.endpoint || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.provider')}</dt>
                    <dd className="font-medium">{providerLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.requestedModel')}</dt>
                    <dd className="font-medium">{record.client_model ?? t('logs.detail.info.noRequestedModel')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.model')}</dt>
                    <dd className="font-medium">{record.model}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.stream')}</dt>
                    <dd className="font-medium">{formatStreamLabel(record.stream)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.inputTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.input_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.cacheReadTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.cache_read_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.cacheCreationTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.cache_creation_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.outputTokens')}</dt>
                    <dd className="font-medium">{formatNumber(record.output_tokens)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.ttft')}</dt>
                    <dd className="font-medium">{formatLatency(record.ttft_ms, t('common.units.ms'))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.info.tpot')}</dt>
                    <dd className="font-medium">{formatLatency(record.tpot_ms, t('common.units.msPerToken'))}</dd>
                  </div>
                </dl>
                {record.error && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('logs.detail.info.error')}</p>
                    <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                      {record.error}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('logs.detail.apiKey.title')}
                </h3>
                <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.apiKey.name')}</dt>
                    <dd className="font-medium">
                      {record.api_key_id == null && !record.api_key_name
                        ? t('logs.detail.apiKey.missing')
                        : apiKeyMeta?.isWildcard
                          ? t('apiKeys.wildcard')
                          : apiKeyMeta?.name ?? record.api_key_name ?? t('logs.detail.apiKey.missing')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.apiKey.identifier')}</dt>
                    <dd className="font-medium">{record.api_key_id ?? t('common.noData')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.apiKey.masked')}</dt>
                    <dd className="font-medium">
                      {apiKeyMeta?.isWildcard
                        ? t('apiKeys.wildcard')
                        : apiKeyMeta?.maskedKey ?? record.api_key_name ?? t('logs.detail.apiKey.maskedUnavailable')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('logs.detail.apiKey.lastUsed')}</dt>
                    <dd className="font-medium">
                      {apiKeyMeta?.lastUsedAt ? new Date(apiKeyMeta.lastUsedAt).toLocaleString() : t('common.noData')}
                    </dd>
                  </div>
                </dl>
                <div className="rounded-md border bg-muted p-3 text-xs">
                  <p className="font-medium">{t('logs.detail.apiKey.rawMasked')}</p>
                  <p className="mt-1 break-all font-mono">
                    {record.api_key_value_available
                      ? record.api_key_value_masked ?? t('logs.detail.apiKey.rawUnavailable')
                      : t('logs.detail.apiKey.rawUnavailable')}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t('logs.detail.apiKey.rawMaskedHint')}
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('logs.detail.payload.request')}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        t('logs.detail.payload.request'),
                        record.payload?.prompt,
                        'logs.detail.copy.requestSuccess'
                      )
                    }
                  >
                    {t('common.actions.copy')}
                  </Button>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">
                  {formatPayloadDisplay(record.payload?.prompt, t('logs.detail.payload.emptyRequest'))}
                </pre>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('logs.detail.payload.response')}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        t('logs.detail.payload.response'),
                        record.payload?.response,
                        'logs.detail.copy.responseSuccess'
                      )
                    }
                  >
                    {t('common.actions.copy')}
                  </Button>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">
                  {formatPayloadDisplay(record.payload?.response, t('logs.detail.payload.emptyResponse'))}
                </pre>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  )
}

function ApiKeyFilter({
  apiKeys,
  selected,
  onChange,
  disabled,
  className
}: {
  apiKeys: ApiKeySummary[]
  selected: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
  className?: string
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
    <div className={cn('relative space-y-2', className)} ref={containerRef}>
      <Label>{t('logs.filters.apiKey')}</Label>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled || apiKeys.length === 0}
        title={t('logs.filters.apiKeyHint')}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          selected.length > 0 && 'border-primary',
          open && 'ring-2 ring-ring ring-offset-2'
        )}
      >
        <span className="truncate">
          {summaryText}
          {selectedLabels.length > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              {selectedLabels.join(', ')}
            </span>
          )}
        </span>
        <svg
          className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border bg-popover p-2 shadow-lg">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
            <span>{summaryText}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-primary hover:underline disabled:opacity-40"
            >
              {t('common.actions.reset')}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto py-2">
            {apiKeys.map((key) => {
              const label = key.isWildcard ? t('apiKeys.wildcard') : key.name
              const checked = selected.includes(key.id)
              return (
                <label
                  key={key.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition hover:bg-muted',
                    checked && 'bg-primary/10 text-primary'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border"
                    checked={checked}
                    onChange={() => handleToggle(key.id)}
                  />
                  <span className="truncate">{label}</span>
                </label>
              )
            })}
            {apiKeys.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('logs.filters.apiKeyAll')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
