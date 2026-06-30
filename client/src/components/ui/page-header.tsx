import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

const colorMap = {
  blue: {
    bg: "bg-blue-100 dark:bg-blue-950",
    text: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    bg: "bg-violet-100 dark:bg-violet-950",
    text: "text-violet-600 dark:text-violet-400",
  },
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-950",
    text: "text-amber-600 dark:text-amber-400",
  },
  rose: {
    bg: "bg-rose-100 dark:bg-rose-950",
    text: "text-rose-600 dark:text-rose-400",
  },
  slate: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-400",
  },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-950",
    text: "text-orange-600 dark:text-orange-400",
  },
  cyan: {
    bg: "bg-cyan-100 dark:bg-cyan-950",
    text: "text-cyan-600 dark:text-cyan-400",
  },
} as const;

export type PageHeaderColor = keyof typeof colorMap;

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  color?: PageHeaderColor;
  children?: ReactNode;
  "data-testid"?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  color = "violet",
  children,
  "data-testid": testId,
}: PageHeaderProps) {
  const colors = colorMap[color];

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors.bg}`}
        >
          <Icon className={`h-5 w-5 ${colors.text}`} />
        </div>
        <div className="min-w-0">
          <h1
            className="text-xl font-semibold tracking-tight truncate"
            data-testid={testId}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground line-clamp-2">{subtitle}</p>
          )}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 ml-4">{children}</div>}
    </div>
  );
}
