import { useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/providers/ThemeProvider'
import { subtleButtonClass } from '@/styles/theme'
import { cn } from '@/utils/cn'

const modes: Array<{ mode: 'light' | 'dark' | 'system'; labelKey: string; icon: typeof Sun }> = [
  { mode: 'light', labelKey: 'common.theme.light', icon: Sun },
  { mode: 'dark', labelKey: 'common.theme.dark', icon: Moon },
  { mode: 'system', labelKey: 'common.theme.system', icon: Monitor }
]

export function ThemeSwitcher() {
  const { mode, setMode, resolved } = useTheme()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const currentMode = modes.find(m => m.mode === mode)
  const Icon = currentMode?.icon || (resolved === 'dark' ? Moon : Sun)

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          subtleButtonClass,
          'h-11 rounded-2xl px-4 transition-all duration-200',
          open && 'ring-2 ring-blue-500/30'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        onBlur={(e) => {
          // Only close if clicking outside the dropdown
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setOpen(false)
          }
        }}
        aria-label={t('common.theme.label')}
      >
        <Icon size={18} aria-hidden="true" />
        <span className="font-medium">{t(currentMode?.labelKey ?? 'common.theme.label')}</span>
      </button>
      {open ? (
        <ul className="absolute right-0 z-20 mt-3 w-48 space-y-1 rounded-2xl border border-slate-200/50 bg-white/95 p-2 shadow-xl shadow-slate-200/40 backdrop-blur-xl animate-slide-down dark:border-slate-700/50 dark:bg-slate-900/95 dark:shadow-2xl dark:shadow-slate-900/50">
          {modes.map((item) => {
            const ItemIcon = item.icon
            const isSelected = item.mode === mode
            return (
              <li key={item.mode}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMode(item.mode)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200',
                    isSelected
                      ? 'bg-gradient-to-r from-blue-600/15 to-indigo-600/10 text-blue-700 shadow-md shadow-blue-200/40 ring-1 ring-blue-500/20 dark:from-blue-500/25 dark:to-indigo-500/15 dark:text-blue-100 dark:shadow-lg dark:shadow-blue-500/20 dark:ring-blue-400/20'
                      : 'text-slate-700 hover:bg-slate-100/80 hover:shadow-sm hover:shadow-slate-200/30 dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:shadow-lg dark:hover:shadow-slate-900/30'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-xl border transition-all duration-200',
                      isSelected
                        ? 'border-blue-500/30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 dark:from-blue-500 dark:to-indigo-500 dark:shadow-blue-500/20'
                        : 'border-slate-200/60 bg-white/90 text-slate-600 shadow-sm shadow-slate-200/20 dark:border-slate-700/60 dark:bg-slate-800/90 dark:text-slate-300 dark:shadow-lg dark:shadow-slate-900/20'
                    )}
                  >
                    <ItemIcon size={14} aria-hidden="true" />
                  </span>
                  {t(item.labelKey)}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
