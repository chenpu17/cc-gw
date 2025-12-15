import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Copy, Shield, AlertCircle } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  httpEnabled: boolean
  httpPort: string
  httpHost: string
  httpsEnabled: boolean
  httpsPort: string
  httpsHost: string
  httpsKeyPath: string
  httpsCertPath: string
  httpsCaPath: string
}

interface FormErrors {
  port?: string
  logRetentionDays?: string
  bodyLimitMb?: string
  httpPort?: string
  httpsPort?: string
  protocol?: string
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
    enableRoutingFallback: false,
    httpEnabled: true,
    httpPort: '4100',
    httpHost: '127.0.0.1',
    httpsEnabled: false,
    httpsPort: '4443',
    httpsHost: '127.0.0.1',
    httpsKeyPath: '',
    httpsCertPath: '',
    httpsCaPath: ''
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

      const cfg = configQuery.data.config

      setForm({
        port: String(cfg.port ?? cfg.http?.port ?? ''),
        host: cfg.host ?? cfg.http?.host ?? '127.0.0.1',
        logRetentionDays: String(cfg.logRetentionDays ?? 30),
        storeRequestPayloads: deriveStoreFlag(cfg.storeRequestPayloads),
        storeResponsePayloads: deriveStoreFlag(cfg.storeResponsePayloads),
        logLevel: (cfg.logLevel as LogLevel) ?? 'info',
        requestLogging: cfg.requestLogging !== false,
        responseLogging: cfg.responseLogging ?? cfg.requestLogging !== false,
        bodyLimitMb: (() => {
          const raw = cfg.bodyLimit
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            return String(Math.max(1, Math.round(raw / (1024 * 1024))))
          }
          return '10'
        })(),
        enableRoutingFallback: cfg.enableRoutingFallback === true,
        httpEnabled: cfg.http?.enabled !== false,
        httpPort: String(cfg.http?.port ?? cfg.port ?? 4100),
        httpHost: cfg.http?.host ?? cfg.host ?? '127.0.0.1',
        httpsEnabled: cfg.https?.enabled === true,
        httpsPort: String(cfg.https?.port ?? 4443),
        httpsHost: cfg.https?.host ?? cfg.host ?? '127.0.0.1',
        httpsKeyPath: cfg.https?.keyPath ?? '',
        httpsCertPath: cfg.https?.certPath ?? '',
        httpsCaPath: cfg.https?.caPath ?? ''
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

    if (!form.httpEnabled && !form.httpsEnabled) {
      nextErrors.protocol = '至少需要启用 HTTP 或 HTTPS 协议'
    }

    if (form.httpEnabled) {
      const httpPortValue = Number(form.httpPort)
      if (!Number.isFinite(httpPortValue) || httpPortValue < 1 || httpPortValue > 65535) {
        nextErrors.httpPort = 'HTTP 端口必须在 1-65535 之间'
      }
    }

    if (form.httpsEnabled) {
      const httpsPortValue = Number(form.httpsPort)
      if (!Number.isFinite(httpsPortValue) || httpsPortValue < 1 || httpsPortValue > 65535) {
        nextErrors.httpsPort = 'HTTPS 端口必须在 1-65535 之间'
      }

      if (!form.httpsKeyPath || !form.httpsCertPath) {
        nextErrors.protocol = 'HTTPS 已启用但缺少证书路径，请手动配置受信任的证书'
      }
    }

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
        http: {
          enabled: form.httpEnabled,
          port: Number(form.httpPort),
          host: form.httpHost.trim() || '127.0.0.1'
        },
        https: {
          enabled: form.httpsEnabled,
          port: Number(form.httpsPort),
          host: form.httpsHost.trim() || '127.0.0.1',
          keyPath: form.httpsKeyPath.trim(),
          certPath: form.httpsCertPath.trim(),
          caPath: form.httpsCaPath.trim() || undefined
        },
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

      const protocolChanged =
        config.http?.enabled !== nextConfig.http?.enabled ||
        config.http?.port !== nextConfig.http?.port ||
        config.https?.enabled !== nextConfig.https?.enabled ||
        config.https?.port !== nextConfig.https?.port ||
        config.https?.keyPath !== nextConfig.https?.keyPath ||
        config.https?.certPath !== nextConfig.https?.certPath

      if (protocolChanged) {
        pushToast({
          title: '配置已保存！请执行 cc-gw restart --daemon 重启服务使协议配置生效',
          variant: 'success'
        })
      } else {
        pushToast({ title: t('settings.toast.saveSuccess'), variant: 'success' })
      }
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
      enableRoutingFallback: config.enableRoutingFallback === true,
      httpEnabled: config.http?.enabled !== false,
      httpPort: String(config.http?.port ?? config.port ?? 4100),
      httpHost: config.http?.host ?? config.host ?? '127.0.0.1',
      httpsEnabled: config.https?.enabled === true,
      httpsPort: String(config.https?.port ?? 4443),
      httpsHost: config.https?.host ?? config.host ?? '127.0.0.1',
      httpsKeyPath: config.https?.keyPath ?? '',
      httpsCertPath: config.https?.certPath ?? '',
      httpsCaPath: config.https?.caPath ?? ''
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
      await copyToClipboard(configPath)
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" aria-hidden="true" />}
        title={t('settings.title')}
        description={t('settings.description')}
        actions={
          config ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleReset} disabled={saving}>
                {t('common.actions.reset')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? t('common.actions.saving') : t('common.actions.save')}
              </Button>
            </div>
          ) : null
        }
      />

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-[220px] items-center justify-center">
            <Loader />
          </CardContent>
        </Card>
      ) : !config ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">{t('settings.toast.missingConfig')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Basic Settings */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-4 text-sm font-semibold">{t('settings.sections.basics')}</h3>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('settings.fields.port')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => handleInputChange('port')(e.target.value)}
                    aria-invalid={Boolean(errors.port)}
                  />
                  {errors.port && (
                    <p className="text-xs text-destructive">{errors.port}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.host')}</Label>
                  <Input
                    value={form.host}
                    onChange={(e) => handleInputChange('host')(e.target.value)}
                    placeholder={t('settings.fields.hostPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.retention')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={form.logRetentionDays}
                    onChange={(e) => handleInputChange('logRetentionDays')(e.target.value)}
                    aria-invalid={Boolean(errors.logRetentionDays)}
                  />
                  {errors.logRetentionDays && (
                    <p className="text-xs text-destructive">{errors.logRetentionDays}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.bodyLimit')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={2048}
                    value={form.bodyLimitMb}
                    onChange={(e) => handleInputChange('bodyLimitMb')(e.target.value)}
                    aria-invalid={Boolean(errors.bodyLimitMb)}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.fields.bodyLimitHint')}</p>
                  {errors.bodyLimitMb && (
                    <p className="text-xs text-destructive">{errors.bodyLimitMb}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.logLevel')}</Label>
                  <Select
                    value={form.logLevel}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, logLevel: value as LogLevel }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_LEVEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(`settings.fields.logLevelOption.${option.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.storeRequestPayloads')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.storeRequestPayloadsHint')}</p>
                    </div>
                    <Switch
                      checked={form.storeRequestPayloads}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, storeRequestPayloads: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.storeResponsePayloads')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.storeResponsePayloadsHint')}</p>
                    </div>
                    <Switch
                      checked={form.storeResponsePayloads}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, storeResponsePayloads: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.requestLogging')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.requestLoggingHint')}</p>
                    </div>
                    <Switch
                      checked={form.requestLogging}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requestLogging: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.responseLogging')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.responseLoggingHint')}</p>
                    </div>
                    <Switch
                      checked={form.responseLogging}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, responseLogging: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        {t('settings.fields.enableRoutingFallback')}
                      </Label>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t('settings.fields.enableRoutingFallbackHint')}
                      </p>
                    </div>
                    <Switch
                      checked={form.enableRoutingFallback}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enableRoutingFallback: checked }))}
                    />
                  </div>
                </div>

                <div className="md:col-span-2 rounded-lg border bg-muted/50 p-4">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('settings.fields.defaults')}
                  </Label>
                  <p className="mt-2 text-sm">{defaultsSummary ?? t('settings.defaults.none')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Protocol Settings */}
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.protocol')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.protocol.description')}</p>
              </div>

              {/* Restart Warning */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t('settings.protocol.restartWarning')}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {t('settings.protocol.restartHint')}
                    </p>
                    <code className="block rounded-md bg-amber-100 px-3 py-2 text-xs font-mono text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      cc-gw restart --daemon
                    </code>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t('settings.protocol.restartTip')}
                    </p>
                  </div>
                </div>
              </div>

              {errors.protocol && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  <AlertCircle className="inline h-4 w-4 mr-2" />
                  {errors.protocol}
                </div>
              )}

              {/* HTTP Config */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-5 dark:border-blue-800 dark:bg-blue-950/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {t('settings.protocol.http.enable')}
                    </Label>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {t('settings.protocol.http.hint')}
                    </p>
                  </div>
                  <Switch
                    checked={form.httpEnabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, httpEnabled: checked }))}
                  />
                </div>

                {form.httpEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2 mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
                    <div className="space-y-2">
                      <Label>{t('settings.protocol.http.port')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={form.httpPort}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpPort: e.target.value }))}
                        aria-invalid={Boolean(errors.httpPort)}
                      />
                      {errors.httpPort && (
                        <p className="text-xs text-destructive">{errors.httpPort}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.http.host')}</Label>
                      <Input
                        value={form.httpHost}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpHost: e.target.value }))}
                        placeholder="127.0.0.1"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* HTTPS Config */}
              <div className="rounded-lg border border-green-200 bg-green-50/50 p-5 dark:border-green-800 dark:bg-green-950/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium text-green-800 dark:text-green-200">
                        {t('settings.protocol.https.enable')}
                      </Label>
                      <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {t('settings.protocol.https.hint')}
                    </p>
                  </div>
                  <Switch
                    checked={form.httpsEnabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, httpsEnabled: checked }))}
                  />
                </div>

                {form.httpsEnabled && (
                  <div className="space-y-4 mt-4 pt-4 border-t border-green-200 dark:border-green-800">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('settings.protocol.https.port')}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={form.httpsPort}
                          onChange={(e) => setForm((prev) => ({ ...prev, httpsPort: e.target.value }))}
                          aria-invalid={Boolean(errors.httpsPort)}
                        />
                        {errors.httpsPort && (
                          <p className="text-xs text-destructive">{errors.httpsPort}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.protocol.https.host')}</Label>
                        <Input
                          value={form.httpsHost}
                          onChange={(e) => setForm((prev) => ({ ...prev, httpsHost: e.target.value }))}
                          placeholder="127.0.0.1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.keyPath')}</Label>
                      <Input
                        value={form.httpsKeyPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsKeyPath: e.target.value }))}
                        placeholder="~/.cc-gw/certs/key.pem"
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.certPath')}</Label>
                      <Input
                        value={form.httpsCertPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsCertPath: e.target.value }))}
                        placeholder="~/.cc-gw/certs/cert.pem"
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.caPath')}</Label>
                      <Input
                        value={form.httpsCaPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsCaPath: e.target.value }))}
                        placeholder="留空则不使用"
                        className="font-mono text-xs"
                      />
                    </div>

                    {/* HTTPS Certificate Warning */}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="space-y-2 flex-1">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                            {t('settings.protocol.https.warning')}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                            <strong>{t('settings.protocol.https.invalidCert')}</strong>
                            {t('settings.protocol.https.invalidCertDetail')}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                            <strong>{t('settings.protocol.https.recommended')}</strong>
                            {t('settings.protocol.https.recommendedDetail')}
                          </p>
                          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            {t('settings.protocol.https.tip')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Security Settings */}
          <Card>
            <CardContent className="pt-6 space-y-5">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.security')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.auth.description')}</p>
              </div>

              {authQuery.isPending && !authSettings ? (
                <div className="flex min-h-[120px] items-center justify-center">
                  <Loader />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{t('settings.auth.enable')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.auth.enableHint')}</p>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                        <span className="rounded-full bg-muted px-3 py-1">/ui</span>
                        <span className="rounded-full bg-muted px-3 py-1">/api/*</span>
                        <span className="rounded-full bg-muted px-3 py-1">Cookie Session</span>
                      </div>
                    </div>
                    <Switch
                      checked={authForm.enabled}
                      onCheckedChange={(checked) => setAuthForm((prev) => ({ ...prev, enabled: checked }))}
                    />
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t('settings.auth.username')}</Label>
                        <Input
                          value={authForm.username}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
                          placeholder={t('settings.auth.usernamePlaceholder')}
                        />
                        {authErrors.username && (
                          <p className="text-xs text-destructive">{authErrors.username}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.auth.password')}</Label>
                        <Input
                          type="password"
                          value={authForm.password}
                          disabled={!authForm.enabled}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
                          placeholder={t('settings.auth.passwordPlaceholder')}
                        />
                        {authErrors.password ? (
                          <p className="text-xs text-destructive">{authErrors.password}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.auth.confirmPassword')}</Label>
                        <Input
                          type="password"
                          value={authForm.confirmPassword}
                          disabled={!authForm.enabled}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                          placeholder={t('settings.auth.confirmPasswordPlaceholder')}
                        />
                        {authErrors.confirmPassword && (
                          <p className="text-xs text-destructive">{authErrors.confirmPassword}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      <div className="rounded-lg border bg-card p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t('settings.auth.status')}
                        </p>
                        <p className="mt-2 text-base font-semibold">
                          {authSettings?.enabled
                            ? t('settings.auth.statusEnabled')
                            : t('settings.auth.statusDisabled')}
                        </p>
                        {authSettings?.username && (
                          <div className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                            {t('settings.auth.username')}: {authSettings.username}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border bg-muted/50 p-4 text-xs text-muted-foreground">
                        {t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button onClick={() => void handleAuthSave()} disabled={savingAuth}>
                      {savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}
                    </Button>
                    <Button variant="outline" onClick={handleAuthReset} disabled={savingAuth}>
                      {t('common.actions.reset')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Config File */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t('settings.sections.configFile')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('settings.file.description')}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleCopyPath()}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t('common.actions.copy')}
                </Button>
              </div>
              <code className="block break-all rounded-lg border bg-muted px-4 py-3 text-xs">
                {configPath || t('settings.file.unknown')}
              </code>
            </CardContent>
          </Card>

          {/* Cleanup */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.cleanup')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.cleanup.description')}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => void handleCleanupLogs()}
                  disabled={cleaning}
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  {cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleClearAllLogs()}
                  disabled={clearingAll}
                >
                  {clearingAll ? t('settings.cleanup.clearingAll') : t('settings.cleanup.clearAll')}
                </Button>
              </div>
              <p className="text-xs text-destructive">
                {t('settings.cleanup.clearAllWarning')}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
