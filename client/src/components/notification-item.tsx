import { Circle } from "lucide-react";

interface NotificationItemProps {
  message: string;
  time: string;
  isRead?: boolean;
}

export function NotificationItem({ message, time, isRead = false }: NotificationItemProps) {
  return (
    <div className="flex items-start gap-3 py-3 hover-elevate rounded-md px-2 -mx-2" data-testid="notification-item">
      {!isRead && (
        <Circle className="mt-1 h-2 w-2 fill-primary text-primary" />
      )}
      {isRead && <div className="mt-1 h-2 w-2" />}
      <div className="flex-1 space-y-1">
        <p className="text-sm">{message}</p>
        <p className="text-xs text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
