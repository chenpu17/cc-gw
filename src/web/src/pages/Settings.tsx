import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Copy } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { cn } from '@/utils/cn'
import { dangerButtonClass, mutedTextClass, primaryButtonClass, subtleButtonClass, inputClass } from '@/styles/theme'
import { apiClient, type ApiError } from '@/services/api'
import type { ConfigInfoResponse, GatewayConfig, WebAuthStatusResponse } from '@/types/providers'

type LogLevel = NonNullable<GatewayConfig['logLevel']>

const LOG_LEVEL_OPTIONS: Array<{ value: LogLevel; labelKey: string }> = [
  { value: 'fatal', labelKey: 'fatal' },
  { value: 'error', labelKey: 'error' },
  { value: 'warn', labelKey: 'warn' },
  { value: 'info', labelKey: 'info' },
  { value: 'debug', labelKey: 'debug' },
  { value: 'trace', labelKey: 'trace' }
]

interface FormState {
  port: string
  host: string
  logRetentionDays: string
  storeRequestPayloads: boolean
  storeResponsePayloads: boolean
  logLevel: LogLevel
  requestLogging: boolean
  responseLogging: boolean
  bodyLimitMb: string
  enableRoutingFallback: boolean
}

interface FormErrors {
  port?: string
  logRetentionDays?: string
  bodyLimitMb?: string
}

interface AuthFormState {
  enabled: boolean
  username: string
  password: string
  confirmPassword: string
}

interface AuthFormErrors {
  username?: string
  password?: string
  confirmPassword?: string
}

interface CleanupResponse {
  success: boolean
  deleted: number
}

