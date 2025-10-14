import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { Loader } from '@/components/Loader'
import { cn } from '@/utils/cn'
import { mutedTextClass, primaryButtonClass } from '@/styles/theme'

interface LocationState {
  from?: {
    pathname?: string
  }
}

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { authEnabled, isAuthenticated, loading, login, error } = useAuth()
  const [form, setForm] = useState({ username: '', password: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fallbackTarget = useMemo(() => {
    const state = location.state as LocationState | undefined
    return state?.from?.pathname ?? '/'
  }, [location.state])

  useEffect(() => {
    if (!authEnabled && !loading) {
      navigate(fallbackTarget, { replace: true })
      return
    }
    if (authEnabled && isAuthenticated && !loading) {
      navigate(fallbackTarget, { replace: true })
    }
  }, [authEnabled, isAuthenticated, loading, navigate, fallbackTarget])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    if (!form.username.trim() || !form.password) {
      setFormError(t('login.validation.required'))
      return
    }
    setSubmitting(true)
    try {
      await login(form.username.trim(), form.password)
      navigate(fallbackTarget, { replace: true })
    } catch (authErr) {
      setFormError(authErr instanceof Error ? authErr.message : t('login.validation.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const renderBackground = (children: React.ReactNode) => (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50/80 via-white to-indigo-100/60 px-4 dark:from-slate-950/95 dark:via-slate-950 dark:to-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-10 top-20 h-48 w-48 rounded-full bg-blue-200/50 blur-3xl dark:bg-blue-500/20" />
        <div className="absolute right-16 bottom-32 h-56 w-56 rounded-full bg-indigo-200/40 blur-3xl dark:bg-indigo-500/20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,_130,_246,_0.12),_transparent_55%)]" />
      </div>
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </div>
  )

  if (loading) {
    return renderBackground(
      <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-blue-200/60 bg-white/90 shadow-2xl shadow-blue-200/50 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-900/80 dark:shadow-slate-900/60">
        <Loader />
      </div>
    )
  }

  if (!authEnabled) {
    return null
  }

  return renderBackground(
    <main className="rounded-3xl border border-blue-200/70 bg-white/95 px-8 pb-10 pt-9 shadow-2xl shadow-blue-200/50 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-900/85 dark:shadow-slate-900/60">
      <header className="mb-8 flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-xl font-bold text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-900/40">
          GW
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{t('login.title')}</h1>
          <p className={cn(mutedTextClass, 'text-sm leading-relaxed max-w-[360px]')}>
            {t('login.description')}
          </p>
        </div>
      </header>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('login.fields.username')}
          </span>
          <input
            value={form.username}
            autoComplete="username"
            autoFocus
            onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
            placeholder={t('login.fields.usernamePlaceholder')}
            className="h-11 rounded-2xl border border-blue-200/60 bg-blue-50/70 px-4 text-sm font-medium text-blue-900 shadow-sm shadow-blue-200/40 transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-100 dark:shadow-blue-900/30"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('login.fields.password')}
          </span>
          <input
            type="password"
            value={form.password}
            autoComplete="current-password"
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder={t('login.fields.passwordPlaceholder')}
            className="h-11 rounded-2xl border border-slate-200/70 bg-white/95 px-4 text-sm shadow-sm shadow-slate-200/40 transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-100 dark:shadow-slate-900/40"
          />
        </div>
        {(formError || error) ? (
          <div className="rounded-2xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm font-medium text-red-600 shadow-sm shadow-red-200/40 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100">
            {formError || error}
          </div>
        ) : null}

        <button
          type="submit"
          className={cn(primaryButtonClass, 'w-full justify-center rounded-full py-3 text-sm font-semibold')}
          disabled={submitting}
        >
          {submitting ? t('common.actions.loading') : t('login.actions.submit')}
        </button>
      </form>

      <footer className="mt-7 text-center text-xs">
        <p className={cn(mutedTextClass, 'leading-relaxed')}>
          {t('login.hint')}
        </p>
      </footer>
    </main>
  )
}
