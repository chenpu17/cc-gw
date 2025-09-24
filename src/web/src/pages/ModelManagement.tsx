import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient, type ApiError } from '@/services/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { GatewayConfig, ProviderConfig, ProviderModelConfig } from '@/types/providers'
import { ProviderDrawer } from './providers/ProviderDrawer'

interface ModelRouteEntry {
  id: string
  source: string
  target: string
}

const CLAUDE_MODEL_SUGGESTIONS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-3-5-haiku-20241022'
]

function createEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function mapRoutesToEntries(routes: Record<string, string> | undefined): ModelRouteEntry[] {
  if (!routes) return []
  return Object.entries(routes).map(([source, target]) => ({
    id: createEntryId(),
    source,
    target
  }))
}

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const configQuery = useApiQuery<GatewayConfig, ApiError>(
    ['config', 'full'],
    { url: '/api/config', method: 'GET' }
  )

  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>(undefined)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [modelRouteEntries, setModelRouteEntries] = useState<ModelRouteEntry[]>([])
  const [routeError, setRouteError] = useState<string | null>(null)
  const [savingRoutes, setSavingRoutes] = useState(false)

  const providers = config?.providers ?? []
  const providerCount = providers.length

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data)
      setModelRouteEntries(mapRoutesToEntries(configQuery.data.modelRoutes))
      setRouteError(null)
    }
  }, [configQuery.data])

  useEffect(() => {
    if (configQuery.isError && configQuery.error) {
      pushToast({
        title: t('providers.toast.loadFailure', { message: configQuery.error.message }),
        variant: 'error'
      })
    }
  }, [configQuery.isError, configQuery.error, pushToast, t])

  const defaultLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of providers) {
      if (!provider.defaultModel || !provider.models) continue
      const matched = provider.models.find((model) => model.id === provider.defaultModel)
      if (matched) {
        map.set(provider.id, resolveModelLabel(matched))
      }
    }
    return map
  }, [providers])

  const providerModelOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = []
    const seen = new Set<string>()

    for (const provider of providers) {
      const providerLabel = provider.label || provider.id
      const models = provider.models ?? []

      if (models.length > 0) {
        for (const model of models) {
          const value = `${provider.id}:${model.id}`
          if (seen.has(value)) continue
          seen.add(value)
          options.push({
            value,
            label: `${providerLabel} · ${model.label ?? model.id}`
          })
        }
      } else if (provider.defaultModel) {
        const value = `${provider.id}:${provider.defaultModel}`
        if (!seen.has(value)) {
          seen.add(value)
          options.push({ value, label: `${providerLabel} · ${provider.defaultModel}` })
        }
      }
    }

    for (const entry of modelRouteEntries) {
      const trimmed = entry.target.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        options.push({ value: trimmed, label: trimmed })
      }
    }

    return options
  }, [providers, modelRouteEntries])

  const ensureConfig = () => {
    if (!config) {
      pushToast({ title: t('settings.toast.missingConfig'), variant: 'error' })
      void configQuery.refetch()
      return false
    }
    return true
  }

  const handleOpenCreate = () => {
    if (!ensureConfig()) return
    setDrawerMode('create')
    setEditingProvider(undefined)
    setDrawerOpen(true)
  }

  const handleOpenEdit = (provider: ProviderConfig) => {
    if (!ensureConfig()) return
    setDrawerMode('edit')
    setEditingProvider(provider)
    setDrawerOpen(true)
  }

  const handleSubmit = async (payload: ProviderConfig) => {
    if (!config) {
      throw new Error(t('settings.toast.missingConfig'))
    }

    const nextProviders =
      drawerMode === 'create'
        ? [...providers, payload]
        : providers.map((item) => (editingProvider && item.id === editingProvider.id ? { ...payload, id: editingProvider.id } : item))

    const nextConfig: GatewayConfig = {
      ...config,
      providers: nextProviders
    }

    await apiClient.put('/api/config', nextConfig)
    setConfig(nextConfig)
    setModelRouteEntries(mapRoutesToEntries(nextConfig.modelRoutes))
    void configQuery.refetch()

    const toastMessage = drawerMode === 'create'
      ? t('providers.toast.createSuccess', { name: payload.label || payload.id })
      : t('providers.toast.updateSuccess', { name: payload.label || payload.id })

    pushToast({ title: toastMessage, variant: 'success' })
  }

  const handleTestConnection = async (provider: ProviderConfig) => {
    setTestingProviderId(provider.id)
    try {
      const response = await apiClient.post<{ ok: boolean; status: number; statusText: string }>(
        `/api/providers/${provider.id}/test`
      )
      if (response.data.ok) {
        pushToast({ title: t('providers.toast.testSuccess'), variant: 'success' })
      } else {
        pushToast({
          title: t('providers.toast.testFailure', {
            message: `${response.data.status} ${response.data.statusText}`
          }),
          variant: 'error'
        })
      }
    } catch (error) {
      pushToast({
        title: t('providers.toast.testFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setTestingProviderId(null)
    }
  }

  const handlePlaceholder = (action: string, provider?: Pick<ProviderConfig, 'id' | 'label'>) => {
    const target = provider?.label ?? provider?.id
    pushToast({
      title: t('common.notifications.featureInProgress'),
      description: target ? `${action} (${target})` : undefined,
      variant: 'info'
    })
  }

  const handleAddRoute = () => {
    setModelRouteEntries((prev) => [...prev, { id: createEntryId(), source: '', target: '' }])
    setRouteError(null)
  }

  const handleAddSuggestion = (model: string) => {
    setModelRouteEntries((prev) => {
      if (prev.some((entry) => entry.source.trim() === model)) {
        return prev
      }
      return [...prev, { id: createEntryId(), source: model, target: '' }]
    })
    setRouteError(null)
  }

  const handleRouteChange = (id: string, field: 'source' | 'target', value: string) => {
    setModelRouteEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)))
    setRouteError(null)
  }

  const handleRemoveRoute = (id: string) => {
    setModelRouteEntries((prev) => prev.filter((entry) => entry.id !== id))
    setRouteError(null)
  }

  const handleResetRoutes = () => {
    if (!config) return
    setModelRouteEntries(mapRoutesToEntries(config.modelRoutes))
    setRouteError(null)
  }

  const handleSaveRoutes = async () => {
    if (!ensureConfig()) return

    const sanitizedRoutes: Record<string, string> = {}
    for (const entry of modelRouteEntries) {
      const source = entry.source.trim()
      const target = entry.target.trim()
      if (!source && !target) {
        continue
      }
      if (!source || !target) {
        setRouteError(t('settings.validation.routePair'))
        return
      }
      if (sanitizedRoutes[source]) {
        setRouteError(t('settings.validation.routeDuplicate', { model: source }))
        return
      }
      sanitizedRoutes[source] = target
    }

    setRouteError(null)
    setSavingRoutes(true)
    try {
      const nextConfig: GatewayConfig = {
        ...config!,
        modelRoutes: sanitizedRoutes
      }
      await apiClient.put('/api/config', nextConfig)
      setConfig(nextConfig)
      setModelRouteEntries(mapRoutesToEntries(nextConfig.modelRoutes))
      pushToast({ title: t('modelManagement.toast.routesSaved'), variant: 'success' })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.routesSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingRoutes(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('modelManagement.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('modelManagement.description')}</p>
      </header>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('providers.title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('providers.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>{t('providers.count', { count: providerCount })}</span>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={() => configQuery.refetch()}
              disabled={configQuery.isFetching}
            >
              {configQuery.isFetching ? t('common.actions.refreshing') : t('providers.actions.refresh')}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              onClick={handleOpenCreate}
            >
              {t('providers.actions.add')}
            </button>
          </div>
        </div>

        {configQuery.isPending || (!config && configQuery.isFetching) ? (
          <section className="flex min-h-[200px] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {t('common.loading')}
          </section>
        ) : providers.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            {t('providers.emptyState')}
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <article
                key={provider.id}
                className="flex h-full flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{provider.label || provider.id}</h3>
                      {provider.type ? <TypeBadge type={provider.type} /> : null}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">ID：{provider.id}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Base URL：<span className="break-all text-slate-600 dark:text-slate-300">{provider.baseUrl}</span>
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {provider.defaultModel ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                        {t('providers.card.defaultModel', {
                          model: defaultLabels.get(provider.id) ?? provider.defaultModel
                        })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('providers.card.noDefault')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('providers.card.modelsTitle')}</h4>
                  {provider.models && provider.models.length > 0 ? (
                    <ul className="flex flex-wrap gap-2">
                      {provider.models.map((model) => (
                        <li
                          key={model.id}
                          className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs dark:border-slate-700 dark:bg-slate-800/60"
                        >
                          <span className="font-medium text-slate-700 dark:text-slate-200">{resolveModelLabel(model)}</span>
                          <ModelCapabilitiesBadge model={model} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('providers.card.noModels')}</p>
                  )}
                </div>

                <footer className="mt-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    onClick={() => handleOpenEdit(provider)}
                  >
                    {t('providers.actions.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestConnection(provider)}
                    disabled={testingProviderId === provider.id}
                    className="rounded-md border border-slate-200 px-3 py-1 text-sm transition enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
                  >
                    {testingProviderId === provider.id ? t('common.actions.testingConnection') : t('providers.actions.test')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-3 py-1 text-sm text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40"
                    onClick={() => handlePlaceholder(t('providers.actions.delete'), provider)}
                  >
                    {t('providers.actions.delete')}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t('settings.routing.title')}</h2>
            <p className="max-w-3xl text-xs text-slate-500 dark:text-slate-400">{t('settings.routing.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={handleAddRoute}
              className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {t('settings.routing.add')}
            </button>
            <button
              type="button"
              onClick={handleResetRoutes}
              className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              disabled={savingRoutes}
            >
              {t('common.actions.reset')}
            </button>
            <button
              type="button"
              onClick={handleSaveRoutes}
              className="rounded-md bg-blue-600 px-3 py-1 text-white transition hover:bg-blue-700 disabled:opacity-60"
              disabled={savingRoutes}
            >
              {savingRoutes ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
            </button>
          </div>
        </div>

        {routeError ? <p className="text-xs text-red-500">{routeError}</p> : null}

        {modelRouteEntries.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            {t('settings.routing.empty')}
          </p>
        ) : (
          <div className="grid gap-3">
            {modelRouteEntries.map((entry) => (
              <div key={entry.id} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="flex flex-col gap-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{t('settings.routing.sourceLabel')}</span>
                  <input
                    value={entry.source}
                    onChange={(event) => handleRouteChange(entry.id, 'source', event.target.value)}
                    placeholder={t('settings.routing.sourcePlaceholder')}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
                    disabled={savingRoutes}
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{t('settings.routing.targetLabel')}</span>
                  <select
                    value={entry.target}
                    onChange={(event) => handleRouteChange(entry.id, 'target', event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                    disabled={savingRoutes}
                  >
                    <option value="">{t('modelManagement.routing.selectTarget')}</option>
                    {providerModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end justify-start pb-1 md:justify-end">
                  <button
                    type="button"
                    onClick={() => handleRemoveRoute(entry.id)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    disabled={savingRoutes}
                  >
                    {t('settings.routing.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{t('settings.routing.suggested')}</span>
          {CLAUDE_MODEL_SUGGESTIONS.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => handleAddSuggestion(model)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={savingRoutes}
            >
              {model}
            </button>
          ))}
        </div>
      </section>

      <ProviderDrawer
        open={drawerOpen}
        mode={drawerMode}
        provider={drawerMode === 'edit' ? editingProvider : undefined}
        existingProviderIds={providers
          .map((item) => item.id)
          .filter((id) => (drawerMode === 'edit' && editingProvider ? id !== editingProvider.id : true))}
        onClose={() => {
          setDrawerOpen(false)
          setEditingProvider(undefined)
          setDrawerMode('create')
        }}
        onSubmit={handleSubmit}
      />
    </div>
  )
}

function resolveModelLabel(model: ProviderModelConfig): string {
  if (model.label && model.label.trim().length > 0) {
    return `${model.label} (${model.id})`
  }
  return model.id
}

function ModelCapabilitiesBadge({ model }: { model: ProviderModelConfig }) {
  const caps = model.capabilities
  if (!caps) return null
  const labels: string[] = []
  if (caps.thinking) labels.push('Thinking')
  if (caps.tools) labels.push('Tools')
  if (labels.length === 0) return null
  return (
    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
      {labels.join(' · ')}
    </span>
  )
}

function TypeBadge({ type }: { type: NonNullable<ProviderConfig['type']> }) {
  const map: Record<NonNullable<ProviderConfig['type']>, string> = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    anthropic: 'Anthropic',
    custom: 'Custom'
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {map[type] ?? type}
    </span>
  )
}
