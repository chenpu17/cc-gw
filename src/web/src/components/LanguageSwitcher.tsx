import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const languages: Array<{ code: 'zh' | 'en'; labelKey: string; nativeName: string }> = [
  { code: 'zh', labelKey: 'language.zh', nativeName: '中文' },
  { code: 'en', labelKey: 'language.en', nativeName: 'English' }
]

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const currentLanguage = languages.find(lang => lang.code === currentLang)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('common.languageSelector')}>
          <Languages className="mr-2 h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{currentLanguage?.nativeName ?? 'Language'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className={lang.code === currentLang ? 'bg-accent' : ''}
          >
            {lang.nativeName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
