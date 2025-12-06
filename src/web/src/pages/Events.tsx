import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Filter, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { eventsApi, toApiError } from '@/services/api'
import type { GatewayEvent } from '@/types/events'
import { formatRelativeTime, formatTimestamp } from '@/utils/date'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/Loader'
import { useToast } from '@/providers/ToastProvider'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface FilterState {
  level: string
  type: string
}

const LEVEL_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'outline',
  error: 'destructive'
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
        <Button
          variant="outline"
          size="sm"
          disabled={!cursor}
          onClick={() => void loadEvents({ cursor: undefined })}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> {t('events.actions.newest')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!nextCursor}
          onClick={() => void loadEvents({ cursor: nextCursor ?? undefined })}
        >
          {t('events.actions.older')} <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    )
  }, [cursor, nextCursor, t])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<ShieldAlert className="h-5 w-5" />}
        title={t('events.title')}
        description={t('events.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {paginationControls}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
              {isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              {t('events.filters.title')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filters.level}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, level: value === 'all' ? '' : value }))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('events.filters.allLevels')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('events.filters.allLevels')}</SelectItem>
                  <SelectItem value="info">{t('events.levels.info')}</SelectItem>
                  <SelectItem value="warn">{t('events.levels.warn')}</SelectItem>
                  <SelectItem value="error">{t('events.levels.error')}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-[180px]"
                placeholder={t('events.filters.typePlaceholder')}
                value={filters.type}
                onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}
              />
              <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                {t('common.actions.reset')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingState />
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
          <p className="text-base font-medium">{t('events.empty.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('events.empty.subtitle')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant={LEVEL_VARIANT[event.level] || 'secondary'}>
                      {t(`events.levels.${event.level}` as const)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {formatTimestamp(event.createdAt)} · {formatRelativeTime(event.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">#{event.id}</Badge>
                    {event.mode && <Badge variant="secondary">{event.mode}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">
                    {event.title || t('events.defaultTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {event.message || t('events.defaultMessage')}
                  </p>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {event.ipAddress && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        IP
                      </p>
                      <p>{event.ipAddress}</p>
                    </div>
                  )}
                  {event.apiKeyName && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        API Key
                      </p>
                      <p>{event.apiKeyName}</p>
                    </div>
                  )}
                  {event.userAgent && (
                    <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        User Agent
                      </p>
                      <p className="truncate">{event.userAgent}</p>
                    </div>
                  )}
                </div>
                {event.details && (
                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      {t('events.details')}
                    </summary>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
