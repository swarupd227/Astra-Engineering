import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBranding } from "@/contexts/BrandingContext";
import {
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
} from "lucide-react";

const EXTENSION_ID = (window as any).__QE_EXTENSION_ID || "";
const CHROME_WEB_STORE_URL = (window as any).__QE_EXTENSION_STORE_URL || "";

interface AgentInfo {
  agentId: string;
  hostname: string;
  status: string;
  label?: string;
  tags?: string[];
}

interface AgentStatusResponse {
  total: number;
  idle: number;
  busy: number;
  agents: AgentInfo[];
}

function ExtensionStatusPill({ installed, connected }: { installed: boolean; connected: boolean }) {
  if (installed && connected) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
        <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400 animate-pulse" /> Active
      </span>
    );
  }
  if (installed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs font-medium">
        <Loader2 className="w-3 h-3 animate-spin" /> Installed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border text-muted-foreground text-xs font-medium">
      <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" /> Not installed
    </span>
  );
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

export default function RemoteAgentsPage() {
  const { brand } = useBranding();

  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);

  const { data: agentStatus, refetch: refetchAgents, isLoading: agentsLoading } = useQuery<AgentStatusResponse>({
    queryKey: ["/api/qe/execution-agent/status"],
    refetchInterval: 5000,
  });

  const detectExtension = useCallback(() => {
    // Method 1: postMessage bridge (works without extension ID)
    window.postMessage({ type: 'DEVXQE_PING' }, '*');

    // Method 2: externally_connectable (requires extension ID)
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
    return () => {
      clearInterval(interval);
      window.removeEventListener('message', handlePong);
    };
  }, [detectExtension]);

  const totalAgents = agentStatus?.total ?? 0;
  const idleAgents = agentStatus?.idle ?? 0;
  const busyAgents = agentStatus?.busy ?? 0;

  return (
    <>
      <DashboardHeader title="Remote Agents" />
      <main className="flex-1 overflow-y-auto">
        <div className="px-6 py-6 space-y-6">

            {/* Hero */}
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Set Up Your Testing Environment</h1>
              <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                Install the Chrome Extension to record user interactions, and connect a Remote Agent to execute tests automatically on real browsers.
              </p>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-card border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Chrome className="w-6 h-6 text-blue-500" />
                    <ExtensionStatusPill installed={extensionInstalled} connected={extensionConnected} />
                  </div>
                  <p className="text-sm font-medium text-foreground">Recorder Extension</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Captures browser interactions</p>
                </CardContent>
              </Card>

              <Card className="bg-card border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Cpu className="w-6 h-6 text-purple-500" />
                    {agentsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : totalAgents > 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
                        <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400 animate-pulse" /> {totalAgents} online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border text-muted-foreground text-xs font-medium">
                        <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" /> Offline
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">Remote Agents</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Executes tests on real browsers</p>
                </CardContent>
              </Card>

              <Card className="bg-card border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Monitor className="w-6 h-6 text-green-500" />
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/25 text-green-600 dark:text-green-400 text-xs font-medium">
                      <Wifi className="w-3 h-3" /> Online
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">QE Server</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Connected and ready</p>
                </CardContent>
              </Card>
            </div>

            {/* Two-column: Extension + Agent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Chrome Extension */}
              <Card className="bg-card border overflow-hidden">
                <div className="h-1.5" style={{ background: "linear-gradient(90deg, #3b82f6, #60a5fa)" }} />
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Puzzle className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base text-foreground">Chrome Recorder Extension</CardTitle>
                      <CardDescription className="text-xs">Record interactions on any website</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <FeatureBullet icon={MousePointer2} text="Captures clicks, typing, navigation, and API calls automatically" />
                    <FeatureBullet icon={Eye} text="Builds smart selectors for stable, reliable tests" />
                    <FeatureBullet icon={Zap} text="Generates natural language steps in real-time as you browse" />
                    <FeatureBullet icon={Shield} text="Passwords are masked — sensitive data never leaves your browser" />
                  </div>

                  <div className="border-t pt-4">
                    {extensionInstalled ? (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center space-y-2">
                        <CheckCircle2 className="w-7 h-7 text-green-500 mx-auto" />
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">Extension installed</p>
                        <p className="text-xs text-muted-foreground">
                          Go to <strong className="text-foreground">Recording Studio</strong> to start a session. The extension will connect automatically.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Button
                          className="w-full h-11 text-sm font-semibold gap-2 text-white"
                          style={{ background: brand.accentColor }}
                          onClick={() => {
                            ['chrome-extension', 'nat-agent-windows'].forEach((id) => {
                              const iframe = document.createElement('iframe');
                              iframe.style.display = 'none';
                              iframe.src = `/api/qe/downloads/${id}`;
                              document.body.appendChild(iframe);
                              setTimeout(() => document.body.removeChild(iframe), 30000);
                            });
                          }}
                        >
                          <Download className="w-4 h-4" /> Download Chrome Extension
                        </Button>

                        <div className="space-y-3">
                          <StepItem n={1} title="Extract the downloaded file">
                            <p>Unzip <strong className="text-foreground">chrome-extension.zip</strong> to a folder on your computer. Remember this location — you'll need it in the next step.</p>
                          </StepItem>
                          <StepItem n={2} title="Open Chrome Extensions page">
                            <p>
                              Open Chrome and type <strong className="text-foreground">chrome://extensions</strong> in the address bar, then press Enter. Turn on <strong className="text-foreground">Developer mode</strong> using the toggle in the top-right corner of the page.
                            </p>
                          </StepItem>
                          <StepItem n={3} title="Load the extension into Chrome">
                            <p>
                              Click the <strong className="text-foreground">Load unpacked</strong> button that appears after enabling Developer mode. Browse to the folder you extracted in Step 1 and select it. The QE Recorder icon will appear in your Chrome toolbar.
                            </p>
                          </StepItem>
                          <StepItem n={4} title="Start recording">
                            <p>
                              Go to <strong className="text-foreground">Recording Studio</strong> in the sidebar and create a new session. The extension will auto-link to the session — just open your target website and start interacting. Natural language steps will appear in real-time.
                            </p>
                          </StepItem>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Remote Agent */}
              <Card className="bg-card border overflow-hidden">
                <div className="h-1.5" style={{ background: "linear-gradient(90deg, #8b5cf6, #a78bfa)" }} />
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                      <Cpu className="w-5 h-5 text-purple-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base text-foreground">Remote Execution Agent</CardTitle>
                      <CardDescription className="text-xs">Runs your tests on real browsers</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <FeatureBullet icon={Play} text="Executes generated Playwright tests on a real Chromium browser" />
                    <FeatureBullet icon={FileCode2} text="Streams results, screenshots, and logs back to your dashboard" />
                    <FeatureBullet icon={Box} text="Runs as a lightweight container — deploy one or many" />
                    <FeatureBullet icon={Shield} text="Connects securely via WebSocket with token authentication" />
                  </div>

                  <div className="border-t pt-4">
                    {totalAgents > 0 ? (
                      <div className="space-y-4">
                        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center space-y-1">
                          <CheckCircle2 className="w-7 h-7 text-green-500 mx-auto" />
                          <p className="text-sm font-medium text-green-600 dark:text-green-400">{totalAgents} agent{totalAgents > 1 ? "s" : ""} connected</p>
                          <div className="flex items-center justify-center gap-3 text-xs">
                            {idleAgents > 0 && <span className="text-green-600 dark:text-green-400">{idleAgents} ready</span>}
                            {busyAgents > 0 && <span className="text-amber-600 dark:text-amber-400">{busyAgents} running tests</span>}
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
                            <div key={agent.agentId} className="flex items-center justify-between px-3 py-2.5 border-t">
                              <div className="flex items-center gap-2">
                                <Cpu className="w-3.5 h-3.5 text-purple-500/70" />
                                <span className="text-sm text-foreground font-mono">{agent.label || agent.agentId}</span>
                              </div>
                              <Badge className={agent.status === "idle"
                                ? "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 text-xs"
                                : "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs"
                              }>
                                {agent.status === "idle" ? "Ready" : "Busy"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Button
                          className="w-full h-11 text-sm font-semibold gap-2 text-white"
                          style={{ background: "#8b5cf6" }}
                          onClick={() => window.open("/api/qe/downloads/nat-agent-windows", "_blank")}
                        >
                          <Download className="w-4 h-4" /> Download Remote Agent (Windows x64)
                        </Button>

                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                          <p className="text-xs font-semibold text-foreground mb-1">No prerequisites required</p>
                          <p className="text-xs text-muted-foreground">
                            The ZIP is fully self-contained — includes Node.js, Playwright, and Chromium. Just extract, configure, and run.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <StepItem n={1} title="Extract the ZIP">
                            <p>Extract <strong className="text-foreground">NAT-Agent-Windows-x64.zip</strong> to a local folder (e.g. <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">C:\NAT-Agent</code>).</p>
                            <p className="text-amber-600 dark:text-amber-400 mt-1"><strong>Important:</strong> Do NOT extract into OneDrive or a path with spaces.</p>
                          </StepItem>
                          <StepItem n={2} title="Edit config.json">
                            <p>Open <strong className="text-foreground">config.json</strong> in the extracted folder and set:</p>
                            <code className="block mt-1.5 px-3 py-2 rounded-md bg-muted border text-xs font-mono text-foreground whitespace-pre-wrap">{`{
  "serverUrl": "${window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://')}/ws/execution-agent",
  "agentId": "my-agent-01",
  "token": ""
}`}</code>
                          </StepItem>
                          <StepItem n={3} title="Start the agent">
                            <p>Double-click <strong className="text-foreground">start-agent.bat</strong> for a visible console (recommended for first run), or <strong className="text-foreground">start-agent.vbs</strong> for silent background mode.</p>
                            <p className="mt-1.5">You should see: <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">Connected. Registering as my-agent-01…</code></p>
                          </StepItem>
                          <StepItem n={4} title="Verify connection">
                            <p>
                              The agent will appear in the status cards above as <strong className="text-foreground">online</strong>. To stop it, double-click <strong className="text-foreground">stop-agent.bat</strong> or close the console window.
                            </p>
                          </StepItem>
                        </div>

                        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                          <p className="text-xs text-foreground">
                            <strong>Need multiple agents?</strong>{" "}
                            <span className="text-muted-foreground">Extract the ZIP on additional machines. Each agent connects independently and appears in the status panel above.</span>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* How it works */}
            <Card className="bg-card border">
              <CardContent className="p-5">
                <p className="text-sm font-semibold text-foreground mb-4">How it works</p>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-0">
                  {[
                    { icon: CircleDot, label: "Record", desc: "Use the extension to capture interactions on your app" },
                    { icon: FileCode2, label: "Generate", desc: "NAT converts recordings into Playwright test scripts" },
                    { icon: Play, label: "Execute", desc: "Remote Agent runs tests on a real browser automatically" },
                    { icon: CheckCircle2, label: "Report", desc: "See results, screenshots, and logs in your dashboard" },
                  ].map((step, i) => (
                    <div key={step.label} className="flex items-center gap-3 flex-1">
                      {i > 0 && <ArrowRight className="w-4 h-4 text-muted-foreground/50 hidden md:block flex-shrink-0" />}
                      <div className="flex items-center gap-2.5 flex-1">
                        <div className="w-9 h-9 rounded-lg bg-muted border flex items-center justify-center flex-shrink-0">
                          <step.icon className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{step.label}</p>
                          <p className="text-xs text-muted-foreground leading-snug">{step.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

        </div>
      </main>
    </>
  );
}
