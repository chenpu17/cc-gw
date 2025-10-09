import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfig, ProviderModelConfig } from '@/types/providers'

export interface ProviderDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  provider?: ProviderConfig
  existingProviderIds: string[]
  onClose: () => void
  onSubmit: (payload: ProviderConfig) => Promise<void>
}

interface FormModel extends ProviderModelConfig {
  _key: string
}

interface FormState {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  type: ProviderConfig['type']
  defaultModel: string
  models: FormModel[]
}

interface FormErrors {
  id?: string
  baseUrl?: string
  models?: string
}

function createKey(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function createEmptyModel(): FormModel {
  return {
    _key: createKey(),
    id: '',
    label: ''
  }
}

const PROVIDER_TYPE_PRESETS: Record<Exclude<ProviderConfig['type'], undefined> | 'openai', {
  baseUrl?: string
  models?: Array<Omit<FormModel, '_key'>>
  defaultModel?: string
}> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1'
  },
  huawei: {
    baseUrl: 'https://api.modelarts-maas.com/v1'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
    models: [
      {
        id: 'claude-sonnet-4-5-20250929',
        label: 'Claude Sonnet 4.5 (2025-09-29)'
      },
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4 (2025-05-14)'
      },
      {
        id: 'claude-opus-4-1-20250805',
        label: 'Claude Opus 4.1 (2025-08-05)'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude 3.5 Haiku (2024-10-22)'
      }
    ]
  },
  custom: {}
}

function buildInitialState(provider?: ProviderConfig): FormState {
  if (!provider) {
    const emptyModel = createEmptyModel()
    return {
      id: '',
      label: '',
      baseUrl: '',
      apiKey: '',
      type: 'custom',
      defaultModel: '',
      models: [emptyModel]
    }
  }

  return {
    id: provider.id,
    label: provider.label ?? provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    type: provider.type ?? 'custom',
    defaultModel: provider.defaultModel ?? '',
    models: (provider.models ?? []).map((model) => ({
      ...model,
      _key: createKey()
    }))
  }
}

function mapPresetModel(model: Omit<FormModel, '_key'>): FormModel {
  return {
    _key: createKey(),
    id: model.id,
    label: model.label
  }
}

