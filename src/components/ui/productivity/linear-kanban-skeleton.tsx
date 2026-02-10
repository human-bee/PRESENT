import { Skeleton } from '@/components/ui/shared/loading-states';

export function KanbanSkeleton() {
  return (
    <div className="p-6 bg-surface-secondary">
      <div className="mb-6">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex gap-6 overflow-x-auto pb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 w-80">
            <div className="bg-surface-elevated rounded-2xl shadow-sm border border-default overflow-hidden">
              <div className="p-4 border-b border-default bg-surface-secondary">
                <Skeleton className="h-6 w-24" />
              </div>
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-24 w-full" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}