interface ClearResponse {
  success: boolean
  deleted: number
  metricsCleared: number
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const configQuery = useApiQuery<ConfigInfoResponse, ApiError>(
    ['config', 'info'],
    { url: '/api/config/info', method: 'GET' }
  )
  const authQuery = useApiQuery<WebAuthStatusResponse, ApiError>(
    ['auth', 'web'],
    { url: '/api/auth/web', method: 'GET' }
  )

  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [configPath, setConfigPath] = useState<string>('')
  const [form, setForm] = useState<FormState>({
    port: '',
    host: '',
    logRetentionDays: '',
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'info',
    requestLogging: true,
    responseLogging: true,
    bodyLimitMb: '10',
    enableRoutingFallback: false
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [authSettings, setAuthSettings] = useState<WebAuthStatusResponse | null>(null)
  const [authForm, setAuthForm] = useState<AuthFormState>({
    enabled: false,
    username: '',
    password: '',
    confirmPassword: ''
  })
  const [authErrors, setAuthErrors] = useState<AuthFormErrors>({})
  const [savingAuth, setSavingAuth] = useState(false)

  const defaultsSummary = useMemo(() => {
    if (!config) return null
    const defaults = config.defaults
    if (!defaults) return null
    const mappings: string[] = []
    if (defaults.completion) mappings.push(t('settings.defaults.completion', { model: defaults.completion }))
    if (defaults.reasoning) mappings.push(t('settings.defaults.reasoning', { model: defaults.reasoning }))
    if (defaults.background) mappings.push(t('settings.defaults.background', { model: defaults.background }))
    return mappings.length > 0 ? mappings.join(' ｜ ') : t('settings.defaults.none')
  }, [config, t])

  const needsPassword = useMemo(() => {
    if (!authForm.enabled) return false
    if (!authSettings?.hasPassword) return true
    return authForm.username.trim() !== (authSettings?.username ?? '')
  }, [authForm.enabled, authForm.username, authSettings])

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data.config)
      setConfigPath(configQuery.data.path)
      const legacyStore = configQuery.data.config.storePayloads
      const deriveStoreFlag = (value?: boolean) =>
        typeof value === 'boolean' ? value : typeof legacyStore === 'boolean' ? legacyStore : true
      setForm({
        port: String(configQuery.data.config.port ?? ''),
        host: configQuery.data.config.host ?? '127.0.0.1',
        logRetentionDays: String(configQuery.data.config.logRetentionDays ?? 30),
        storeRequestPayloads: deriveStoreFlag(configQuery.data.config.storeRequestPayloads),
        storeResponsePayloads: deriveStoreFlag(configQuery.data.config.storeResponsePayloads),
        logLevel: (configQuery.data.config.logLevel as LogLevel) ?? 'info',
        requestLogging: configQuery.data.config.requestLogging !== false,
        responseLogging: configQuery.data.config.responseLogging ?? configQuery.data.config.requestLogging !== false,
        bodyLimitMb: (() => {
          const raw = configQuery.data.config.bodyLimit
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            return String(Math.max(1, Math.round(raw / (1024 * 1024))))
          }
          return '10'
        })(),
        enableRoutingFallback: configQuery.data.config.enableRoutingFallback === true
      })
    }
  }, [configQuery.data])

  useEffect(() => {
    if (authQuery.data) {
      setAuthSettings(authQuery.data)
      setAuthForm({
        enabled: authQuery.data.enabled,
        username: authQuery.data.username ?? '',
        password: '',
        confirmPassword: ''
      })
      setAuthErrors({})
    }
  }, [authQuery.data])

  useEffect(() => {
    if (configQuery.isError && configQuery.error) {
      pushToast({
        title: t('settings.toast.loadFailure', { message: configQuery.error.message }),
        variant: 'error'
      })
    }
  }, [configQuery.isError, configQuery.error, pushToast, t])

  useEffect(() => {
    if (authQuery.isError && authQuery.error) {
      pushToast({
        title: t('settings.toast.authLoadFailure', { message: authQuery.error.message }),
        variant: 'error'
      })
    }
  }, [authQuery.isError, authQuery.error, pushToast, t])

  const handleInputChange = (field: 'port' | 'host' | 'logRetentionDays' | 'bodyLimitMb') => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}
    const portValue = Number(form.port)
    if (!Number.isFinite(portValue) || portValue < 1 || portValue > 65535) {
      nextErrors.port = t('settings.validation.port')
    }
    const retentionValue = Number(form.logRetentionDays)
    if (!Number.isFinite(retentionValue) || retentionValue < 1 || retentionValue > 365) {
      nextErrors.logRetentionDays = t('settings.validation.retention')
    }
    const bodyLimitValue = Number(form.bodyLimitMb)
    if (!Number.isFinite(bodyLimitValue) || bodyLimitValue < 1 || bodyLimitValue > 2048) {
      nextErrors.bodyLimitMb = t('settings.validation.bodyLimit')
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const validateAuth = (): boolean => {
    const nextErrors: AuthFormErrors = {}
    const usernameValue = authForm.username.trim()
    const usernameChanged = authSettings ? usernameValue !== (authSettings.username ?? '') : true
    const needsPassword =
      authForm.enabled &&
      (!authSettings?.hasPassword || usernameChanged)

    if (authForm.enabled && !usernameValue) {
      nextErrors.username = t('settings.auth.validation.username')
    }

    if (authForm.password && authForm.password.length < 6) {
      nextErrors.password = t('settings.auth.validation.minLength')
    }

    if (needsPassword && !authForm.password) {
      nextErrors.password = t('settings.auth.validation.passwordRequired')
    }

    if (authForm.password || authForm.confirmPassword) {
      if (authForm.password !== authForm.confirmPassword) {
        nextErrors.confirmPassword = t('settings.auth.validation.confirmMismatch')
      }
    }

    setAuthErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async () => {
    if (!config) {
      pushToast({ title: t('settings.toast.loadFailure', { message: t('settings.toast.missingConfig') }), variant: 'error' })
      return
    }
    if (!validate()) return
    setSaving(true)
    try {
      const portValue = Number(form.port)
      const retentionValue = Number(form.logRetentionDays)
      const bodyLimitValue = Number(form.bodyLimitMb)
      const nextConfig: GatewayConfig = {
        ...config,
        port: portValue,
        host: form.host.trim() || undefined,
        logRetentionDays: retentionValue,
        storeRequestPayloads: form.storeRequestPayloads,
        storeResponsePayloads: form.storeResponsePayloads,
        logLevel: form.logLevel,
        requestLogging: form.requestLogging,
        responseLogging: form.responseLogging,
        bodyLimit: Math.max(1, Math.floor(bodyLimitValue * 1024 * 1024)),
        enableRoutingFallback: form.enableRoutingFallback
      }
      const { webAuth: _ignored, ...payload } = nextConfig as GatewayConfig & { webAuth?: never }
      await apiClient.put('/api/config', payload)
      setConfig({ ...nextConfig, webAuth: config.webAuth })
      pushToast({ title: t('settings.toast.saveSuccess'), variant: 'success' })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('settings.toast.saveFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!config) return
    setForm({
      port: String(config.port ?? ''),
      host: config.host ?? '',
      logRetentionDays: String(config.logRetentionDays ?? 30),
      storeRequestPayloads:
        typeof config.storeRequestPayloads === 'boolean'
          ? config.storeRequestPayloads
          : typeof config.storePayloads === 'boolean'
          ? config.storePayloads
          : true,
      storeResponsePayloads:
        typeof config.storeResponsePayloads === 'boolean'
          ? config.storeResponsePayloads
          : typeof config.storePayloads === 'boolean'
          ? config.storePayloads
          : true,
      logLevel: (config.logLevel as LogLevel) ?? 'info',
      requestLogging: config.requestLogging !== false,
      responseLogging: config.responseLogging ?? config.requestLogging !== false,
      bodyLimitMb: (() => {
        const raw = config.bodyLimit
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
          return String(Math.max(1, Math.round(raw / (1024 * 1024))))
        }
        return '10'
      })(),
      enableRoutingFallback: config.enableRoutingFallback === true
    })
    setErrors({})
  }

  const handleAuthSave = async () => {
    if (!validateAuth()) return
    setSavingAuth(true)
    try {
      const payload: { enabled: boolean; username?: string; password?: string } = {
        enabled: authForm.enabled,
        username: authForm.username.trim() || undefined
      }
      if (authForm.password) {
        payload.password = authForm.password
      }
      const response = await apiClient.post('/api/auth/web', payload)
      const updatedAuth = (response.data as { auth?: WebAuthStatusResponse })?.auth
      if (updatedAuth) {
        setAuthSettings(updatedAuth)
        setAuthForm({
          enabled: updatedAuth.enabled,
          username: updatedAuth.username ?? '',
          password: '',
          confirmPassword: ''
        })
        setAuthErrors({})
      }
      pushToast({ title: t('settings.auth.toast.success'), variant: 'success' })
      void authQuery.refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      pushToast({
        title: t('settings.auth.toast.failure', { message }),
        variant: 'error'
      })
    } finally {
      setSavingAuth(false)
    }
  }

  const handleAuthReset = () => {
    if (!authSettings) return
    setAuthForm({
      enabled: authSettings.enabled,
      username: authSettings.username ?? '',
      password: '',
      confirmPassword: ''
    })
    setAuthErrors({})
  }

  const handleCopyPath = async () => {
    if (!configPath) {
      pushToast({ title: t('settings.toast.copyFailure', { message: t('settings.file.unknown') }), variant: 'error' })
      return
    }
    try {
      await navigator.clipboard.writeText(configPath)
      pushToast({ title: t('settings.toast.copySuccess'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('settings.toast.copyFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    }
  }

  const handleCleanupLogs = async () => {
    setCleaning(true)
    try {
      const response = await apiClient.post<CleanupResponse>('/api/logs/cleanup')
      const deleted = response.data.deleted ?? 0
      pushToast({
        title:
          deleted > 0
            ? t('settings.toast.cleanupSuccess', { count: deleted })
            : t('settings.toast.cleanupNone'),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('settings.toast.cleanupFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    } finally {
      setCleaning(false)
    }
  }

  const handleClearAllLogs = async () => {
    setClearingAll(true)
    try {
      const response = await apiClient.post<ClearResponse>('/api/logs/clear')
      const { deleted, metricsCleared } = response.data
      pushToast({
        title: t('settings.toast.clearAllSuccess', {
          logs: deleted,
          metrics: metricsCleared
        }),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('settings.toast.clearAllFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setClearingAll(false)
    }
  }

  const isLoading = configQuery.isPending || (!config && configQuery.isFetching)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon={<SettingsIcon className="h-6 w-6" aria-hidden="true" />}
        title={t('settings.title')}
        description={t('settings.description')}
        actions=
          {config ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className={cn(subtleButtonClass, 'h-10 rounded-full px-4')}
                disabled={saving}
              >
                {t('common.actions.reset')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className={cn(primaryButtonClass, 'h-10 rounded-full px-4')}
                disabled={saving}
              >
                {saving ? t('common.actions.saving') : t('common.actions.save')}
              </button>
            </div>
          ) : null}
      />

      {isLoading ? (
        <PageSection className="flex min-h-[220px] items-center justify-center">
          <Loader />
        </PageSection>
      ) : !config ? (
        <PageSection>
          <p className="text-sm font-medium text-red-500 dark:text-red-300">{t('settings.toast.missingConfig')}</p>
        </PageSection>
      ) : (
        <>
          <PageSection title={t('settings.sections.basics')} contentClassName="grid w-full gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.port')}
              </span>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => handleInputChange('port')(event.target.value)}
                className={cn(inputClass, 'h-11')}
                aria-invalid={Boolean(errors.port)}
              />
              {errors.port ? (
                <span className="text-xs font-medium text-red-500 dark:text-red-300">{errors.port}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.host')}
              </span>
              <input
                value={form.host}
                onChange={(event) => handleInputChange('host')(event.target.value)}
                placeholder={t('settings.fields.hostPlaceholder')}
                className={cn(inputClass, 'h-11')}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.retention')}
              </span>
              <input
                type="number"
                min={1}
                max={365}
                value={form.logRetentionDays}
                onChange={(event) => handleInputChange('logRetentionDays')(event.target.value)}
                className={cn(inputClass, 'h-11')}
                aria-invalid={Boolean(errors.logRetentionDays)}
              />
              {errors.logRetentionDays ? (
                <span className="text-xs font-medium text-red-500 dark:text-red-300">{errors.logRetentionDays}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.bodyLimit')}
              </span>
              <input
                type="number"
                min={1}
                max={2048}
                value={form.bodyLimitMb}
                onChange={(event) => handleInputChange('bodyLimitMb')(event.target.value)}
                className={cn(inputClass, 'h-11')}
                aria-invalid={Boolean(errors.bodyLimitMb)}
              />
              <p className={cn(mutedTextClass, 'text-[11px] leading-relaxed')}>
                {t('settings.fields.bodyLimitHint')}
              </p>
              {errors.bodyLimitMb ? (
                <span className="text-xs font-medium text-red-500 dark:text-red-300">{errors.bodyLimitMb}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.logLevel')}
              </span>
              <select
                value={form.logLevel}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, logLevel: event.target.value as LogLevel }))
                }
                className="h-10"
              >
                {LOG_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(`settings.fields.logLevelOption.${option.labelKey}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/60 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:hover:border-slate-500/60">
                <input
                  type="checkbox"
                  checked={form.storeRequestPayloads}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, storeRequestPayloads: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 dark:border-slate-600"
                />
                <div className="space-y-1">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                    {t('settings.fields.storeRequestPayloads')}
                  </span>
                  <p className={cn(mutedTextClass, 'text-xs')}>{t('settings.fields.storeRequestPayloadsHint')}</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/60 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:hover:border-slate-500/60">
                <input
                  type="checkbox"
                  checked={form.storeResponsePayloads}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, storeResponsePayloads: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 dark:border-slate-600"
                />
                <div className="space-y-1">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                    {t('settings.fields.storeResponsePayloads')}
                  </span>
                  <p className={cn(mutedTextClass, 'text-xs')}>{t('settings.fields.storeResponsePayloadsHint')}</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/60 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:hover:border-slate-500/60">
                <input
                  type="checkbox"
                  checked={form.requestLogging}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, requestLogging: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 dark:border-slate-600"
                />
                <div className="space-y-1">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                    {t('settings.fields.requestLogging')}
                  </span>
                  <p className={cn(mutedTextClass, 'text-xs')}>{t('settings.fields.requestLoggingHint')}</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/60 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:hover:border-slate-500/60">
                <input
                  type="checkbox"
                  checked={form.responseLogging}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, responseLogging: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 dark:border-slate-600"
                />
                <div className="space-y-1">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                    {t('settings.fields.responseLogging')}
                  </span>
                  <p className={cn(mutedTextClass, 'text-xs')}>{t('settings.fields.responseLoggingHint')}</p>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 shadow-sm shadow-amber-200/60 transition hover:border-amber-300 dark:border-amber-700/60 dark:bg-amber-900/30 dark:hover:border-amber-500/60">
                <input
                  type="checkbox"
                  checked={form.enableRoutingFallback}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, enableRoutingFallback: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-400 dark:border-amber-500"
                />
                <div className="space-y-1">
                  <span className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                    {t('settings.fields.enableRoutingFallback')}
                  </span>
                  <p className={cn(mutedTextClass, 'text-xs text-amber-800/80 dark:text-amber-200/80')}>
                    {t('settings.fields.enableRoutingFallbackHint')}
                  </p>
                </div>
              </label>
            </div>

            <div className="md:col-span-2 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200/60 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.defaults')}
              </span>
              <p className="mt-2 text-sm">{defaultsSummary ?? t('settings.defaults.none')}</p>
            </div>
          </PageSection>

        <PageSection
          title={t('settings.sections.security')}
          description={t('settings.auth.description')}
          contentClassName="space-y-5"
        >
          {authQuery.isPending && !authSettings ? (
            <div className="flex min-h-[120px] items-center justify-center">
              <Loader />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-200/50 transition dark:border-slate-700/60 dark:bg-slate-900/80 dark:shadow-slate-900/40">
                <label className="flex cursor-pointer select-none items-start gap-3">
                  <input
                    type="checkbox"
                    checked={authForm.enabled}
                    onChange={(event) =>
                      setAuthForm((prev) => ({ ...prev, enabled: event.target.checked }))
                    }
                    className="mt-1 h-5 w-5 rounded border-slate-300 bg-white text-blue-600 shadow-sm transition focus:ring-blue-400/40 dark:border-slate-600 dark:bg-slate-900 dark:text-blue-200"
                  />
                  <div className="space-y-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {t('settings.auth.enable')}
                    </span>
                    <p className={cn(mutedTextClass, 'text-xs leading-relaxed')}>
                      {t('settings.auth.enableHint')}
                    </p>
                    <div className="flex flex-wrap gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className="rounded-full bg-slate-100/90 px-3 py-1 shadow-sm shadow-slate-200/40 dark:bg-slate-800/70">
                        /ui
                      </span>
                      <span className="rounded-full bg-slate-100/90 px-3 py-1 shadow-sm shadow-slate-200/40 dark:bg-slate-800/70">
                        /api/*
                      </span>
                      <span className="rounded-full bg-slate-100/90 px-3 py-1 shadow-sm shadow-slate-200/40 dark:bg-slate-800/70">
                        Cookie Session
                      </span>
                    </div>
                  </div>
                </label>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t('settings.auth.username')}
                    </span>
                    <input
                      value={authForm.username}
                      onChange={(event) =>
                        setAuthForm((prev) => ({ ...prev, username: event.target.value }))
                      }
                      placeholder={t('settings.auth.usernamePlaceholder')}
                      className={cn(inputClass, 'h-11 font-medium')}
                    />
                    {authErrors.username ? (
                      <span className="text-xs font-medium text-red-500 dark:text-red-300">
                        {authErrors.username}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t('settings.auth.password')}
                    </span>
                    <input
                      type="password"
                      value={authForm.password}
                      disabled={!authForm.enabled}
                      onChange={(event) =>
                        setAuthForm((prev) => ({ ...prev, password: event.target.value }))
                      }
                      placeholder={t('settings.auth.passwordPlaceholder')}
                      className={cn(
                        inputClass,
                        'h-11 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-900/40'
                      )}
                    />
                    {authErrors.password ? (
                      <span className="text-xs font-medium text-red-500 dark:text-red-300">
                        {authErrors.password}
                      </span>
                    ) : (
                      <span className={cn(mutedTextClass, 'text-xs leading-relaxed')}>
                        {t(
                          needsPassword
                            ? 'settings.auth.passwordHintRequired'
                            : 'settings.auth.passwordHintOptional'
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t('settings.auth.confirmPassword')}
                    </span>
                    <input
                      type="password"
                      value={authForm.confirmPassword}
                      disabled={!authForm.enabled}
                      onChange={(event) =>
                        setAuthForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                      }
                      placeholder={t('settings.auth.confirmPasswordPlaceholder')}
                      className={cn(
                        inputClass,
                        'h-11 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-900/40'
                      )}
                    />
                    {authErrors.confirmPassword ? (
                      <span className="text-xs font-medium text-red-500 dark:text-red-300">
                        {authErrors.confirmPassword}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-slate-200/70 bg-white/95 px-5 py-4 text-sm shadow-sm shadow-slate-200/40 dark:border-slate-700/60 dark:bg-slate-900/75 dark:text-slate-200 dark:shadow-slate-900/40">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500/90 dark:text-slate-400">
                      {t('settings.auth.status')}
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-800 dark:text-slate-100">
                      {authSettings?.enabled
                        ? t('settings.auth.statusEnabled')
                        : t('settings.auth.statusDisabled')}
                    </div>
                    {authSettings?.username ? (
                      <div className="mt-3 rounded-2xl bg-blue-50/80 px-3 py-2 text-xs font-medium text-blue-700 shadow-sm shadow-blue-200/40 dark:bg-blue-500/20 dark:text-blue-100">
                        {t('settings.auth.username')}: {authSettings.username}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-slate-200/60 bg-slate-50/80 px-5 py-4 text-xs leading-relaxed text-slate-600 shadow-sm shadow-slate-200/40 dark:border-slate-700/50 dark:bg-slate-800/60 dark:text-slate-300">
                    {t(
                      needsPassword
                        ? 'settings.auth.passwordHintRequired'
                        : 'settings.auth.passwordHintOptional'
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleAuthSave}
                  className={cn(primaryButtonClass, 'h-10 rounded-full px-6')}
                  disabled={savingAuth}
                >
                  {savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}
                </button>
                <button
                  type="button"
                  onClick={handleAuthReset}
                  className={cn(subtleButtonClass, 'h-10 rounded-full px-4')}
                  disabled={savingAuth}
                >
                  {t('common.actions.reset')}
                </button>
              </div>
            </div>
          )}
        </PageSection>

          <PageSection
            title={t('settings.sections.configFile')}
            description={t('settings.file.description')}
            actions={
              <button
                type="button"
                onClick={handleCopyPath}
                className={cn(subtleButtonClass, 'h-10 rounded-full px-4')}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t('common.actions.copy')}
              </button>
            }
            contentClassName="gap-3"
          >
            <code className="block break-all rounded-2xl border border-slate-200/60 bg-slate-100 px-4 py-3 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200">
              {configPath || t('settings.file.unknown')}
            </code>
          </PageSection>

          <PageSection
            title={t('settings.sections.cleanup')}
            description={t('settings.cleanup.description')}
            contentClassName="flex flex-col gap-4"
          >
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleCleanupLogs}
                className={cn(dangerButtonClass, 'px-5')}
                disabled={cleaning}
              >
                {cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
              </button>
              <button
                type="button"
                onClick={handleClearAllLogs}
                className={cn(
                  dangerButtonClass,
                  'px-5 border-red-500/70 bg-red-600 text-white hover:bg-red-600/90 dark:border-red-500 dark:bg-red-500 dark:text-white'
                )}
                disabled={clearingAll}
              >
                {clearingAll ? t('settings.cleanup.clearingAll') : t('settings.cleanup.clearAll')}
              </button>
            </div>
            <p className="text-xs font-medium text-red-500 dark:text-red-300">
              {t('settings.cleanup.clearAllWarning')}
            </p>
          </PageSection>
        </>
      )}
    </div>
  )
}
