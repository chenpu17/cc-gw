import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { apiClient, type ApiError } from '@/services/api'
import type { ConfigInfoResponse, GatewayConfig } from '@/types/providers'

interface FormState {
  port: string
  host: string
  logRetentionDays: string
  storePayloads: boolean
}

interface FormErrors {
  port?: string
  logRetentionDays?: string
}

interface CleanupResponse {
  success: boolean
  deleted: number
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
  const [form, setForm] = useState<FormState>({ port: '', host: '', logRetentionDays: '', storePayloads: true })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)

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
      setForm({
        port: String(configQuery.data.config.port ?? ''),
        host: configQuery.data.config.host ?? '',
        logRetentionDays: String(configQuery.data.config.logRetentionDays ?? 30),
        storePayloads: configQuery.data.config.storePayloads !== false
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
        storePayloads: form.storePayloads
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
      storePayloads: config.storePayloads !== false
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

  const isLoading = configQuery.isPending || (!config && configQuery.isFetching)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.description')}</p>
      </header>

      {isLoading ? (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Loader />
        </section>
      ) : !config ? (
        <section className="flex min-h-[200px] items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-sm text-red-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {t('settings.toast.missingConfig')}
        </section>
      ) : (
        <>
          <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t('settings.sections.basics')}</h2>
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-md border border-slate-200 px-3 py-1 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  disabled={saving}
                >
                  {t('common.actions.reset')}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-md bg-blue-600 px-3 py-1 text-white transition hover:bg-blue-700 disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? t('common.actions.saving') : t('common.actions.save')}
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('settings.fields.port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(event) => handleInputChange('port')(event.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                  aria-invalid={Boolean(errors.port)}
                />
                {errors.port ? <span className="text-xs text-red-500">{errors.port}</span> : null}
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('settings.fields.host')}</span>
                <input
                  value={form.host}
                  onChange={(event) => handleInputChange('host')(event.target.value)}
                  placeholder={t('settings.fields.hostPlaceholder')}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('settings.fields.retention')}</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.logRetentionDays}
                  onChange={(event) => handleInputChange('logRetentionDays')(event.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                  aria-invalid={Boolean(errors.logRetentionDays)}
                />
                {errors.logRetentionDays ? <span className="text-xs text-red-500">{errors.logRetentionDays}</span> : null}
              </label>

              <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={form.storePayloads}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, storePayloads: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600"
                />
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {t('settings.fields.storePayloads')}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('settings.fields.storePayloadsHint')}
                  </span>
                </div>
              </label>

              <div className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('settings.fields.defaults')}</span>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  {defaultsSummary ?? t('settings.defaults.none')}
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('settings.sections.configFile')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.file.description')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  {configPath || t('settings.file.unknown')}
                </code>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {t('common.actions.copy')}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('settings.sections.cleanup')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.cleanup.description')}</p>
              <button
                type="button"
                onClick={handleCleanupLogs}
                className="w-fit rounded-md border border-red-200 px-4 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40"
                disabled={cleaning}
              >
                {cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
