import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  const hasHeader = title || description || actions

  return (
    <Card className={className}>
      {hasHeader && (
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            {typeof title === 'string' ? (
              <CardTitle className="text-base">{title}</CardTitle>
            ) : (
              title
            )}
            {description && (
              typeof description === 'string' ? (
                <CardDescription>{description}</CardDescription>
              ) : (
                <div className="text-sm text-muted-foreground">{description}</div>
              )
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </CardHeader>
      )}
      <CardContent className={cn(!hasHeader && 'pt-6', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
