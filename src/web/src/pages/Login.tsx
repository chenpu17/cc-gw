import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { Loader } from '@/components/Loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex min-h-[320px] items-center justify-center">
            <Loader />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!authEnabled) {
    return null
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            GW
          </div>
          <CardTitle className="text-2xl">{t('login.title')}</CardTitle>
          <CardDescription className="text-sm">
            {t('login.description')}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">{t('login.fields.username')}</Label>
              <Input
                id="username"
                value={form.username}
                autoComplete="username"
                autoFocus
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder={t('login.fields.usernamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('login.fields.password')}</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                autoComplete="current-password"
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder={t('login.fields.passwordPlaceholder')}
              />
            </div>

            {(formError || error) && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError || error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('common.actions.loading') : t('login.actions.submit')}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-center text-xs text-muted-foreground">
            {t('login.hint')}
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
