import { useTranslation } from 'react-i18next'

const languages: Array<{ code: 'zh' | 'en'; labelKey: string }> = [
  { code: 'zh', labelKey: 'language.zh' },
  { code: 'en', labelKey: 'language.en' }
]

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()

  return (
    <select
      value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
      onChange={(event) => i18n.changeLanguage(event.target.value)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
      aria-label={t('common.languageSelector')}
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {t(lang.labelKey)}
        </option>
      ))}
    </select>
  )
}
