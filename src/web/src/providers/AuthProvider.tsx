import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient, toApiError } from '@/services/api'
import type { AuthLoginResponse, AuthLogoutResponse, AuthSessionResponse } from '@/types/auth'

interface AuthState {
  loading: boolean
  authEnabled: boolean
  isAuthenticated: boolean
  username?: string
  error?: string | null
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const mountedRef = useRef(true)
  const [state, setState] = useState<AuthState>({
    loading: true,
    authEnabled: false,
    isAuthenticated: true,
    username: undefined,
    error: null
  })

  const updateState = useCallback((updater: (prev: AuthState) => AuthState) => {
    if (!mountedRef.current) return
    setState(updater)
  }, [])

  const refresh = useCallback(async () => {
    updateState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const { data } = await apiClient.get<AuthSessionResponse>('/auth/session')
      updateState(() => ({
        loading: false,
        authEnabled: Boolean(data.authEnabled),
        isAuthenticated: !data.authEnabled || Boolean(data.authenticated),
        username: data.username ?? undefined,
        error: null
      }))
    } catch (error) {
      const apiError = toApiError(error)
      updateState(() => ({
        loading: false,
        authEnabled: false,
        isAuthenticated: true,
        username: undefined,
        error: apiError.message
      }))
    }
  }, [updateState])

  const login = useCallback(
    async (username: string, password: string) => {
      updateState((prev) => ({ ...prev, loading: true, error: null }))
      try {
        await apiClient.post<AuthLoginResponse>('/auth/login', { username, password })
        await refresh()
      } catch (error) {
        const apiError = toApiError(error)
        updateState((prev) => ({
          ...prev,
          loading: false,
          error: apiError.message,
          isAuthenticated: false
        }))
        throw apiError
      }
    },
    [refresh, updateState]
  )

  const logout = useCallback(async () => {
    updateState((prev) => ({ ...prev, loading: true }))
    try {
      await apiClient.post<AuthLogoutResponse>('/auth/logout')
    } catch (error) {
      // Ignore logout failures but still refresh session status
      const apiError = toApiError(error)
      updateState((prev) => ({ ...prev, error: apiError.message }))
    } finally {
      await refresh()
    }
  }, [refresh, updateState])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const interceptor = apiClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error?.response?.status === 401) {
          await refresh()
        }
        return Promise.reject(error)
      }
    )

    return () => {
      mountedRef.current = false
      apiClient.interceptors.response.eject(interceptor)
    }
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refresh,
      login,
      logout
    }),
    [state, refresh, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
