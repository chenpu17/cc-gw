import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/providers/ThemeProvider'

const modes: Array<{ mode: 'light' | 'dark' | 'system'; labelKey: string }> = [
  { mode: 'light', labelKey: 'common.theme.light' },
  { mode: 'dark', labelKey: 'common.theme.dark' },
  { mode: 'system', labelKey: 'common.theme.system' }
]

export function ThemeSwitcher() {
  const { mode, setMode, resolved } = useTheme()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const icon = resolved === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        onBlur={() => setOpen(false)}
        aria-label={t('common.theme.label')}
      >
        {icon}
        <span>{t(modes.find((item) => item.mode === mode)?.labelKey ?? 'common.theme.label')}</span>
      </button>
      {open ? (
        <ul className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {modes.map((item) => (
            <li key={item.mode}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setMode(item.mode)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  item.mode === mode ? 'bg-slate-100 dark:bg-slate-700' : ''
                }`}
              >
                <span className="h-2 w-2 rounded-full border border-slate-400">
                  <span
                    className={`block h-full w-full rounded-full ${mode === item.mode ? 'bg-blue-500' : ''}`}
                  />
                </span>
                {t(item.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
