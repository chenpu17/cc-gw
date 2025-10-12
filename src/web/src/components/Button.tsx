import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import {
  subtleButtonClass,
  primaryButtonClass,
  dangerButtonClass
} from '@/styles/theme'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'subtle' | 'primary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  loading?: boolean
  icon?: ReactNode
  className?: string
}

export function Button({
  variant = 'subtle',
  size = 'md',
  children,
  loading,
  icon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const baseClass = {
    subtle: subtleButtonClass,
    primary: primaryButtonClass,
    danger: dangerButtonClass
  }[variant]

  const sizeClass = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base'
  }[size]

  return (
    <button
      className={cn(
        baseClass,
        sizeClass,
        loading && 'cursor-wait opacity-70',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
      ) : icon ? (
        <>
          {icon}
          {children}
        </>
      ) : (
        children
      )}
    </button>
  )
}