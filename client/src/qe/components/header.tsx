import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { ProjectSelector } from "@/components/project-selector";
import { useProject } from "@/contexts/ProjectContext";
import { 
  LogOut, 
  User, 
  Home, 
  Bell, 
  Search, 
  ChevronRight,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  Sun,
  Moon
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation, Link } from "wouter";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/recorder': 'Recording Studio',
  '/test-library': 'Test Library',
  '/test-management': 'Test Management',
  '/coverage': 'Coverage',
  '/functional-testing': 'Autonomous Testing',
  '/sprint-agent': 'Generate from User Stories',
  '/execution-mode': 'Execution Mode',
  '/visual-regression': 'Visual Regression',
  '/synthetic-data': 'Synthetic Data',
  '/reports': 'Reports & Analytics',
  '/import-export': 'Import/Export',
  '/projects': 'Project History',
  '/integration-management': 'Integration Management',
  '/settings': 'Settings',
  '/help': 'Help & Guidance',
  '/history': 'Session History',
  '/architecture': 'Architecture Diagram',
};

const mockNotifications = [
  { id: 1, type: 'success', title: 'Test generation complete', message: '45 test cases generated for Insurance Portal', time: '2 min ago', read: false },
  { id: 2, type: 'warning', title: 'Execution partially failed', message: '3 tests failed in Claims System', time: '1 hour ago', read: false },
  { id: 3, type: 'info', title: 'Export complete', message: 'Test suite exported to Azure DevOps', time: '3 hours ago', read: true },
];

const searchResults = [
  { type: 'page', title: 'Dashboard', path: '/dashboard' },
  { type: 'page', title: 'Recording Studio', path: '/recorder' },
  { type: 'page', title: 'Test Library', path: '/test-library' },
  { type: 'page', title: 'Test Management', path: '/test-management' },
  { type: 'page', title: 'Coverage', path: '/coverage' },
  { type: 'page', title: 'Autonomous Testing', path: '/functional-testing' },
  { type: 'page', title: 'Generate from User Stories', path: '/sprint-agent' },
  { type: 'page', title: 'Execution Mode', path: '/execution-mode' },
  { type: 'page', title: 'Visual Regression', path: '/visual-regression' },
  { type: 'page', title: 'Synthetic Data', path: '/synthetic-data' },
  { type: 'page', title: 'Reports & Analytics', path: '/reports' },
  { type: 'page', title: 'Import/Export Center', path: '/import-export' },
  { type: 'page', title: 'Project History', path: '/projects' },
  { type: 'page', title: 'Integration Management', path: '/integration-management' },
  { type: 'page', title: 'Settings', path: '/settings' },
  { type: 'page', title: 'Help & Guidance', path: '/help' },
];

export function DashboardHeader() {
  const [location, setLocation] = useLocation();
  const { selectedProjectId, setSelectedProjectId } = useProject();
  const { isDark, toggleDarkMode } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState(mockNotifications);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    setLocation("/landing");
  };

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const filteredResults = searchResults.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSearchSelect = (path: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    setLocation(path);
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const currentLabel = routeLabels[location] || 'Page';

  return (
    <>
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-card dark:shadow-sm" data-testid="header-dashboard">
        <div className="flex-1 flex items-center gap-3">
          <nav className="flex items-center gap-1 text-sm" data-testid="breadcrumbs">
            <Link href="/dashboard">
              <Button 
                variant="ghost" 
                size="sm"
                className="text-muted-foreground hover:text-foreground px-2"
                data-testid="button-home"
                title="Dashboard"
              >
                <Home className="w-4 h-4" />
              </Button>
            </Link>
            {location !== '/dashboard' && (
              <>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                <span className="text-foreground font-medium" data-testid="breadcrumb-current">
                  {currentLabel}
                </span>
              </>
            )}
          </nav>
          
          <div className="w-px h-6 bg-border mx-2" />
          
          <ProjectSelector 
            selectedProjectId={selectedProjectId}
            onProjectSelect={setSelectedProjectId}
          />
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="w-64 justify-start text-muted-foreground"
            onClick={() => setSearchOpen(true)}
            data-testid="button-global-search"
          >
            <Search className="w-4 h-4 mr-2" />
            <span>Search...</span>
            <kbd className="ml-auto px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl+K</kbd>
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="relative"
                data-testid="button-notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between p-3 border-b border-border">
                <h4 className="font-semibold text-sm">Notifications</h4>
                {unreadCount > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs h-7"
                    onClick={markAllRead}
                    data-testid="button-mark-all-read"
                  >
                    Mark all read
                  </Button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={cn(
                      "p-3 border-b border-border/50 last:border-0 hover:bg-muted/50 cursor-pointer",
                      !notification.read && "bg-primary/5"
                    )}
                    data-testid={`notification-${notification.id}`}
                  >
                    <div className="flex items-start gap-3">
                      {getNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{notification.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{notification.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{notification.time}</p>
                      </div>
                      {!notification.read && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-2 border-t border-border">
                <Link href="/reports">
                  <Button variant="ghost" size="sm" className="w-full text-xs" data-testid="button-view-all-notifications">
                    View all activity
                  </Button>
                </Link>
              </div>
            </PopoverContent>
          </Popover>
          
          <div className="w-px h-6 bg-border" />
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <span data-testid="text-username">Demo User</span>
          </div>
          
          <div className="w-px h-6 bg-border" />
          
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDarkMode}
            data-testid="button-toggle-dark-mode"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          <ThemeSelector />
          
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-lg p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="sr-only">Global Search</DialogTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search pages, projects, test cases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
                autoFocus
                data-testid="input-global-search"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto px-2 pb-2">
            {filteredResults.length > 0 ? (
              <div className="space-y-1 pt-2">
                <p className="text-xs text-muted-foreground px-2 mb-2">Pages</p>
                {filteredResults.map((result) => (
                  <button
                    key={result.path}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-muted flex items-center gap-3"
                    onClick={() => handleSearchSelect(result.path)}
                    data-testid={`search-result-${result.path.slice(1)}`}
                  >
                    <span className="text-sm font-medium">{result.title}</span>
                    <Badge variant="outline" className="ml-auto text-xs">{result.type}</Badge>
                  </button>
                ))}
              </div>
            ) : searchQuery ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No results found</p>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Start typing to search...</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
