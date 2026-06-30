import { Skeleton } from "@/components/ui/skeleton";

/** Reusable PageHeader skeleton — icon badge + title + optional subtitle */
export function PageHeaderSkeleton({ showSubtitle = true }: { showSubtitle?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-40" />
        {showSubtitle && <Skeleton className="h-3 w-56" />}
      </div>
    </div>
  );
}

/** Skeleton for pages with a filter bar + two-column split (test-generation, test-cases, bdd-files, bdd-step-definitions) */
export function TestViewSkeleton() {
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="border-b border-border bg-card p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-16 rounded-md" />
            <PageHeaderSkeleton showSubtitle={false} />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-44 rounded-md" />
            <Skeleton className="h-9 w-44 rounded-md" />
            <Skeleton className="h-9 w-44 rounded-md" />
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — story list */}
        <div className="w-[400px] border-r border-border bg-card flex flex-col">
          <div className="p-4 border-b border-border flex-shrink-0">
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — content area */}
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for card grid pages (personas, golden-repos, organizations) */
export function CardGridSkeleton({
  columns = 3,
  cardCount = 6,
  cardHeight = "h-48",
}: {
  columns?: 2 | 3;
  cardCount?: number;
  cardHeight?: string;
}) {
  const gridCols =
    columns === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`grid gap-6 ${gridCols}`}>
      {Array.from({ length: cardCount }).map((_, i) => (
        <div
          key={i}
          className={`rounded-lg border border-border p-5 space-y-3 ${cardHeight}`}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for table-based pages (admin-user-access) */
export function TableRowsSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  const widths = ["w-28", "w-40", "w-24", "w-16", "w-20"];
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="py-4 px-4">
              <Skeleton className={`h-4 ${widths[j % widths.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Skeleton for settings page (PageHeader + tabs + form card) */
export function SettingsSkeleton() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeaderSkeleton />

      {/* Tabs */}
      <div className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <Skeleton className="h-9 rounded-md" />
        <Skeleton className="h-9 rounded-md" />
      </div>

      {/* Card with form fields */}
      <div className="rounded-lg border border-border">
        <div className="p-6 space-y-1.5 border-b border-border">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="p-6 space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for admin-tenants page (PageHeader + info cards) */
export function TenantSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <PageHeaderSkeleton />

      {/* Tenant info card */}
      <div className="rounded-lg border border-border">
        <div className="p-6 flex items-center justify-between border-b border-border">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="p-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={i >= 2 ? "md:col-span-2" : ""}>
              <Skeleton className="h-3 w-24 mb-1.5" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>

      {/* Subscription card */}
      <div className="rounded-lg border border-border">
        <div className="p-6 border-b border-border">
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="p-6 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20 mb-1.5" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Skeleton for golden-repos page */
export function GoldenReposSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      {/* Header bar */}
      <div className="border-b p-6">
        <PageHeaderSkeleton />
      </div>

      {/* Domain nav tabs */}
      <div className="border-b border-border px-6">
        <div className="flex gap-4 py-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6 p-6">
        <Skeleton className="h-10 w-64 rounded-md" />
        <CardGridSkeleton columns={3} cardCount={6} />
      </div>
    </div>
  );
}
