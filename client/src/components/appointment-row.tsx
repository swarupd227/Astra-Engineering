import { Badge } from "@/components/ui/badge";

interface AppointmentRowProps {
  name: string;
  type: string;
  category: string;
  time: string;
  status?: "ongoing" | "upcoming";
}

export function AppointmentRow({ name, type, category, time, status }: AppointmentRowProps) {
  return (
    <div className="grid grid-cols-4 gap-4 py-3 text-sm border-b last:border-0" data-testid={`appointment-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="font-medium">{name}</div>
      <div className="text-muted-foreground">{type}</div>
      <div className="text-muted-foreground">{category}</div>
      <div className="flex items-center justify-between">
        <span className={status === "ongoing" ? "text-emerald-600 dark:text-emerald-400" : ""}>
          {time}
        </span>
        {status === "ongoing" && (
          <Badge variant="outline" className="text-emerald-600 border-emerald-600">
            On Going
          </Badge>
        )}
      </div>
    </div>
  );
}
