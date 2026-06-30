import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { 
  Eye, 
  Accessibility, 
  Smartphone, 
  Image, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  ArrowRight,
  Zap,
  Shield,
  Monitor,
  TrendingUp,
  BarChart3,
  FileCheck,
  Target,
  FileSpreadsheet,
  Globe,
  Code2,
  Activity,
  Coffee
} from "lucide-react";

// NAT-imp-tools: module ids listed here are kept in the `modules` array
// below (definitions, routes, and detail pages are all preserved) but filtered
// out of the AI Quality Engine UI — they don't render as cards on the hub
// page and they don't contribute to the aggregated stats. Remove an id from
// this set to re-enable the corresponding module in the UI.
const HIDDEN_MODULE_IDS: ReadonlySet<string> = new Set([
  "visual-regression",
  "pixel-comparison",
  "accessibility",
  "responsive",
  "ssrs-powerbi",
  "selenium-migration",
  "icu-streaming",
]);

// Recent Scans entries whose `module` label matches a hidden module are also
// filtered so the hidden modules aren't referenced in the Recent Scans tab.
const HIDDEN_SCAN_MODULES: ReadonlySet<string> = new Set([
  "Visual Regression",
  "Pixel Comparison",
  "Accessibility",
  "Responsive",
]);

const modules = [
  {
    id: "visual-regression",
    title: "Visual Regression Testing",
    description: "Automated detection of visual changes in medical imaging interfaces",
    icon: Eye,
    href: "/nradiverse/visual-regression",
    color: "text-violet-400",
    bgColor: "bg-violet-500/20",
    borderColor: "border-violet-500/30",
    features: [
      "Baseline image capture & management",
      "Pixel-by-pixel comparison",
      "SSIM/PSNR quality metrics",
      "Medical imaging format support"
    ],
    stats: { tests: 156, passed: 148, failed: 8 }
  },
  {
    id: "pixel-comparison",
    title: "Pixel-to-Pixel Comparison",
    description: "Granular image comparison with advanced metrics for medical images",
    icon: Image,
    href: "/nradiverse/pixel-comparison",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/20",
    borderColor: "border-cyan-500/30",
    features: [
      "Multi-algorithm comparison",
      "Histogram analysis",
      "Heat map visualization",
      "Batch processing support"
    ],
    stats: { tests: 89, passed: 85, failed: 4 }
  },
  {
    id: "accessibility",
    title: "Accessibility Compliance",
    description: "WCAG 2.1 Level AA automated compliance validation",
    icon: Accessibility,
    href: "/nradiverse/accessibility",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/20",
    borderColor: "border-emerald-500/30",
    features: [
      "axe-core integration",
      "Color contrast analysis",
      "Keyboard navigation testing",
      "Screen reader compatibility"
    ],
    stats: { tests: 234, passed: 218, failed: 16 }
  },
  {
    id: "responsive",
    title: "Responsive Design Testing",
    description: "Cross-device layout validation across 15+ device configurations",
    icon: Smartphone,
    href: "/nradiverse/responsive",
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    borderColor: "border-amber-500/30",
    features: [
      "15+ device emulation",
      "Touch target validation",
      "Layout shift detection",
      "Performance metrics"
    ],
    stats: { tests: 312, passed: 298, failed: 14 }
  },
  {
    id: "ssrs-powerbi",
    title: "SSRS to PowerBI Migration",
    description: "AI-powered report validation for SSRS to PowerBI migration projects",
    icon: FileSpreadsheet,
    href: "/nradiverse/ssrs-powerbi",
    color: "text-orange-400",
    bgColor: "bg-orange-500/20",
    borderColor: "border-orange-500/30",
    features: [
      "Excel & PDF comparison",
      "Cell-by-cell validation",
      "AI discrepancy analysis",
      "Side-by-side viewer"
    ],
    stats: { tests: 45, passed: 42, failed: 3 }
  },
  {
    id: "api-testing",
    title: "API Testing Module",
    description: "AI-powered comprehensive API test case generation with Postman & ReadyAPI integration",
    icon: Globe,
    href: "/nradiverse/api-testing",
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/30",
    features: [
      "Postman & ReadyAPI scripts",
      "Functional & Negative tests",
      "Security testing",
      "Performance validation"
    ],
    stats: { tests: 0, passed: 0, failed: 0 }
  },
  {
    id: "selenium-migration",
    title: "Selenium to Playwright Migration",
    description: "Convert Selenium C# BDD tests (SpecFlow) to Playwright TypeScript with Cucumber.js",
    icon: Code2,
    href: "/nradiverse/migration",
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/30",
    features: [
      "SpecFlow to Cucumber.js",
      "Page Object conversion",
      "Hooks migration",
      "Locator mapping"
    ],
    stats: { tests: 0, passed: 0, failed: 0 }
  },
  {
    id: "java-migration",
    title: "Java + Selenium + BDD Migration",
    description: "AI-powered agents convert your Java+Selenium+Cucumber framework to Playwright+TypeScript — upload, classify, migrate, download",
    icon: Coffee,
    href: "/nradiverse/java-migration",
    color: "text-violet-400",
    bgColor: "bg-violet-500/20",
    borderColor: "border-violet-500/30",
    badge: "NEW",
    features: [
      "Upload ZIP & auto-classify",
      "6 AI migration agents",
      "PageFactory → Playwright POM",
      "Download ready-to-run project"
    ],
    stats: { tests: 0, passed: 0, failed: 0 }
  },
  {
    id: "icu-streaming",
    title: "ICU Medical Device Stream Validator",
    description: "Real-time validation of 24/7 ICU device data streams as they push to the cloud — integrity, latency, sequencing, and FHIR transformation",
    icon: Activity,
    href: "/nradiverse/icu-streaming",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/20",
    borderColor: "border-cyan-500/30",
    badge: "GE Healthcare",
    features: [
      "GE CARESCAPE / Ventilator / ECG live data",
      "Latency & sequence ordering checks",
      "FHIR R4 transformation validation",
      "TLS 1.3 encryption & data drop detection"
    ],
    stats: { tests: 0, passed: 0, failed: 0 }
  }
];

