import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, TrendingUp, Activity, Timer } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { apiClient, type ApiError, toApiError } from '@/services/api'
import type { LogListResponse, LogRecord } from '@/types/logs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

interface OverviewStats {
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    avgLatencyMs: number
  }
  today: {
    requests: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    avgLatencyMs: number
  }
}

interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  avgLatencyMs: number
}

interface ModelUsageMetric {
  model: string
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
  avgTtftMs: number | null
  avgTpotMs: number | null
}

interface ServiceStatus {
  port: number
  host?: string
  providers: number
  activeRequests?: number
}

interface DatabaseInfo {
  pageCount: number
  pageSize: number
  sizeBytes: number
  freelistPages?: number
  fileSizeBytes?: number
  walSizeBytes?: number
  totalBytes?: number
  memoryRssBytes?: number
  memoryHeapBytes?: number
  memoryExternalBytes?: number
}

function formatLatencyValue(
  value: number | null | undefined,
  suffix: string,
  options?: Intl.NumberFormatOptions
): string {
  if (value === null || value === undefined) {
    return '-'
  }
  return `${value.toLocaleString(undefined, options)} ${suffix}`
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-'
  }
  if (value < 1024) {
    return `${value} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let bytes = value / 1024
  let unitIndex = 0
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex += 1
  }
  return `${bytes.toFixed(bytes >= 100 ? 0 : bytes >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [endpointFilter, setEndpointFilter] = useState<'all' | 'anthropic' | 'openai'>('all')
  const [compacting, setCompacting] = useState(false)
  const endpointParam = endpointFilter === 'all' ? undefined : endpointFilter

  const overviewQuery = useApiQuery<OverviewStats, ApiError>(
    ['stats', 'overview', endpointFilter],
    {
      url: '/api/stats/overview',
      method: 'GET',
      params: endpointParam ? { endpoint: endpointParam } : undefined
    }
  )

  const dailyQuery = useApiQuery<DailyMetric[], ApiError>(
    ['stats', 'daily', 14, endpointFilter],
    {
      url: '/api/stats/daily',
      method: 'GET',
      params: {
        days: 14,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    }
  )

  const modelUsageQuery = useApiQuery<ModelUsageMetric[], ApiError>(
    ['stats', 'model', 7, 6, endpointFilter],
    {
      url: '/api/stats/model',
      method: 'GET',
      params: {
        days: 7,
        limit: 6,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    }
  )

  const statusQuery = useApiQuery<ServiceStatus, ApiError>(
    ['status'],
    { url: '/api/status', method: 'GET' }
  )

  const dbInfoQuery = useApiQuery<DatabaseInfo, ApiError>(
    ['db', 'info'],
    { url: '/api/db/info', method: 'GET' }
  )
  const refetchDbInfo = dbInfoQuery.refetch ?? (async () => undefined)

  const latestLogsQuery = useApiQuery<LogListResponse, ApiError>(
    ['logs', 'recent', endpointFilter],
    {
      url: '/api/logs',
      method: 'GET',
      params: {
        limit: 5,
        ...(endpointParam ? { endpoint: endpointParam } : {})
      }
    },
    { refetchInterval: 30_000 }
  )

  useEffect(() => {
    if (overviewQuery.isError && overviewQuery.error) {
      pushToast({
        title: t('dashboard.toast.overviewError'),
        description: overviewQuery.error.message,
        variant: 'error'
      })
    }
  }, [overviewQuery.isError, overviewQuery.error, pushToast, t])

  useEffect(() => {
    if (dailyQuery.isError && dailyQuery.error) {
      pushToast({ title: t('dashboard.toast.dailyError'), description: dailyQuery.error.message, variant: 'error' })
    }
  }, [dailyQuery.isError, dailyQuery.error, pushToast, t])

  useEffect(() => {
    if (modelUsageQuery.isError && modelUsageQuery.error) {
      pushToast({ title: t('dashboard.toast.modelError'), description: modelUsageQuery.error.message, variant: 'error' })
    }
  }, [modelUsageQuery.isError, modelUsageQuery.error, pushToast, t])

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({ title: t('dashboard.toast.statusError'), description: statusQuery.error.message, variant: 'error' })
    }
  }, [statusQuery.isError, statusQuery.error, pushToast, t])

  useEffect(() => {
    if (dbInfoQuery.isError && dbInfoQuery.error) {
      pushToast({ title: t('dashboard.toast.dbError'), description: dbInfoQuery.error.message, variant: 'error' })
    }
  }, [dbInfoQuery.isError, dbInfoQuery.error, pushToast, t])

  const handleCompact = useCallback(async () => {
    if (compacting) return
    setCompacting(true)
    try {
      await apiClient.post('/api/db/compact')
      await refetchDbInfo()
      pushToast({
        title: t('dashboard.toast.compactSuccess.title'),
        description: t('dashboard.toast.compactSuccess.desc'),
        variant: 'success'
      })
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('dashboard.toast.compactError.title'),
        description: apiError.message,
        variant: 'error'
      })
    } finally {
      setCompacting(false)
    }
  }, [compacting, pushToast, refetchDbInfo, t])

  useEffect(() => {
    if (latestLogsQuery.isError && latestLogsQuery.error) {
      pushToast({ title: t('dashboard.toast.recentError'), description: latestLogsQuery.error.message, variant: 'error' })
    }
  }, [latestLogsQuery.isError, latestLogsQuery.error, pushToast, t])

  const overview = overviewQuery.data
  const daily = dailyQuery.data ?? []
  const models = modelUsageQuery.data ?? []
  const status = statusQuery.data
  const dbInfo = dbInfoQuery.data
  const recentLogs = latestLogsQuery.data?.items ?? []
  const dbSizeDisplay = dbInfo ? formatBytes(dbInfo.totalBytes ?? dbInfo.sizeBytes) : '-'
  const memoryDisplay = dbInfo ? formatBytes(dbInfo.memoryRssBytes ?? 0) : '-'

  const dailyOption = useMemo<EChartsOption>(() => {
    const dates = daily.map((item) => item.date)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')
    const cacheReadLabel = t('dashboard.charts.lineCacheRead')
    const cacheCreationLabel = t('dashboard.charts.lineCacheCreation')
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: [requestLabel, inputLabel, outputLabel, cacheReadLabel, cacheCreationLabel]
      },
      grid: { left: 60, right: 40, top: 60, bottom: 60 },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value' },
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: 'hsl(var(--primary))', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: inputLabel,
          type: 'line',
          data: daily.map((item) => item.inputTokens),
          smooth: true,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2 }
        },
        {
          name: outputLabel,
          type: 'line',
          data: daily.map((item) => item.outputTokens),
          smooth: true,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 2 }
        },
        {
          name: cacheReadLabel,
          type: 'line',
          data: daily.map((item) => item.cacheReadTokens),
          smooth: true,
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { width: 2 }
        },
        {
          name: cacheCreationLabel,
          type: 'line',
          data: daily.map((item) => item.cacheCreationTokens),
          smooth: true,
          itemStyle: { color: '#ec4899' },
          lineStyle: { width: 2 }
        }
      ]
    }
  }, [daily, t])

  const modelRequestsOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: [requestLabel, inputLabel, outputLabel] },
      grid: { left: 80, right: 60, top: 60, bottom: 100 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { rotate: 30 }
      },
      yAxis: [
        { type: 'value', name: requestLabel },
        { type: 'value', name: t('dashboard.charts.axisTokens'), position: 'right' }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.inputTokens ?? 0),
          itemStyle: { color: '#10b981' }
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.outputTokens ?? 0),
          itemStyle: { color: '#f59e0b' }
        }
      ]
    }
  }, [models, t])

  const ttftOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const ttftLabel = t('dashboard.charts.ttftLabel')

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 30 } },
      yAxis: { type: 'value', name: t('dashboard.charts.ttftAxis') },
      series: [
        {
          name: ttftLabel,
          type: 'bar',
          data: models.map((item) => item.avgTtftMs ?? 0),
          itemStyle: { color: 'hsl(var(--primary))', borderRadius: [4, 4, 0, 0] }
        }
      ]
    }
  }, [models, t])

  const tpotOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const tpotLabel = t('dashboard.charts.tpotLabel')

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 30 } },
      yAxis: { type: 'value', name: t('dashboard.charts.tpotAxis') },
      series: [
        {
          name: tpotLabel,
          type: 'bar',
          data: models.map((item) => item.avgTpotMs ?? 0),
          itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }
        }
      ]
    }
  }, [models, t])

  if (overviewQuery.isPending || statusQuery.isPending || dbInfoQuery.isPending) {
    return <Loader />
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        title={t('nav.dashboard')}
        description={t('dashboard.description')}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t('dashboard.filters.endpoint')}
            </span>
            <Select
              value={endpointFilter}
              onValueChange={(value) => setEndpointFilter(value as 'all' | 'anthropic' | 'openai')}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('dashboard.filters.endpointAll')}</SelectItem>
                <SelectItem value="anthropic">{t('dashboard.filters.endpointAnthropic')}</SelectItem>
                <SelectItem value="openai">{t('dashboard.filters.endpointOpenAI')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Service Status */}
      {status && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <Badge variant="default" className="bg-emerald-500">
              {t('dashboard.status.listening', {
                host: status.host ?? '0.0.0.0',
                port: status.port
              })}
            </Badge>
            <Badge variant="secondary">
              {t('dashboard.status.providers', { value: status.providers.toLocaleString() })}
            </Badge>
            <Badge variant="secondary">
              {t('dashboard.status.todayRequests', {
                value: (overview?.today.requests ?? 0).toLocaleString()
              })}
            </Badge>
            <Badge variant="outline">
              {t('dashboard.status.active', {
                value: (status.activeRequests ?? 0).toLocaleString()
              })}
            </Badge>
            <Badge variant="outline">
              {t('dashboard.status.dbSize', { value: dbSizeDisplay })}
            </Badge>
            <Badge variant="outline">
              {t('dashboard.status.memory', { value: memoryDisplay })}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCompact}
              disabled={compacting}
            >
              {compacting ? t('dashboard.actions.compacting') : t('dashboard.actions.compact')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          title={t('dashboard.cards.todayRequests')}
          value={overview?.today.requests ?? 0}
          suffix={t('common.units.request')}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          title={t('dashboard.cards.todayInput')}
          value={overview?.today.inputTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          title={t('dashboard.cards.todayCacheRead')}
          value={overview?.today.cacheReadTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          title={t('dashboard.cards.todayCacheCreation')}
          value={overview?.today.cacheCreationTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          title={t('dashboard.cards.todayOutput')}
          value={overview?.today.outputTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<Timer className="h-4 w-4" />}
          title={t('dashboard.cards.avgLatency')}
          value={overview?.today.avgLatencyMs ?? 0}
          suffix={t('common.units.ms')}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.requestsTitle')}
          description={t('dashboard.charts.requestsDesc')}
          loading={dailyQuery.isPending}
          option={dailyOption}
          empty={!daily.length}
          emptyText={t('dashboard.charts.empty')}
        />
        <ChartCard
          title={t('dashboard.charts.modelTitle')}
          description={t('dashboard.charts.modelDesc')}
          loading={modelUsageQuery.isPending}
          option={modelRequestsOption}
          empty={!models.length}
          emptyText={t('dashboard.charts.empty')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.ttftTitle')}
          description={t('dashboard.charts.ttftDesc')}
          loading={modelUsageQuery.isPending}
          option={ttftOption}
          empty={!models.some((metric) => metric.avgTtftMs != null && metric.avgTtftMs > 0)}
          emptyText={t('dashboard.charts.ttftEmpty')}
        />
        <ChartCard
          title={t('dashboard.charts.tpotTitle')}
          description={t('dashboard.charts.tpotDesc')}
          loading={modelUsageQuery.isPending}
          option={tpotOption}
          empty={!models.some((metric) => metric.avgTpotMs != null && metric.avgTpotMs > 0)}
          emptyText={t('dashboard.charts.tpotEmpty')}
        />
      </div>

      <ModelMetricsTable models={models} loading={modelUsageQuery.isPending} />

      <RecentRequestsTable loading={latestLogsQuery.isPending} records={recentLogs} />
    </div>
  )
}

function StatCard({
  icon,
  title,
  value,
  suffix
}: {
  icon?: React.ReactNode
  title: string
  value: number
  suffix?: string
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
          {icon && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
          )}
        </div>
        <p className="text-2xl font-semibold">
          {value.toLocaleString()}
          {suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
        </p>
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  option,
  loading,
  empty,
  emptyText
}: {
  title: string
  description: string
  option: EChartsOption
  loading?: boolean
  empty?: boolean
  emptyText?: string
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div>
          <p className="text-base font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
          </div>
        ) : empty ? (
          <div className="flex h-[320px] flex-col items-center justify-center rounded-lg border border-dashed">
            <BarChart3 className="mb-2 h-10 w-10 text-muted-foreground/50" />
            <span className="text-sm text-muted-foreground">{emptyText ?? t('dashboard.charts.empty')}</span>
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: 320 }} notMerge lazyUpdate />
        )}
      </CardContent>
    </Card>
  )
}

