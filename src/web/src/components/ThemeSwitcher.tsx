import { Moon, Sun, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/providers/ThemeProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const modes: Array<{ mode: 'light' | 'dark' | 'system'; labelKey: string; icon: typeof Sun }> = [
  { mode: 'light', labelKey: 'common.theme.light', icon: Sun },
  { mode: 'dark', labelKey: 'common.theme.dark', icon: Moon },
  { mode: 'system', labelKey: 'common.theme.system', icon: Monitor }
]

export function ThemeSwitcher() {
  const { mode, setMode, resolved } = useTheme()
  const { t } = useTranslation()

  const currentMode = modes.find(m => m.mode === mode)
  const Icon = currentMode?.icon || (resolved === 'dark' ? Moon : Sun)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('common.theme.label')}>
          <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t(currentMode?.labelKey ?? 'common.theme.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {modes.map((item) => {
          const ItemIcon = item.icon
          const isSelected = item.mode === mode
          return (
            <DropdownMenuItem
              key={item.mode}
              onClick={() => setMode(item.mode)}
              className={isSelected ? 'bg-accent' : ''}
            >
              <ItemIcon className="mr-2 h-4 w-4" aria-hidden="true" />
              {t(item.labelKey)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
