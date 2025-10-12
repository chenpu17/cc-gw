import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { mutedTextClass, pageHeaderShellClass, pillClass } from '@/styles/theme'

interface PageHeaderProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ icon, title, description, badge, actions, className }: PageHeaderProps) {
  return (
    <div className={cn(pageHeaderShellClass, 'animate-slide-up', className)}>
      <div className="flex flex-1 flex-wrap items-start gap-6">
        {icon ? (
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600/15 to-indigo-600/10 text-blue-600 shadow-lg shadow-blue-200/30 ring-1 ring-blue-500/20 backdrop-blur-sm dark:from-blue-500/25 dark:to-indigo-500/15 dark:text-blue-200 dark:shadow-xl dark:shadow-blue-500/20 dark:ring-blue-400/20">
            {icon}
          </div>
        ) : null}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 gradient-text">
              {title}
            </h1>
            {badge ? <span className={cn(pillClass, 'shadow-md')}>{badge}</span> : null}
          </div>
          {description ? (
            <div className={cn(mutedTextClass, 'max-w-3xl text-base leading-relaxed')}>
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
