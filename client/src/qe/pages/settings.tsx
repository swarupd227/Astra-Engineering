import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/contexts/BrandingContext";
import { useHostingConfig } from "@/hooks/use-hosting-config";
import { 
  Cog,
  Bell,
  Palette,
  TestTube2,
  Link2,
  User,
  Save,
  Moon,
  Sun,
  Monitor,
  Download,
  CheckCircle2,
  Loader2,
  Chrome,
  Wifi,
  RefreshCw,
  Puzzle,
  Play,
  Zap,
  Shield,
  Eye,
  MousePointer2,
  Box,
  CircleDot,
  ArrowRight,
  FileCode2,
  Cpu,
  Theater,
  AlertCircle,
} from "lucide-react";

const EXTENSION_ID = (window as any).__QE_EXTENSION_ID || "";

interface AgentInfo {
  agentId: string;
  hostname: string;
  status: string;
  label?: string;
}

interface AgentStatusResponse {
  total: number;
  idle: number;
  busy: number;
  agents: AgentInfo[];
}

function FeatureBullet({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-5 h-5 rounded flex items-center justify-center bg-muted flex-shrink-0 mt-0.5">
        <Icon className="w-3 h-3 text-muted-foreground" />
      </div>
      <span className="text-sm text-foreground leading-relaxed">{text}</span>
    </div>
  );
}

