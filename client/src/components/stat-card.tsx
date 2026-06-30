import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconBgColor?: string;
  change?: string;
  showTimeFilter?: boolean;
  onTimeFilterChange?: (value: string) => void;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBgColor = "bg-primary/10",
  change,
  showTimeFilter = false,
  onTimeFilterChange,
}: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${iconBgColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        {showTimeFilter && (
          <Select defaultValue="month" onValueChange={onTimeFilterChange}>
            <SelectTrigger className="h-8 w-[130px]" data-testid="select-time-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="mt-2 flex items-baseline gap-2">
          <div className="text-3xl font-bold" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </div>
          {change && (
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {change}
            </div>
          )}
        </div>
        {subtitle && (
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        )}
      </CardContent>
    </Card>
  );
}