function ModelMetricsTable({ models, loading }: { models: ModelUsageMetric[]; loading?: boolean }) {
  const { t } = useTranslation()
  const hasData = models.length > 0

  return (
    <PageSection
      title={t('dashboard.modelTable.title')}
      description={t('dashboard.modelTable.description')}
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
        </div>
      ) : !hasData ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
          <span className="text-sm text-muted-foreground">{t('dashboard.modelTable.empty')}</span>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.modelTable.columns.model')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.requests')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.latency')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.ttft')}</TableHead>
                <TableHead className="text-right">{t('dashboard.modelTable.columns.tpot')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((item) => (
                <TableRow key={`${item.provider}/${item.model}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{item.provider}</span>
                      <span className="text-xs text-muted-foreground">{item.model}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {item.requests.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
  )
}

function RecentRequestsTable({ records, loading }: { records: LogRecord[]; loading?: boolean }) {
  const { t } = useTranslation()
  return (
    <PageSection
      title={t('dashboard.recent.title')}
      description={t('dashboard.recent.subtitle', { count: 5 })}
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('dashboard.recent.loading')}</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
          <span className="text-sm text-muted-foreground">{t('dashboard.recent.empty')}</span>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.recent.columns.time')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.endpoint')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.provider')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.route')}</TableHead>
                <TableHead className="text-right">{t('dashboard.recent.columns.latency')}</TableHead>
                <TableHead>{t('dashboard.recent.columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs">
                    {new Date(item.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.endpoint === 'anthropic'
                      ? t('logs.table.endpointAnthropic')
                      : item.endpoint === 'openai'
                      ? t('logs.table.endpointOpenAI')
                      : item.endpoint}
                  </TableCell>
                  <TableCell className="font-medium">{item.provider}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>{item.client_model ?? t('dashboard.recent.routePlaceholder')}</span>
                      <span>→</span>
                      <span className="font-medium text-foreground">{item.model}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatLatencyValue(item.latency_ms, t('common.units.ms'))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.error ? 'destructive' : 'default'}>
                      {(item.status_code ?? (item.error ? 500 : 200)).toString()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageSection>
  )
}
