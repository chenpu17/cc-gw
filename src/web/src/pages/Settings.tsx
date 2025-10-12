import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Copy } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { cn } from '@/utils/cn'
import { dangerButtonClass, mutedTextClass, primaryButtonClass, subtleButtonClass } from '@/styles/theme'
import { apiClient, type ApiError } from '@/services/api'
import type { ConfigInfoResponse, GatewayConfig } from '@/types/providers'

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
}

interface FormErrors {
  port?: string
  logRetentionDays?: string
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
    responseLogging: true
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

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

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data.config)
      setConfigPath(configQuery.data.path)
      const legacyStore = configQuery.data.config.storePayloads
      const deriveStoreFlag = (value?: boolean) =>
        typeof value === 'boolean' ? value : typeof legacyStore === 'boolean' ? legacyStore : true
      setForm({
        port: String(configQuery.data.config.port ?? ''),
        host: configQuery.data.config.host ?? '',
        logRetentionDays: String(configQuery.data.config.logRetentionDays ?? 30),
        storeRequestPayloads: deriveStoreFlag(configQuery.data.config.storeRequestPayloads),
        storeResponsePayloads: deriveStoreFlag(configQuery.data.config.storeResponsePayloads),
        logLevel: (configQuery.data.config.logLevel as LogLevel) ?? 'info',
        requestLogging: configQuery.data.config.requestLogging !== false,
        responseLogging: configQuery.data.config.responseLogging ?? configQuery.data.config.requestLogging !== false
      })
    }
  }, [configQuery.data])

  useEffect(() => {
    if (configQuery.isError && configQuery.error) {
      pushToast({
        title: t('settings.toast.loadFailure', { message: configQuery.error.message }),
        variant: 'error'
      })
    }
  }, [configQuery.isError, configQuery.error, pushToast, t])

  const handleInputChange = (field: 'port' | 'host' | 'logRetentionDays') => (value: string) => {
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
    setErrors(nextErrors)
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
      const nextConfig: GatewayConfig = {
        ...config,
        port: portValue,
        host: form.host.trim() || undefined,
        logRetentionDays: retentionValue,
        storeRequestPayloads: form.storeRequestPayloads,
        storeResponsePayloads: form.storeResponsePayloads,
        logLevel: form.logLevel,
        requestLogging: form.requestLogging,
        responseLogging: form.responseLogging
      }
      await apiClient.put('/api/config', nextConfig)
      setConfig(nextConfig)
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
      responseLogging: config.responseLogging ?? config.requestLogging !== false
    })
    setErrors({})
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
                className="h-10"
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
                className="h-10"
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
                className="h-10"
                aria-invalid={Boolean(errors.logRetentionDays)}
              />
              {errors.logRetentionDays ? (
                <span className="text-xs font-medium text-red-500 dark:text-red-300">{errors.logRetentionDays}</span>
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
            </div>

            <div className="md:col-span-2 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200/60 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('settings.fields.defaults')}
              </span>
              <p className="mt-2 text-sm">{defaultsSummary ?? t('settings.defaults.none')}</p>
            </div>
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
