import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const STORAGE_KEY = 'cc-gw-theme'

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function resolvePreferred(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(mode: 'light' | 'dark') {
  const root = document.documentElement
  root.dataset.theme = mode
  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? (stored as ThemeMode) : 'system'
  })

  const resolved = useMemo(() => (typeof window !== 'undefined' ? resolvePreferred(mode) : 'light'), [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => {
      if (mode === 'system') {
        applyTheme(event.matches ? 'dark' : 'light')
      }
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    applyTheme(resolved)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode, resolved])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode
    }),
    [mode, resolved]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
