import { StatCard } from "../stat-card";
import { Building2 } from "lucide-react";

export default function StatCardExample() {
  return (
    <div className="p-4 max-w-sm">
      <StatCard
        title="Organizations"
        value="24"
        change="+12.5%"
        icon={Building2}
        showTimeFilter={true}
      />
    </div>
  );
}
