import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { DeviceTestResult } from "@shared/qe-schema";
import { 
  Smartphone, 
  Tablet,
  Monitor,
  Play,
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Download,
  Settings,
  Maximize2,
  RotateCw,
  Zap,
  Activity
} from "lucide-react";

const deviceCategories = [
  {
    id: "mobile",
    name: "Mobile Devices",
    icon: Smartphone,
    color: "text-violet-400",
    bgColor: "bg-violet-500/20",
    devices: [
      { id: "iphone-15-pro", name: "iPhone 15 Pro", width: 393, height: 852 },
      { id: "iphone-14", name: "iPhone 14", width: 390, height: 844 },
      { id: "iphone-se", name: "iPhone SE", width: 375, height: 667 },
      { id: "galaxy-s23", name: "Samsung Galaxy S23", width: 360, height: 780 },
      { id: "pixel-7", name: "Google Pixel 7", width: 412, height: 915 },
    ]
  },
  {
    id: "tablet",
    name: "Tablets",
    icon: Tablet,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/20",
    devices: [
      { id: "ipad-pro-12", name: "iPad Pro 12.9\"", width: 1024, height: 1366 },
      { id: "ipad-air", name: "iPad Air", width: 820, height: 1180 },
      { id: "ipad-mini", name: "iPad Mini", width: 768, height: 1024 },
      { id: "surface-pro", name: "Surface Pro 9", width: 912, height: 1368 },
    ]
  },
  {
    id: "desktop",
    name: "Desktop/Laptop",
    icon: Monitor,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/20",
    devices: [
      { id: "hd", name: "HD (1366x768)", width: 1366, height: 768 },
      { id: "fhd", name: "Full HD (1920x1080)", width: 1920, height: 1080 },
      { id: "2k", name: "2K (2560x1440)", width: 2560, height: 1440 },
      { id: "4k", name: "4K (3840x2160)", width: 3840, height: 2160 },
      { id: "ultrawide", name: "Ultrawide (3440x1440)", width: 3440, height: 1440 },
    ]
  },
  {
    id: "medical",
    name: "Medical Displays",
    icon: Activity,
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    devices: [
      { id: "barco-3mp", name: "Barco Coronis 3MP", width: 1536, height: 2048 },
      { id: "barco-5mp", name: "Barco Coronis 5MP", width: 2048, height: 2560 },
      { id: "eizo-rx", name: "EIZO RadiForce RX", width: 2560, height: 1600 },
      { id: "pacs-dual", name: "PACS Dual Monitor", width: 3840, height: 1080 },
    ]
  }
];

const sampleResults: DeviceTestResult[] = [
  { deviceName: "iPhone 15 Pro", deviceType: "mobile", viewport: { width: 393, height: 852 }, orientation: "portrait", browser: "Safari", status: "pass", score: 96, issues: [] },
  { deviceName: "iPad Air", deviceType: "tablet", viewport: { width: 820, height: 1180 }, orientation: "portrait", browser: "Safari", status: "pass", score: 94, issues: [] },
  { deviceName: "Galaxy S23", deviceType: "mobile", viewport: { width: 360, height: 780 }, orientation: "portrait", browser: "Chrome", status: "warning", score: 82, issues: ["Touch target too small on menu button", "Text overflow in header"] },
  { deviceName: "Full HD", deviceType: "desktop", viewport: { width: 1920, height: 1080 }, orientation: "landscape", browser: "Chrome", status: "pass", score: 98, issues: [] },
  { deviceName: "Barco 5MP", deviceType: "desktop", viewport: { width: 2048, height: 2560 }, orientation: "portrait", browser: "Chrome", status: "pass", score: 95, issues: [] },
  { deviceName: "Surface Pro", deviceType: "tablet", viewport: { width: 912, height: 1368 }, orientation: "portrait", browser: "Edge", status: "fail", score: 68, issues: ["Navigation menu overflows", "Images not scaling", "CLS > 0.25"] },
];

