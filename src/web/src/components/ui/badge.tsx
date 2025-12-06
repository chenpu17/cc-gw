import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        secondary:
          'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        destructive:
          'border-transparent bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        outline:
          'border-slate-200 bg-transparent text-slate-600 dark:border-slate-700 dark:text-slate-400',
        success:
          'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        warning:
          'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        info:
          'border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
        purple:
          'border-transparent bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
        pink:
          'border-transparent bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
