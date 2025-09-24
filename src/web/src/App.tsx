import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AppProviders } from '@/providers/AppProviders'
import { Loader } from '@/components/Loader'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const ModelManagementPage = lazy(() => import('@/pages/ModelManagement'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const AboutPage = lazy(() => import('@/pages/About'))

export function App() {
  return (
    <AppProviders>
      <BrowserRouter basename={typeof window !== 'undefined' && window.location.pathname.startsWith('/ui') ? '/ui' : '/'}>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="models" element={<ModelManagementPage />} />
              <Route path="providers" element={<ModelManagementPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="about" element={<AboutPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProviders>
  )
}

export default App