function StepItem({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted border text-foreground text-xs font-bold flex-shrink-0">
        {n}
      </span>
      <div className="flex-1 pt-0.5">
        <p className="text-sm text-foreground font-medium mb-0.5">{title}</p>
        <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { brand } = useBranding();
  const { data: hostingConfig } = useHostingConfig();

  // Public WS base URL the Remote Agent (and Chrome extension) should connect to.
  // On AWS where API Gateway HTTP API can't WS-upgrade, the server exposes the
  // EC2 host:port via EXTENSION_WS_PUBLIC_URL. Local dev / Azure use page origin.
  const wsBaseUrl = (
    hostingConfig?.extensionWsPublicUrl ||
    window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://')
  ).replace(/\/+$/, '');

  // Remote Agents state
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);

  // Playwright environment health (server-side Chromium launchability)
  interface PwHealth {
    ok: boolean;
    packageInstalled: boolean;
    browserLaunches: boolean;
    headless: boolean;
    hosting: 'aws' | 'local';
    platform: string;
    version?: string;
    details: string;
    hint?: string;
    durationMs?: number;
  }
  const [pwHealth, setPwHealth] = useState<PwHealth | null>(null);
  const [pwHealthLoading, setPwHealthLoading] = useState(false);

  const runPwHealth = useCallback(async () => {
    setPwHealthLoading(true);
    try {
      const res = await fetch('/api/recorder/playwright/health');
      const data = await res.json();
      setPwHealth(data);
    } catch (err: any) {
      setPwHealth({
        ok: false,
        packageInstalled: false,
        browserLaunches: false,
        headless: false,
        hosting: 'local',
        platform: 'unknown',
        details: `Failed to reach health endpoint: ${err?.message || err}`,
      });
    } finally {
      setPwHealthLoading(false);
    }
  }, []);

  const { data: agentStatus, refetch: refetchAgents, isLoading: agentsLoading } = useQuery<AgentStatusResponse>({
    queryKey: ["/api/qe/execution-agent/status"],
    refetchInterval: 5000,
  });

  const detectExtension = useCallback(() => {
    window.postMessage({ type: 'DEVXQE_PING' }, '*');
    if (EXTENSION_ID) {
      try {
        (chrome as any).runtime.sendMessage(EXTENSION_ID, { type: "PING" }, (response: any) => {
          if (chrome.runtime.lastError || !response) return;
          setExtensionInstalled(true);
          setExtensionConnected(!!response?.connected);
        });
      } catch {}
    }
  }, []);

  useEffect(() => {
    const handlePong = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === 'DEVXQE_PONG' && event.data?.installed) {
        setExtensionInstalled(true);
      }
    };
    window.addEventListener('message', handlePong);
    detectExtension();
    const interval = setInterval(detectExtension, 10000);
    return () => { clearInterval(interval); window.removeEventListener('message', handlePong); };
  }, [detectExtension]);

  useEffect(() => { runPwHealth(); }, [runPwHealth]);

  const totalAgents = agentStatus?.total ?? 0;
  const idleAgents = agentStatus?.idle ?? 0;
  const busyAgents = agentStatus?.busy ?? 0;
  
  const [settings, setSettings] = useState(() => {
    const savedDomain = localStorage.getItem("defaultDomain");
    return {
      defaultDomain: savedDomain || 'insurance',
      defaultCoverageLevel: 'comprehensive',
      autoSaveInterval: '30',
      dateFormat: 'MM/DD/YYYY',
      emailNotifications: true,
      notifyGeneration: true,
      notifyExecution: true,
      notifySync: true,
      notifyErrors: true,
      theme: 'dark',
      sidebarCollapsed: false,
      itemsPerPage: '25',
      defaultTestTypes: ['functional', 'negative', 'edge'],
      defaultModule: 'autonomous'
    };
  });

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated successfully."
    });
  };

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                  <Cog className="w-7 h-7 text-primary" />
                  Settings
                </h1>
                <p className="text-muted-foreground mt-1">Configure your {brand.platformShortName} preferences</p>
              </div>
              <Button onClick={handleSave} data-testid="button-save-settings">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </div>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cog className="w-5 h-5 text-primary" />
                  General Settings
                </CardTitle>
                <CardDescription>Basic application preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="default-domain">Default Domain</Label>
                    <Select 
                      value={settings.defaultDomain} 
                      onValueChange={(value) => {
                        setSettings({...settings, defaultDomain: value});
                        localStorage.setItem("defaultDomain", value);
                      }}
                    >
                      <SelectTrigger id="default-domain" data-testid="select-default-domain">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="insurance">Insurance</SelectItem>
                        <SelectItem value="healthcare">Healthcare</SelectItem>
                        <SelectItem value="banking">Banking & Finance</SelectItem>
                        <SelectItem value="ecommerce">E-Commerce</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coverage-level">Default Coverage Level</Label>
                    <Select 
                      value={settings.defaultCoverageLevel} 
                      onValueChange={(value) => setSettings({...settings, defaultCoverageLevel: value})}
                    >
                      <SelectTrigger id="coverage-level" data-testid="select-coverage-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="comprehensive">Comprehensive</SelectItem>
                        <SelectItem value="exhaustive">Exhaustive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auto-save">Auto-save Interval (seconds)</Label>
                    <Select 
                      value={settings.autoSaveInterval} 
                      onValueChange={(value) => setSettings({...settings, autoSaveInterval: value})}
                    >
                      <SelectTrigger id="auto-save" data-testid="select-auto-save">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 seconds</SelectItem>
                        <SelectItem value="30">30 seconds</SelectItem>
                        <SelectItem value="60">1 minute</SelectItem>
                        <SelectItem value="300">5 minutes</SelectItem>
                        <SelectItem value="0">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date-format">Date/Time Format</Label>
                    <Select 
                      value={settings.dateFormat} 
                      onValueChange={(value) => setSettings({...settings, dateFormat: value})}
                    >
                      <SelectTrigger id="date-format" data-testid="select-date-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Remote Agents & Extension */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-primary" />
                  Remote Agents & Extension
                </CardTitle>
                <CardDescription>Set up the Chrome Extension and Remote Agent for recording and test execution</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Status row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background/50 border">
                    <div className="flex items-center gap-2">
                      <Chrome className="w-5 h-5 text-blue-500" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Recorder Extension</p>
                        <p className="text-xs text-muted-foreground">Captures interactions</p>
                      </div>
                    </div>
                    {extensionInstalled ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted border text-muted-foreground text-xs font-medium">Not installed</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background/50 border">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-purple-500" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Remote Agent</p>
                        <p className="text-xs text-muted-foreground">Executes tests</p>
                      </div>
                    </div>
                    {agentsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : totalAgents > 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> {totalAgents} online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted border text-muted-foreground text-xs font-medium">Offline</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background/50 border">
                    <div className="flex items-center gap-2">
                      <Monitor className="w-5 h-5 text-green-500" />
                      <div>
                        <p className="text-sm font-medium text-foreground">QE Server</p>
                        <p className="text-xs text-muted-foreground">Backend</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
                      <Wifi className="w-3 h-3" /> Online
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Chrome Extension setup */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Puzzle className="w-4 h-4 text-blue-500" />
                    <p className="text-sm font-semibold text-foreground">Chrome Recorder Extension</p>
                  </div>
                  {extensionInstalled ? (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">Extension installed</p>
                        <p className="text-xs text-muted-foreground">Go to Recording Studio to start a session.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <FeatureBullet icon={MousePointer2} text="Captures clicks, typing, navigation, and API calls automatically" />
                        <FeatureBullet icon={Zap} text="Generates natural language steps in real-time as you browse" />
                      </div>
                      <Button
                        className="h-9 text-sm font-semibold gap-2 text-white"
                        style={{ background: brand.accentColor }}
                        onClick={() => window.open('/api/qe/downloads/chrome-extension', '_blank')}
                      >
                        <Download className="w-4 h-4" /> Download Extension
                      </Button>
                      <div className="space-y-2 text-sm">
                        <StepItem n={1} title="Extract the ZIP">
                          <p>Unzip <strong className="text-foreground">chrome-extension.zip</strong> to a folder.</p>
                        </StepItem>
                        <StepItem n={2} title="Load in Chrome">
                          <p>Go to <strong className="text-foreground">chrome://extensions</strong>, enable <strong className="text-foreground">Developer mode</strong>, click <strong className="text-foreground">Load unpacked</strong> and select the extracted folder.</p>
                        </StepItem>
                        <StepItem n={3} title="Start recording">
                          <p>Open <strong className="text-foreground">Recording Studio</strong> from the sidebar and create a new session.</p>
                        </StepItem>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Playwright Recorder Engine — server-side health check */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Theater className="w-4 h-4 text-emerald-500" />
                      <p className="text-sm font-semibold text-foreground">Playwright Recorder Engine</p>
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 text-[10px] uppercase">Recommended</Badge>
                    </div>
                    <button
                      onClick={runPwHealth}
                      disabled={pwHealthLoading}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${pwHealthLoading ? 'animate-spin' : ''}`} />
                      {pwHealthLoading ? 'Checking…' : 'Re-check'}
                    </button>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Powers the <strong className="text-foreground">"Record with Playwright"</strong> button in Recording Studio.
                    Uses the Playwright library directly — assert mode survives every navigation, popups & iframes are auto-injected.
                  </p>

                  {pwHealth === null && pwHealthLoading && (
                    <div className="bg-muted/50 border rounded-lg p-3 flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground flex-shrink-0" />
                      <p className="text-sm text-muted-foreground">Probing Playwright environment…</p>
                    </div>
                  )}

                  {pwHealth?.ok && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">Ready to record</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{pwHealth.details}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                          {pwHealth.version && <span>v{pwHealth.version}</span>}
                          <span>{pwHealth.headless ? 'Headless' : 'Headed'} mode</span>
                          <span>{pwHealth.platform}</span>
                          <span className="capitalize">{pwHealth.hosting} hosting</span>
                          {pwHealth.durationMs !== undefined && <span>{pwHealth.durationMs}ms</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {pwHealth && !pwHealth.ok && (
                    <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-3 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Playwright not ready</p>
                        <p className="text-xs text-foreground break-words">{pwHealth.details}</p>
                        {pwHealth.hint && (
                          <div className="bg-background/60 border rounded px-2 py-1.5">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Suggested fix</p>
                            <code className="text-xs font-mono text-foreground break-words">{pwHealth.hint}</code>
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          Until this is fixed, use <strong className="text-foreground">Record in Window</strong> as a fallback (uses the Chrome extension flow).
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Remote Agent setup */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-purple-500" />
                    <p className="text-sm font-semibold text-foreground">Remote Execution Agent</p>
                  </div>
                  {totalAgents > 0 ? (
                    <div className="space-y-3">
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-green-600 dark:text-green-400">{totalAgents} agent{totalAgents > 1 ? "s" : ""} connected</p>
                          <div className="flex items-center gap-3 text-xs">
                            {idleAgents > 0 && <span className="text-green-600 dark:text-green-400">{idleAgents} ready</span>}
                            {busyAgents > 0 && <span className="text-amber-600 dark:text-amber-400">{busyAgents} running</span>}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connected Agents</span>
                          <button onClick={() => refetchAgents()} className="text-muted-foreground hover:text-foreground transition-colors">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {agentStatus?.agents.map((agent) => (
                          <div key={agent.agentId} className="flex items-center justify-between px-3 py-2 border-t">
                            <div className="flex items-center gap-2">
                              <Cpu className="w-3.5 h-3.5 text-purple-500/70" />
                              <span className="text-sm text-foreground font-mono">{agent.label || agent.agentId}</span>
                            </div>
                            <Badge className={agent.status === "idle"
                              ? "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 text-xs"
                              : "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs"
                            }>{agent.status === "idle" ? "Ready" : "Busy"}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <FeatureBullet icon={Play} text="Executes Playwright tests on a real Chromium browser" />
                        <FeatureBullet icon={Box} text="Self-contained — includes Node.js, Playwright, and Chromium" />
                      </div>
                      <Button
                        className="h-9 text-sm font-semibold gap-2 text-white"
                        style={{ background: "#8b5cf6" }}
                        onClick={() => window.open("/api/qe/downloads/nat-agent-windows", "_blank")}
                      >
                        <Download className="w-4 h-4" /> Download Remote Agent (Windows x64)
                      </Button>
                      <div className="space-y-2 text-sm">
                        <StepItem n={1} title="Extract the ZIP">
                          <p>Extract to a local folder (e.g. <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">C:\NAT-Agent</code>). Avoid OneDrive or paths with spaces.</p>
                        </StepItem>
                        <StepItem n={2} title="Edit config.json">
                          <p>Set the server URL:</p>
                          <code className="block mt-1 px-3 py-2 rounded-md bg-muted border text-xs font-mono text-foreground whitespace-pre-wrap">{`{
  "serverUrl": "${wsBaseUrl}/ws/execution-agent",
  "agentId": "my-agent-01"
}`}</code>
                        </StepItem>
                        <StepItem n={3} title="Start the agent">
                          <p>Double-click <strong className="text-foreground">start-agent.bat</strong>. You should see: <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">Connected. Registering as my-agent-01…</code></p>
                        </StepItem>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  Notification Settings
                </CardTitle>
                <CardDescription>Configure how you receive updates</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Email Notifications</p>
                    <p className="text-sm text-muted-foreground">Receive email updates for important events</p>
                  </div>
                  <Switch 
                    checked={settings.emailNotifications}
                    onCheckedChange={(checked) => setSettings({...settings, emailNotifications: checked})}
                    data-testid="switch-email-notifications"
                  />
                </div>
                <Separator />
                <div className="space-y-4">
                  <p className="text-sm font-medium text-muted-foreground">Notification Types</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                      <span className="text-sm text-foreground">Generation complete</span>
                      <Switch 
                        checked={settings.notifyGeneration}
                        onCheckedChange={(checked) => setSettings({...settings, notifyGeneration: checked})}
                        data-testid="switch-notify-generation"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                      <span className="text-sm text-foreground">Execution complete</span>
                      <Switch 
                        checked={settings.notifyExecution}
                        onCheckedChange={(checked) => setSettings({...settings, notifyExecution: checked})}
                        data-testid="switch-notify-execution"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                      <span className="text-sm text-foreground">Sync complete</span>
                      <Switch 
                        checked={settings.notifySync}
                        onCheckedChange={(checked) => setSettings({...settings, notifySync: checked})}
                        data-testid="switch-notify-sync"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                      <span className="text-sm text-foreground">Errors/failures</span>
                      <Switch 
                        checked={settings.notifyErrors}
                        onCheckedChange={(checked) => setSettings({...settings, notifyErrors: checked})}
                        data-testid="switch-notify-errors"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Palette className="w-5 h-5 text-primary" />
                  Display Settings
                </CardTitle>
                <CardDescription>Customize the appearance</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Theme</Label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'light', icon: Sun, label: 'Light' },
                      { id: 'dark', icon: Moon, label: 'Dark' },
                      { id: 'system', icon: Monitor, label: 'System' },
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setSettings({...settings, theme: theme.id})}
                        className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-2 ${
                          settings.theme === theme.id 
                            ? 'border-primary bg-primary/10' 
                            : 'border-border/50 bg-background/50 hover:border-primary/50'
                        }`}
                        data-testid={`button-theme-${theme.id}`}
                      >
                        <theme.icon className="w-5 h-5" />
                        <span className="text-sm font-medium">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">Sidebar collapsed by default</p>
                      <p className="text-sm text-muted-foreground">Start with minimized sidebar</p>
                    </div>
                    <Switch 
                      checked={settings.sidebarCollapsed}
                      onCheckedChange={(checked) => setSettings({...settings, sidebarCollapsed: checked})}
                      data-testid="switch-sidebar-collapsed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="items-per-page">Items per page</Label>
                    <Select 
                      value={settings.itemsPerPage} 
                      onValueChange={(value) => setSettings({...settings, itemsPerPage: value})}
                    >
                      <SelectTrigger id="items-per-page" data-testid="select-items-per-page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 items</SelectItem>
                        <SelectItem value="25">25 items</SelectItem>
                        <SelectItem value="50">50 items</SelectItem>
                        <SelectItem value="100">100 items</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TestTube2 className="w-5 h-5 text-primary" />
                  Default Test Generation Settings
                </CardTitle>
                <CardDescription>Configure default test generation options</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="default-module">Default Module</Label>
                    <Select 
                      value={settings.defaultModule} 
                      onValueChange={(value) => setSettings({...settings, defaultModule: value})}
                    >
                      <SelectTrigger id="default-module" data-testid="select-default-module">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="autonomous">Autonomous Testing</SelectItem>
                        <SelectItem value="stories">Generate from User Stories</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Default Test Types</Label>
                    <p className="text-xs text-muted-foreground">Pre-selected when generating tests</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-primary" />
                  Integration Settings
                </CardTitle>
                <CardDescription>Manage external connections</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg bg-background/50">
                  <div>
                    <p className="font-medium text-foreground">Integration Management</p>
                    <p className="text-sm text-muted-foreground">Manage Azure DevOps, JIRA, and other integrations</p>
                  </div>
                  <Button variant="outline" asChild data-testid="button-manage-integrations">
                    <a href="/qe/integration-management">Manage</a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" />
                  Account Settings
                </CardTitle>
                <CardDescription>Manage your account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Display Name</Label>
                    <Input id="display-name" defaultValue="Demo User" data-testid="input-display-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" defaultValue="demo@example.com" data-testid="input-email" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" data-testid="button-change-password">
                    Change Password
                  </Button>
                </div>
              </CardContent>
            </Card>
        </div>
      </main>
    </>
  );
}
