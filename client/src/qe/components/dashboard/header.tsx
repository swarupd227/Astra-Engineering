import { useState } from "react";
import { Button } from "@/components/ui/button";
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

type SearchEntry = {
  type: 'page';
  title: string;
  path: string;
  // Synonyms, abbreviations, and domain terms users might type instead of the
  // exact title. Matched as substrings (case-insensitive) so partial typing
  // still resolves -- e.g. "automate" hits "automation".
  keywords?: string[];
  // Optional one-liner shown under the title to disambiguate similar pages
  // (e.g. NRadiverse subpages, Recording Studio vs Test Management).
  description?: string;
};

const searchResults: SearchEntry[] = [
  {
    type: 'page',
    title: 'Dashboard',
    path: '/dashboard',
    keywords: ['home', 'overview', 'summary', 'kpi', 'metrics', 'landing'],
    description: 'Home overview and KPIs',
  },
  {
    type: 'page',
    title: 'Recording Studio',
    path: '/recorder',
    keywords: [
      'record', 'recorder', 'recording', 'capture', 'replay',
      'chrome extension', 'browser actions', 'screen recording',
      'manual recording', 'session recording', 'studio',
    ],
    description: 'Capture browser interactions into test scripts',
  },
  {
    type: 'page',
    title: 'Test Library',
    path: '/test-library',
    keywords: [
      'library', 'tests', 'test cases', 'scripts', 'test scripts',
      'test suite', 'saved tests', 'repository', 'catalog',
    ],
    description: 'Browse and manage all stored test cases',
  },
  {
    type: 'page',
    title: 'Test Management',
    path: '/test-management',
    keywords: [
      'manage tests', 'test cases', 'suites', 'test suites', 'plans',
      'test plans', 'runs', 'test runs', 'execution', 'execution history',
      'rtm', 'traceability', 'environments',
    ],
    description: 'Plan, organise, and run test suites',
  },
  {
    type: 'page',
    title: 'Coverage',
    path: '/coverage',
    keywords: [
      'coverage', 'gaps', 'rtm', 'traceability', 'requirements coverage',
      'requirement', 'matrix', 'intelligence',
    ],
    description: 'Test coverage and traceability matrix',
  },
  {
    type: 'page',
    title: 'Autonomous Testing',
    path: '/functional-testing',
    keywords: [
      'autonomous', 'autopilot', 'automation', 'automate', 'ai testing',
      'agent', 'exploratory', 'crawl', 'crawler', 'e2e', 'end to end',
      'functional', 'functional testing',
    ],
    description: 'AI-driven crawl and exploratory test generation',
  },
  {
    type: 'page',
    title: 'Generate from User Stories',
    path: '/sprint-agent',
    keywords: [
      'user story', 'user stories', 'story', 'stories', 'sprint',
      'sprint agent', 'generate tests', 'story to tests', 'jira', 'ado',
      'azure devops', 'bdd', 'gherkin', 'acceptance criteria', 'backlog',
      'requirement to test',
    ],
    description: 'Turn Jira / ADO user stories into test cases',
  },
  {
    type: 'page',
    title: 'Execution Mode',
    path: '/execution-mode',
    keywords: [
      'execution', 'run mode', 'headless', 'headed', 'browsers',
      'execution settings', 'runner config',
    ],
  },
  {
    type: 'page',
    title: 'Visual Regression',
    path: '/visual-regression',
    keywords: [
      'visual', 'visual diff', 'screenshot', 'screenshots', 'baseline',
      'image compare', 'pixel', 'regression', 'snapshots', 'snapshot diff',
    ],
  },
  {
    type: 'page',
    title: 'Synthetic Data',
    path: '/synthetic-data',
    keywords: [
      'synthetic', 'synthetic data', 'fake data', 'test data', 'mock data',
      'data generation', 'generate data', 'faker', 'seed data', 'fixtures',
    ],
    description: 'Generate realistic test data sets',
  },
  {
    type: 'page',
    title: 'Reports & Analytics',
    path: '/reports',
    keywords: [
      'reports', 'report', 'analytics', 'metrics', 'insights', 'charts',
      'kpi', 'pass rate', 'failure rate', 'dashboard reports',
    ],
    description: 'Run reports, trends, and analytics',
  },
  {
    type: 'page',
    title: 'Import/Export Center',
    path: '/import-export',
    keywords: [
      'import', 'export', 'csv', 'excel', 'xlsx', 'json',
      'jira import', 'ado import', 'azure devops import', 'transfer',
      'migrate tests', 'bulk upload',
    ],
    description: 'Bulk import or export test cases',
  },
  {
    type: 'page',
    title: 'Project History',
    path: '/projects',
    keywords: [
      'projects', 'history', 'audit log', 'audit', 'archive', 'past projects',
    ],
  },
  {
    type: 'page',
    title: 'Integration Management',
    path: '/integration-management',
    keywords: [
      'integrations', 'integration', 'jira', 'ado', 'azure devops',
      'github', 'gitlab', 'slack', 'teams', 'webhooks', 'webhook',
      'api keys', 'connectors', 'connect', 'auth', 'oauth', 'pat',
    ],
    description: 'Connect Jira, ADO, GitHub, and other tools',
  },
  {
    type: 'page',
    title: 'Settings',
    path: '/settings',
    keywords: [
      'settings', 'preferences', 'config', 'configuration', 'account',
      'profile', 'general', 'admin',
    ],
  },
  {
    type: 'page',
    title: 'Help & Guidance',
    path: '/help',
    keywords: [
      'help', 'docs', 'documentation', 'faq', 'support', 'guide',
      'guidance', 'tutorial', 'how to', 'getting started',
    ],
  },
  {
    type: 'page',
    title: 'Remote Agents',
    path: '/remote-agents',
    keywords: [
      'remote agent', 'remote agents', 'agents', 'runners', 'workers',
      'distributed', 'machines', 'cloud agents', 'self hosted',
      'execution agent',
    ],
    description: 'Self-hosted Playwright runners',
  },
  {
    type: 'page',
    title: 'Framework Configuration',
    path: '/framework-config',
    keywords: [
      'framework', 'frameworks', 'playwright', 'selenium', 'cypress',
      'puppeteer', 'webdriverio', 'framework config', 'framework setup',
      'browser config',
    ],
    description: 'Choose and configure your test framework',
  },
  {
    type: 'page',
    title: 'CI/CD Integration',
    path: '/cicd-integration',
    keywords: [
      'ci', 'cd', 'ci/cd', 'pipeline', 'pipelines', 'github actions',
      'jenkins', 'azure pipelines', 'azure pipeline', 'devops pipeline',
      'gitlab ci', 'circleci', 'build', 'release',
    ],
  },
  {
    type: 'page',
    title: 'Performance Testing',
    path: '/performance-testing',
    keywords: [
      'performance', 'perf', 'load', 'load testing', 'stress',
      'stress testing', 'k6', 'gatling', 'jmeter', 'throughput', 'latency',
    ],
  },
  {
    type: 'page',
    title: 'Security Testing',
    path: '/security-testing',
    keywords: [
      'security', 'sec', 'vulnerability', 'vulnerabilities', 'owasp',
      'penetration', 'pen test', 'sast', 'dast', 'scan',
    ],
  },
  {
    type: 'page',
    title: 'Accessibility Testing',
    path: '/accessibility-testing',
    keywords: [
      'accessibility', 'a11y', 'axe', 'wcag', 'screen reader', 'contrast',
      'aria', 'inclusive',
    ],
  },
  {
    type: 'page',
    title: 'Code Review',
    path: '/code-review',
    keywords: [
      'code review', 'pr review', 'pull request', 'merge request',
      'ai code review', 'review', 'lint',
    ],
  },
  {
    type: 'page',
    title: 'RAG Testing',
    path: '/rag-testing',
    keywords: [
      'rag', 'retrieval', 'embeddings', 'llm test', 'prompt', 'prompt test',
      'vector', 'vector search', 'evals',
    ],
  },
  {
    type: 'page',
    title: 'Team Collaboration',
    path: '/team-collaboration',
    keywords: [
      'team', 'collaboration', 'comments', 'share', 'members', 'invite',
      'roles', 'permissions',
    ],
  },
  {
    type: 'page',
    title: 'Session History',
    path: '/history',
    keywords: [
      'session history', 'sessions', 'past runs', 'history', 'timeline',
      'recent activity',
    ],
  },
  {
    type: 'page',
    title: 'Architecture Diagram',
    path: '/architecture',
    keywords: [
      'architecture', 'diagram', 'system diagram', 'flow', 'c4',
      'component diagram',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse',
    path: '/nradiverse',
    keywords: [
      'nradiverse', 'nra', 'modernization', 'modernisation',
      'legacy migration',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - Visual Regression',
    path: '/nradiverse/visual-regression',
    keywords: [
      'nradiverse', 'visual regression', 'screenshot diff', 'pixel compare',
      'modernization regression',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - Accessibility',
    path: '/nradiverse/accessibility',
    keywords: ['nradiverse', 'accessibility', 'a11y', 'wcag'],
  },
  {
    type: 'page',
    title: 'NRadiverse - Responsive',
    path: '/nradiverse/responsive',
    keywords: [
      'nradiverse', 'responsive', 'breakpoints', 'mobile', 'tablet',
      'viewport',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - Pixel Comparison',
    path: '/nradiverse/pixel-comparison',
    keywords: [
      'nradiverse', 'pixel comparison', 'pixel diff', 'image compare',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - SSRS / Power BI',
    path: '/nradiverse/ssrs-powerbi',
    keywords: ['nradiverse', 'ssrs', 'power bi', 'powerbi', 'reports'],
  },
  {
    type: 'page',
    title: 'NRadiverse - API Testing',
    path: '/nradiverse/api-testing',
    keywords: [
      'nradiverse', 'api testing', 'api', 'rest', 'http', 'endpoints',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - Migration',
    path: '/nradiverse/migration',
    keywords: [
      'nradiverse', 'migration', 'legacy', 'modernization', 'modernisation',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - Java Migration',
    path: '/nradiverse/java-migration',
    keywords: [
      'nradiverse', 'java migration', 'java', 'spring', 'jakarta', 'legacy',
    ],
  },
  {
    type: 'page',
    title: 'NRadiverse - ICU Streaming',
    path: '/nradiverse/icu-streaming',
    keywords: ['nradiverse', 'icu', 'streaming', 'live'],
  },
];

// NAT-imp-tools: hide these pages from global search results so they can't
// be discovered while their nav entries are hidden. Routes remain reachable
// by direct URL. Removing entries here is a one-line change to re-enable.
const HIDDEN_SEARCH_PATHS: ReadonlySet<string> = new Set([
  '/execution-mode',
  '/visual-regression',
  '/projects',
]);

const visibleSearchResults: SearchEntry[] = searchResults.filter(
  (item) => !HIDDEN_SEARCH_PATHS.has(item.path),
);

// Tokenised, AND-style substring match against title + keywords + path.
// Each whitespace-separated token in the user's query must appear somewhere
// in the haystack -- so "user stories" and "story" both find the sprint
// agent page, "test cases" finds Test Library + Test Management, and
// "automation" finds Autonomous Testing without the user having to know the
// exact page name.
function matchesSearch(item: SearchEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = [
    item.title,
    item.path,
    ...(item.keywords ?? []),
    item.description ?? '',
  ]
    .join(' ')
    .toLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export function DashboardHeader() {
  const [location, setLocation] = useLocation();
  const { selectedProjectId, setSelectedProjectId, isFromDevx, devxContext } = useProject();
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

  const filteredResults = visibleSearchResults.filter((item) =>
    matchesSearch(item, searchQuery),
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

          {isFromDevx && (devxContext.organization || devxContext.sdlcProjectName) && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <div className="flex items-center gap-2 text-xs">
                {devxContext.organization && (
                  <span className="text-muted-foreground">
                    Org: <span className="text-foreground font-medium">{devxContext.organization}</span>
                  </span>
                )}
                {devxContext.sdlcProjectName && (
                  <span className="text-muted-foreground">
                    Project: <span className="text-foreground font-medium">{devxContext.sdlcProjectName}</span>
                  </span>
                )}
                {devxContext.goldenRepoName && (
                  <span className="text-muted-foreground">
                    Repo: <span className="text-foreground font-medium">{devxContext.goldenRepoName}</span>
                  </span>
                )}
              </div>
            </>
          )}
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
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-muted flex items-start gap-3"
                    onClick={() => handleSearchSelect(result.path)}
                    data-testid={`search-result-${result.path.slice(1)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{result.title}</span>
                      {result.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {result.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                      {result.type}
                    </Badge>
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
