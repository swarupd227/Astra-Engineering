import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";

export function QELayout({ children }: { children: React.ReactNode }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar
        activeView="configuration"
        onViewChange={() => {}}
        isRunning={false}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
