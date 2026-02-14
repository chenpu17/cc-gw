import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, ChevronRight, Layers, Plus, RefreshCw, X } from 'lucide-react'
import { apiClient, customEndpointsApi, toApiError, type ApiError } from '@/services/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { EndpointRoutingConfig, GatewayConfig, ProviderConfig, ProviderModelConfig, RoutingPreset } from '@/types/providers'
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
import { ProviderDrawer } from './providers/ProviderDrawer'

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

  result.anthropic = mapRoutesToEntries(routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {})
  result.openai = mapRoutesToEntries(routing.openai?.modelRoutes ?? {})

  for (const endpoint of customEndpoints) {
    if (endpoint.routing?.modelRoutes) {
      result[endpoint.id] = mapRoutesToEntries(endpoint.routing.modelRoutes)
    } else {
      result[endpoint.id] = []
    }
  }

  return result
}

function getSavedRoutesFromConfig(
  config: GatewayConfig,
  customEndpoints: CustomEndpoint[],
  endpoint: string
): Record<string, string> {
  const customEndpoint = customEndpoints.find((e) => e.id === endpoint)
  if (customEndpoint) return customEndpoint.routing?.modelRoutes ?? {}

  const routing = config.endpointRouting ?? {}
  if (endpoint === 'anthropic') return routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {}
  if (endpoint === 'openai') return routing.openai?.modelRoutes ?? {}
  return {}
}

function mapEntriesToRoutes(entries: ModelRouteEntry[]): Record<string, string> {
  const routes: Record<string, string> = {}
  for (const entry of entries) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source && target) {
      routes[source] = target
    }
  }
  return routes
}

function areRouteEntriesDirty(entries: ModelRouteEntry[], saved: Record<string, string>): boolean {
  return JSON.stringify(mapEntriesToRoutes(entries)) !== JSON.stringify(saved)
}

function isAnthropicEndpoint(endpoint: string, customEndpoints: CustomEndpoint[]): boolean {
  if (endpoint === 'anthropic') {
    return true
  }
  const customEndpoint = customEndpoints.find((e) => e.id === endpoint)
  if (!customEndpoint) {
    return false
  }
  if (customEndpoint.paths && customEndpoint.paths.length > 0) {
    return customEndpoint.paths.some((p) => p.protocol === 'anthropic')
  }
  return customEndpoint.protocol === 'anthropic'
}

function getEndpointValidation(
  endpoint: string,
  config: GatewayConfig | null,
  customEndpoints: CustomEndpoint[]
): { mode: string; allowExperimentalBlocks?: boolean } | undefined {
  if (!config) return undefined

  if (endpoint === 'anthropic' || endpoint === 'openai') {
    return config.endpointRouting?.[endpoint]?.validation
  }

  const customEndpoint = customEndpoints.find((e) => e.id === endpoint)
  return customEndpoint?.routing?.validation
}

