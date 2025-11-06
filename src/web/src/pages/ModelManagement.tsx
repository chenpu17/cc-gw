import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, customEndpointsApi, toApiError, type ApiError } from '@/services/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { EndpointRoutingConfig, GatewayConfig, ProviderConfig, ProviderModelConfig, RoutingPreset } from '@/types/providers'
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
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
  'claude-sonnet-4-5-20250929-thinking',
  'claude-sonnet-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-opus-4-1-20250805-thinking',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001-thinking',
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

function deriveRoutesFromConfig(
  config: GatewayConfig | null,
  customEndpoints: CustomEndpoint[]
): Record<string, ModelRouteEntry[]> {
  if (!config) return {}

  const result: Record<string, ModelRouteEntry[]> = {}
  const routing = config.endpointRouting ?? {}

  // System endpoints
  result.anthropic = mapRoutesToEntries(routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {})
  result.openai = mapRoutesToEntries(routing.openai?.modelRoutes ?? {})

  // Custom endpoints
  for (const endpoint of customEndpoints) {
    if (endpoint.routing?.modelRoutes) {
      result[endpoint.id] = mapRoutesToEntries(endpoint.routing.modelRoutes)
    } else {
      result[endpoint.id] = []
    }
  }

  return result
}

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const queryClient = useQueryClient()

  const configQuery = useApiQuery<GatewayConfig, ApiError>(
    ['config', 'full'],
    { url: '/api/config', method: 'GET' }
  )

  // Fetch custom endpoints
  const { data: customEndpointsData } = useQuery({
    queryKey: ['custom-endpoints'],
    queryFn: customEndpointsApi.list,
    refetchInterval: 10000
  })

  const customEndpoints = customEndpointsData?.endpoints ?? []

  type Endpoint = string // Can be 'anthropic', 'openai', or custom endpoint ID

  // Generate tabs dynamically
  const tabs = useMemo(() => {
    const baseTabs: Array<{ key: string; label: string; description: string; isSystem: boolean; canDelete: boolean; protocols?: string[] }> = [
      { key: 'providers', label: t('modelManagement.tabs.providers'), description: t('modelManagement.tabs.providersDesc'), isSystem: true, canDelete: false },
      { key: 'anthropic', label: t('modelManagement.tabs.anthropic'), description: t('modelManagement.tabs.anthropicDesc'), isSystem: true, canDelete: false, protocols: ['anthropic'] },
      { key: 'openai', label: t('modelManagement.tabs.openai'), description: t('modelManagement.tabs.openaiDesc'), isSystem: true, canDelete: false, protocols: ['openai-auto', 'openai-chat', 'openai-responses'] }
    ]

    const customTabs = customEndpoints.map((endpoint) => {
      // 支持新旧两种格式
      let pathsText: string
      let protocols: string[] = []

      if (endpoint.paths && endpoint.paths.length > 0) {
        // 新格式：显示所有路径
        const pathsList = endpoint.paths.map(p => `${p.path} (${p.protocol})`).join(', ')
        pathsText = `${t('modelManagement.tabs.customEndpoint')}: ${pathsList}`
        // 收集所有协议
        protocols = [...new Set(endpoint.paths.map(p => p.protocol))]
      } else if (endpoint.path) {
        // 旧格式：单个路径
        const protocol = endpoint.protocol || 'anthropic'
        pathsText = `${t('modelManagement.tabs.customEndpoint')}: ${endpoint.path} (${protocol})`
        protocols = [protocol]
      } else {
        pathsText = t('modelManagement.tabs.customEndpoint')
      }

      return {
        key: endpoint.id,
        label: endpoint.label,
        description: pathsText,
        isSystem: false,
        canDelete: true,
        protocols
      }
    })

    return [...baseTabs, ...customTabs]
  }, [t, customEndpoints])

  const [activeTab, setActiveTab] = useState<string>('providers')
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>(undefined)
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)

  // Endpoint drawer for adding custom endpoints
  const [endpointDrawerOpen, setEndpointDrawerOpen] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | undefined>(undefined)

  // Store routes for all endpoints (including custom ones)
  const [routesByEndpoint, setRoutesByEndpoint] = useState<Record<string, ModelRouteEntry[]>>({})
  const [routeError, setRouteError] = useState<Record<string, string | null>>({})
  const [savingRouteFor, setSavingRouteFor] = useState<string | null>(null)
  const [presetsByEndpoint, setPresetsByEndpoint] = useState<Record<string, RoutingPreset[]>>({})
  const [presetNameByEndpoint, setPresetNameByEndpoint] = useState<Record<string, string>>({})
  const [presetErrorByEndpoint, setPresetErrorByEndpoint] = useState<Record<string, string | null>>({})
  const [savingPresetFor, setSavingPresetFor] = useState<string | null>(null)
  const [applyingPreset, setApplyingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [deletingPreset, setDeletingPreset] = useState<{ endpoint: string; name: string } | null>(null)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testDialogProvider, setTestDialogProvider] = useState<ProviderConfig | null>(null)
  const [testDialogUsePreset, setTestDialogUsePreset] = useState(true)
  const [testDialogPreservedExtras, setTestDialogPreservedExtras] = useState<Record<string, string>>({})
  const [savingClaudeValidation, setSavingClaudeValidation] = useState(false)

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

      setRoutesByEndpoint(deriveRoutesFromConfig(incoming, customEndpoints))
      setRouteError({})

      // Load presets for system endpoints
      const presetsMap: Record<string, RoutingPreset[]> = {
        anthropic: incoming.routingPresets?.anthropic ?? [],
        openai: incoming.routingPresets?.openai ?? []
      }

      // Load presets for custom endpoints
      for (const endpoint of customEndpoints) {
        presetsMap[endpoint.id] = endpoint.routingPresets ?? []
      }

      setPresetsByEndpoint(presetsMap)
    }
  }, [configQuery.data, customEndpoints])

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

    const combinedEntries = [
      ...(routesByEndpoint.anthropic || []),
      ...(routesByEndpoint.openai || [])
    ]

    for (const entry of combinedEntries) {
      const trimmed = entry.target.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        options.push({ value: trimmed, label: trimmed })
      }
    }

    return options
  }, [providers, routesByEndpoint, t])

  const syncPresets = (endpoint: Endpoint, presets: RoutingPreset[]) => {
    setPresetsByEndpoint((prev) => ({
      ...prev,
      [endpoint]: presets
    }))
    setConfig((prev) => {
      if (!prev) return prev

      // 系统端点：保存到 config.routingPresets
      if (endpoint === 'anthropic' || endpoint === 'openai') {
        return {
          ...prev,
          routingPresets: {
            ...prev.routingPresets,
            [endpoint]: presets
          }
        }
      }

      // 自定义端点：保存到 customEndpoints[i].routingPresets
      const customEndpoints = prev.customEndpoints ?? []
      const endpointIndex = customEndpoints.findIndex((e) => e.id === endpoint)
      if (endpointIndex === -1) return prev

      const updatedEndpoints = [...customEndpoints]
      updatedEndpoints[endpointIndex] = {
        ...updatedEndpoints[endpointIndex],
        routingPresets: presets
      }

      return {
        ...prev,
        customEndpoints: updatedEndpoints
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

  const handlePresetNameChange = (endpoint: Endpoint, value: string) => {
    setPresetNameByEndpoint((prev) => ({
      ...prev,
      [endpoint]: value
    }))
    if (value.trim()) {
      setPresetErrorByEndpoint((prev) => ({
        ...prev,
        [endpoint]: null
      }))
    }
  }

  const handleSavePreset = async (endpoint: Endpoint) => {
    if (!ensureConfig()) return
    const trimmed = presetNameByEndpoint[endpoint].trim()
    if (!trimmed) {
      setPresetErrorByEndpoint((prev) => ({
        ...prev,
        [endpoint]: t('modelManagement.validation.presetName')
      }))
      return
    }
    if (presetsByEndpoint[endpoint].some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      setPresetErrorByEndpoint((prev) => ({
        ...prev,
        [endpoint]: t('modelManagement.validation.presetDuplicate', { name: trimmed })
      }))
      return
    }

    setSavingPresetFor(endpoint)
    try {
      const response = await apiClient.post<{ success: boolean; presets: RoutingPreset[] }>(
        `/api/routing-presets/${endpoint}`,
        { name: trimmed }
      )
      const presets = response.data.presets ?? []
      syncPresets(endpoint, presets)
      setPresetNameByEndpoint((prev) => ({
        ...prev,
        [endpoint]: ''
      }))
      setPresetErrorByEndpoint((prev) => ({
        ...prev,
        [endpoint]: null
      }))
      pushToast({ title: t('modelManagement.toast.presetSaved', { name: trimmed }), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('modelManagement.toast.presetSaveFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setSavingPresetFor(null)
      void configQuery.refetch()
    }
  }

  const handleApplyPreset = async (endpoint: Endpoint, preset: RoutingPreset) => {
    if (!ensureConfig()) return
    setApplyingPreset({ endpoint, name: preset.name })
    try {
      const response = await apiClient.post<{ success: boolean; config: GatewayConfig }>(
        `/api/routing-presets/${endpoint}/apply`,
        { name: preset.name }
      )
      const updatedConfig = response.data.config
      if (updatedConfig) {
        setConfig(updatedConfig)
        setRoutesByEndpoint(deriveRoutesFromConfig(updatedConfig, customEndpoints))

        // Update presets for all endpoints
        const presetsMap: Record<string, RoutingPreset[]> = {
          anthropic: updatedConfig.routingPresets?.anthropic ?? [],
          openai: updatedConfig.routingPresets?.openai ?? []
        }
        for (const ep of customEndpoints) {
          const updatedEndpoint = updatedConfig.customEndpoints?.find((e) => e.id === ep.id)
          presetsMap[ep.id] = updatedEndpoint?.routingPresets ?? []
        }
        setPresetsByEndpoint(presetsMap)
      } else {
        setRoutesByEndpoint((prev) => ({
          ...prev,
          [endpoint]: mapRoutesToEntries(preset.modelRoutes)
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

  const handleDeletePreset = async (endpoint: Endpoint, preset: RoutingPreset) => {
    if (!ensureConfig()) return
    const confirmed = window.confirm(t('modelManagement.confirm.deletePreset', { name: preset.name }))
    if (!confirmed) return

    setDeletingPreset({ endpoint, name: preset.name })
    try {
      const response = await apiClient.delete<{ success: boolean; presets: RoutingPreset[] }>(
        `/api/routing-presets/${endpoint}/${encodeURIComponent(preset.name)}`
      )
      const presets = response.data.presets ?? []
      syncPresets(endpoint, presets)
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
    setRoutesByEndpoint(deriveRoutesFromConfig(nextConfig, customEndpoints))
    void configQuery.refetch()

    const toastMessage = drawerMode === 'create'
      ? t('providers.toast.createSuccess', { name: payload.label || payload.id })
      : t('providers.toast.updateSuccess', { name: payload.label || payload.id })

    pushToast({ title: toastMessage, variant: 'success' })
  }

  const handleDeleteEndpoint = async (endpointId: string) => {
    const endpoint = customEndpoints.find((e) => e.id === endpointId)
    if (!endpoint) return

    if (!confirm(t('modelManagement.deleteEndpointConfirm', { label: endpoint.label }))) {
      return
    }

    try {
      await customEndpointsApi.delete(endpointId)
      queryClient.invalidateQueries({ queryKey: ['custom-endpoints'] })
      pushToast({
        title: t('modelManagement.deleteEndpointSuccess'),
        variant: 'success'
      })
      // Switch to providers tab if deleted endpoint was active
      if (activeTab === endpointId) {
        setActiveTab('providers')
      }
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.deleteEndpointError', { error: apiError.message }),
        variant: 'error'
      })
    }
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
      [endpoint]: [...(prev[endpoint] || []), { id: createEntryId(), source: '', target: '' }]
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleToggleClaudeValidation = async (enabled: boolean) => {
    if (!ensureConfig()) return
    setSavingClaudeValidation(true)
    try {
      const currentRouting = config!.endpointRouting ? { ...config!.endpointRouting } : {}
      const currentAnthropic = currentRouting.anthropic ?? {
        defaults: config!.defaults,
        modelRoutes: config!.modelRoutes ?? {}
      }

      const baseRouting: EndpointRoutingConfig = {
        defaults: currentAnthropic.defaults ?? config!.defaults,
        modelRoutes: currentAnthropic.modelRoutes ?? (config!.modelRoutes ?? {})
      }

      let validation = currentAnthropic.validation
      if (enabled) {
        validation = {
          ...(validation ?? {}),
          mode: 'claude-code'
        }
        if (validation.allowExperimentalBlocks === undefined) {
          validation.allowExperimentalBlocks = true
        }
      } else {
        validation = undefined
      }

      const nextAnthropicRouting: EndpointRoutingConfig = validation
        ? { ...baseRouting, validation }
        : { ...baseRouting }

      const nextRouting: NonNullable<GatewayConfig['endpointRouting']> = {
        ...currentRouting,
        anthropic: nextAnthropicRouting
      }

      const nextConfig: GatewayConfig = {
        ...config!,
        endpointRouting: nextRouting
      }

      await apiClient.put('/api/config', nextConfig)
      setConfig(nextConfig)
      pushToast({
        title: enabled
          ? t('modelManagement.toast.claudeValidationEnabled')
          : t('modelManagement.toast.claudeValidationDisabled'),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.toast.claudeValidationFailure', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setSavingClaudeValidation(false)
    }
  }

  const handleAddSuggestion = (endpoint: Endpoint, model: string) => {
    setRoutesByEndpoint((prev) => {
      const currentRoutes = prev[endpoint] || []
      if (currentRoutes.some((entry) => entry.source.trim() === model.trim())) {
        return prev
      }
      return {
        ...prev,
        [endpoint]: [...currentRoutes, { id: createEntryId(), source: model, target: '' }]
      }
    })
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleRouteChange = (endpoint: Endpoint, id: string, field: 'source' | 'target', value: string) => {
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: (prev[endpoint] || []).map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleRemoveRoute = (endpoint: Endpoint, id: string) => {
    setRoutesByEndpoint((prev) => ({
      ...prev,
      [endpoint]: (prev[endpoint] || []).filter((entry) => entry.id !== id)
    }))
    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleResetRoutes = (endpoint: string) => {
    if (!config) return

    // Check if this is a custom endpoint
    const customEndpoint = customEndpoints.find((e) => e.id === endpoint)

    if (customEndpoint) {
      // Reset to custom endpoint's routing config
      const routes = customEndpoint.routing?.modelRoutes ?? {}
      setRoutesByEndpoint((prev) => ({
        ...prev,
        [endpoint]: mapRoutesToEntries(routes)
      }))
    } else {
      // System endpoint
      const routing = config.endpointRouting ?? {}
      const systemEndpoint = endpoint as 'anthropic' | 'openai'
      const fallback = systemEndpoint === 'anthropic' ? config.modelRoutes ?? {} : {}
      const routes = routing[systemEndpoint]?.modelRoutes ?? fallback
      setRoutesByEndpoint((prev) => ({
        ...prev,
        [endpoint]: mapRoutesToEntries(routes)
      }))
    }

    setRouteError((prev) => ({ ...prev, [endpoint]: null }))
  }

  const handleSaveRoutes = async (endpoint: string) => {
    if (!ensureConfig()) return

    const currentEntries = routesByEndpoint[endpoint] || []
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
      // Check if this is a custom endpoint
      const customEndpoint = customEndpoints.find((e) => e.id === endpoint)

      if (customEndpoint) {
        // Save to custom endpoint's routing config
        const updatedRouting = {
          ...(customEndpoint.routing || {}),
          modelRoutes: sanitizedRoutes,
          defaults: customEndpoint.routing?.defaults || config!.defaults
        }

        await customEndpointsApi.update(endpoint, {
          routing: updatedRouting
        })

        queryClient.invalidateQueries({ queryKey: ['custom-endpoints'] })
        pushToast({ title: t('modelManagement.toast.routesSaved'), variant: 'success' })
      } else {
        // System endpoint - save to config.endpointRouting
        const routing = config!.endpointRouting ? { ...config!.endpointRouting } : {}
        const systemEndpoint = endpoint as 'anthropic' | 'openai'

        const existingEndpointRouting = routing[systemEndpoint] ?? {
          defaults: config!.defaults,
          modelRoutes: systemEndpoint === 'anthropic' ? config!.modelRoutes ?? {} : {}
        }

        const updatedEndpointRouting: EndpointRoutingConfig = {
          ...existingEndpointRouting,
          defaults: existingEndpointRouting.defaults ?? config!.defaults,
          modelRoutes: sanitizedRoutes
        }

        const nextRouting: GatewayConfig['endpointRouting'] = {
          ...routing,
          [systemEndpoint]: updatedEndpointRouting
        }

        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: nextRouting,
          modelRoutes: systemEndpoint === 'anthropic' ? sanitizedRoutes : config!.modelRoutes ?? {}
        }

        await apiClient.put('/api/config', nextConfig)
        setConfig(nextConfig)
        pushToast({ title: t('modelManagement.toast.routesSaved'), variant: 'success' })
        void configQuery.refetch()
      }

      setRoutesByEndpoint((prev) => ({
        ...prev,
        [endpoint]: mapRoutesToEntries(sanitizedRoutes)
      }))
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

  const renderPresetsSection = (endpoint: Endpoint) => {
    const presets = presetsByEndpoint[endpoint]
    const presetName = presetNameByEndpoint[endpoint]
    const presetError = presetErrorByEndpoint[endpoint]
    const savingPreset = savingPresetFor === endpoint

    return (
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
              onChange={(event) => handlePresetNameChange(endpoint, event.target.value)}
              placeholder={t('modelManagement.presets.namePlaceholder')}
              className={inputClass}
              disabled={savingPreset}
            />
            <button
              type="button"
              onClick={() => handleSavePreset(endpoint)}
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
        {presets.length === 0 ? (
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
            {presets.map((preset) => {
              const isApplying = applyingPreset?.endpoint === endpoint && applyingPreset?.name === preset.name
              const isDeleting = deletingPreset?.endpoint === endpoint && deletingPreset?.name === preset.name
              return (
                <div
                  key={preset.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/50 bg-gradient-to-r from-white/90 to-white/80 px-4 py-3 text-sm shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-slate-300/70 hover:bg-white/95 hover:shadow-md dark:border-slate-700/50 dark:from-slate-900/90 dark:to-slate-900/80 dark:hover:border-slate-600/70 dark:hover:bg-slate-900/95"
                >
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{preset.name}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleApplyPreset(endpoint, preset)}
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
                      onClick={() => handleDeletePreset(endpoint, preset)}
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
  }

  const renderRoutesSection = (endpoint: Endpoint) => {
    const entries = routesByEndpoint[endpoint] || []
    const error = routeError[endpoint]

    // 查找 tab 信息以获取正确的标签和描述
    const tabInfo = tabs.find((tab) => tab.key === endpoint)

    // 根据协议确定模型建议
    // 如果协议列表包含 'anthropic'，使用 Claude 模型；否则使用 OpenAI 模型
    const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? (endpoint === 'anthropic')
    const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS

    const isSaving = savingRouteFor === endpoint

    const endpointLabel = tabInfo?.label ?? t(`modelManagement.tabs.${endpoint}`)

    // 对于自定义端点，使用 tab 的 description；对于系统端点，使用 i18n key
    const endpointDescription = tabInfo?.isSystem === false
      ? tabInfo.description
      : t(`settings.routing.descriptionByEndpoint.${endpoint}`)

    const sourceListId = `route-source-${endpoint}`
    const targetListId = `route-target-${endpoint}`
    const claudeValidationEnabled =
      endpoint === 'anthropic' &&
      config?.endpointRouting?.anthropic?.validation?.mode === 'claude-code'

    return (
      <section className={surfaceCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {t('settings.routing.titleByEndpoint', { endpoint: endpointLabel })}
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              {endpointDescription}
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

        {endpoint === 'anthropic' && (
          <div className="mt-6 rounded-xl border border-blue-200/60 bg-blue-50/60 p-4 dark:border-blue-500/40 dark:bg-blue-900/30 backdrop-blur-sm">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-blue-700 dark:text-blue-200">
                    {t('modelManagement.claudeValidation.title')}
                  </span>
                  <p className="text-xs text-blue-600/80 dark:text-blue-200/80">
                    {t('modelManagement.claudeValidation.description')}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                    checked={Boolean(claudeValidationEnabled)}
                    onChange={(event) => handleToggleClaudeValidation(event.target.checked)}
                    disabled={savingClaudeValidation}
                  />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-200">
                    {savingClaudeValidation
                      ? t('common.actions.saving')
                      : t('modelManagement.claudeValidation.toggleLabel')}
                  </span>
                </label>
              </div>
              <span
                className={`text-xs font-semibold ${claudeValidationEnabled ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {claudeValidationEnabled
                  ? t('modelManagement.claudeValidation.statusEnabled')
                  : t('modelManagement.claudeValidation.statusDisabled')}
              </span>
            </div>
          </div>
        )}

        {renderPresetsSection(endpoint)}

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
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent dark:from-slate-100 dark:to-slate-300">
              {t('modelManagement.title')}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400">{t('modelManagement.description')}</p>
          </div>
          <button
            onClick={() => {
              setEditingEndpoint(undefined)
              setEndpointDrawerOpen(true)
            }}
            className={primaryButtonClass}
          >
            + {t('modelManagement.addEndpoint')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <div key={tab.key} className="relative">
              <button
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
              {tab.canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteEndpoint(tab.key)
                  }}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center text-xs shadow-md"
                  title={t('common.delete')}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {activeTab === 'providers' ? renderProvidersSection() : renderRoutesSection(activeTab)}

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

      <EndpointDrawer
        open={endpointDrawerOpen}
        endpoint={editingEndpoint}
        onClose={() => {
          setEndpointDrawerOpen(false)
          setEditingEndpoint(undefined)
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['custom-endpoints'] })
        }}
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

function EndpointDrawer({
  open,
  endpoint,
  onClose,
  onSuccess
}: {
  open: boolean
  endpoint?: CustomEndpoint
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const [formData, setFormData] = useState({
    id: '',
    label: '',
    paths: [{ path: '', protocol: 'openai-auto' as EndpointProtocol }],
    enabled: true
  })

  useEffect(() => {
    if (endpoint) {
      // 支持新旧两种格式
      let paths: Array<{ path: string; protocol: EndpointProtocol }>
      if (endpoint.paths && endpoint.paths.length > 0) {
        paths = endpoint.paths
      } else if (endpoint.path && endpoint.protocol) {
        paths = [{ path: endpoint.path, protocol: endpoint.protocol }]
      } else {
        paths = [{ path: '', protocol: 'openai-auto' }]
      }

      setFormData({
        id: endpoint.id,
        label: endpoint.label,
        paths,
        enabled: endpoint.enabled !== false
      })
    } else {
      setFormData({
        id: '',
        label: '',
        paths: [{ path: '', protocol: 'openai-auto' }],
        enabled: true
      })
    }
  }, [endpoint, open])

  const createMutation = useMutation({
    mutationFn: customEndpointsApi.create,
    onSuccess: () => {
      pushToast({
        title: t('modelManagement.createEndpointSuccess'),
        variant: 'success'
      })
      onSuccess()
      onClose()
    },
    onError: (error) => {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.createEndpointError', { error: apiError.message }),
        variant: 'error'
      })
    }
  })

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; updates: any }) =>
      customEndpointsApi.update(data.id, data.updates),
    onSuccess: () => {
      pushToast({
        title: t('modelManagement.updateEndpointSuccess'),
        variant: 'success'
      })
      onSuccess()
      onClose()
    },
    onError: (error) => {
      const apiError = toApiError(error)
      pushToast({
        title: t('modelManagement.updateEndpointError', { error: apiError.message }),
        variant: 'error'
      })
    }
  })

  const handleAddPath = () => {
    setFormData({
      ...formData,
      paths: [...formData.paths, { path: '', protocol: 'anthropic' }]
    })
  }

  const handleRemovePath = (index: number) => {
    if (formData.paths.length === 1) {
      pushToast({
        title: t('modelManagement.atLeastOnePath'),
        variant: 'error'
      })
      return
    }
    const newPaths = formData.paths.filter((_, i) => i !== index)
    setFormData({ ...formData, paths: newPaths })
  }

  const handlePathChange = (index: number, field: 'path' | 'protocol', value: string) => {
    const newPaths = [...formData.paths]
    newPaths[index] = { ...newPaths[index], [field]: value }
    setFormData({ ...formData, paths: newPaths })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.id.trim() || !formData.label.trim()) {
      pushToast({
        title: t('modelManagement.endpointValidationError'),
        variant: 'error'
      })
      return
    }

    // 验证所有路径
    for (const pathItem of formData.paths) {
      if (!pathItem.path.trim()) {
        pushToast({
          title: t('modelManagement.pathValidationError'),
          variant: 'error'
        })
        return
      }
    }

    const paths = formData.paths.map(p => ({
      path: p.path.trim(),
      protocol: p.protocol
    }))

    if (endpoint) {
      updateMutation.mutate({
        id: endpoint.id,
        updates: {
          label: formData.label.trim(),
          paths,
          enabled: formData.enabled
        }
      })
    } else {
      createMutation.mutate({
        id: formData.id.trim(),
        label: formData.label.trim(),
        paths,
        enabled: formData.enabled
      })
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-gray-900 shadow-xl z-50 overflow-y-auto">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {endpoint ? t('modelManagement.editEndpoint') : t('modelManagement.createEndpoint')}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('modelManagement.endpointId')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                className={inputClass}
                placeholder={t('modelManagement.endpointIdPlaceholder')}
                disabled={!!endpoint}
                required
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('modelManagement.endpointIdHint')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('modelManagement.endpointLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                className={inputClass}
                placeholder={t('modelManagement.endpointLabelPlaceholder')}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('modelManagement.endpointPaths')} <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleAddPath}
                  className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  + {t('modelManagement.addPath')}
                </button>
              </div>

              <div className="space-y-3">
                {formData.paths.map((pathItem, index) => (
                  <div
                    key={index}
                    className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={pathItem.path}
                          onChange={(e) => handlePathChange(index, 'path', e.target.value)}
                          className={inputClass}
                          placeholder={t('modelManagement.endpointPathPlaceholder')}
                          required
                        />
                        <select
                          value={pathItem.protocol}
                          onChange={(e) =>
                            handlePathChange(index, 'protocol', e.target.value)
                          }
                          className={selectClass}
                          required
                        >
                          <option value="anthropic">{t('modelManagement.protocolAnthropic')}</option>
                          <option value="openai-auto">{t('modelManagement.protocolOpenAI')}</option>
                        </select>
                      </div>

                      {formData.paths.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePath(index)}
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 mt-1"
                          title={t('modelManagement.removePath')}
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    {index === 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('modelManagement.endpointPathHint')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
              />
              <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">
                {t('modelManagement.endpointEnabled')}
              </label>
            </div>

            {!endpoint && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  {t('modelManagement.endpointRoutingHint')}
                </p>
              </div>
            )}
          </form>

          <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className={`${subtleButtonClass} flex-1`}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              className={`${primaryButtonClass} flex-1`}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? t('common.saving')
                : endpoint
                ? t('common.save')
                : t('common.create')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
