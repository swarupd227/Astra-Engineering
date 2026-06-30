import { Activity, Zap, Target, FolderOpen, ChevronLeft, ChevronRight, LayoutDashboard, Eye, Play, Database, BarChart3, ArrowUpDown, Cog, HelpCircle, Bot, Sparkles, Layers, Library, CircleDot, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useBranding } from "@/contexts/BrandingContext";

interface SidebarProps {
  activeView: "testing" | "configuration";
  onViewChange: (view: "testing" | "configuration") => void;
  isRunning: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

// NAT-imp-tools: hrefs listed here are kept in the data array (code preserved)
// but filtered out of the rendered sidebar so they are not visible to users.
// Routes remain registered in App.tsx and pages still work via direct URL.
const HIDDEN_NAV_HREFS: ReadonlySet<string> = new Set([
  "/execution-mode",
  "/visual-regression",
  "/projects",
  "/architecture",
]);

export function Sidebar({ activeView, onViewChange, isRunning, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const [location] = useLocation();
  const { brand } = useBranding();

  const isActive = (path: string) => location === path;

  const activeStyle = {
    backgroundColor: brand.accentColor,
    color: "white",
    boxShadow: `0 4px 14px -2px ${brand.accentColor}66`,
  };

  const navItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", testId: "nav-dashboard" },
    { href: "/recorder", icon: CircleDot, label: "Recording Studio", testId: "nav-recorder" },
    { href: "/test-library", icon: Library, label: "Test Library", testId: "nav-test-library" },
    { href: "/test-management", icon: ClipboardList, label: "Test Management", testId: "nav-test-management" },
    { href: "/functional-testing", icon: Zap, label: "Autonomous Testing", testId: "nav-functional" },
    { href: "/sprint-agent", icon: Target, label: "Generate from User Stories", testId: "nav-sprint-agent" },
    { href: "/execution-mode", icon: Play, label: "Execution Mode", testId: "nav-execution-mode" },
    { href: "/visual-regression", icon: Eye, label: "Visual Regression", testId: "nav-visual-regression" },
    { href: "/synthetic-data", icon: Database, label: "Synthetic Data", testId: "nav-synthetic-data" },
    { href: "/nradiverse", icon: Sparkles, label: "AI Quality Engine", testId: "nav-nradiverse" },
    { href: "/reports", icon: BarChart3, label: "Reports & Analytics", testId: "nav-reports" },
    { href: "/import-export", icon: ArrowUpDown, label: "Import/Export", testId: "nav-import-export" },
    { href: "/projects", icon: FolderOpen, label: "Project History", testId: "nav-projects" },
    { href: "/architecture", icon: Layers, label: "Architecture Diagram", testId: "nav-architecture" },
  ];

  const visibleNavItems = navItems.filter(item => !HIDDEN_NAV_HREFS.has(item.href));

  const bottomItems = [
    { href: "/framework-config", icon: Library, label: "Framework Config", testId: "nav-framework-config" },
    { href: "/integration-management", icon: Bot, label: "Integration Management", testId: "nav-integration-management" },
    { href: "/settings", icon: Cog, label: "Settings", testId: "nav-settings" },
    { href: "/help", icon: HelpCircle, label: "Help & Guidance", testId: "nav-help" },
  ];

  return (
    <aside className={cn("bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300", isCollapsed ? "w-16" : "w-72")}>
      <div className="pl-0 pr-4 pt-1 pb-2">
        <div className={cn("flex items-center gap-4", isCollapsed && "justify-center")}>
          <div className={cn("min-w-0", isCollapsed && "hidden")}>
            {brand.logoType === "image" && brand.logoSrc ? (
              <div className="space-y-0.5">
                <div
                  className="flex items-center gap-2"
                  style={brand.logoBackground ? { background: brand.logoBackground, borderRadius: 6, padding: "4px 8px" } : {}}
                >
                  <img
                    src={brand.logoSrc}
                    alt={brand.platformName}
                    className="object-contain object-left"
                    style={{ height: "48px", maxWidth: "250px" }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground tracking-wide pl-6">{brand.subtitle}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <Activity className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">{brand.subtitle}</p>
                </div>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className={cn("h-8 w-8 flex-shrink-0", isCollapsed && "mx-auto")}
            data-testid="button-toggle-sidebar"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <nav className={cn("flex-1 p-4 space-y-3 overflow-y-auto", isCollapsed && "flex flex-col items-center")}>
        <div className={cn(!isCollapsed && "px-2 mb-2")}>
          {!isCollapsed && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Testing Modes</p>}
        </div>

        {visibleNavItems.map(({ href, icon: Icon, label, testId }) => (
          <Link key={href} href={href}>
            <button
              className={cn(
                "w-full min-h-11 rounded-lg px-4 flex items-center gap-3 text-sm font-medium transition-all duration-300 whitespace-nowrap overflow-hidden text-ellipsis",
                isCollapsed && "w-10 h-10 px-0 justify-center",
                isActive(href)
                  ? "scale-105 font-semibold"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
              style={isActive(href) ? activeStyle : {}}
              disabled={isRunning}
              data-testid={testId}
              title={label}
            >
              <Icon className={cn("w-5 h-5 flex-shrink-0", isActive(href) && "animate-pulse")} />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </button>
          </Link>
        ))}
      </nav>

      <div className={cn("border-t border-sidebar-border p-4 space-y-2", isCollapsed && "flex flex-col items-center")}>
        {bottomItems.map(({ href, icon: Icon, label, testId }) => (
          <Link key={href} href={href}>
            <button
              className={cn(
                "w-full min-h-10 rounded-lg px-4 flex items-center gap-3 text-sm font-medium transition-all duration-300 whitespace-nowrap overflow-hidden text-ellipsis",
                isCollapsed && "w-10 h-10 px-0 justify-center",
                isActive(href)
                  ? "scale-105 font-semibold"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
              style={isActive(href) ? activeStyle : {}}
              disabled={isRunning}
              data-testid={testId}
              title={label}
            >
              <Icon className={cn("w-5 h-5 flex-shrink-0", isActive(href) && "animate-pulse")} />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </button>
          </Link>
        ))}
      </div>
    </aside>
  );
}
