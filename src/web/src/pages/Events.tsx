import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Filter, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { eventsApi, toApiError } from '@/services/api'
import type { GatewayEvent } from '@/types/events'
import { formatRelativeTime, formatTimestamp } from '@/utils/date'
import { badgeClass, primaryButtonClass, subtleButtonClass } from '@/styles/theme'
import { cn } from '@/utils/cn'
import { LoadingState } from '@/components/Loader'
import { useToast } from '@/providers/ToastProvider'

interface FilterState {
  level: string
  type: string
}

const LEVEL_BADGE: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  error: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
}

export default function EventsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [events, setEvents] = useState<GatewayEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [filters, setFilters] = useState<FilterState>({ level: '', type: '' })
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadEvents = async (options?: { cursor?: number | null; reset?: boolean }) => {
    setLoading(true)
    try {
      const response = await eventsApi.list({
        cursor: options?.cursor ?? undefined,
        limit: 50,
        level: filters.level || undefined,
        type: filters.type || undefined
      })
      setEvents(response.events)
      setNextCursor(response.nextCursor)
      setCursor(options?.cursor ?? null)
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('events.toast.loadFailure', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadEvents({ reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.level, filters.type])

  const handleRefresh = () => {
    setIsRefreshing(true)
    void loadEvents({ cursor, reset: false })
  }

  const handleResetFilters = () => {
    setFilters({ level: '', type: '' })
  }

  const paginationControls = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={subtleButtonClass}
          disabled={!cursor}
          onClick={() => void loadEvents({ cursor: undefined })}
        >
          <ChevronLeft size={16} /> {t('events.actions.newest')}
        </button>
        <button
          type="button"
          className={subtleButtonClass}
          disabled={!nextCursor}
          onClick={() => void loadEvents({ cursor: nextCursor ?? undefined })}
        >
          {t('events.actions.older')} <ChevronRight size={16} />
        </button>
      </div>
    )
  }, [cursor, nextCursor, t])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert size={22} className="text-blue-600 dark:text-blue-300" />
            {t('events.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('events.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {paginationControls}
          <button
            type="button"
            onClick={handleRefresh}
            className={cn(subtleButtonClass, 'inline-flex items-center gap-2')}
            disabled={isRefreshing}
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : undefined} />
            {isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
          </button>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-4 shadow-lg shadow-slate-200/50 backdrop-blur dark:border-slate-800/50 dark:bg-slate-900/80 dark:shadow-slate-900/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Filter size={16} />
            {t('events.filters.title')}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200/50 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200 dark:focus:border-blue-500"
              value={filters.level}
              onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
            >
              <option value="">{t('events.filters.allLevels')}</option>
              <option value="info">{t('events.levels.info')}</option>
              <option value="warn">{t('events.levels.warn')}</option>
              <option value="error">{t('events.levels.error')}</option>
            </select>
            <input
              type="text"
              className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200/50 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200 dark:focus:border-blue-500"
              placeholder={t('events.filters.typePlaceholder')}
              value={filters.type}
              onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}
            />
            <button type="button" onClick={handleResetFilters} className={subtleButtonClass}>
              {t('common.actions.reset')}
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingState />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200/70 bg-white/60 p-10 text-center text-slate-500 shadow-inner shadow-slate-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-400 dark:shadow-slate-900/40">
          <p className="text-lg font-semibold">{t('events.empty.title')}</p>
          <p className="text-sm mt-2">{t('events.empty.subtitle')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <article
              key={event.id}
              className="rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white/95 to-white/85 p-5 shadow-md shadow-slate-200/40 backdrop-blur dark:border-slate-800/60 dark:from-slate-900/90 dark:to-slate-900/80 dark:shadow-slate-900/50"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className={cn('text-sm font-semibold px-3 py-1 rounded-full', LEVEL_BADGE[event.level] || LEVEL_BADGE.info)}>
                    {t(`events.levels.${event.level}` as const)}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {formatTimestamp(event.createdAt)} · {formatRelativeTime(event.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className={cn(badgeClass.default, 'bg-slate-100 dark:bg-slate-800')}>
                    #{event.id}
                  </span>
                  {event.mode ? (
                    <span className={cn(badgeClass.default, 'bg-blue-100 dark:bg-blue-900/40')}>
                      {event.mode}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  {event.title || t('events.defaultTitle')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {event.message || t('events.defaultMessage')}
                </p>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                {event.ipAddress ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      IP
                    </p>
                    <p>{event.ipAddress}</p>
                  </div>
                ) : null}
                {event.apiKeyName ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      API Key
                    </p>
                    <p>{event.apiKeyName}</p>
                  </div>
                ) : null}
                {event.userAgent ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      User Agent
                    </p>
                    <p className="truncate">{event.userAgent}</p>
                  </div>
                ) : null}
              </div>
              {event.details ? (
                <details className="mt-4 rounded-2xl border border-slate-200/60 bg-slate-50/70 p-3 text-sm dark:border-slate-800/60 dark:bg-slate-900/60">
                  <summary className="cursor-pointer text-sm font-semibold text-blue-600 dark:text-blue-300">
                    {t('events.details')}
                  </summary>
                  <pre className="mt-3 rounded-xl bg-white/80 p-3 text-xs text-slate-700 shadow-inner dark:bg-slate-950/80 dark:text-slate-200">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
