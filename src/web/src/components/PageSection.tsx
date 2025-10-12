import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { mutedTextClass, sectionTitleClass, surfaceCardClass } from '@/styles/theme'

interface PageSectionProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}

export function PageSection({
  title,
  description,
  actions,
  className,
  contentClassName,
  children
}: PageSectionProps) {
  return (
    <section className={cn(surfaceCardClass, 'animate-slide-up', className)}>
      {(title || description || actions) && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-3">
            {typeof title === 'string' ? (
              <h2 className={cn(sectionTitleClass, 'text-base font-bold')}>{title}</h2>
            ) : title}
            {description ? (
              <div className={cn(mutedTextClass, 'max-w-3xl text-sm leading-relaxed')}>
                {description}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-3">
              {actions}
            </div>
          ) : null}
        </div>
      )}
      <div className={cn('flex flex-col gap-6', contentClassName)}>
        {children}
      </div>
    </section>
  )
}
