import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Key, Copy, Trash2, Plus, Check, Eye, EyeOff } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { apiClient, type ApiError } from '@/services/api'
import { cn } from '@/lib/utils'
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
  const [revealedKeys, setRevealedKeys] = useState<Map<number, string>>(new Map())
  const [isRevealing, setIsRevealing] = useState<number | null>(null)

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
  const totalKeysValue = overview ? overview.totalKeys.toLocaleString() : '-'
  const enabledKeysValue = overview ? overview.enabledKeys.toLocaleString() : '-'
  const activeKeysValue = overview ? overview.activeKeys.toLocaleString() : '-'

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

  const handleRevealKey = async (id: number) => {
    if (revealedKeys.has(id)) {
      return
    }

    setIsRevealing(id)
    try {
      const response = await apiClient.get<{ key: string }>(`/api/keys/${id}/reveal`)
      setRevealedKeys((prev) => new Map(prev).set(id, response.data.key))
    } catch (error: any) {
      pushToast({
        title: t('apiKeys.toast.revealFailure'),
        description: error.response?.data?.error || error.message,
        variant: 'error'
      })
    } finally {
      setIsRevealing(null)
    }
  }

  const handleHideKey = (id: number) => {
    setRevealedKeys((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      pushToast({ title: t('apiKeys.toast.keyCopied'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('apiKeys.toast.copyFailure'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'error'
      })
    }
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
          itemStyle: { color: 'hsl(var(--primary))' }
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Key className="h-5 w-5" aria-hidden="true" />}
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
        actions={
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('apiKeys.createNew')}
          </Button>
        }
      />

      <PageSection
        title={t('apiKeys.analytics.title')}
        description={t('apiKeys.analytics.description', { days: rangeDays })}
        actions={
          <div className="flex items-center gap-1 rounded-lg border p-1">
            {RANGE_OPTIONS.map((option) => {
              const active = rangeDays === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRangeDays(option.value)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t(option.labelKey)}
                </button>
              )
            })}
          </div>
        }
      >
        <div className="space-y-6">
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
        </div>
      </PageSection>

      <PageSection
        title={t('apiKeys.list.title')}
        description={hasWildcard ? t('apiKeys.wildcardHint') : undefined}
      >
        {keys.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">{t('apiKeys.list.empty')}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {keys.map((key) => {
              const totalTokens = (key.totalInputTokens + key.totalOutputTokens).toLocaleString()
              const revealedKey = revealedKeys.get(key.id)
              const isKeyRevealing = isRevealing === key.id
              return (
                <Card key={key.id}>
                  <CardContent className="space-y-4 pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold">{key.name}</h3>
                          {key.isWildcard && (
                            <Badge variant="secondary">{t('apiKeys.wildcard')}</Badge>
                          )}
                          <Badge variant={key.enabled ? 'default' : 'outline'}>
                            {key.enabled ? t('apiKeys.status.enabled') : t('apiKeys.status.disabled')}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-sm">
                            {key.isWildcard
                              ? t('apiKeys.wildcard')
                              : revealedKey ?? key.maskedKey ?? '********'}
                          </code>
                          {!key.isWildcard && (
                            <div className="flex items-center gap-1">
                              {revealedKey ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => void handleCopyKey(revealedKey)}
                                    aria-label={t('common.actions.copy')}
                                    title={t('common.actions.copy')}
                                  >
                                    <Copy className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleHideKey(key.id)}
                                    aria-label={t('apiKeys.actions.hide')}
                                    title={t('apiKeys.actions.hide')}
                                  >
                                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => void handleRevealKey(key.id)}
                                  disabled={isKeyRevealing}
                                  aria-label={t('apiKeys.actions.reveal')}
                                  title={t('apiKeys.actions.reveal')}
                                >
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        {key.isWildcard ? (
                          <p className="text-sm text-muted-foreground">
                            {t('apiKeys.wildcardHint')}
                          </p>
                        ) : key.description ? (
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{key.description}</p>
                        ) : null}
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('apiKeys.created')}
                            </span>
                            <p className="font-medium">{formatDate(key.createdAt)}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('apiKeys.lastUsed')}
                            </span>
                            <p className="font-medium">{formatDate(key.lastUsedAt)}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('apiKeys.requestCount')}
                            </span>
                            <p className="font-medium">{key.requestCount.toLocaleString()}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('apiKeys.totalTokens')}
                            </span>
                            <p className="font-medium">{totalTokens}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={key.enabled ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => handleToggleEnabled(key.id, key.enabled)}
                        >
                          {key.enabled ? t('apiKeys.actions.disable') : t('apiKeys.actions.enable')}
                        </Button>
                        {!key.isWildcard && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDeleteKey(key.id)}
                            disabled={isDeleting === key.id}
                            aria-label={t('apiKeys.actions.delete')}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </PageSection>

      {/* Create Key Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('apiKeys.createNew')}</DialogTitle>
            <DialogDescription>{t('apiKeys.createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="keyName">{t('apiKeys.keyNamePlaceholder')} *</Label>
              <Input
                id="keyName"
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="keyDescription">{t('apiKeys.descriptionLabel')}</Label>
              <Textarea
                id="keyDescription"
                value={newKeyDescription}
                onChange={(event) => setNewKeyDescription(event.target.value)}
                placeholder={t('apiKeys.keyDescriptionPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false)
                setNewKeyName('')
                setNewKeyDescription('')
              }}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button onClick={() => void handleCreateKey()}>
              {t('apiKeys.createAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Key Created Success Dialog */}
      <Dialog open={!!newlyCreatedKey} onOpenChange={() => setNewlyCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Check className="h-5 w-5" aria-hidden="true" />
              </div>
              <DialogTitle>{t('apiKeys.keyCreated')}</DialogTitle>
            </div>
          </DialogHeader>
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {t('apiKeys.saveKeyWarning')}
          </p>
          <div className="rounded-md bg-muted px-4 py-3 font-mono text-sm">
            {newlyCreatedKey?.key}
          </div>
          {newlyCreatedKey?.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {newlyCreatedKey.description}
            </p>
          )}
          <DialogFooter>
            <Button onClick={() => void handleCopyKey(newlyCreatedKey?.key ?? '')}>
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('common.actions.copy')}
            </Button>
            <Button variant="outline" onClick={() => setNewlyCreatedKey(null)}>
              {t('common.actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
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
    <Card>
      <CardContent className="space-y-4 pt-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {loading ? (
          <div className="flex h-[280px] items-center justify-center">
            <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
          </div>
        ) : empty ? (
          <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed">
            <span className="text-sm text-muted-foreground">{emptyText}</span>
          </div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: 280 }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
