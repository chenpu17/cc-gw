import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface ToastOptions {
  id?: string
  title: string
  description?: string
  variant?: 'info' | 'success' | 'error'
  durationMs?: number
}

interface ToastContextValue {
  toasts: ToastOptions[]
  pushToast: (toast: ToastOptions) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

function buildId() {
  return `toast_${Math.random().toString(36).slice(2)}`
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastOptions[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const pushToast = useCallback(
    (toast: ToastOptions) => {
      const id = toast.id ?? buildId()
      setToasts((prev) => [...prev, { ...toast, id }])
      const duration = toast.durationMs ?? 3000
      if (duration > 0) {
        setTimeout(() => dismissToast(id), duration)
      }
    },
    [dismissToast]
  )

  const value = useMemo(() => ({ toasts, pushToast, dismissToast }), [toasts, dismissToast, pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-6 top-6 z-50 flex w-80 flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-md border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
              toast.variant === 'error'
                ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200'
                : toast.variant === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                : ''
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? <p className="mt-1 text-sm opacity-75">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                onClick={() => dismissToast(toast.id!)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