export function ProviderDrawer({
  open,
  mode,
  provider,
  existingProviderIds,
  onClose,
  onSubmit
}: ProviderDrawerProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => buildInitialState(provider))
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const providerIdRef = useRef<HTMLInputElement | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(mode === 'edit')

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(provider))
      setErrors({})
      setSubmitError(null)
      setSubmitting(false)
      setShowAdvanced(mode === 'edit')
    }
  }, [open, provider, mode])

  useEffect(() => {
    if (!open) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    if (mode === 'create' && providerIdRef.current) {
      providerIdRef.current.focus()
      return
    }
    if (closeButtonRef.current) {
      closeButtonRef.current.focus()
    }
  }, [open, mode])

  const availableDefaultModels = useMemo(() => form.models.filter((model) => model.id.trim().length > 0), [form.models])

  const handleInputChange = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleProviderIdChange = (value: string) => {
    setForm((prev) => {
      const shouldSyncLabel =
        !showAdvanced || prev.label.trim().length === 0 || prev.label === prev.id
      const nextLabel = shouldSyncLabel ? value : prev.label
      return { ...prev, id: value, label: nextLabel }
    })
  }

  const handleTypeChange = (value: ProviderConfig['type']) => {
    setForm((prev) => {
      const presetKey = value ?? 'custom'
      const preset = PROVIDER_TYPE_PRESETS[presetKey] ?? PROVIDER_TYPE_PRESETS.custom
      const knownBaseUrls = Object.values(PROVIDER_TYPE_PRESETS)
        .map((item) => item.baseUrl)
        .filter((item): item is string => Boolean(item))
      const shouldReplaceBaseUrl = !prev.baseUrl || knownBaseUrls.includes(prev.baseUrl)
      const shouldApplyModels =
        mode === 'create' && (prev.models.length === 0 || prev.models.every((model) => model.id.trim().length === 0))

      const next: FormState = {
        ...prev,
        type: value
      }

      if (preset?.baseUrl && shouldReplaceBaseUrl) {
        next.baseUrl = preset.baseUrl
      }

      if (preset?.models && shouldApplyModels) {
        next.models = preset.models.map(mapPresetModel)
        next.defaultModel = preset.defaultModel ?? preset.models[0]?.id ?? ''
      }

      return next
    })
  }

  const handleModelChange = (index: number, patch: Partial<FormModel>) => {
    setForm((prev) => {
      const nextModels = [...prev.models]
      nextModels[index] = { ...nextModels[index], ...patch }
      return { ...prev, models: nextModels }
    })
  }

  const handleModelIdChange = (index: number, value: string) => {
    setForm((prev) => {
      const nextModels = [...prev.models]
      const current = nextModels[index]
      if (!current) return prev
      const shouldSyncLabel =
        !showAdvanced || !current.label || current.label === current.id
      const nextModel: FormModel = {
        ...current,
        id: value,
        label: shouldSyncLabel ? value : current.label
      }
      nextModels[index] = nextModel

      const nextDefault = prev.defaultModel === current.id ? value : prev.defaultModel

      return { ...prev, models: nextModels, defaultModel: nextDefault }
    })
  }

  const handleRemoveModel = (index: number) => {
    setForm((prev) => {
      if (prev.models.length <= 1) return prev
      const nextModels = prev.models.filter((_, idx) => idx !== index)
      let nextDefault = prev.defaultModel
      if (!nextModels.some((model) => model.id === nextDefault)) {
        nextDefault = nextModels[0]?.id ?? ''
      }
      return { ...prev, models: nextModels, defaultModel: nextDefault }
    })
  }

  const handleAddModel = () => {
    setForm((prev) => ({
      ...prev,
      models: [...prev.models, createEmptyModel()]
    }))
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}
    const trimmedId = form.id.trim()
    const trimmedUrl = form.baseUrl.trim()

    if (mode === 'create') {
      if (trimmedId.length === 0) {
        nextErrors.id = t('providers.drawer.errors.idRequired')
      } else if (existingProviderIds.includes(trimmedId)) {
        nextErrors.id = t('providers.drawer.errors.idDuplicate')
      }
    }

    if (mode === 'edit' && trimmedId.length === 0) {
      nextErrors.id = t('providers.drawer.errors.idRequired')
    }

    if (trimmedUrl.length === 0) {
      nextErrors.baseUrl = t('providers.drawer.errors.baseUrlInvalid')
    } else {
      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl)
      } catch {
        nextErrors.baseUrl = t('providers.drawer.errors.baseUrlInvalid')
      }
    }

    const modelIds = new Set<string>()
    const invalidModel = form.models.some((model) => {
      const id = model.id.trim()
      if (id.length === 0) {
        return true
      }
      if (modelIds.has(id)) {
        return true
      }
      modelIds.add(id)
      return false
    })

    if (invalidModel) {
      nextErrors.models = t('providers.drawer.errors.modelInvalid')
    }

    if (form.models.length === 0) {
      nextErrors.models = t('providers.drawer.errors.modelsRequired')
    }

    if (form.defaultModel && !form.models.some((model) => model.id === form.defaultModel)) {
      nextErrors.models = t('providers.drawer.errors.defaultInvalid')
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const serialize = (): ProviderConfig => {
    const trimmedModels: ProviderModelConfig[] = form.models.map((model) => ({
      id: model.id.trim(),
      label: model.label?.trim() ? model.label.trim() : undefined
    }))

    const extraHeaders = provider?.extraHeaders && Object.keys(provider.extraHeaders).length > 0 ? provider.extraHeaders : undefined

    return {
      id: form.id.trim(),
      label: form.label.trim() || form.id.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      type: form.type ?? 'custom',
      defaultModel: form.defaultModel || undefined,
      models: trimmedModels,
      extraHeaders
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!validate()) return
    setSubmitting(true)
    try {
      const payload = serialize()
      await onSubmit(payload)
    } catch (error) {
      setSubmitError(t('providers.drawer.toast.saveFailure', { message: error instanceof Error ? error.message : 'unknown' }))
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onClose()
  }

  const isCreate = mode === 'create'

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-drawer-title"
        aria-describedby="provider-drawer-desc"
        className="flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="provider-drawer-title" className="text-lg font-semibold">
              {isCreate ? t('providers.drawer.createTitle') : t('providers.drawer.editTitle')}
            </h2>
            <p id="provider-drawer-desc" className="text-xs text-slate-500 dark:text-slate-400">
              {t('providers.drawer.description')}
            </p>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t('common.actions.close')}
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <section className="space-y-4" aria-labelledby="provider-basic-fields">
            <div id="provider-basic-fields" className="sr-only">
              {t('providers.drawer.description')}
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="rounded-md border border-slate-200 px-3 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {showAdvanced
                  ? t('providers.drawer.fields.hideAdvanced')
                  : t('providers.drawer.fields.showAdvanced')}
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.id')}</span>
                <input
                  value={form.id}
                  ref={providerIdRef}
                  onChange={(event) => handleProviderIdChange(event.target.value)}
                  disabled={!isCreate}
                  placeholder={t('providers.drawer.fields.idPlaceholder')}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                  aria-invalid={Boolean(errors.id)}
                />
                {errors.id ? <span className="text-xs text-red-500">{errors.id}</span> : null}
              </label>
              {showAdvanced ? (
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.label')}</span>
                  <input
                    value={form.label}
                    onChange={(event) => handleInputChange('label')(event.target.value)}
                    placeholder={t('providers.drawer.fields.labelPlaceholder')}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                  />
                </label>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.baseUrl')}</span>
                <input
                  value={form.baseUrl}
                  onChange={(event) => handleInputChange('baseUrl')(event.target.value)}
                  placeholder={t('providers.drawer.fields.baseUrlPlaceholder')}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                  aria-invalid={Boolean(errors.baseUrl)}
                />
                {errors.baseUrl ? <span className="text-xs text-red-500">{errors.baseUrl}</span> : null}
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.type')}</span>
                <select
                  value={form.type ?? 'custom'}
                  onChange={(event) => handleTypeChange(event.target.value as ProviderConfig['type'])}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                >
                  <option value="openai">OpenAI</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="huawei">华为云</option>
                  <option value="kimi">Kimi</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.apiKey')}</span>
              <input
                value={form.apiKey}
                onChange={(event) => handleInputChange('apiKey')(event.target.value)}
                placeholder={t('providers.drawer.fields.apiKeyPlaceholder')}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
              />
            </label>
          </section>

          <section className="mt-6 space-y-3" aria-labelledby="provider-model-fields">
            <header className="flex items-center justify-between">
              <div>
                <h3 id="provider-model-fields" className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('providers.drawer.fields.models')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.modelsDescription')}</p>
              </div>
              <button
                type="button"
                onClick={handleAddModel}
                className="rounded-md border border-slate-200 px-3 py-1 text-xs transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {t('providers.drawer.fields.addModel')}
              </button>
            </header>

            {errors.models ? <p className="text-xs text-red-500">{errors.models}</p> : null}

              <div className="space-y-4">
                {form.models.map((model, index) => (
                  <div
                    key={model._key}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.modelId')}</span>
                        <input
                          value={model.id}
                          onChange={(event) => handleModelIdChange(index, event.target.value)}
                          placeholder={t('providers.drawer.fields.modelIdPlaceholder')}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                        />
                      </label>
                      {showAdvanced ? (
                        <label className="flex flex-col gap-2 text-sm">
                          <span className="text-xs text-slate-500 dark:text-slate-400">{t('providers.drawer.fields.modelLabel')}</span>
                          <input
                            value={model.label ?? ''}
                            onChange={(event) => handleModelChange(index, { label: event.target.value })}
                            placeholder={t('providers.drawer.fields.modelLabelPlaceholder')}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-blue-400 dark:focus:ring-blue-400/40 dark:disabled:bg-slate-800/60"
                          />
                        </label>
                      ) : null}
                    </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <input
                        type="radio"
                        name="defaultModel"
                        value={model.id}
                        checked={form.defaultModel === model.id}
                        onChange={() => setForm((prev) => ({ ...prev, defaultModel: model.id }))}
                        disabled={model.id.trim().length === 0}
                      />
                      {t('providers.drawer.fields.setDefault')}
                    </label>
                    <button
                      type="button"
                      className="text-red-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => handleRemoveModel(index)}
                      disabled={form.models.length <= 1}
                    >
                      {t('providers.drawer.fields.removeModel')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {availableDefaultModels.length > 1 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('providers.drawer.defaultHint', { model: form.defaultModel || t('providers.card.noDefault') })}
              </div>
            ) : null}
          </section>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 text-sm dark:border-slate-800">
          <div className="flex flex-col text-xs text-red-500" aria-live="polite">
            {submitError ? <span>{submitError}</span> : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              disabled={submitting}
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? t('common.actions.saving') : t('common.actions.save')}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