const recentScans = [
  { id: 1, url: "https://imaging.gehealthcare.com/portal", module: "Visual Regression", status: "passed", score: 98, time: "2 min ago" },
  { id: 2, url: "https://pacs.gehealthcare.com/viewer", module: "Accessibility", status: "failed", score: 76, time: "15 min ago" },
  { id: 3, url: "https://radiology.gehealthcare.com", module: "Responsive", status: "passed", score: 94, time: "1 hour ago" },
  { id: 4, url: "https://dicom.gehealthcare.com/upload", module: "Pixel Comparison", status: "warning", score: 87, time: "2 hours ago" },
];

export default function NRadiVersePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const visibleModules = modules.filter((m) => !HIDDEN_MODULE_IDS.has(m.id));
  const visibleRecentScans = recentScans.filter((s) => !HIDDEN_SCAN_MODULES.has(s.module));

  const totalTests = visibleModules.reduce((sum, m) => sum + m.stats.tests, 0);
  const totalPassed = visibleModules.reduce((sum, m) => sum + m.stats.passed, 0);
  const totalFailed = visibleModules.reduce((sum, m) => sum + m.stats.failed, 0);
  const overallScore = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/dashboard">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border">
                    ← Dashboard
                  </button>
                </Link>
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-nradiverse">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-yellow-500/20 to-cyan-500/20">
                      <Sparkles className="w-7 h-7 text-yellow-400" />
                    </div>
                    AI Quality Engine
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    Comprehensive visual, accessibility, and responsive testing for any application
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" asChild>
                  <Link href="/reports" data-testid="button-view-reports">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    View Reports
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Overall Score</p>
                      <p className="text-3xl font-bold text-violet-400" data-testid="stat-overall-score">{overallScore}%</p>
                    </div>
                    <div className="p-3 rounded-full bg-violet-500/20">
                      <Target className="w-6 h-6 text-violet-400" />
                    </div>
                  </div>
                  <Progress value={overallScore} className="mt-3 h-2" />
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Tests Passed</p>
                      <p className="text-3xl font-bold text-emerald-400" data-testid="stat-passed">{totalPassed}</p>
                    </div>
                    <div className="p-3 rounded-full bg-emerald-500/20">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Tests Failed</p>
                      <p className="text-3xl font-bold text-red-400" data-testid="stat-failed">{totalFailed}</p>
                    </div>
                    <div className="p-3 rounded-full bg-red-500/20">
                      <XCircle className="w-6 h-6 text-red-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Tests</p>
                      <p className="text-3xl font-bold text-cyan-400" data-testid="stat-total">{totalTests}</p>
                    </div>
                    <div className="p-3 rounded-full bg-cyan-500/20">
                      <FileCheck className="w-6 h-6 text-cyan-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                <TabsTrigger value="recent" data-testid="tab-recent">Recent Scans</TabsTrigger>
                <TabsTrigger value="compliance" data-testid="tab-compliance">Compliance Status</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {visibleModules.map((module) => (
                    <Card key={module.id} className={`${module.bgColor} ${module.borderColor} border hover:border-opacity-60 transition-all`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`p-2 rounded-lg flex-shrink-0 ${module.bgColor}`}>
                              <module.icon className={`w-5 h-5 ${module.color}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <CardTitle className="text-lg">{module.title}</CardTitle>
                                {"badge" in module && module.badge && (
                                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">{module.badge as string}</Badge>
                                )}
                              </div>
                              <CardDescription>{module.description}</CardDescription>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ul className="space-y-2">
                          {module.features.map((feature, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex items-center gap-2">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                        <Link href={module.href}>
                          <Button className="w-full" variant="outline" data-testid={`button-open-${module.id}`}>
                            Open Module
                            <ArrowRight className="w-4 h-4 ml-2" />
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="recent" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Quality Scans</CardTitle>
                    <CardDescription>Latest test executions across all modules</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {visibleRecentScans.map((scan) => (
                        <div key={scan.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${
                              scan.status === 'passed' ? 'bg-emerald-500/20' : 
                              scan.status === 'failed' ? 'bg-red-500/20' : 'bg-amber-500/20'
                            }`}>
                              {scan.status === 'passed' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : scan.status === 'failed' ? (
                                <XCircle className="w-4 h-4 text-red-400" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{scan.url}</p>
                              <p className="text-xs text-muted-foreground">{scan.module} · {scan.time}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className={`font-bold ${
                                scan.score >= 90 ? 'text-emerald-400' : 
                                scan.score >= 70 ? 'text-amber-400' : 'text-red-400'
                              }`}>{scan.score}%</p>
                              <p className="text-xs text-muted-foreground">Score</p>
                            </div>
                            <Button size="sm" variant="ghost" data-testid={`button-view-scan-${scan.id}`}>
                              View
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="compliance" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30">
                    <CardContent className="p-6 text-center">
                      <Shield className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                      <h3 className="font-bold text-lg">WCAG 2.1 AA</h3>
                      <p className="text-sm text-muted-foreground mb-3">Accessibility Standard</p>
                      <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/50">
                        92% Compliant
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                    <CardContent className="p-6 text-center">
                      <Monitor className="w-12 h-12 text-cyan-400 mx-auto mb-3" />
                      <h3 className="font-bold text-lg">Section 508</h3>
                      <p className="text-sm text-muted-foreground mb-3">Federal Accessibility</p>
                      <Badge variant="outline" className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50">
                        88% Compliant
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30">
                    <CardContent className="p-6 text-center">
                      <TrendingUp className="w-12 h-12 text-violet-400 mx-auto mb-3" />
                      <h3 className="font-bold text-lg">ADA Compliance</h3>
                      <p className="text-sm text-muted-foreground mb-3">Healthcare Standard</p>
                      <Badge variant="outline" className="bg-violet-500/20 text-violet-400 border-violet-500/50">
                        95% Compliant
                      </Badge>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
        </div>
      </main>
    </>
  );
}
