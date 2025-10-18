import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient, type ApiError } from '@/services/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { EndpointRoutingConfig, GatewayConfig, ProviderConfig, ProviderModelConfig, RoutingPreset } from '@/types/providers'
import { ProviderDrawer } from './providers/ProviderDrawer'
import { pageHeaderShellClass, surfaceCardClass, primaryButtonClass, subtleButtonClass, dangerButtonClass, inputClass, selectClass, badgeClass, statusBadgeClass } from '@/styles/theme'

interface ModelRouteEntry {
  id: string
  source: string
  target: string
}

interface ProviderTestResponse {
  ok: boolean
  status: number
  statusText: string
  durationMs?: number
  sample?: string | null
}

interface AnthropicHeaderOption {
  key: string
  value: string
  label: string
  description: string
}

const CLAUDE_MODEL_SUGGESTIONS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-3-5-haiku-20241022'
]

const OPENAI_MODEL_SUGGESTIONS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o4-mini',
  'o4-large',
  'gpt-5-codex'
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

function deriveRoutesFromConfig(config: GatewayConfig | null): Record<'anthropic' | 'openai', ModelRouteEntry[]> {
  if (!config) {
    return {
      anthropic: [],
      openai: []
    }
  }
  const routing = config.endpointRouting ?? {}
  return {
    anthropic: mapRoutesToEntries(routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {}),
    openai: mapRoutesToEntries(routing.openai?.modelRoutes ?? {})
  }
}

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const configQuery = useApiQuery<GatewayConfig, ApiError>(
    ['config', 'full'],
    { url: '/api/config', method: 'GET' }
  )

  type Endpoint = 'anthropic' | 'openai'
  const tabs: Array<{ key: 'providers' | Endpoint; label: string; description: string }> = [
    { key: 'providers', label: t('modelManagement.tabs.providers'), description: t('modelManagement.tabs.providersDesc') },
    { key: 'anthropic', label: t('modelManagement.tabs.anthropic'), description: t('modelManagement.tabs.anthropicDesc') },
    { key: 'openai', label: t('modelManagement.tabs.openai'), description: t('modelManagement.tabs.openaiDesc') }
  ]

  const [activeTab, setActiveTab] = useState<'providers' | Endpoint>('providers')
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>(undefined)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [routesByEndpoint, setRoutesByEndpoint] = useState<Record<Endpoint, ModelRouteEntry[]>>({
    anthropic: [],
    openai: []
  })
  const [routeError, setRouteError] = useState<Record<Endpoint, string | null>>({
    anthropic: null,
    openai: null
  })
  const [savingRouteFor, setSavingRouteFor] = useState<Endpoint | null>(null)
  const [anthropicPresets, setAnthropicPresets] = useState<RoutingPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetError, setPresetError] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null)
  const [deletingPreset, setDeletingPreset] = useState<string | null>(null)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogProvider, setTestDialogProvider] = useState<ProviderConfig | null>(null)
  const [testDialogUsePreset, setTestDialogUsePreset] = useState(true)
  const [testDialogPreservedExtras, setTestDialogPreservedExtras] = useState<Record<string, string>>({})

  const providers = config?.providers ?? []
  const providerCount = providers.length

  const anthropicTestHeaderOptions = useMemo<AnthropicHeaderOption[]>(() => [
    {
      key: 'anthropic-beta',
      value: 'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      label: t('providers.testDialog.options.beta.label'),
      description: t('providers.testDialog.options.beta.description')
    }
  ], [t])

  useEffect(() => {
    if (configQuery.data) {
      const incoming = configQuery.data
      setConfig(incoming)

      setRoutesByEndpoint(deriveRoutesFromConfig(incoming))
      setRouteError({ anthropic: null, openai: null })
      setAnthropicPresets(incoming.routingPresets?.anthropic ?? [])
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

      const passthroughValue = `${provider.id}:*`
      if (!seen.has(passthroughValue)) {
        seen.add(passthroughValue)
        options.push({
          value: passthroughValue,
          label: t('settings.routing.providerPassthroughOption', { provider: providerLabel })
        })
      }
    }

    const combinedEntries = [...routesByEndpoint.anthropic, ...routesByEndpoint.openai]

    for (const entry of combinedEntries) {
      const trimmed = entry.target.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        options.push({ value: trimmed, label: trimmed })
      }
    }

    return options
  }, [providers, routesByEndpoint, t])

  const syncAnthropicPresets = (presets: RoutingPreset[]) => {
    setAnthropicPresets(presets)
    setConfig((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        routingPresets: {
          ...prev.routingPresets,
          anthropic: presets
        }
      }
    })
  }

  const ensureConfig = () => {
    if (!config) {
      pushToast({ title: t('settings.toast.missingConfig'), variant: 'error' })
      void configQuery.refetch()
      return false
    }
    return true
  }

  const ensureUniqueProviderId = (baseId: string): string => {
    if (!config) return baseId
    let candidate = baseId
    let suffix = 1
    while (config.providers.some((provider) => provider.id === candidate)) {
      candidate = `${baseId}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  const handlePresetNameChange = (value: string) => {
    setPresetName(value)
    if (value.trim()) {
      setPresetError(null)
    }
  }

  const handleSavePreset = async () => {
    if (!ensureConfig()) return
    const trimmed = presetName.trim()
    if (!trimmed) {
      setPresetError(t('modelManagement.validation.presetName'))
      return
    }
    if (anthropicPresets.some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      setPresetError(t('modelManagement.validation.presetDuplicate', { name: trimmed }))
      return
    }

    setSavingPreset(true)
    try {
      const response = await apiClient.post<{ success: boolean; presets: RoutingPreset[] }>(
        '/api/routing-presets/anthropic',
        { name: trimmed }
      )
      const presets = response.data.presets ?? []
      syncAnthropicPresets(presets)
      setPresetName('')
      setPresetError(null)
      pushToast({ title: t('modelManagement.toast.presetSaved', { name: trimmed }), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingPreset(false)
      void configQuery.refetch()
    }
  }

  const handleApplyPreset = async (preset: RoutingPreset) => {
    if (!ensureConfig()) return
    setApplyingPreset(preset.name)
    try {
      const response = await apiClient.post<{ success: boolean; config: GatewayConfig }>(
        '/api/routing-presets/anthropic/apply',
        { name: preset.name }
      )
      const updatedConfig = response.data.config
      if (updatedConfig) {
        setConfig(updatedConfig)
        setRoutesByEndpoint(deriveRoutesFromConfig(updatedConfig))
        setAnthropicPresets(updatedConfig.routingPresets?.anthropic ?? [])
      } else {
        setRoutesByEndpoint((prev) => ({
          ...prev,
          anthropic: mapRoutesToEntries(preset.modelRoutes)
        }))
      }
      pushToast({ title: t('modelManagement.toast.presetApplySuccess', { name: preset.name }), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetApplyFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setApplyingPreset(null)
      void configQuery.refetch()
    }
  }

  const handleDeletePreset = async (preset: RoutingPreset) => {
    if (!ensureConfig()) return
    const confirmed = window.confirm(t('modelManagement.confirm.deletePreset', { name: preset.name }))
    if (!confirmed) return

    setDeletingPreset(preset.name)
    try {
      const response = await apiClient.delete<{ success: boolean; presets: RoutingPreset[] }>(
        `/api/routing-presets/anthropic/${encodeURIComponent(preset.name)}`
      )
      const presets = response.data.presets ?? []
      syncAnthropicPresets(presets)
      pushToast({ title: t('modelManagement.toast.presetDeleteSuccess', { name: preset.name }), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetDeleteFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setDeletingPreset(null)
      void configQuery.refetch()
    }
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
    setRoutesByEndpoint(deriveRoutesFromConfig(nextConfig))
    void configQuery.refetch()

    const toastMessage = drawerMode === 'create'
      ? t('providers.toast.createSuccess', { name: payload.label || payload.id })
      : t('providers.toast.updateSuccess', { name: payload.label || payload.id })

    pushToast({ title: toastMessage, variant: 'success' })
  }

  const handleTestConnection = async (
    provider: ProviderConfig,
    options?: { headers?: Record<string, string>; query?: string }
  ) => {
    setTestingProviderId(provider.id)
    try {
      const payload =
        options && (options.headers || options.query)
          ? {
              headers: options.headers && Object.keys(options.headers).length > 0 ? options.headers : undefined,
              query: options.query && options.query.trim().length > 0 ? options.query.trim() : undefined
            }
          : undefined
      const response = await apiClient.post<ProviderTestResponse>(
        `/api/providers/${provider.id}/test`,
        payload
      )
      if (response.data.ok) {
        pushToast({
          title: t('providers.toast.testSuccess'),
          description: t('providers.toast.testSuccessDesc', {
            status: response.data.status,
            duration: response.data.durationMs ? `${response.data.durationMs} ms` : '—'
          }),
          variant: 'success'
        })
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

  const initiateTestConnection = (provider: ProviderConfig) => {
    if (provider.type === 'anthropic') {
      const providerHeaders = provider.extraHeaders ?? {}
      const recommendedLookup = new Map(
        anthropicTestHeaderOptions.map((option) => [option.key.toLowerCase(), option])
      )
      const preservedExtras: Record<string, string> = {}
      let presetDefault = true

      for (const option of anthropicTestHeaderOptions) {
        const match = Object.entries(providerHeaders).find(
          ([headerKey]) => headerKey.toLowerCase() === option.key.toLowerCase()
        )
        if (match) {
          const [headerName, headerValue] = match
          const matchesValue = String(headerValue ?? '') === option.value
          if (!matchesValue) {
            presetDefault = false
            preservedExtras[headerName] = String(headerValue ?? '')
          }
        }
      }

      for (const [headerKey, headerValue] of Object.entries(providerHeaders)) {
        if (recommendedLookup.has(headerKey.toLowerCase())) continue
        preservedExtras[headerKey] = String(headerValue ?? '')
      }

      setTestDialogPreservedExtras(preservedExtras)
      setTestDialogUsePreset(presetDefault)
      setTestDialogProvider(provider)
      setTestDialogOpen(true)
      return
    }
    void handleTestConnection(provider)
  }

  const closeTestDialog = () => {
    setTestDialogOpen(false)
    setTestDialogProvider(null)
    setTestDialogUsePreset(true)
    setTestDialogPreservedExtras({})
  }

  const confirmTestDialog = async () => {
    if (!testDialogProvider) return
    const selectedHeaders: Record<string, string> = {}
    if (testDialogUsePreset) {
      for (const option of anthropicTestHeaderOptions) {
        selectedHeaders[option.key] = option.value
      }
    }
    const recognized = new Map(
      anthropicTestHeaderOptions.map((option) => [option.key.toLowerCase(), option])
    )
    for (const [key, value] of Object.entries(testDialogPreservedExtras)) {
      const lower = key.toLowerCase()
      const matchedOption = recognized.get(lower)
      if (matchedOption && testDialogUsePreset) {
        // User explicitly selected the recommended value; skip preserved override.
        continue
      }
      selectedHeaders[key] = value
    }
    const targetProvider = testDialogProvider
    closeTestDialog()
    await handleTestConnection(
      targetProvider,
      {
        headers: Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined,
        query: testDialogUsePreset ? 'beta=true' : undefined
      }
    )
  }

  const handleDelete = async (provider: ProviderConfig) => {
    if (!ensureConfig()) return
    const confirmed = window.confirm(
      t('providers.confirm.delete', { name: provider.label || provider.id })
    )
    if (!confirmed) return

    const nextProviders = providers.filter((item) => item.id !== provider.id)

    const sanitizeRoutes = (routes: Record<string, string> | undefined): Record<string, string> => {
      const result: Record<string, string> = {}
      if (!routes) return result
      for (const [source, target] of Object.entries(routes)) {
        if (!target) continue
        const [targetProvider] = target.split(':')
        if ((targetProvider && targetProvider === provider.id) || target === provider.id) {
          continue
        }
        result[source] = target
      }
      return result
    }

    const currentRouting = config?.endpointRouting ?? {}
    const sanitizedAnthropic = sanitizeRoutes(currentRouting.anthropic?.modelRoutes ?? config?.modelRoutes ?? {})
    const sanitizedOpenAI = sanitizeRoutes(currentRouting.openai?.modelRoutes ?? {})

    const nextConfig: GatewayConfig = {
      ...config!,
      providers: nextProviders,
      modelRoutes: sanitizedAnthropic,
      endpointRouting: {
        anthropic: {
          defaults: currentRouting.anthropic?.defaults ?? config!.defaults,
          modelRoutes: sanitizedAnthropic
        },
        openai: {
          defaults: currentRouting.openai?.defaults ?? config!.defaults,
          modelRoutes: sanitizedOpenAI
        }
      }
    }

    try {
      await apiClient.put('/api/config', nextConfig)
      setConfig(nextConfig)
      setRoutesByEndpoint({
        anthropic: mapRoutesToEntries(sanitizedAnthropic),
        openai: mapRoutesToEntries(sanitizedOpenAI)
      })
      pushToast({
        title: t('providers.toast.deleteSuccess', { name: provider.label || provider.id }),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('providers.toast.deleteFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    }
  }

  const handleAddRoute = (endpoint: Endpoint) => {
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: [...prev[endpoint], { id: createEntryId(), source: '', target: '' }]
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleAddSuggestion = (endpoint: Endpoint, model: string) => {
    setRoutesByEndpoint((prev) => {
      if (prev[endpoint].some((entry) => entry.source.trim() === model.trim())) {
        return prev
      }
      return {
        ...prev,
        [endpoint]: [...prev[endpoint], { id: createEntryId(), source: model, target: '' }]
      }
    })
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleRouteChange = (endpoint: Endpoint, id: string, field: 'source' | 'target', value: string) => {
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: prev[endpoint].map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleRemoveRoute = (endpoint: Endpoint, id: string) => {
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: prev[endpoint].filter((entry) => entry.id !== id)
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleResetRoutes = (endpoint: Endpoint) => {
    if (!config) return
    const routing = config.endpointRouting ?? {}
    const fallback = endpoint === 'anthropic' ? config.modelRoutes ?? {} : {}
    const routes = routing[endpoint]?.modelRoutes ?? fallback
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: mapRoutesToEntries(routes)
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleSaveRoutes = async (endpoint: Endpoint) => {
    if (!ensureConfig()) return

    const currentEntries = routesByEndpoint[endpoint]
    const sanitizedRoutes: Record<string, string> = {}
    for (const entry of currentEntries) {
      const source = entry.source.trim()
      const target = entry.target.trim()
      if (!source && !target) {
        continue
      }
      if (!source || !target) {
        setRouteError((prev) => ({ ...prev, [endpoint]: t('settings.validation.routePair') }))
        return
      }
      if (sanitizedRoutes[source]) {
        setRouteError((prev) => ({
          ...prev,
          [endpoint]: t('settings.validation.routeDuplicate', { model: source })
        }))
        return
      }
      sanitizedRoutes[source] = target
    }

    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
    setSavingRouteFor(endpoint)
    try {
      const routing = config!.endpointRouting ? { ...config!.endpointRouting } : {}

      const existingEndpointRouting = routing[endpoint] ?? {
        defaults: config!.defaults,
        modelRoutes: endpoint === 'anthropic' ? config!.modelRoutes ?? {} : {}
      }

      const updatedEndpointRouting: EndpointRoutingConfig = {
        ...existingEndpointRouting,
        defaults: existingEndpointRouting.defaults ?? config!.defaults,
        modelRoutes: sanitizedRoutes
      }

      const nextRouting: GatewayConfig['endpointRouting'] = {
        ...routing,
        [endpoint]: updatedEndpointRouting
      }

      const nextConfig: GatewayConfig = {
        ...config!,
        endpointRouting: nextRouting,
        modelRoutes: endpoint === 'anthropic' ? sanitizedRoutes : config!.modelRoutes ?? {}
      }

      await apiClient.put('/api/config', nextConfig)
      setConfig(nextConfig)
      setRoutesByEndpoint((prev) => ({
        ...prev,
        [endpoint]: mapRoutesToEntries(sanitizedRoutes)
      }))
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
      setSavingRouteFor(null)
    }
  }

  const renderProvidersSection = () => (
    <section className={surfaceCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('providers.title')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('providers.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={badgeClass.default}>
            {t('providers.count', { count: providerCount })}
          </div>
          <button
            type="button"
            className={subtleButtonClass}
            onClick={() => configQuery.refetch()}
            disabled={configQuery.isFetching}
          >
            {configQuery.isFetching ? t('common.actions.refreshing') : t('providers.actions.refresh')}
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={handleOpenCreate}
          >
            {t('providers.actions.add')}
          </button>
        </div>
      </div>

      {configQuery.isPending || (!config && configQuery.isFetching) ? (
        <section className="flex min-h-[200px] items-center justify-center rounded-3xl border border-slate-200/50 bg-gradient-to-br from-white/80 to-white/70 text-sm text-slate-600 dark:border-slate-700/50 dark:from-slate-900/80 dark:to-slate-900/70 dark:text-slate-400 backdrop-blur-lg">
          {t('common.loading')}
        </section>
      ) : providers.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-300/60 bg-gradient-to-br from-slate-50/80 to-white/70 p-12 text-center text-sm text-slate-600 dark:border-slate-600/60 dark:from-slate-900/80 dark:to-slate-800/70 dark:text-slate-400 backdrop-blur-lg">
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-slate-200/50 p-4 dark:bg-slate-700/50">
              <svg className="h-8 w-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-300">{t('providers.emptyState')}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('providers.emptyStateSub', { default: '点击上方按钮添加您的第一个提供商' })}
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <article
              key={provider.id}
              className="group flex h-full flex-col gap-5 rounded-3xl border border-slate-200/50 bg-gradient-to-br from-white/85 via-white/80 to-white/75 p-6 shadow-lg shadow-slate-200/30 backdrop-blur-md transition-all duration-300 hover:border-slate-200/70 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 dark:border-slate-700/50 dark:from-slate-900/85 dark:via-slate-900/80 dark:to-slate-900/75 dark:shadow-2xl dark:shadow-slate-900/40 dark:hover:border-slate-600/70 dark:hover:bg-slate-900/90"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
                      <span className="text-lg font-bold">
                        {(provider.label || provider.id).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{provider.label || provider.id}</h3>
                        {provider.type ? <TypeBadge type={provider.type} /> : null}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">ID: {provider.id}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                      Base URL:
                    </p>
                    <p className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-100/50 dark:bg-slate-800/50 rounded-lg px-2 py-1 break-all">
                      {provider.baseUrl}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {provider.defaultModel ? (
                    <div className={statusBadgeClass.success}>
                      {t('providers.card.defaultModel', {
                        model: defaultLabels.get(provider.id) ?? provider.defaultModel
                      })}
                    </div>
                  ) : (
                    <div className={statusBadgeClass.info}>
                      {t('providers.card.noDefault')}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300">{t('providers.card.modelsTitle')}</h4>
                {provider.models && provider.models.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {provider.models.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 rounded-xl border border-slate-200/60 bg-gradient-to-r from-slate-50/80 to-slate-100/70 px-3 py-1.5 text-xs dark:border-slate-700/60 dark:from-slate-800/60 dark:to-slate-700/50 backdrop-blur-sm transition-all duration-200 hover:border-slate-300/70 hover:bg-slate-100/80 dark:hover:border-slate-600/70 dark:hover:bg-slate-700/60"
                      >
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
                        <span className="font-medium text-slate-700 dark:text-slate-200">{resolveModelLabel(model)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300/50 bg-slate-50/50 px-4 py-3 text-xs text-slate-500 dark:border-slate-600/50 dark:bg-slate-800/30 dark:text-slate-400">
                    {t('providers.card.noModels')}
                  </div>
                )}
              </div>

              <footer className="mt-auto flex flex-wrap gap-3 pt-2 border-t border-slate-200/30 dark:border-slate-700/30">
                <button
                  type="button"
                  className={subtleButtonClass}
                  onClick={() => handleOpenEdit(provider)}
                >
                  {t('providers.actions.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => initiateTestConnection(provider)}
                  disabled={testingProviderId === provider.id}
                  className={testingProviderId === provider.id ?
                    `${subtleButtonClass} opacity-60 cursor-not-allowed` :
                    subtleButtonClass
                  }
                >
                  {testingProviderId === provider.id ? t('common.actions.testingConnection') : t('providers.actions.test')}
                </button>
                <button
                  type="button"
                  className={dangerButtonClass}
                  onClick={() => handleDelete(provider)}
                >
                  {t('providers.actions.delete')}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  )

  const renderAnthropicPresets = () => (
    <div className="rounded-2xl border border-dashed border-slate-300/60 bg-gradient-to-br from-slate-50/80 to-white/70 p-6 dark:border-slate-600/60 dark:from-slate-800/60 dark:to-slate-900/70 backdrop-blur-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            {t('modelManagement.presets.title')}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('modelManagement.presets.description')}
          </p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="text"
            value={presetName}
            onChange={(event) => handlePresetNameChange(event.target.value)}
            placeholder={t('modelManagement.presets.namePlaceholder')}
            className={inputClass}
            disabled={savingPreset}
          />
          <button
            type="button"
            onClick={handleSavePreset}
            className={primaryButtonClass}
            disabled={savingPreset}
          >
            {savingPreset ? t('modelManagement.presets.saving') : t('modelManagement.presets.save')}
          </button>
        </div>
      </div>
      {presetError ? (
        <div className="rounded-xl bg-red-50/80 border border-red-200/50 p-3 text-xs text-red-700 dark:bg-red-900/40 dark:border-red-800/50 dark:text-red-300 backdrop-blur-sm">
          {presetError}
        </div>
      ) : null}
      {anthropicPresets.length === 0 ? (
        <div className="rounded-xl border border-slate-200/40 bg-slate-50/60 p-6 text-center text-sm text-slate-600 dark:border-slate-700/40 dark:bg-slate-800/40 dark:text-slate-400 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl bg-slate-200/50 p-3 dark:bg-slate-700/50">
              <svg className="h-6 w-6 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="font-medium text-slate-700 dark:text-slate-300">{t('modelManagement.presets.empty')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {anthropicPresets.map((preset) => {
            const isApplying = applyingPreset === preset.name
            const isDeleting = deletingPreset === preset.name
            return (
              <div
                key={preset.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/50 bg-gradient-to-r from-white/90 to-white/80 px-4 py-3 text-sm shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-slate-300/70 hover:bg-white/95 hover:shadow-md dark:border-slate-700/50 dark:from-slate-900/90 dark:to-slate-900/80 dark:hover:border-slate-600/70 dark:hover:bg-slate-900/95"
              >
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">{preset.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={isApplying || isDeleting ?
                      `${subtleButtonClass} opacity-60 cursor-not-allowed text-xs px-2 py-1` :
                      `${primaryButtonClass} text-xs px-2 py-1`
                    }
                    disabled={isApplying || isDeleting}
                  >
                    {isApplying ? t('modelManagement.presets.applying') : t('modelManagement.presets.apply')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePreset(preset)}
                    className={isDeleting || isApplying ?
                      `${subtleButtonClass} opacity-60 cursor-not-allowed text-xs px-2 py-1` :
                      `${dangerButtonClass} text-xs px-2 py-1`
                    }
                    disabled={isDeleting || isApplying}
                  >
                    {isDeleting ? t('modelManagement.presets.deleting') : t('modelManagement.presets.delete')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderRoutesSection = (endpoint: Endpoint) => {
    const entries = routesByEndpoint[endpoint]
    const error = routeError[endpoint]
    const suggestions = endpoint === 'anthropic' ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS
    const isSaving = savingRouteFor === endpoint
    const endpointLabel = t(`modelManagement.tabs.${endpoint}`)
    const sourceListId = `route-source-${endpoint}`
    const targetListId = `route-target-${endpoint}`

    return (
      <section className={surfaceCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {t('settings.routing.titleByEndpoint', { endpoint: endpointLabel })}
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              {t(`settings.routing.descriptionByEndpoint.${endpoint}`)}
            </p>
            <p className="max-w-3xl text-xs text-slate-500 dark:text-slate-400">
              {t('settings.routing.wildcardHint')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleAddRoute(endpoint)}
              className={subtleButtonClass}
              disabled={isSaving}
            >
              {t('settings.routing.add')}
            </button>
            <button
              type="button"
              onClick={() => handleResetRoutes(endpoint)}
              className={subtleButtonClass}
              disabled={isSaving}
            >
              {t('common.actions.reset')}
            </button>
            <button
              type="button"
              onClick={() => handleSaveRoutes(endpoint)}
              className={primaryButtonClass}
              disabled={isSaving}
            >
              {isSaving ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
            </button>
          </div>
        </div>

        {endpoint === 'anthropic' ? renderAnthropicPresets() : null}

        {error ? (
          <div className="rounded-xl bg-red-50/80 border border-red-200/50 p-4 text-sm text-red-700 dark:bg-red-900/40 dark:border-red-800/50 dark:text-red-300 backdrop-blur-sm">
            {error}
          </div>
        ) : null}

        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300/60 bg-gradient-to-br from-slate-50/80 to-white/70 p-12 text-center text-sm text-slate-600 dark:border-slate-600/60 dark:from-slate-800/60 dark:to-slate-900/70 dark:text-slate-400 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl bg-slate-200/50 p-4 dark:bg-slate-700/50">
                <svg className="h-8 w-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">{t('settings.routing.empty')}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t('settings.routing.emptySub', { default: '点击上方按钮添加路由规则' })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry, index) => (
              <div key={entry.id} className="rounded-xl border border-slate-200/50 bg-gradient-to-r from-white/90 to-white/85 p-4 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-slate-300/70 hover:bg-white/95 hover:shadow-md dark:border-slate-700/50 dark:from-slate-900/90 dark:to-slate-900/85 dark:hover:border-slate-600/70 dark:hover:bg-slate-900/95">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                    <span className="text-sm font-bold">{index + 1}</span>
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">路由规则</span>
                </div>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-2">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300">{t('settings.routing.source')}</span>
                      <input
                        type="text"
                        value={entry.source}
                        onChange={(event) => handleRouteChange(endpoint, entry.id, 'source', event.target.value)}
                        className={inputClass}
                        placeholder="claude-3.5-sonnet"
                        list={sourceListId}
                        disabled={isSaving}
                      />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300">{t('settings.routing.target')}</span>
                      {(() => {
                        const normalizedTarget = entry.target.trim()
                        const hasMatchingOption = providerModelOptions.some((option) => option.value === normalizedTarget)
                        const selectValue = hasMatchingOption ? normalizedTarget : '__custom'
                        return (
                          <>
                            <select
                              value={selectValue}
                              onChange={(event) => {
                                const value = event.target.value
                                if (value === '__custom') {
                                  handleRouteChange(endpoint, entry.id, 'target', normalizedTarget)
                                } else {
                                  handleRouteChange(endpoint, entry.id, 'target', value)
                                }
                              }}
                              className={selectClass}
                              disabled={isSaving}
                            >
                              <option value="__custom">{t('settings.routing.customTargetOption')}</option>
                              {providerModelOptions.map((option) => (
                                <option key={`${targetListId}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {selectValue === '__custom' && (
                              <input
                                type="text"
                                value={entry.target}
                                onChange={(event) => handleRouteChange(endpoint, entry.id, 'target', event.target.value)}
                                className={inputClass}
                                placeholder="providerId:modelId"
                                disabled={isSaving}
                              />
                            )}
                          </>
                        )
                      })()}
                    </label>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className={dangerButtonClass}
                      onClick={() => handleRemoveRoute(endpoint, entry.id)}
                      disabled={isSaving}
                    >
                      {t('settings.routing.remove')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-slate-200/40 bg-gradient-to-r from-slate-50/80 to-white/70 p-4 dark:border-slate-700/40 dark:from-slate-800/60 dark:to-slate-900/70 backdrop-blur-sm">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-slate-600 dark:text-slate-300">
              {t('settings.routing.suggested')}
            </span>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((model) => (
                <button
                  key={`${endpoint}-${model}`}
                  type="button"
                  onClick={() => handleAddSuggestion(endpoint, model)}
                  className={subtleButtonClass}
                  disabled={isSaving}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        </div>

        <datalist id={sourceListId}>
          {suggestions.map((model) => (
            <option key={`${sourceListId}-${model}`} value={model} />
          ))}
        </datalist>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className={pageHeaderShellClass}>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent dark:from-slate-100 dark:to-slate-300">
            {t('modelManagement.title')}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400">{t('modelManagement.description')}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex min-w-[240px] flex-col gap-2 rounded-2xl border px-6 py-4 text-left transition-all duration-300 hover-lift ${
                isActive
                  ? 'border-blue-500/30 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 shadow-lg shadow-blue-200/40 ring-1 ring-blue-500/20 dark:border-blue-400/30 dark:from-blue-900/40 dark:to-indigo-900/30 dark:text-blue-100 dark:shadow-xl dark:shadow-blue-500/20 dark:ring-blue-400/20'
                  : 'border-slate-200/50 bg-white/80 hover:bg-white/90 hover:shadow-md hover:shadow-slate-200/30 dark:border-slate-700/50 dark:bg-slate-900/80 dark:hover:bg-slate-900/90 dark:hover:shadow-lg dark:hover:shadow-slate-900/30'
              }`}
            >
              <span className="text-base font-bold">{tab.label}</span>
              <span className="text-sm text-slate-600 dark:text-slate-400">{tab.description}</span>
            </button>
          )
        })}
      </div>

      {activeTab === 'providers' ? renderProvidersSection() : renderRoutesSection(activeTab as Endpoint)}

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

      <TestConnectionDialog
        open={testDialogOpen}
        provider={testDialogProvider}
        options={anthropicTestHeaderOptions}
        preservedExtras={testDialogPreservedExtras}
        usePreset={testDialogUsePreset}
        onPresetChange={setTestDialogUsePreset}
        onConfirm={confirmTestDialog}
        onClose={closeTestDialog}
      />
    </div>
  )
}

function TestConnectionDialog({
  open,
  provider,
  options,
  usePreset,
  preservedExtras,
  onPresetChange,
  onConfirm,
  onClose
}: {
  open: boolean
  provider: ProviderConfig | null
  options: AnthropicHeaderOption[]
  usePreset: boolean
  preservedExtras: Record<string, string>
  onPresetChange: (value: boolean) => void
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useTranslation()

  if (!open || !provider) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-test-dialog-title"
        className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-2xl backdrop-blur-xl animate-fade-in dark:border-slate-800/60 dark:bg-slate-900/95"
      >
        <header className="mb-4 space-y-1">
          <h2 id="connection-test-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t('providers.testDialog.title')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('providers.testDialog.subtitle', { name: provider.label || provider.id })}
          </p>
        </header>
        <p className="mb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t('providers.testDialog.description')}
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/70 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-blue-500/60 dark:hover:bg-slate-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={usePreset}
              onChange={(event) => onPresetChange(event.target.checked)}
            />
            <div className="space-y-2">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t('providers.testDialog.presetLabel')}
              </span>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t('providers.testDialog.presetDescription')}
              </p>
              <details className="rounded-lg bg-slate-50/60 px-3 py-2 text-xs text-slate-600 transition dark:bg-slate-800/50 dark:text-slate-300">
                <summary className="cursor-pointer text-blue-600 hover:underline dark:text-blue-300">
                  {t('providers.testDialog.presetPreviewSummary')}
                </summary>
                <div className="mt-2 grid gap-1">
                  {options.map((option) => (
                    <code
                      key={option.key}
                      className="rounded bg-white/80 px-2 py-1 text-[11px] text-slate-700 shadow-sm dark:bg-slate-900/60 dark:text-slate-200"
                    >
                      {option.key}: {option.value}
                    </code>
                  ))}
                </div>
              </details>
            </div>
          </label>
        </div>
        {Object.keys(preservedExtras).length > 0 ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <p className="mb-2 font-semibold text-slate-700 dark:text-slate-200">
              {t('providers.testDialog.preservedInfo')}
            </p>
            <div className="grid gap-2">
              {Object.entries(preservedExtras).map(([key, value]) => (
                <code
                  key={key}
                  className="rounded bg-white/70 px-2 py-1 text-[11px] text-slate-700 shadow-sm dark:bg-slate-900/70 dark:text-slate-200"
                >
                  {key}: {value}
                </code>
              ))}
            </div>
          </div>
        ) : null}
        <footer className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className={subtleButtonClass}
          >
            {t('providers.testDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm()
            }}
            className={primaryButtonClass}
          >
            {t('providers.testDialog.primary')}
          </button>
        </footer>
      </div>
    </div>
  )
}


function resolveModelLabel(model: ProviderModelConfig): string {
  if (model.label && model.label.trim().length > 0) {
    return `${model.label} (${model.id})`
  }
  return model.id
}

function TypeBadge({ type }: { type: NonNullable<ProviderConfig['type']> }) {
  const config: Record<NonNullable<ProviderConfig['type']>, { label: string; color: string }> = {
    openai: { label: 'OpenAI', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    deepseek: { label: 'DeepSeek', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    huawei: { label: '华为云', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    kimi: { label: 'Kimi', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    anthropic: { label: 'Anthropic', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    custom: { label: 'Custom', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
  }
  const { label, color } = config[type] || config.custom
  return (
    <span className={`rounded-full ${color} px-2.5 py-1 text-xs font-semibold shadow-sm`}>
      {label}
    </span>
  )
}
