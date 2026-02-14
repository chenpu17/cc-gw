import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div role="status" aria-label="Loading" className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
      <Skeleton className="h-8 w-32" />
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-[320px] w-full rounded-lg" />
    </div>
  )
}

export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  const widths = ['w-24', 'w-16', 'w-20', 'w-28', 'w-14', 'w-12', 'w-20', 'w-16', 'w-14', 'w-12']
  return (
    <tr className="border-b">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <Skeleton className={cn('h-4', widths[i % widths.length])} />
        </td>
      ))}
    </tr>
  )
}
