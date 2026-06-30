import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardHeader } from "@/components/dashboard/header";
import { 
  Brain, 
  Eye, 
  FileCode, 
  Database, 
  Globe, 
  Layers, 
  TestTube2, 
  FileText,
  Sparkles,
  ArrowRight,
  ArrowDown,
  Workflow,
  Settings,
  Cloud,
  Server,
  Code2,
  FileJson,
  BarChart3,
  Shield,
  Accessibility,
  Monitor,
  FileSpreadsheet,
  GitBranch,
  Play,
  Zap,
  Bot,
  MessageSquare,
  Search,
  CheckCircle,
  Package,
  Download
} from "lucide-react";

interface LayerBoxProps {
  title: string;
  icon: React.ReactNode;
  description?: string;
  className?: string;
  accentColor?: string;
}

function LayerBox({ title, icon, description, className = "", accentColor = "cyan" }: LayerBoxProps) {
  const colorClasses = {
    cyan: "border-cyan-500/30 bg-cyan-950/20 hover:border-cyan-400/50",
    purple: "border-purple-500/30 bg-purple-950/20 hover:border-purple-400/50",
    green: "border-green-500/30 bg-green-950/20 hover:border-green-400/50",
    orange: "border-orange-500/30 bg-orange-950/20 hover:border-orange-400/50",
    blue: "border-blue-500/30 bg-blue-950/20 hover:border-blue-400/50",
    pink: "border-pink-500/30 bg-pink-950/20 hover:border-pink-400/50"
  };

  const iconColors = {
    cyan: "text-cyan-400",
    purple: "text-purple-400",
    green: "text-green-400",
    orange: "text-orange-400",
    blue: "text-blue-400",
    pink: "text-pink-400"
  };

  return (
    <div 
      className={`relative rounded-lg border p-3 transition-all duration-300 ${colorClasses[accentColor as keyof typeof colorClasses]} ${className}`}
      data-testid={`box-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <div className={`${iconColors[accentColor as keyof typeof iconColors]}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-foreground/90 leading-tight">{title}</span>
        {description && (
          <span className="text-[10px] text-muted-foreground leading-tight">{description}</span>
        )}
      </div>
    </div>
  );
}

interface LayerSectionProps {
  layerNumber: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  accentColor: string;
}

function LayerSection({ layerNumber, title, subtitle, children, accentColor }: LayerSectionProps) {
  const borderColors = {
    cyan: "border-cyan-500/40",
    purple: "border-purple-500/40",
    green: "border-green-500/40",
    orange: "border-orange-500/40"
  };

  const bgColors = {
    cyan: "bg-cyan-500/10",
    purple: "bg-purple-500/10",
    green: "bg-green-500/10",
    orange: "bg-orange-500/10"
  };

  const textColors = {
    cyan: "text-cyan-400",
    purple: "text-purple-400",
    green: "text-green-400",
    orange: "text-orange-400"
  };

  return (
    <div 
      className={`relative rounded-xl border-2 ${borderColors[accentColor as keyof typeof borderColors]} ${bgColors[accentColor as keyof typeof bgColors]} p-4`}
      data-testid={`layer-${layerNumber}`}
    >
      <div className="absolute -top-3 left-4 flex items-center gap-2">
        <Badge 
          variant="outline" 
          className={`${textColors[accentColor as keyof typeof textColors]} border-current bg-background px-3 font-mono text-xs`}
          data-testid={`badge-layer-${layerNumber}`}
        >
          LAYER {layerNumber}: {title}
        </Badge>
        <span 
          className="text-xs text-muted-foreground bg-background px-2 rounded"
          data-testid={`text-layer-${layerNumber}-subtitle`}
        >({subtitle})</span>
      </div>
      <div className="mt-4">
        {children}
      </div>
    </div>
  );
}

function ConnectionArrow({ direction = "down", className = "" }: { direction?: "down" | "right"; className?: string }) {
  if (direction === "right") {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="h-0.5 w-8 bg-gradient-to-r from-cyan-500 to-purple-500" />
        <ArrowRight className="h-4 w-4 text-purple-400 -ml-1" />
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center py-2 ${className}`}>
      <div className="w-0.5 h-6 bg-gradient-to-b from-cyan-500 to-purple-500" />
      <ArrowDown className="h-4 w-4 text-purple-400 -mt-1" />
    </div>
  );
}

export default function ArchitectureDiagram() {
  return (
    <div className="flex flex-col h-full">
      <DashboardHeader />
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start">
          <Link href="/dashboard">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border">
              ← Dashboard
            </button>
          </Link>
        </div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="h-1 w-12 bg-gradient-to-r from-transparent to-cyan-500 rounded" />
            <Sparkles className="h-8 w-8 text-cyan-400" />
            <div className="h-1 w-12 bg-gradient-to-l from-transparent to-cyan-500 rounded" />
          </div>
          <h1 
            className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-2"
            data-testid="title-architecture"
          >
            AGENTIC AI TESTING PLATFORM
          </h1>
          <p className="text-muted-foreground text-sm">
            Next-Generation Autonomous Testing with Multi-Agent AI Orchestration
          </p>
        </div>

        <LayerSection layerNumber={1} title="USER INTERACTION" subtitle="Dashboard & Modules" accentColor="cyan">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <LayerBox 
              title="Dashboard" 
              icon={<Monitor className="h-8 w-8" />}
              description="Analytics & Overview"
              accentColor="cyan"
            />
            <LayerBox 
              title="Sprint Agent V2" 
              icon={<Bot className="h-8 w-8" />}
              description="AI Test Generation"
              accentColor="cyan"
            />
            <LayerBox 
              title="API Testing" 
              icon={<Globe className="h-8 w-8" />}
              description="HTTP & REST Testing"
              accentColor="cyan"
            />
            <LayerBox 
              title="Visual Regression" 
              icon={<Eye className="h-8 w-8" />}
              description="Pixel Comparison"
              accentColor="cyan"
            />
            <LayerBox 
              title="SSRS → PowerBI" 
              icon={<BarChart3 className="h-8 w-8" />}
              description="Migration Validator"
              accentColor="cyan"
            />
            <LayerBox 
              title="Selenium → Playwright" 
              icon={<GitBranch className="h-8 w-8" />}
              description="Test Migration"
              accentColor="cyan"
            />
          </div>
        </LayerSection>

        <ConnectionArrow />

        <LayerSection layerNumber={2} title="AUTONOMOUS AGENTS" subtitle="AI Reasoning Engine" accentColor="purple">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="text-xs text-purple-400 font-mono mb-2 text-center">AI PROVIDERS</div>
              <div className="grid grid-cols-3 gap-2">
                <LayerBox 
                  title="Claude" 
                  icon={<Brain className="h-6 w-6" />}
                  accentColor="purple"
                />
                <LayerBox 
                  title="OpenAI" 
                  icon={<Sparkles className="h-6 w-6" />}
                  accentColor="purple"
                />
                <LayerBox 
                  title="Anthropic" 
                  icon={<MessageSquare className="h-6 w-6" />}
                  accentColor="purple"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-purple-400 font-mono mb-2 text-center">MULTI-AGENT PIPELINE</div>
              <div className="flex items-center justify-center gap-1 flex-wrap">
                <LayerBox 
                  title="Story Analyzer" 
                  icon={<Search className="h-5 w-5" />}
                  accentColor="purple"
                  className="flex-1 min-w-[80px]"
                />
                <ArrowRight className="h-4 w-4 text-purple-400 hidden md:block" />
                <LayerBox 
                  title="Planner" 
                  icon={<Workflow className="h-5 w-5" />}
                  accentColor="purple"
                  className="flex-1 min-w-[80px]"
                />
                <ArrowRight className="h-4 w-4 text-purple-400 hidden md:block" />
                <LayerBox 
                  title="Generator" 
                  icon={<Zap className="h-5 w-5" />}
                  accentColor="purple"
                  className="flex-1 min-w-[80px]"
                />
                <ArrowRight className="h-4 w-4 text-purple-400 hidden md:block" />
                <LayerBox 
                  title="QA Refiner" 
                  icon={<CheckCircle className="h-5 w-5" />}
                  accentColor="purple"
                  className="flex-1 min-w-[80px]"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-purple-400 font-mono mb-2 text-center">TEST CATEGORIES</div>
              <div className="grid grid-cols-5 gap-1">
                <LayerBox 
                  title="Functional" 
                  icon={<TestTube2 className="h-5 w-5" />}
                  accentColor="blue"
                />
                <LayerBox 
                  title="Negative" 
                  icon={<Shield className="h-5 w-5" />}
                  accentColor="orange"
                />
                <LayerBox 
                  title="Edge Case" 
                  icon={<Layers className="h-5 w-5" />}
                  accentColor="pink"
                />
                <LayerBox 
                  title="Security" 
                  icon={<Shield className="h-5 w-5" />}
                  accentColor="green"
                />
                <LayerBox 
                  title="A11y" 
                  icon={<Accessibility className="h-5 w-5" />}
                  accentColor="cyan"
                />
              </div>
            </div>
          </div>
        </LayerSection>

        <ConnectionArrow />

        <LayerSection layerNumber={3} title="CODE GENERATION" subtitle="BDD Assets & Scripts" accentColor="green">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="text-xs text-green-400 font-mono mb-2 text-center">BDD ARTIFACT GENERATION</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <LayerBox 
                  title="Feature Files" 
                  icon={<FileText className="h-6 w-6" />}
                  description=".feature"
                  accentColor="green"
                />
                <LayerBox 
                  title="Step Definitions" 
                  icon={<Code2 className="h-6 w-6" />}
                  description=".steps.ts"
                  accentColor="green"
                />
                <LayerBox 
                  title="Page Objects" 
                  icon={<FileCode className="h-6 w-6" />}
                  description=".page.ts"
                  accentColor="green"
                />
                <LayerBox 
                  title="Utilities" 
                  icon={<Settings className="h-6 w-6" />}
                  description="helpers.ts"
                  accentColor="green"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-green-400 font-mono mb-2 text-center">SCRIPT GENERATION</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <LayerBox 
                  title="Playwright TS" 
                  icon={<Play className="h-6 w-6" />}
                  description="E2E Tests"
                  accentColor="green"
                />
                <LayerBox 
                  title="Postman" 
                  icon={<FileJson className="h-6 w-6" />}
                  description="Collections"
                  accentColor="green"
                />
                <LayerBox 
                  title="ReadyAPI" 
                  icon={<Server className="h-6 w-6" />}
                  description="Projects"
                  accentColor="green"
                />
                <LayerBox 
                  title="C# to TS" 
                  icon={<GitBranch className="h-6 w-6" />}
                  description="Migration"
                  accentColor="green"
                />
              </div>
            </div>
          </div>
        </LayerSection>

        <ConnectionArrow />

        <LayerSection layerNumber={4} title="DATA & INTEGRATION" subtitle="Storage & Export" accentColor="orange">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="text-xs text-orange-400 font-mono mb-2 text-center">DATABASE</div>
              <div className="grid grid-cols-2 gap-2">
                <LayerBox 
                  title="PostgreSQL" 
                  icon={<Database className="h-6 w-6" />}
                  description="Neon Serverless"
                  accentColor="orange"
                />
                <LayerBox 
                  title="Drizzle ORM" 
                  icon={<Layers className="h-6 w-6" />}
                  description="Type-safe"
                  accentColor="orange"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-orange-400 font-mono mb-2 text-center">EXPORT FORMATS</div>
              <div className="grid grid-cols-3 gap-2">
                <LayerBox 
                  title="Excel Export" 
                  icon={<FileSpreadsheet className="h-6 w-6" />}
                  accentColor="orange"
                />
                <LayerBox 
                  title="ZIP Bundle" 
                  icon={<Package className="h-6 w-6" />}
                  accentColor="orange"
                />
                <LayerBox 
                  title="JSON/Text" 
                  icon={<FileJson className="h-6 w-6" />}
                  accentColor="orange"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-orange-400 font-mono mb-2 text-center">INTEGRATIONS</div>
              <div className="grid grid-cols-3 gap-2">
                <LayerBox 
                  title="Azure DevOps" 
                  icon={<Cloud className="h-6 w-6" />}
                  accentColor="orange"
                />
                <LayerBox 
                  title="Jira" 
                  icon={<Server className="h-6 w-6" />}
                  accentColor="orange"
                />
                <LayerBox 
                  title="TestRail" 
                  icon={<TestTube2 className="h-6 w-6" />}
                  accentColor="orange"
                />
              </div>
            </div>
          </div>
        </LayerSection>

        <div className="text-center py-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/30 bg-cyan-950/20">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span className="text-xs text-cyan-400 font-mono">
              POWERED BY MULTI-AGENT AI ORCHESTRATION
            </span>
            <Sparkles className="h-4 w-4 text-cyan-400" />
          </div>
        </div>

        <Card className="p-6 bg-gradient-to-r from-slate-900/50 to-slate-800/50 border-slate-700/50" data-testid="card-platform-capabilities">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="heading-platform-capabilities">
            <Layers className="h-5 w-5 text-cyan-400" />
            Platform Capabilities
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="space-y-2" data-testid="section-ai-testing">
              <h4 className="font-medium text-cyan-400">AI-Powered Testing</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Intelligent test case generation</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Multi-agent orchestration</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Real-time streaming progress</li>
              </ul>
            </div>
            <div className="space-y-2" data-testid="section-visual-validation">
              <h4 className="font-medium text-purple-400">Visual Validation</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Pixel-perfect comparison</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> WCAG 2.1 AA compliance</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Responsive design testing</li>
              </ul>
            </div>
            <div className="space-y-2" data-testid="section-code-generation">
              <h4 className="font-medium text-green-400">Code Generation</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> BDD feature files</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Playwright TypeScript</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Postman & ReadyAPI</li>
              </ul>
            </div>
            <div className="space-y-2" data-testid="section-enterprise-integration">
              <h4 className="font-medium text-orange-400">Enterprise Integration</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Azure DevOps sync</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Excel export</li>
                <li className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-400" /> Jira & TestRail push</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}