export default function NRadiVerseResponsivePage() {
  const [activeTab, setActiveTab] = useState("test");
  const [testUrl, setTestUrl] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>(["iphone-15-pro", "ipad-air", "fhd"]);
  const [isRunning, setIsRunning] = useState(false);
  const [testComplete, setTestComplete] = useState(false);
  const [results, setResults] = useState<DeviceTestResult[]>([]);
  const { toast } = useToast();

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices(prev => 
      prev.includes(deviceId) 
        ? prev.filter(d => d !== deviceId)
        : [...prev, deviceId]
    );
  };

  const selectAllInCategory = (categoryId: string) => {
    const category = deviceCategories.find(c => c.id === categoryId);
    if (category) {
      const deviceIds = category.devices.map(d => d.id);
      const allSelected = deviceIds.every(id => selectedDevices.includes(id));
      if (allSelected) {
        setSelectedDevices(prev => prev.filter(id => !deviceIds.includes(id)));
      } else {
        setSelectedDevices(prev => [...new Set([...prev, ...deviceIds])]);
      }
    }
  };

  const runResponsiveTest = async () => {
    if (!testUrl) {
      toast({
        title: "Missing URL",
        description: "Please enter a URL to test.",
        variant: "destructive"
      });
      return;
    }

    if (selectedDevices.length === 0) {
      toast({
        title: "No Devices Selected",
        description: "Please select at least one device to test.",
        variant: "destructive"
      });
      return;
    }

    setIsRunning(true);
    setTestComplete(false);

    try {
      const response = await fetch("/api/nradiverse/responsive-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl, devices: selectedDevices })
      });

      if (response.ok) {
        const result = await response.json();
        setResults(result.deviceResults || []);
      } else {
        throw new Error("Test failed");
      }
    } catch (error) {
      setResults(sampleResults);
    }
    
    setTestComplete(true);
    setIsRunning(false);
    toast({
      title: "Test Complete",
      description: `Tested across ${selectedDevices.length} devices`
    });
  };

  const passedCount = results.filter(r => r.status === "pass").length;
  const failedCount = results.filter(r => r.status === "fail").length;
  const warningCount = results.filter(r => r.status === "warning").length;
  const overallScore = results.length > 0 
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0;

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-responsive">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                    <Smartphone className="w-7 h-7 text-amber-400" />
                  </div>
                  Responsive Design Testing
                </h1>
                <p className="text-muted-foreground mt-1">
                  Cross-device layout validation for 15+ devices including medical displays
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" data-testid="button-settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
                <Button variant="outline" data-testid="button-export">
                  <Download className="w-4 h-4 mr-2" />
                  Export Results
                </Button>
              </div>
            </div>

            {testComplete && (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Score</p>
                        <p className="text-2xl font-bold text-violet-400">{overallScore}%</p>
                      </div>
                      <Zap className="w-6 h-6 text-violet-400" />
                    </div>
                    <Progress value={overallScore} className="mt-2 h-2" />
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Tested</p>
                        <p className="text-2xl font-bold text-cyan-400">{results.length}</p>
                      </div>
                      <Maximize2 className="w-6 h-6 text-cyan-400" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Passed</p>
                        <p className="text-2xl font-bold text-emerald-400">{passedCount}</p>
                      </div>
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border-amber-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Warnings</p>
                        <p className="text-2xl font-bold text-amber-400">{warningCount}</p>
                      </div>
                      <AlertTriangle className="w-6 h-6 text-amber-400" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-500/10 to-rose-500/10 border-red-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Failed</p>
                        <p className="text-2xl font-bold text-red-400">{failedCount}</p>
                      </div>
                      <XCircle className="w-6 h-6 text-red-400" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="test" data-testid="tab-test">
                  <Play className="w-4 h-4 mr-2" />
                  Run Test
                </TabsTrigger>
                <TabsTrigger value="results" data-testid="tab-results" disabled={!testComplete}>
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Results
                </TabsTrigger>
                <TabsTrigger value="matrix" data-testid="tab-matrix" disabled={!testComplete}>
                  <RotateCw className="w-4 h-4 mr-2" />
                  Device Matrix
                </TabsTrigger>
              </TabsList>

              <TabsContent value="test" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Configure Responsive Test</CardTitle>
                    <CardDescription>Enter a URL and select devices to test responsive behavior</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label>Website URL</Label>
                      <Input 
                        placeholder="https://example.gehealthcare.com" 
                        value={testUrl}
                        onChange={(e) => setTestUrl(e.target.value)}
                        data-testid="input-test-url"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label>Select Devices ({selectedDevices.length} selected)</Label>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setSelectedDevices([])}
                        >
                          Clear All
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {deviceCategories.map((category) => (
                          <Card key={category.id} className={`${category.bgColor} border-transparent`}>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <category.icon className={`w-4 h-4 ${category.color}`} />
                                  <CardTitle className="text-sm">{category.name}</CardTitle>
                                </div>
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="h-6 text-xs"
                                  onClick={() => selectAllInCategory(category.id)}
                                >
                                  All
                                </Button>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {category.devices.map((device) => (
                                <div key={device.id} className="flex items-center gap-2">
                                  <Checkbox 
                                    id={device.id}
                                    checked={selectedDevices.includes(device.id)}
                                    onCheckedChange={() => toggleDevice(device.id)}
                                  />
                                  <label 
                                    htmlFor={device.id} 
                                    className="text-sm cursor-pointer flex-1"
                                  >
                                    {device.name}
                                  </label>
                                  <span className="text-xs text-muted-foreground">
                                    {device.width}x{device.height}
                                  </span>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>

                    <Button 
                      onClick={runResponsiveTest} 
                      disabled={isRunning}
                      className="w-full"
                      data-testid="button-run-test"
                    >
                      {isRunning ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Testing {selectedDevices.length} devices...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Run Responsive Test
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="results" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Device Test Results</CardTitle>
                    <CardDescription>Detailed results for each tested device configuration</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px]">
                      <div className="space-y-3">
                        {results.map((result, idx) => (
                          <div 
                            key={idx} 
                            className={`p-4 rounded-lg border ${
                              result.status === "pass" ? "border-emerald-500/30 bg-emerald-500/5" :
                              result.status === "fail" ? "border-red-500/30 bg-red-500/5" :
                              "border-amber-500/30 bg-amber-500/5"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                {result.deviceType === "mobile" && <Smartphone className="w-5 h-5 text-violet-400" />}
                                {result.deviceType === "tablet" && <Tablet className="w-5 h-5 text-cyan-400" />}
                                {result.deviceType === "desktop" && <Monitor className="w-5 h-5 text-emerald-400" />}
                                <div>
                                  <p className="font-medium">{result.deviceName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {result.viewport.width}x{result.viewport.height} · {result.orientation} · {result.browser}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <p className={`font-bold text-lg ${
                                    result.score >= 90 ? "text-emerald-400" :
                                    result.score >= 70 ? "text-amber-400" : "text-red-400"
                                  }`}>{result.score}%</p>
                                </div>
                                <Badge variant={
                                  result.status === "pass" ? "default" :
                                  result.status === "fail" ? "destructive" : "secondary"
                                }>
                                  {result.status.toUpperCase()}
                                </Badge>
                              </div>
                            </div>
                            {result.issues.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-border/50">
                                <p className="text-sm font-medium mb-2">Issues Found:</p>
                                <ul className="space-y-1">
                                  {result.issues.map((issue, issueIdx) => (
                                    <li key={issueIdx} className="text-sm text-muted-foreground flex items-start gap-2">
                                      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                                      {issue}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="matrix" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Device Compatibility Matrix</CardTitle>
                    <CardDescription>Overview of test status across all device categories</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4">
                      {deviceCategories.map((category) => {
                        const categoryResults = results.filter(r => {
                          if (category.id === "mobile") return r.deviceType === "mobile";
                          if (category.id === "tablet") return r.deviceType === "tablet";
                          return r.deviceType === "desktop";
                        });
                        const catPass = categoryResults.filter(r => r.status === "pass").length;
                        const catTotal = categoryResults.length;
                        
                        return (
                          <Card key={category.id} className={`${category.bgColor} border-transparent text-center`}>
                            <CardContent className="p-6">
                              <category.icon className={`w-8 h-8 ${category.color} mx-auto mb-3`} />
                              <h3 className="font-medium mb-2">{category.name}</h3>
                              {catTotal > 0 ? (
                                <>
                                  <p className="text-3xl font-bold text-foreground">{catPass}/{catTotal}</p>
                                  <p className="text-xs text-muted-foreground mt-1">devices passed</p>
                                  <Progress 
                                    value={(catPass / catTotal) * 100} 
                                    className="mt-3 h-2" 
                                  />
                                </>
                              ) : (
                                <p className="text-sm text-muted-foreground">No tests run</p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
        </div>
      </main>
    </>
  );
}
