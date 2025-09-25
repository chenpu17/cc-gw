import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Loader } from '@/components/Loader'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiError } from '@/services/api'
import type { LogListResponse, LogRecord } from '@/types/logs'

interface OverviewStats {
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    avgLatencyMs: number
  }
  today: {
    requests: number
    inputTokens: number
    outputTokens: number
    avgLatencyMs: number
  }
}

interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
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

  const overviewQuery = useApiQuery<OverviewStats, ApiError>(
    ['stats', 'overview'],
    { url: '/api/stats/overview', method: 'GET' }
  )

  const dailyQuery = useApiQuery<DailyMetric[], ApiError>(
    ['stats', 'daily', 14],
    { url: '/api/stats/daily', method: 'GET', params: { days: 14 } }
  )

  const modelUsageQuery = useApiQuery<ModelUsageMetric[], ApiError>(
    ['stats', 'model', 7, 6],
    { url: '/api/stats/model', method: 'GET', params: { days: 7, limit: 6 } }
  )

  const statusQuery = useApiQuery<ServiceStatus, ApiError>(
    ['status'],
    { url: '/api/status', method: 'GET' }
  )

  const dbInfoQuery = useApiQuery<DatabaseInfo, ApiError>(
    ['db', 'info'],
    { url: '/api/db/info', method: 'GET' }
  )

  const latestLogsQuery = useApiQuery<LogListResponse, ApiError>(
    ['logs', 'recent'],
    { url: '/api/logs', method: 'GET', params: { limit: 5 } },
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

  const dailyOption = useMemo<EChartsOption>(() => {
    const dates = daily.map((item) => item.date)
    const requestLabel = t('dashboard.charts.barRequests')
    const inputLabel = t('dashboard.charts.lineInput')
    const outputLabel = t('dashboard.charts.lineOutput')
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: [requestLabel, inputLabel, outputLabel] },
      grid: { left: 40, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value' },
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: daily.map((item) => item.requestCount),
          itemStyle: { color: '#2563eb' }
        },
        {
          name: inputLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.inputTokens),
          smooth: true,
          itemStyle: { color: '#22c55e' }
        },
        {
          name: outputLabel,
          type: 'line',
          yAxisIndex: 0,
          data: daily.map((item) => item.outputTokens),
          smooth: true,
          itemStyle: { color: '#f97316' }
        }
      ]
    }
  }, [daily, t])

  const modelOption = useMemo<EChartsOption>(() => {
    const categories = models.map((item) => `${item.provider}/${item.model}`)
    const requestLabel = t('dashboard.charts.barRequests')
    const ttftLabel = t('dashboard.charts.ttftLabel')
    const tpotLabel = t('dashboard.charts.tpotLabel')

    return {
      tooltip: {
        trigger: 'axis',
        formatter(params) {
          if (!Array.isArray(params) || params.length === 0) return ''
          const index = params[0]?.dataIndex ?? 0
          const metric = models[index]
          if (!metric) return ''
          const lines = [
            `<strong>${categories[index]}</strong>`,
            `${requestLabel}: ${metric.requests.toLocaleString()}`,
            `${ttftLabel}: ${formatLatencyValue(metric.avgTtftMs, t('common.units.ms'))}`,
            `${tpotLabel}: ${formatLatencyValue(metric.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}`
          ]
          return lines.join('<br/>')
        }
      },
      legend: { data: [requestLabel, ttftLabel, tpotLabel] },
      grid: { left: 50, right: 40, top: 40, bottom: 70 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { rotate: 30 }
      },
      yAxis: [
        {
          type: 'value',
          name: requestLabel
        },
        {
          type: 'value',
          name: t('dashboard.charts.axisLatency'),
          position: 'right'
        }
      ],
      series: [
        {
          name: requestLabel,
          type: 'bar',
          data: models.map((item) => item.requests),
          itemStyle: { color: '#6366f1' },
          yAxisIndex: 0
        },
        {
          name: ttftLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: models.map((item) => item.avgTtftMs ?? 0),
          itemStyle: { color: '#22c55e' }
        },
        {
          name: tpotLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          lineStyle: { type: 'dashed' },
          data: models.map((item) => item.avgTpotMs ?? 0),
          itemStyle: { color: '#f97316' }
        }
      ]
    }
  }, [models, t])

  if (overviewQuery.isPending || statusQuery.isPending || dbInfoQuery.isPending) {
    return <Loader />
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('nav.dashboard')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.description')}</p>
        {status ? (
          <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-live="polite">
            <span className="font-medium">
              {t('dashboard.status.listening', {
                host: status.host ?? '0.0.0.0',
                port: status.port
              })}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {t('dashboard.status.providers', { value: status.providers })}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {t('dashboard.status.todayRequests', {
                value: (overview?.today.requests ?? 0).toLocaleString()
              })}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {t('dashboard.status.active', {
                value: (status.activeRequests ?? 0).toLocaleString()
              })}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {t('dashboard.status.dbSize', {
                value: dbInfo ? formatBytes(dbInfo.sizeBytes) : '-'
              })}
            </span>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t('dashboard.cards.todayRequests')}
          value={overview?.today.requests ?? 0}
          suffix={t('common.units.request')}
        />
        <StatCard
          title={t('dashboard.cards.todayInput')}
          value={overview?.today.inputTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          title={t('dashboard.cards.todayOutput')}
          value={overview?.today.outputTokens ?? 0}
          suffix={t('common.units.token')}
        />
        <StatCard
          title={t('dashboard.cards.avgLatency')}
          value={overview?.today.avgLatencyMs ?? 0}
          suffix={t('common.units.ms')}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title={t('dashboard.charts.requestsTitle')}
          description={t('dashboard.charts.requestsDesc')}
          loading={dailyQuery.isPending}
          option={dailyOption}
        />
        <ChartCard
          title={t('dashboard.charts.modelTitle')}
          description={t('dashboard.charts.modelDesc')}
          loading={modelUsageQuery.isPending}
          option={modelOption}
        />
      </div>

      <ModelMetricsTable models={models} loading={modelUsageQuery.isPending} />

      <RecentRequestsTable loading={latestLogsQuery.isPending} records={recentLogs} />
    </div>
  )
}

function StatCard({ title, value, suffix }: { title: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold">
        {value.toLocaleString()}
        {suffix ? <span className="ml-1 text-base font-normal text-slate-500 dark:text-slate-400">{suffix}</span> : null}
      </p>
    </div>
  )
}

function ChartCard({
  title,
  description,
  option,
  loading
}: {
  title: string
  description: string
  option: EChartsOption
  loading?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      {loading ? (
        <div className="flex h-60 items-center justify-center text-sm text-slate-400">{t('common.loadingShort')}</div>
      ) : (
        <ReactECharts option={option} style={{ height: 260 }} notMerge lazyUpdate theme={undefined} />
      )}
    </div>
  )
}

function ModelMetricsTable({ models, loading }: { models: ModelUsageMetric[]; loading?: boolean }) {
  const { t } = useTranslation()
  const hasData = models.length > 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <p className="text-sm font-semibold">{t('dashboard.modelTable.title')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('dashboard.modelTable.description')}</p>
        </div>
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">{t('common.loadingShort')}</div>
      ) : !hasData ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">{t('dashboard.modelTable.empty')}</div>
      ) : (
        <div className="max-h-80 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <caption className="sr-only">{t('dashboard.modelTable.title')}</caption>
            <thead className="bg-slate-100 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.modelTable.columns.model')}
                </th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.modelTable.columns.requests')}
                </th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.modelTable.columns.latency')}
                </th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.modelTable.columns.ttft')}
                </th>
                <th className="px-4 py-2 text-right font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.modelTable.columns.tpot')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {models.map((item) => (
                <tr key={`${item.provider}/${item.model}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-700 dark:text-slate-100">{item.provider}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{item.model}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">{item.requests.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{formatLatencyValue(item.avgLatencyMs, t('common.units.ms'))}</td>
                  <td className="px-4 py-2 text-right">{formatLatencyValue(item.avgTtftMs, t('common.units.ms'))}</td>
                  <td className="px-4 py-2 text-right">{formatLatencyValue(item.avgTpotMs, t('common.units.msPerToken'), { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RecentRequestsTable({ records, loading }: { records: LogRecord[]; loading?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <p className="text-sm font-semibold">{t('dashboard.recent.title')}</p>
        <span className="text-xs text-slate-500 dark:text-slate-400">{t('dashboard.recent.subtitle', { count: 5 })}</span>
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">{t('dashboard.recent.loading')}</div>
      ) : records.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">{t('dashboard.recent.empty')}</div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <caption className="sr-only">{t('dashboard.recent.title')}</caption>
            <thead className="bg-slate-100 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.recent.columns.time')}
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.recent.columns.provider')}
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.recent.columns.route')}
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.recent.columns.latency')}
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">
                  {t('dashboard.recent.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {records.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(item.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{item.provider}</td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {item.client_model ?? t('dashboard.recent.routePlaceholder')}
                    </span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="font-medium text-slate-700 dark:text-slate-100">{item.model}</span>
                  </td>
                  <td className="px-4 py-2">{formatLatencyValue(item.latency_ms, t('common.units.ms'))}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.error
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                      }`}
                    >
                      {(item.status_code ?? 200).toString()}
                      <span className="ml-1">
                        {item.error ? t('common.status.error') : t('common.status.success')}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
