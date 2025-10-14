import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n'
import { ThemeProvider } from './ThemeProvider'
import { ToastProvider } from './ToastProvider'
import { AuthProvider } from './AuthProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
}
