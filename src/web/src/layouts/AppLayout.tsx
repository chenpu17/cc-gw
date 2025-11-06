import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BarChart3, Cog, FileText, Key, Layers, LifeBuoy, Menu, Settings, X } from 'lucide-react'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/utils/cn'
import { pageContainerClass, subtleButtonClass } from '@/styles/theme'
import { useAuth } from '@/providers/AuthProvider'

const navItems = [
  { to: '/', icon: BarChart3, labelKey: 'nav.dashboard' },
  { to: '/logs', icon: FileText, labelKey: 'nav.logs' },
  { to: '/models', icon: Layers, labelKey: 'nav.models' },
  { to: '/events', icon: AlertTriangle, labelKey: 'nav.events' },
  { to: '/api-keys', icon: Key, labelKey: 'nav.apiKeys' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
  { to: '/help', icon: LifeBuoy, labelKey: 'nav.help' },
  { to: '/about', icon: Cog, labelKey: 'nav.about' }
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()

  return (
    <nav className="flex h-full flex-col gap-1" aria-label={t('app.title')}>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-all duration-200',
                isActive
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              )
            }
            end={item.to === '/'}
            title={t(item.labelKey)}
          >
            {({ isActive }) => (
              <>
                <span className="flex h-7 w-7 items-center justify-center">
                  <Icon
                    size={14}
                    className={cn(
                      'transition-colors duration-200',
                      isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                    )}
                    aria-hidden="true"
                  />
                </span>
                <span
                  className={cn(
                    'hidden xl:block font-medium text-xs leading-tight whitespace-nowrap transition-colors duration-200',
                    isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'
                  )}
                >
                  {t(item.labelKey)}
                </span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { authEnabled, username, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="relative flex min-h-screen text-slate-900 dark:text-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-4 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      {/* Desktop Sidebar */}
      <aside className="relative z-20 hidden flex-col gap-3 border-r border-slate-200/20 bg-white/60 px-2 py-3 shadow-md shadow-slate-200/15 backdrop-blur-sm lg:flex lg:w-36 lg:min-w-[9rem] lg:max-w-[9rem] xl:w-40 xl:min-w-[10rem] xl:max-w-[10rem] 2xl:w-44 2xl:min-w-[11rem] 2xl:max-w-[11rem] lg:flex-shrink-0 dark:border-slate-800/20 dark:bg-slate-950/60 dark:shadow-lg dark:shadow-slate-900/20">
        <div className="space-y-2" aria-label={t('app.title')}>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200/30 bg-white/80 p-1.5 shadow-sm shadow-slate-200/20 backdrop-blur-sm dark:border-slate-700/30 dark:bg-slate-900/80 dark:shadow-md dark:shadow-slate-900/20">
            <div className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-xs font-bold text-white shadow-md shadow-blue-500/20">
              GW
            </div>
            <div className="hidden xl:block">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{t('app.title')}</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-4 border-b border-slate-200/30 bg-white/90 px-3 sm:px-4 lg:px-6 py-2.5 sm:py-3 shadow-md shadow-slate-200/15 backdrop-blur-sm dark:border-slate-800/30 dark:bg-slate-950/90 dark:shadow-lg dark:shadow-slate-900/20">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/50 bg-white/90 text-slate-600 shadow-lg shadow-slate-200/30 transition-shadow duration-200 hover:bg-white hover:shadow-xl dark:border-slate-700/50 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-xl dark:shadow-slate-900/30 dark:hover:bg-slate-900"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? t('common.actions.closeNavigation') : t('common.actions.openNavigation')}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
            >
              {mobileNavOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
            <div className="text-lg font-bold gradient-text">{t('app.title')}</div>
          </div>
          <div className="flex items-center gap-3">
            {authEnabled ? (
              <div className="flex items-center gap-3">
                {username ? (
                  <span className="hidden text-xs font-medium text-slate-500 dark:text-slate-400 sm:inline">
                    {t('login.status', { username })}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className={cn(subtleButtonClass, 'h-10 rounded-full px-4')}
                  disabled={loggingOut}
                >
                  {loggingOut ? t('common.actions.loading') : t('common.actions.logout')}
                </button>
              </div>
            ) : null}
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        {/* Main Content */}
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-6 pb-8 sm:pb-12 lg:pb-16 pt-6 sm:pt-8"
        >
          <div className={cn(pageContainerClass, 'animate-fade-in')}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile Navigation Overlay */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-900/80 backdrop-blur-sm lg:hidden animate-fade-in" role="dialog" aria-modal="true">
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 w-72 sm:w-80 border-r border-slate-200/40 bg-gradient-to-b from-white/95 to-white/90 px-4 sm:px-6 py-6 sm:py-8 shadow-2xl shadow-slate-900/30 backdrop-blur-xl animate-slide-up dark:border-slate-800/40 dark:from-slate-950/95 dark:to-slate-950/90 gpu-accelerated"
          >
            <div className="mb-8 flex items-center justify-between">
              <span className="text-lg font-bold gradient-text">{t('app.title')}</span>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/50 bg-white/90 text-slate-600 shadow-lg shadow-slate-200/30 transition-shadow duration-200 hover:bg-white dark:border-slate-700/50 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-xl dark:shadow-slate-900/30"
                onClick={() => setMobileNavOpen(false)}
                aria-label={t('common.actions.closeNavigation')}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
