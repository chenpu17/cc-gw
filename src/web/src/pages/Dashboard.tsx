import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, TrendingUp, Activity, Timer } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { Select, StatusBadge } from '@/components'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { apiClient, type ApiError, toApiError } from '@/services/api'
import type { LogListResponse, LogRecord } from '@/types/logs'
import { cn } from '@/utils/cn'
import { mutedTextClass, sectionTitleClass, surfaceCardClass, glassCardClass, badgeClass, statusIndicatorClass, loadingStateClass, emptyStateClass, loadingSpinnerClass, chartContainerClass, subtleButtonClass, responsiveGridClass, responsiveTextClass, enhancedLoadingClass } from '@/styles/theme'

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
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        textStyle: { color: '#e2e8f0' }
      },
      legend: {
        data: [requestLabel, inputLabel, outputLabel, cacheReadLabel, cacheCreationLabel],
        textStyle: { color: '#64748b' }
      },
      grid: { left: 60, right: 40, top: 60, bottom: 60 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1e293b' } }
      },
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0]
          },
          emphasis: {
            itemStyle: {
              color: '#2563eb'
            }
          }
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.inputTokens),
          smooth: true,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 3 },
          symbol: 'circle',
          symbolSize: 6
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.outputTokens),
          smooth: true,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 3 },
          symbol: 'circle',
          symbolSize: 6
        },
        {
          name: cacheReadLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.cacheReadTokens),
          smooth: true,
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { width: 3 },
          symbol: 'circle',
          symbolSize: 6
        },
        {
          name: cacheCreationLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.cacheCreationTokens),
          smooth: true,
          itemStyle: { color: '#ec4899' },
          lineStyle: { width: 3 },
          symbol: 'circle',
          symbolSize: 6
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
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        textStyle: { color: '#e2e8f0' }
      },
      legend: {
        data: [requestLabel, inputLabel, outputLabel],
        textStyle: { color: '#64748b' }
      },
      grid: { left: 80, right: 60, top: 60, bottom: 100 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          rotate: 30,
          color: '#64748b'
        },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: [
        {
          type: 'value',
          name: requestLabel,
          axisLabel: { color: '#64748b' },
          axisLine: { lineStyle: { color: '#334155' } },
          splitLine: { lineStyle: { color: '#1e293b' } }
        },
        {
          type: 'value',
          name: t('dashboard.charts.axisTokens'),
          position: 'right',
          axisLabel: { color: '#64748b' },
          axisLine: { lineStyle: { color: '#334155' } }
        }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: {
            color: '#6366f1',
            borderRadius: [4, 4, 0, 0]
          },
          yAxisIndex: 0
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.inputTokens ?? 0),
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 3 }
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.outputTokens ?? 0),
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 3 }
        }
      ]
    }
  }, [models, t])

  const ttftOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const ttftLabel = t('dashboard.charts.ttftLabel')

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        textStyle: { color: '#e2e8f0' },
        formatter(params) {
          if (!Array.isArray(params) || params.length === 0) return ''
          const index = params[0]?.dataIndex ?? 0
          const metric = models[index]
          if (!metric) return ''
          return `<strong>${categories[index]}</strong><br/>${ttftLabel}: ${formatLatencyValue(metric.avgTtftMs, t('common.units.ms'))}`
        }
      },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          rotate: 30,
          color: '#64748b'
        },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        name: t('dashboard.charts.ttftAxis'),
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1e293b' } }
      },
      series: [
        {
          name: ttftLabel,
          type: 'bar',
          data: models.map((item) => item.avgTtftMs ?? 0),
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    }
  }, [models, t])

  const tpotOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const tpotLabel = t('dashboard.charts.tpotLabel')

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(59, 130, 246, 0.3)',
        textStyle: { color: '#e2e8f0' },
        formatter(params) {
          if (!Array.isArray(params) || params.length === 0) return ''
          const index = params[0]?.dataIndex ?? 0
          const metric = models[index]
          if (!metric) return ''
          return `<strong>${categories[index]}</strong><br/>${tpotLabel}: ${formatLatencyValue(metric.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}`
        }
      },
      grid: { left: 80, right: 50, top: 60, bottom: 100 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          rotate: 30,
          color: '#64748b'
        },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        name: t('dashboard.charts.tpotAxis'),
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1e293b' } }
      },
      series: [
        {
          name: tpotLabel,
          type: 'bar',
          data: models.map((item) => item.avgTpotMs ?? 0),
          itemStyle: {
            color: '#f59e0b',
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    }
  }, [models, t])

  if (overviewQuery.isPending || statusQuery.isPending || dbInfoQuery.isPending) {
    return <Loader />
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon={<BarChart3 className="h-7 w-7" aria-hidden="true" />}
        title={t('nav.dashboard')}
        description={t('dashboard.description')}
        actions={
          <div className="flex items-center gap-4 rounded-2xl bg-white/90 px-4 py-3 shadow-lg shadow-slate-200/30 ring-1 ring-slate-200/40 backdrop-blur-lg dark:bg-slate-900/90 dark:shadow-xl dark:shadow-slate-900/30 dark:ring-slate-700/40">
            <label
              htmlFor="dashboard-endpoint-filter"
              className="text-xs font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300"
            >
              {t('dashboard.filters.endpoint')}
            </label>
            <div className="relative">
              <Select
                id="dashboard-endpoint-filter"
                value={endpointFilter}
                onChange={(event) => setEndpointFilter(event.target.value as 'all' | 'anthropic' | 'openai')}
                options={[
                  { value: 'all', label: t('dashboard.filters.endpointAll') },
                  { value: 'anthropic', label: t('dashboard.filters.endpointAnthropic') },
                  { value: 'openai', label: t('dashboard.filters.endpointOpenAI') }
                ]}
              />
            </div>
          </div>
        }
      />

      {/* Service Status */}
      {status ? (
        <section
          className={cn(
            glassCardClass,
            'flex flex-wrap items-center gap-4 text-sm leading-relaxed animate-slide-up'
          )}
          aria-live="polite"
        >
          <span className={cn(statusIndicatorClass.success, 'inline-flex items-center gap-2 rounded-full px-4 py-2 font-semibold')}>
            <span className="h-2 w-2 rounded-full bg-current shadow-lg" aria-hidden="true" />
            {t('dashboard.status.listening', {
              host: status.host ?? '0.0.0.0',
              port: status.port
            })}
          </span>
          <span className={cn(badgeClass.default, 'font-semibold')}>
            {t('dashboard.status.providers', { value: status.providers.toLocaleString() })}
          </span>
          <span className={cn(badgeClass.primary, 'font-semibold')}>
            {t('dashboard.status.todayRequests', {
              value: (overview?.today.requests ?? 0).toLocaleString()
            })}
          </span>
          <span className={cn(badgeClass.default, 'font-semibold')}>
            {t('dashboard.status.active', {
              value: (status.activeRequests ?? 0).toLocaleString()
            })}
          </span>
          <span className={cn(badgeClass.default, 'font-semibold')}>
            {t('dashboard.status.dbSize', {
              value: dbSizeDisplay
            })}
          </span>
          <span className={cn(badgeClass.default, 'font-semibold')}>
            {t('dashboard.status.memory', {
              value: memoryDisplay
            })}
          </span>
          <button
            type="button"
            onClick={handleCompact}
            disabled={compacting}
            className={cn(
              subtleButtonClass,
              'h-9 rounded-full px-4 text-xs font-semibold',
              compacting ? 'cursor-wait opacity-70' : ''
            )}
          >
            {compacting ? t('dashboard.actions.compacting') : t('dashboard.actions.compact')}
          </button>
        </section>
      ) : null}

      {/* Statistics Cards */}
      <section className={cn(responsiveGridClass.auto, 'gap-4 sm:gap-6')}>
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayRequests')}
          value={overview?.today.requests ?? 0}
          suffix={t('common.units.request')}
          trend="+12%"
          trendDirection="up"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          title={t('dashboard.cards.todayInput')}
          value={overview?.today.inputTokens ?? 0}
          suffix={t('common.units.token')}
          trend="+8%"
          trendDirection="up"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayCacheRead')}
          value={overview?.today.cacheReadTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          title={t('dashboard.cards.todayCacheCreation')}
          value={overview?.today.cacheCreationTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5" />}
          title={t('dashboard.cards.todayOutput')}
          value={overview?.today.outputTokens ?? 0}
          suffix={t('common.units.token')}
          trend="+15%"
          trendDirection="up"
        />
        <StatCard
          icon={<Timer className="h-5 w-5" />}
          title={t('dashboard.cards.avgLatency')}
          value={overview?.today.avgLatencyMs ?? 0}
          suffix={t('common.units.ms')}
          trend="-5%"
          trendDirection="down"
        />
      </section>

      {/* Charts Grid */}
      <div className={cn(responsiveGridClass.fixed[2], 'gap-6 sm:gap-8')}>
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

      <div className={cn(responsiveGridClass.fixed[2], 'gap-6 sm:gap-8')}>
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
  suffix,
  trend,
  trendDirection
}: {
  icon?: React.ReactNode
  title: string
  value: number
  suffix?: string
  trend?: string
  trendDirection?: 'up' | 'down'
}) {
  return (
    <div className={cn(glassCardClass, 'group hover-lift animate-slide-up')}>
      <div className="flex items-center justify-between mb-4">
        <div className={cn(mutedTextClass, 'text-xs font-bold uppercase tracking-[0.15em]')}>{title}</div>
        {icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/15 to-indigo-600/10 text-blue-600 ring-1 ring-blue-500/20 dark:from-blue-500/25 dark:to-indigo-500/15 dark:text-blue-200 dark:ring-blue-400/20">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {value.toLocaleString()}
            {suffix ? (
              <span className={cn(mutedTextClass, 'ml-2 text-base sm:text-lg font-medium')}>{suffix}</span>
            ) : null}
          </p>
          {trend && (
            <div className={cn(
              'mt-2 flex items-center gap-1 text-xs font-semibold',
              trendDirection === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}>
              <span>{trend}</span>
              <span className="text-slate-500">vs last period</span>
            </div>
          )}
        </div>
      </div>
    </div>
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
    <div className={cn(glassCardClass, 'space-y-4 sm:space-y-6 hover-lift animate-slide-up')}>
      <div>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50">{title}</p>
        <p className={cn(mutedTextClass, 'mt-2 text-xs sm:text-sm leading-relaxed')}>{description}</p>
      </div>
      {loading ? (
        <div className={enhancedLoadingClass.container}>
          <div className="text-center">
            <div className={enhancedLoadingClass.spinner}></div>
            <span className={cn(enhancedLoadingClass.text)}>{t('common.loadingShort')}</span>
          </div>
        </div>
      ) : empty ? (
        <div className={emptyStateClass}>
          <div className="text-center">
            <BarChart3 className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
            <span className={cn(mutedTextClass, 'text-sm')}>{emptyText ?? t('dashboard.charts.empty')}</span>
          </div>
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 320 }}
          notMerge
          lazyUpdate
          theme={undefined}
          className={chartContainerClass}
        />
      )}
    </div>
  )
}

function ModelMetricsTable({ models, loading }: { models: ModelUsageMetric[]; loading?: boolean }) {
  const { t } = useTranslation()
  const hasData = models.length > 0

  return (
    <PageSection
      title={<span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('dashboard.modelTable.title')}</span>}
      description={t('dashboard.modelTable.description')}
      contentClassName="gap-0 overflow-hidden p-0"
    >
      {loading ? (
        <div className={loadingStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{t('common.loadingShort')}</span>
        </div>
      ) : !hasData ? (
        <div className={emptyStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{t('dashboard.modelTable.empty')}</span>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-700/60">
            <caption className="sr-only">{t('dashboard.modelTable.title')}</caption>
            <thead className="bg-slate-100/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3 font-semibold">{t('dashboard.modelTable.columns.model')}</th>
                <th className="px-5 py-3 text-right font-semibold">{t('dashboard.modelTable.columns.requests')}</th>
                <th className="px-5 py-3 text-right font-semibold">{t('dashboard.modelTable.columns.latency')}</th>
                <th className="px-5 py-3 text-right font-semibold">{t('dashboard.modelTable.columns.ttft')}</th>
                <th className="px-5 py-3 text-right font-semibold">{t('dashboard.modelTable.columns.tpot')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
              {models.map((item) => (
                <tr key={`${item.provider}/${item.model}`} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800 dark:text-slate-50">{item.provider}</span>
                      <span className={cn(mutedTextClass, 'text-xs')}>{item.model}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-800 dark:text-slate-50">
                    {item.requests.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right">{formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}</td>
                  <td className="px-5 py-3 text-right">{formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}</td>
                  <td className="px-5 py-3 text-right">
                    {formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  )
}

function RecentRequestsTable({ records, loading }: { records: LogRecord[]; loading?: boolean }) {
  const { t } = useTranslation()
  return (
    <PageSection
      title={<span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('dashboard.recent.title')}</span>}
      description={t('dashboard.recent.subtitle', { count: 5 })}
      contentClassName="gap-0 overflow-hidden p-0"
    >
      {loading ? (
        <div className={loadingStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{t('dashboard.recent.loading')}</span>
        </div>
      ) : records.length === 0 ? (
        <div className={emptyStateClass}>
          <span className={cn(mutedTextClass, 'text-sm')}>{t('dashboard.recent.empty')}</span>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-700/60">
            <caption className="sr-only">{t('dashboard.recent.title')}</caption>
            <thead className="bg-slate-100/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3 font-semibold">{t('dashboard.recent.columns.time')}</th>
                <th className="px-5 py-3 font-semibold">{t('dashboard.recent.columns.endpoint')}</th>
                <th className="px-5 py-3 font-semibold">{t('dashboard.recent.columns.provider')}</th>
                <th className="px-5 py-3 font-semibold">{t('dashboard.recent.columns.route')}</th>
                <th className="px-5 py-3 text-right font-semibold">{t('dashboard.recent.columns.latency')}</th>
                <th className="px-5 py-3 text-left font-semibold">{t('dashboard.recent.columns.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
              {records.map((item) => (
                <tr key={item.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-3 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {new Date(item.timestamp).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {item.endpoint === 'anthropic'
                      ? t('logs.table.endpointAnthropic')
                      : item.endpoint === 'openai'
                      ? t('logs.table.endpointOpenAI')
                      : item.endpoint}
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-slate-800 dark:text-slate-50">{item.provider}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{item.client_model ?? t('dashboard.recent.routePlaceholder')}</span>
                      <span aria-hidden="true" className="text-slate-400">
                        →
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-100">{item.model}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-medium text-slate-800 dark:text-slate-100">
                    {formatLatencyValue(item.latency_ms, t('common.units.ms'))}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge variant={item.error ? 'error' : 'success'}>
                      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                      {(item.status_code ?? (item.error ? 500 : 200)).toString()}
                      <span>{item.error ? t('common.status.error') : t('common.status.success')}</span>
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  )
}
