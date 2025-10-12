import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { formLabelClass, formFieldClass } from '@/styles/theme'

interface FormFieldProps {
  label: string
  children: ReactNode
  className?: string
  required?: boolean
  error?: string
}

export function FormField({ label, children, className, required, error }: FormFieldProps) {
  return (
    <div className={cn(formFieldClass, className)}>
      <label className={formLabelClass}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  )
}