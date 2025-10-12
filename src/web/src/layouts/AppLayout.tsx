import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart3, Cog, FileText, Key, Layers, LifeBuoy, Menu, Settings, X } from 'lucide-react'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/utils/cn'
import { pageContainerClass } from '@/styles/theme'

const navItems = [
  { to: '/', icon: BarChart3, labelKey: 'nav.dashboard' },
  { to: '/logs', icon: FileText, labelKey: 'nav.logs' },
  { to: '/models', icon: Layers, labelKey: 'nav.models' },
  { to: '/api-keys', icon: Key, labelKey: 'nav.apiKeys' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
  { to: '/help', icon: LifeBuoy, labelKey: 'nav.help' },
  { to: '/about', icon: Cog, labelKey: 'nav.about' }
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()

  return (
    <nav className="flex h-full flex-col gap-2" aria-label={t('app.title')}>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-4 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200 hover-lift',
                isActive
                  ? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/10 text-blue-700 shadow-lg shadow-blue-200/40 ring-1 ring-blue-500/20 dark:from-blue-500/25 dark:to-indigo-500/15 dark:text-blue-100 dark:shadow-xl dark:shadow-blue-500/20 dark:ring-blue-400/20'
                  : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 hover:shadow-md hover:shadow-slate-200/40 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-slate-900/30'
              )
            }
            end={item.to === '/'}
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-2xl border transition-all duration-200',
                    isActive
                      ? 'border-blue-500/30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 dark:from-blue-500 dark:to-indigo-500 dark:shadow-blue-500/20'
                      : 'border-slate-200/60 bg-white/90 text-slate-600 shadow-sm shadow-slate-200/30 group-hover:border-slate-300/70 group-hover:bg-white group-hover:shadow-md dark:border-slate-700/60 dark:bg-slate-800/90 dark:text-slate-300 dark:shadow-lg dark:shadow-slate-900/30'
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    'font-medium transition-colors duration-200',
                    isActive ? 'text-blue-700 dark:text-blue-100' : ''
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

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  return (
    <div className="relative flex min-h-screen text-slate-900 dark:text-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-4 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      {/* Desktop Sidebar */}
      <aside className="relative z-20 hidden flex-col gap-8 border-r border-slate-200/40 bg-gradient-to-b from-white/90 to-white/80 px-6 py-8 shadow-xl shadow-slate-200/30 backdrop-blur-xl lg:flex lg:w-80 dark:border-slate-800/50 dark:from-slate-950/95 dark:to-slate-950/85 dark:shadow-2xl dark:shadow-slate-900/50">
        <div className="space-y-4" aria-label={t('app.title')}>
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200/40 bg-white/90 p-4 shadow-lg shadow-slate-200/30 backdrop-blur-sm dark:border-slate-700/40 dark:bg-slate-900/90 dark:shadow-xl dark:shadow-slate-900/40">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-base font-bold text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-500/20">
              GW
            </div>
            <div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">{t('app.title')}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('dashboard.description')}</p>
            </div>
          </div>
        </div>
        <div className="flex-1">
          <SidebarNav />
        </div>
        <div className="rounded-2xl border border-slate-200/40 bg-gradient-to-br from-slate-50/90 to-white/90 p-4 text-xs font-medium text-slate-600 shadow-lg shadow-slate-200/30 backdrop-blur-sm dark:border-slate-700/40 dark:from-slate-900/90 dark:to-slate-800/90 dark:text-slate-400 dark:shadow-xl dark:shadow-slate-900/40">
          <div className="mb-2 font-bold text-slate-700 dark:text-slate-300">{t('help.title')}</div>
          {t('help.intro')}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200/40 bg-gradient-to-r from-white/90 to-white/85 px-4 py-4 shadow-lg shadow-slate-200/20 backdrop-blur-xl sm:px-6 dark:border-slate-800/40 dark:from-slate-950/90 dark:to-slate-950/85 dark:shadow-2xl dark:shadow-slate-900/30">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/50 bg-white/90 text-slate-600 shadow-lg shadow-slate-200/30 transition-all duration-200 hover:bg-white hover:shadow-xl hover:-translate-y-0.5 dark:border-slate-700/50 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-xl dark:shadow-slate-900/30 dark:hover:bg-slate-900"
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
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        {/* Main Content */}
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto px-4 pb-12 pt-8 sm:px-6 sm:pb-16"
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
            className="absolute inset-y-0 left-0 w-80 border-r border-slate-200/40 bg-gradient-to-b from-white/95 to-white/90 px-6 py-8 shadow-2xl shadow-slate-900/30 backdrop-blur-xl animate-slide-up dark:border-slate-800/40 dark:from-slate-950/95 dark:to-slate-950/90"
          >
            <div className="mb-8 flex items-center justify-between">
              <span className="text-lg font-bold gradient-text">{t('app.title')}</span>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/50 bg-white/90 text-slate-600 shadow-lg shadow-slate-200/30 transition-all duration-200 hover:bg-white hover:-translate-y-0.5 dark:border-slate-700/50 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-xl dark:shadow-slate-900/30"
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
