import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { AppProviders } from '@/providers/AppProviders'
import { Loader } from '@/components/Loader'
import { useAuth } from '@/providers/AuthProvider'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const EventsPage = lazy(() => import('@/pages/Events'))
const ModelManagementPage = lazy(() => import('@/pages/ModelManagement'))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeys'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const AboutPage = lazy(() => import('@/pages/About'))
const HelpPage = lazy(() => import('@/pages/Help'))
const LoginPage = lazy(() => import('@/pages/Login'))

function RequireAuth({ children }: { children: JSX.Element }) {
  const { authEnabled, isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <Loader />
  }

  if (!authEnabled || isAuthenticated) {
    return children
  }

  return <Navigate to="/login" replace state={{ from: location }} />
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter basename={typeof window !== 'undefined' && window.location.pathname.startsWith('/ui') ? '/ui' : '/'}>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="events" element={<EventsPage />} />
              <Route path="models" element={<ModelManagementPage />} />
              <Route path="providers" element={<ModelManagementPage />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="help" element={<HelpPage />} />
            </Route>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProviders>
  )
}

export default App
