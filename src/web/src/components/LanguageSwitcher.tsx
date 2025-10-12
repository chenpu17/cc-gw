import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { cn } from '@/utils/cn'
import { selectClass } from '@/styles/theme'

const languages: Array<{ code: 'zh' | 'en'; labelKey: string; nativeName: string }> = [
  { code: 'zh', labelKey: 'language.zh', nativeName: '中文' },
  { code: 'en', labelKey: 'language.en', nativeName: 'English' }
]

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const currentLanguage = languages.find(lang => lang.code === currentLang)

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-white/85 via-white/80 to-white/75 px-4 py-2.5 shadow-lg shadow-slate-200/30 ring-1 ring-slate-200/40 backdrop-blur-lg transition-all duration-300 hover:bg-white/90 hover:shadow-xl hover:shadow-slate-200/40 dark:from-slate-900/85 dark:via-slate-900/80 dark:to-slate-900/75 dark:shadow-xl dark:shadow-slate-900/30 dark:ring-slate-700/40 dark:hover:bg-slate-900/90">
        <Languages size={16} className="text-slate-600 dark:text-slate-300" aria-hidden="true" />
        <select
          value={currentLang}
          onChange={(event) => i18n.changeLanguage(event.target.value)}
          className={cn(
            'appearance-none bg-transparent text-sm font-medium text-slate-700 focus:outline-none dark:text-slate-200'
          )}
          aria-label={t('common.languageSelector')}
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.nativeName}
            </option>
          ))}
        </select>
        <div className="text-slate-400 dark:text-slate-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.085 13.71 7.23a.75.75 0 011.08 1.04l-4.24 4.4a.75.75 0 01-1.08 0l-4.24-4.4a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}