export default function ModelManagementPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const queryClient = useQueryClient()

  const configQuery = useApiQuery<GatewayConfig, ApiError>(
    ['config', 'full'],
    { url: '/api/config', method: 'GET' }
  )

  const { data: customEndpointsData } = useQuery({
    queryKey: ['custom-endpoints'],
    queryFn: customEndpointsApi.list,
    refetchInterval: 10000
  })

  const customEndpoints = customEndpointsData?.endpoints ?? []

  type Endpoint = string

  const tabs = useMemo(() => {
    const baseTabs: Array<{ key: string; label: string; description: string; isSystem: boolean; canDelete: boolean; protocols?: string[] }> = [
      { key: 'providers', label: t('modelManagement.tabs.providers'), description: t('modelManagement.tabs.providersDesc'), isSystem: true, canDelete: false },
      { key: 'anthropic', label: t('modelManagement.tabs.anthropic'), description: t('modelManagement.tabs.anthropicDesc'), isSystem: true, canDelete: false, protocols: ['anthropic'] },
      { key: 'openai', label: t('modelManagement.tabs.openai'), description: t('modelManagement.tabs.openaiDesc'), isSystem: true, canDelete: false, protocols: ['openai-auto', 'openai-chat', 'openai-responses'] }
    ]

    const customTabs = customEndpoints.map((endpoint) => {
      let pathsText: string
      let protocols: string[] = []

      if (endpoint.paths && endpoint.paths.length > 0) {
        const pathsList = endpoint.paths.map(p => `${p.path} (${p.protocol})`).join(', ')
        pathsText = `${t('modelManagement.tabs.customEndpoint')}: ${pathsList}`
        protocols = [...new Set(endpoint.paths.map(p => p.protocol))]
      } else if (endpoint.path) {
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
        canDelete: endpoint.deletable !== false,
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

  const [endpointDrawerOpen, setEndpointDrawerOpen] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<CustomEndpoint | undefined>(undefined)

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
  const [presetsExpanded, setPresetsExpanded] = useState<Record<string, boolean>>({})
  const [presetDiffDialog, setPresetDiffDialog] = useState<{ endpoint: string; preset: RoutingPreset } | null>(null)

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
      setRoutesByEndpoint((previous) => {
        const nextFromServer = deriveRoutesFromConfig(incoming, customEndpoints)
        if (!previous || Object.keys(previous).length === 0) {
          return nextFromServer
        }

        const merged: Record<string, ModelRouteEntry[]> = { ...nextFromServer }
        for (const [endpoint, previousEntries] of Object.entries(previous)) {
          if (!(endpoint in nextFromServer)) continue
          const savedRoutes = getSavedRoutesFromConfig(incoming, customEndpoints, endpoint)
          if (areRouteEntriesDirty(previousEntries, savedRoutes)) {
            merged[endpoint] = previousEntries
          }
        }
        return merged
      })
      setRouteError({})

      const presetsMap: Record<string, RoutingPreset[]> = {
        anthropic: incoming.routingPresets?.anthropic ?? [],
        openai: incoming.routingPresets?.openai ?? []
      }

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
      const providerDisplay =
        provider.label && provider.label !== provider.id
          ? `${provider.label} (${provider.id})`
          : provider.id
      const models = provider.models ?? []

      if (models.length > 0) {
        for (const model of models) {
          const value = `${provider.id}:${model.id}`
          if (seen.has(value)) continue
          seen.add(value)
          options.push({
            value,
            label: `${providerDisplay} · ${model.label ?? model.id}`
          })
        }
      } else if (provider.defaultModel) {
        const value = `${provider.id}:${provider.defaultModel}`
        if (!seen.has(value)) {
          seen.add(value)
          options.push({ value, label: `${providerDisplay} · ${provider.defaultModel}` })
        }
      }

      const passthroughValue = `${provider.id}:*`
      if (!seen.has(passthroughValue)) {
        seen.add(passthroughValue)
        options.push({
          value: passthroughValue,
          label: t('settings.routing.providerPassthroughOption', { provider: providerDisplay })
        })
      }
    }

    const combinedEntries = Object.values(routesByEndpoint).flat()

    for (const entry of combinedEntries) {
      const trimmed = entry.target.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        options.push({ value: trimmed, label: trimmed })
      }
    }

    return options
  }, [providers, routesByEndpoint, t])

  const getSavedRoutes = (endpoint: string): Record<string, string> => {
    if (!config) return {}
    return getSavedRoutesFromConfig(config, customEndpoints, endpoint)
  }

  const computeIsDirty = (entries: ModelRouteEntry[], saved: Record<string, string>): boolean => {
    return areRouteEntriesDirty(entries, saved)
  }

  const isDirtyByEndpoint = useMemo(() => {
    const result: Record<string, boolean> = {}
    for (const tab of tabs) {
      if (tab.key === 'providers') continue
      const entries = routesByEndpoint[tab.key] || []
      const saved = getSavedRoutes(tab.key)
      result[tab.key] = computeIsDirty(entries, saved)
    }
    return result
  }, [routesByEndpoint, config, customEndpoints, tabs])

  const syncPresets = (endpoint: Endpoint, presets: RoutingPreset[]) => {
    setPresetsByEndpoint((prev) => ({
      ...prev,
      [endpoint]: presets
    }))
    setConfig((prev) => {
      if (!prev) return prev

      if (endpoint === 'anthropic' || endpoint === 'openai') {
        return {
          ...prev,
          routingPresets: {
            ...prev.routingPresets,
            [endpoint]: presets
          }
        }
      }

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
    if (endpoint.deletable === false) return

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

  const handleToggleClaudeValidation = async (endpoint: string, enabled: boolean) => {
    if (!ensureConfig()) return
    setSavingClaudeValidation(true)
    try {
      if (endpoint === 'anthropic' || endpoint === 'openai') {
        const currentRouting = config!.endpointRouting ? { ...config!.endpointRouting } : {}
        const currentEndpointRouting = currentRouting[endpoint] ?? {
          defaults: config!.defaults,
          modelRoutes: (endpoint === 'anthropic' ? config!.modelRoutes : {}) ?? {}
        }

        const baseRouting: EndpointRoutingConfig = {
          defaults: currentEndpointRouting.defaults ?? config!.defaults,
          modelRoutes: currentEndpointRouting.modelRoutes ?? {}
        }

        let validation = currentEndpointRouting.validation
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

        const nextEndpointRouting: EndpointRoutingConfig = validation
          ? { ...baseRouting, validation }
          : { ...baseRouting }

        const nextRouting: NonNullable<GatewayConfig['endpointRouting']> = {
          ...currentRouting,
          [endpoint]: nextEndpointRouting
        }

        const nextConfig: GatewayConfig = {
          ...config!,
          endpointRouting: nextRouting
        }

        await apiClient.put('/api/config', nextConfig)
        setConfig(nextConfig)
      } else {
        const customEndpoints = config!.customEndpoints ?? []
        const endpointIndex = customEndpoints.findIndex((e) => e.id === endpoint)
        if (endpointIndex === -1) {
          throw new Error(t('modelManagement.toast.endpointNotFound'))
        }

        const customEndpoint = customEndpoints[endpointIndex]
        const currentRouting = customEndpoint.routing ?? {
          defaults: config!.defaults,
          modelRoutes: {}
        }

        let validation = currentRouting.validation
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

        const updatedRouting: EndpointRoutingConfig = validation
          ? { ...currentRouting, validation }
          : { ...currentRouting }

        const updatedEndpoint = {
          ...customEndpoint,
          routing: updatedRouting
        }

        const updatedCustomEndpoints = [...customEndpoints]
        updatedCustomEndpoints[endpointIndex] = updatedEndpoint

        const nextConfig: GatewayConfig = {
          ...config!,
          customEndpoints: updatedCustomEndpoints
        }

        await apiClient.put('/api/config', nextConfig)
        setConfig(nextConfig)
      }

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

    const customEndpoint = customEndpoints.find((e) => e.id === endpoint)

    if (customEndpoint) {
      const routes = customEndpoint.routing?.modelRoutes ?? {}
      setRoutesByEndpoint((prev) => ({
        ...prev,
        [endpoint]: mapRoutesToEntries(routes)
      }))
    } else {
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
      const customEndpoint = customEndpoints.find((e) => e.id === endpoint)

      if (customEndpoint) {
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
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('providers.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('providers.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{t('providers.count', { count: providerCount })}</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => configQuery.refetch()}
              disabled={configQuery.isFetching}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', configQuery.isFetching && 'animate-spin')} />
              {configQuery.isFetching ? t('common.actions.refreshing') : t('providers.actions.refresh')}
            </Button>
            <Button size="sm" onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t('providers.actions.add')}
            </Button>
          </div>
        </div>

        {configQuery.isPending || (!config && configQuery.isFetching) ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border bg-muted/50 text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium">{t('providers.emptyState')}</p>
            <p className="mt-2 text-xs">
              {t('providers.emptyStateSub', { default: '点击上方按钮添加您的第一个提供商' })}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <Card key={provider.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-4 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{provider.label || provider.id}</h3>
                        {provider.type && <TypeBadge type={provider.type} />}
                      </div>
                      <p className="text-xs text-muted-foreground">ID: {provider.id}</p>
                      <p className="text-xs text-muted-foreground break-all">{provider.baseUrl}</p>
                    </div>
                    {provider.defaultModel ? (
                      <Badge variant="default" className="text-xs">
                        {defaultLabels.get(provider.id) ?? provider.defaultModel}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {t('providers.card.noDefault')}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">{t('providers.card.modelsTitle')}</Label>
                    {provider.models && provider.models.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {provider.models.map((model) => (
                          <Badge key={model.id} variant="outline" className="text-xs">
                            {resolveModelLabel(model)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('providers.card.noModels')}</p>
                    )}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2 pt-4 border-t">
                    <Button variant="outline" size="sm" onClick={() => handleOpenEdit(provider)}>
                      {t('providers.actions.edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => initiateTestConnection(provider)}
                      disabled={testingProviderId === provider.id}
                    >
                      {testingProviderId === provider.id ? t('common.actions.testingConnection') : t('providers.actions.test')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(provider)}>
                      {t('providers.actions.delete')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  const renderPresetsSection = (endpoint: Endpoint) => {
    const presets = presetsByEndpoint[endpoint] ?? []
    const presetName = presetNameByEndpoint[endpoint] ?? ''
    const presetError = presetErrorByEndpoint[endpoint]
    const savingPreset = savingPresetFor === endpoint
    const expanded = presetsExpanded[endpoint] === true

    return (
      <div className="rounded-lg border border-dashed bg-muted/30">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
          onClick={() => setPresetsExpanded((prev) => ({ ...prev, [endpoint]: !expanded }))}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="font-medium">{t('modelManagement.presets.title')}</h3>
            <Badge variant="secondary" className="text-xs">{presets.length}</Badge>
          </div>
        </button>
        {expanded && (
          <div className="border-t px-4 pb-4 pt-3 space-y-4">
            <p className="text-sm text-muted-foreground">{t('modelManagement.presets.description')}</p>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                value={presetName}
                onChange={(e) => handlePresetNameChange(endpoint, e.target.value)}
                placeholder={t('modelManagement.presets.namePlaceholder')}
                disabled={savingPreset}
                className="w-full md:w-48"
              />
              <Button onClick={() => void handleSavePreset(endpoint)} disabled={savingPreset}>
                {savingPreset ? t('modelManagement.presets.saving') : t('modelManagement.presets.save')}
              </Button>
            </div>
            {presetError && (
              <p className="text-sm text-destructive">{presetError}</p>
            )}
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('modelManagement.presets.empty')}
              </p>
            ) : (
              <TooltipProvider>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {presets.map((preset) => {
                    const isApplying = applyingPreset?.endpoint === endpoint && applyingPreset?.name === preset.name
                    const isDeleting = deletingPreset?.endpoint === endpoint && deletingPreset?.name === preset.name
                    const routeEntries = Object.entries(preset.modelRoutes ?? {})
                    const rulesCount = routeEntries.length
                    return (
                      <div
                        key={preset.name}
                        className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="min-w-0 flex-1 cursor-default">
                              <span className="block truncate text-sm font-medium">{preset.name}</span>
                              <Badge variant="outline" className="mt-1 text-xs">
                                {rulesCount > 0
                                  ? t('modelManagement.presets.rulesCount', { count: rulesCount })
                                  : t('modelManagement.presets.noRules')}
                              </Badge>
                            </div>
                          </TooltipTrigger>
                          {rulesCount > 0 && (
                            <TooltipContent side="bottom" className="max-w-xs">
                              <div className="space-y-1 text-xs">
                                {routeEntries.slice(0, 5).map(([src, tgt]) => (
                                  <div key={src} className="flex items-center gap-1">
                                    <span className="truncate">{src}</span>
                                    <ArrowRight className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{tgt}</span>
                                  </div>
                                ))}
                                {rulesCount > 5 && (
                                  <div className="text-muted-foreground">…+{rulesCount - 5}</div>
                                )}
                              </div>
                            </TooltipContent>
                          )}
                        </Tooltip>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            onClick={() => setPresetDiffDialog({ endpoint, preset })}
                            disabled={isApplying || isDeleting}
                          >
                            {isApplying ? t('modelManagement.presets.applying') : t('modelManagement.presets.apply')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDeletePreset(endpoint, preset)}
                            disabled={isDeleting || isApplying}
                          >
                            {isDeleting ? t('modelManagement.presets.deleting') : t('modelManagement.presets.delete')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TooltipProvider>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderRoutesSection = (endpoint: Endpoint) => {
    const entries = routesByEndpoint[endpoint] || []
    const error = routeError[endpoint]

    const tabInfo = tabs.find((tab) => tab.key === endpoint)
    const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? (endpoint === 'anthropic')
    const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS

    const isSaving = savingRouteFor === endpoint
    const isDirty = isDirtyByEndpoint[endpoint] ?? false
    const endpointLabel = tabInfo?.label ?? t(`modelManagement.tabs.${endpoint}`)
    const endpointDescription = tabInfo?.isSystem === false
      ? tabInfo.description
      : t(`settings.routing.descriptionByEndpoint.${endpoint}`)

    const sourceListId = `route-source-${endpoint}`
    const isAnthropicProtocol = isAnthropicEndpoint(endpoint, customEndpoints)
    const validation = getEndpointValidation(endpoint, config, customEndpoints)
    const claudeValidationEnabled = isAnthropicProtocol && validation?.mode === 'claude-code'

    const existingSources = new Set(entries.map(e => e.source.trim()).filter(Boolean))

    return (
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                {t('settings.routing.titleByEndpoint', { endpoint: endpointLabel })}
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">{endpointDescription}</p>
              <p className="max-w-3xl text-xs text-muted-foreground">{t('settings.routing.wildcardHint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleAddRoute(endpoint)} disabled={isSaving}>
                {t('settings.routing.add')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleResetRoutes(endpoint)} disabled={isSaving}>
                {t('common.actions.reset')}
              </Button>
              <Button size="sm" onClick={() => void handleSaveRoutes(endpoint)} disabled={isSaving} className="relative">
                {isSaving ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
                {isDirty && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" />}
              </Button>
            </div>
          </div>

          {isAnthropicProtocol && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {t('modelManagement.claudeValidation.title')}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    {t('modelManagement.claudeValidation.description')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={claudeValidationEnabled}
                    onCheckedChange={(checked) => void handleToggleClaudeValidation(endpoint, checked)}
                    disabled={savingClaudeValidation}
                  />
                  <span className={cn('text-xs font-medium', claudeValidationEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                    {claudeValidationEnabled
                      ? t('modelManagement.claudeValidation.statusEnabled')
                      : t('modelManagement.claudeValidation.statusDisabled')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {renderPresetsSection(endpoint)}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              <p className="font-medium">{t('settings.routing.empty')}</p>
              <p className="mt-2 text-xs">{t('settings.routing.emptySub', { default: '点击上方按钮添加路由规则' })}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-1 text-xs font-medium text-muted-foreground">
                <span>{t('settings.routing.source')}</span>
                <span />
                <span>{t('settings.routing.target')}</span>
                <span />
              </div>
              {entries.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3">
                  <Input
                    value={entry.source}
                    onChange={(e) => handleRouteChange(endpoint, entry.id, 'source', e.target.value)}
                    placeholder={t('settings.routing.sourcePlaceholder')}
                    list={sourceListId}
                    disabled={isSaving}
                  />
                  <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <TargetCombobox
                    value={entry.target}
                    onChange={(v) => handleRouteChange(endpoint, entry.id, 'target', v)}
                    options={providerModelOptions}
                    disabled={isSaving}
                    placeholder={t('settings.routing.targetPlaceholder')}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveRoute(endpoint, entry.id)}
                    disabled={isSaving}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <Label>{t('settings.routing.suggested')}</Label>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((model) => {
                const alreadyAdded = existingSources.has(model)
                return (
                  <Button
                    key={`${endpoint}-${model}`}
                    variant={alreadyAdded ? 'ghost' : 'outline'}
                    size="sm"
                    onClick={() => handleAddSuggestion(endpoint, model)}
                    disabled={isSaving || alreadyAdded}
                    className={alreadyAdded ? 'opacity-50' : ''}
                  >
                    {model}
                  </Button>
                )
              })}
            </div>
          </div>

          <datalist id={sourceListId}>
            {suggestions.map((model) => (
              <option key={`${sourceListId}-${model}`} value={model} />
            ))}
          </datalist>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
        title={t('modelManagement.title')}
        description={t('modelManagement.description')}
        actions={
          <Button onClick={() => {
            setEditingEndpoint(undefined)
            setEndpointDrawerOpen(true)
          }}>
            <Plus className="mr-2 h-4 w-4" />
            {t('modelManagement.addEndpoint')}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key
          const tabDirty = tab.key !== 'providers' && isDirtyByEndpoint[tab.key]
          return (
            <div key={tab.key} className="relative">
              <button
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex min-w-[200px] flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-all',
                  isActive
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card hover:bg-accent'
                )}
              >
                <span className="font-medium flex items-center gap-2">
                  {tab.label}
                  {tabDirty && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                </span>
                <span className="text-xs text-muted-foreground">{tab.description}</span>
              </button>
              {tab.canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeleteEndpoint(tab.key)
                  }}
                  className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs hover:bg-destructive/90"
                  title={t('common.delete')}
                >
                  <X className="h-3 w-3" />
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

      <PresetDiffDialog
        dialog={presetDiffDialog}
        currentRoutes={presetDiffDialog ? (routesByEndpoint[presetDiffDialog.endpoint] || []) : []}
        onConfirm={(endpoint, preset) => {
          setPresetDiffDialog(null)
          void handleApplyPreset(endpoint, preset)
        }}
        onClose={() => setPresetDiffDialog(null)}
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

  if (!provider) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers.testDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('providers.testDialog.subtitle', { name: provider.label || provider.id })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('providers.testDialog.description')}</p>
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border"
            checked={usePreset}
            onChange={(e) => onPresetChange(e.target.checked)}
          />
          <div className="space-y-2">
            <Label>{t('providers.testDialog.presetLabel')}</Label>
            <p className="text-xs text-muted-foreground">{t('providers.testDialog.presetDescription')}</p>
            <details className="rounded-md bg-muted p-2 text-xs">
              <summary className="cursor-pointer text-primary hover:underline">
                {t('providers.testDialog.presetPreviewSummary')}
              </summary>
              <div className="mt-2 space-y-1">
                {options.map((option) => (
                  <code key={option.key} className="block rounded bg-background px-2 py-1 text-xs">
                    {option.key}: {option.value}
                  </code>
                ))}
              </div>
            </details>
          </div>
        </div>
        {Object.keys(preservedExtras).length > 0 && (
          <div className="rounded-lg border bg-muted p-4 text-xs space-y-2">
            <p className="font-medium">{t('providers.testDialog.preservedInfo')}</p>
            {Object.entries(preservedExtras).map(([key, value]) => (
              <code key={key} className="block rounded bg-background px-2 py-1">
                {key}: {value}
              </code>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('providers.testDialog.cancel')}
          </Button>
          <Button onClick={() => void onConfirm()}>
            {t('providers.testDialog.primary')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TargetCombobox({
  value,
  onChange,
  options,
  disabled,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const lower = search.toLowerCase()
    return options.filter(
      (o) => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower)
    )
  }, [options, search])

  const selectOption = (nextValue: string) => {
    onChange(nextValue)
    setSearch('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setSearch('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setSearch('')
            setOpen(true)
          }}
          onClick={() => {
            if (!open) setOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t('common.noMatches')}</div>
        ) : (
          filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
                option.value === value.trim() && 'bg-accent'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                selectOption(option.value)
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}

function PresetDiffDialog({
  dialog,
  currentRoutes,
  onConfirm,
  onClose
}: {
  dialog: { endpoint: string; preset: RoutingPreset } | null
  currentRoutes: ModelRouteEntry[]
  onConfirm: (endpoint: string, preset: RoutingPreset) => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  if (!dialog) return null

  const { endpoint, preset } = dialog
  const presetRoutes = preset.modelRoutes ?? {}

  const currentMap: Record<string, string> = {}
  for (const e of currentRoutes) {
    const s = e.source.trim()
    const tgt = e.target.trim()
    if (s && tgt) currentMap[s] = tgt
  }

  const allKeys = new Set([...Object.keys(currentMap), ...Object.keys(presetRoutes)])
  const added: Array<[string, string]> = []
  const removed: Array<[string, string]> = []
  const changed: Array<[string, string, string]> = []

  for (const key of allKeys) {
    const inCurrent = key in currentMap
    const inPreset = key in presetRoutes
    if (inPreset && !inCurrent) {
      added.push([key, presetRoutes[key]])
    } else if (inCurrent && !inPreset) {
      removed.push([key, currentMap[key]])
    } else if (inCurrent && inPreset && currentMap[key] !== presetRoutes[key]) {
      changed.push([key, currentMap[key], presetRoutes[key]])
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('modelManagement.presets.diffTitle')}</DialogTitle>
          <DialogDescription>
            {t('modelManagement.presets.diffDescription', { name: preset.name })}
          </DialogDescription>
        </DialogHeader>
        {!hasChanges ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('modelManagement.presets.diffEmpty')}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-2 text-sm">
            {added.map(([src, tgt]) => (
              <div key={`add-${src}`} className="flex items-center gap-2 rounded px-2 py-1 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200">
                <Badge variant="outline" className="text-xs border-emerald-300 dark:border-emerald-700">{t('modelManagement.presets.diffAdded')}</Badge>
                <span className="truncate">{src}</span>
                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{tgt}</span>
              </div>
            ))}
            {removed.map(([src, tgt]) => (
              <div key={`rm-${src}`} className="flex items-center gap-2 rounded px-2 py-1 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200">
                <Badge variant="outline" className="text-xs border-red-300 dark:border-red-700">{t('modelManagement.presets.diffRemoved')}</Badge>
                <span className="truncate">{src}</span>
                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{tgt}</span>
              </div>
            ))}
            {changed.map(([src, oldTgt, newTgt]) => (
              <div key={`chg-${src}`} className="flex items-center gap-2 rounded px-2 py-1 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                <Badge variant="outline" className="text-xs border-amber-300 dark:border-amber-700">{t('modelManagement.presets.diffChanged')}</Badge>
                <span className="truncate">{src}</span>
                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                <span className="truncate line-through opacity-60">{oldTgt}</span>
                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{newTgt}</span>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(endpoint, preset)} disabled={!hasChanges}>
            {t('modelManagement.presets.diffConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function resolveModelLabel(model: ProviderModelConfig): string {
  if (model.label && model.label.trim().length > 0) {
    return `${model.label} (${model.id})`
  }
  return model.id
}

function TypeBadge({ type }: { type: NonNullable<ProviderConfig['type']> }) {
  const config: Record<NonNullable<ProviderConfig['type']>, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'purple' | 'pink' | 'outline' }> = {
    openai: { label: 'OpenAI', variant: 'success' },
    deepseek: { label: 'DeepSeek', variant: 'info' },
    huawei: { label: '华为云', variant: 'warning' },
    kimi: { label: 'Kimi', variant: 'purple' },
    anthropic: { label: 'Anthropic', variant: 'pink' },
    custom: { label: 'Custom', variant: 'secondary' }
  }
  const { label, variant } = config[type] || config.custom
  return <Badge variant={variant} className="text-xs">{label}</Badge>
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
    mutationFn: (data: { id: string; updates: Parameters<typeof customEndpointsApi.update>[1] }) =>
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
    newPaths[index] = { ...newPaths[index], [field]: value as EndpointProtocol }
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
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l shadow-xl z-50 overflow-y-auto">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-lg font-semibold">
              {endpoint ? t('modelManagement.editEndpoint') : t('modelManagement.createEndpoint')}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 p-6 space-y-6">
            <div className="space-y-2">
              <Label>{t('modelManagement.endpointId')} <span className="text-destructive">*</span></Label>
              <Input
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                placeholder={t('modelManagement.endpointIdPlaceholder')}
                disabled={!!endpoint}
                required
              />
              <p className="text-xs text-muted-foreground">{t('modelManagement.endpointIdHint')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('modelManagement.endpointLabel')} <span className="text-destructive">*</span></Label>
              <Input
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder={t('modelManagement.endpointLabelPlaceholder')}
                required
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t('modelManagement.endpointPaths')} <span className="text-destructive">*</span></Label>
                <Button type="button" variant="ghost" size="sm" onClick={handleAddPath}>
                  <Plus className="mr-1 h-3 w-3" />
                  {t('modelManagement.addPath')}
                </Button>
              </div>

              <div className="space-y-3">
                {formData.paths.map((pathItem, index) => (
                  <div key={index} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <Input
                          value={pathItem.path}
                          onChange={(e) => handlePathChange(index, 'path', e.target.value)}
                          placeholder={t('modelManagement.endpointPathPlaceholder')}
                          required
                        />
                        <Select
                          value={pathItem.protocol}
                          onValueChange={(value) => handlePathChange(index, 'protocol', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="anthropic">{t('modelManagement.protocolAnthropic')}</SelectItem>
                            <SelectItem value="openai-auto">{t('modelManagement.protocolOpenAI')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {formData.paths.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemovePath(index)}
                          className="text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {index === 0 && (
                      <p className="text-xs text-muted-foreground">{t('modelManagement.endpointPathHint')}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
              <Label htmlFor="enabled">{t('modelManagement.endpointEnabled')}</Label>
            </div>

            {!endpoint && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t('modelManagement.endpointRoutingHint')}
                </p>
              </div>
            )}
          </form>

          <div className="flex gap-3 p-6 border-t">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting
                ? t('common.saving')
                : endpoint
                ? t('common.save')
                : t('common.create')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
