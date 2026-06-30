import { NotificationItem } from "../notification-item";

export default function NotificationItemExample() {
  return (
    <div className="p-4 max-w-md space-y-2">
      <NotificationItem
        message="You have a new message in chat!"
        time="Today · 11:30"
        isRead={false}
      />
      <NotificationItem
        message="Project deployment completed successfully"
        time="Yesterday · 14:22"
        isRead={true}
      />
    </div>
  );
}
