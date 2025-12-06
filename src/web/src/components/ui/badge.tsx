import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm',
  {
    variants: {
      variant: {
        default:
          'border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 dark:border-primary/30 dark:bg-primary/20 dark:text-primary-foreground',
        secondary:
          'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
        destructive:
          'border-red-200 bg-gradient-to-r from-red-50 to-red-100 text-red-700 hover:from-red-100 hover:to-red-150 dark:border-red-800 dark:from-red-950 dark:to-red-900 dark:text-red-300',
        outline:
          'border-slate-300 bg-transparent text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800',
        success:
          'border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 hover:from-emerald-100 hover:to-emerald-150 dark:border-emerald-800 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-300',
        warning:
          'border-amber-200 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 hover:from-amber-100 hover:to-amber-150 dark:border-amber-800 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300',
        info:
          'border-cyan-200 bg-gradient-to-r from-cyan-50 to-cyan-100 text-cyan-700 hover:from-cyan-100 hover:to-cyan-150 dark:border-cyan-800 dark:from-cyan-950 dark:to-cyan-900 dark:text-cyan-300',
        purple:
          'border-violet-200 bg-gradient-to-r from-violet-50 to-violet-100 text-violet-700 hover:from-violet-100 hover:to-violet-150 dark:border-violet-800 dark:from-violet-950 dark:to-violet-900 dark:text-violet-300',
        pink:
          'border-pink-200 bg-gradient-to-r from-pink-50 to-pink-100 text-pink-700 hover:from-pink-100 hover:to-pink-150 dark:border-pink-800 dark:from-pink-950 dark:to-pink-900 dark:text-pink-300'
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
