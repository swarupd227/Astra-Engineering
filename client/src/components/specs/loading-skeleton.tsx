import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSkeleton() {
  return (
    <div className="flex gap-3 flex-1 min-h-0">
      <div className="w-[20%] shrink-0">
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-8 w-full mt-2 rounded-md" />
          </CardHeader>
          <CardContent className="pt-2 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 pl-2">
                <Skeleton className="h-3.5 w-3.5 rounded" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="flex-1 min-w-0">
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3">
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 w-[160px] rounded-md" />
              <Skeleton className="h-8 w-[130px] rounded-md" />
            </div>
          </CardHeader>
          <div className="mx-4 border-t border-border/60" />
          <CardContent className="pt-3 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-1.5">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16 rounded" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
