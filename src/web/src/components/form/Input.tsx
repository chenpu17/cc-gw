import { forwardRef } from 'react'
import { cn } from '@/utils/cn'
import { inputClass } from '@/styles/theme'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'search'
  className?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = 'default', className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(inputClass, className)}
        {...props}
      />
    )
  }
)