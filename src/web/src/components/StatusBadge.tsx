import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { statusBadgeClass } from '@/styles/theme'

interface StatusBadgeProps {
  variant: 'success' | 'error' | 'warning' | 'info'
  children: ReactNode
  icon?: ReactNode
  className?: string
}

export function StatusBadge({ variant, children, icon, className }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeClass[variant], className)}>
      {icon || <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}