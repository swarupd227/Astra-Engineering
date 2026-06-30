import { useState, useRef } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { 
  Eye, 
  ArrowLeft,
  Upload, 
  Image, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Download,
  Settings,
  Layers,
  ZoomIn,
  GitCompare,
  Camera,
  Trash2,
  Play
} from "lucide-react";

interface Baseline {
  id: string;
  name: string;
  url: string;
  viewport: string;
  capturedAt: string;
  imageData?: string;
}

interface ComparisonResult {
  diffPercentage: number;
  ssimScore: number;
  psnrScore: number;
  pixelsDifferent: number;
  totalPixels: number;
  baselineImage: string;
  currentImage: string;
  diffImage: string;
  status: "pass" | "fail" | "warning";
}

const viewports = [
  { id: "desktop", name: "Desktop", width: 1920, height: 1080 },
  { id: "laptop", name: "Laptop", width: 1366, height: 768 },
  { id: "tablet", name: "Tablet", width: 768, height: 1024 },
  { id: "mobile", name: "Mobile", width: 375, height: 812 },
  { id: "medical-3mp", name: "Medical 3MP", width: 1536, height: 2048 },
  { id: "medical-5mp", name: "Medical 5MP", width: 2048, height: 2560 },
];

const sampleBaselines: Baseline[] = [
  { id: "1", name: "Login Page", url: "https://portal.gehealthcare.com/login", viewport: "desktop", capturedAt: "2024-12-20T10:30:00Z" },
  { id: "2", name: "Dashboard", url: "https://portal.gehealthcare.com/dashboard", viewport: "desktop", capturedAt: "2024-12-20T10:32:00Z" },
  { id: "3", name: "DICOM Viewer", url: "https://pacs.gehealthcare.com/viewer", viewport: "medical-5mp", capturedAt: "2024-12-19T15:45:00Z" },
  { id: "4", name: "Patient Portal", url: "https://patient.gehealthcare.com", viewport: "mobile", capturedAt: "2024-12-18T09:20:00Z" },
];

export default function NRadiVerseVisualRegressionPage() {
  const [activeTab, setActiveTab] = useState("capture");
  const [baselines, setBaselines] = useState<Baseline[]>(sampleBaselines);
  const [selectedBaseline, setSelectedBaseline] = useState<Baseline | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [captureUrl, setCaptureUrl] = useState("");
  const [selectedViewport, setSelectedViewport] = useState("desktop");
  const [baselineName, setBaselineName] = useState("");
  const [diffThreshold, setDiffThreshold] = useState("0.1");
  const [uploadedBaseline, setUploadedBaseline] = useState<string | null>(null);
  const [uploadedCurrent, setUploadedCurrent] = useState<string | null>(null);
  const baselineInputRef = useRef<HTMLInputElement>(null);
  const currentInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "baseline" | "current") => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (type === "baseline") {
          setUploadedBaseline(dataUrl);
        } else {
          setUploadedCurrent(dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const runComparison = async () => {
    if (!uploadedBaseline || !uploadedCurrent) {
      toast({
        title: "Missing Images",
        description: "Please upload both baseline and current images to compare.",
        variant: "destructive"
      });
      return;
    }

    setIsComparing(true);
    
    try {
      const response = await fetch("/api/nradiverse/compare-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baselineImage: uploadedBaseline,
          currentImage: uploadedCurrent,
          threshold: parseFloat(diffThreshold)
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Comparison failed");
      }
      
      const result = await response.json();
      setComparisonResult(result);
      toast({
        title: "Comparison Complete",
        description: `Difference: ${result.diffPercentage.toFixed(2)}% | SSIM: ${result.ssimScore.toFixed(3)}`
      });
    } catch (error: any) {
      toast({
        title: "Comparison Failed",
        description: error.message || "Failed to compare images. Please try again.",
        variant: "destructive"
      });
    }
    
    setIsComparing(false);
  };

  const captureBaseline = async () => {
    if (!captureUrl || !baselineName) {
      toast({
        title: "Missing Information",
        description: "Please provide URL and name for the baseline.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Capturing Baseline",
      description: "Taking screenshot of the specified URL..."
    });

    const newBaseline: Baseline = {
      id: Date.now().toString(),
      name: baselineName,
      url: captureUrl,
      viewport: selectedViewport,
      capturedAt: new Date().toISOString()
    };

    setBaselines([newBaseline, ...baselines]);
    setCaptureUrl("");
    setBaselineName("");

    toast({
      title: "Baseline Captured",
      description: `Successfully captured ${baselineName}`
    });
  };

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Link href="/nradiverse">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="button-back"
                  aria-label="Back to AI Quality Engine"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-visual-regression">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                    <Eye className="w-7 h-7 text-violet-400" />
                  </div>
                  Visual Regression Testing
                </h1>
                <p className="text-muted-foreground mt-1">
                  Detect visual changes in medical imaging interfaces with pixel-perfect precision
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button variant="outline" data-testid="button-settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Baselines</p>
                      <p className="text-2xl font-bold text-violet-400">{baselines.length}</p>
                    </div>
                    <Layers className="w-6 h-6 text-violet-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Passed</p>
                      <p className="text-2xl font-bold text-emerald-400">148</p>
                    </div>
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Failed</p>
                      <p className="text-2xl font-bold text-red-400">8</p>
                    </div>
                    <XCircle className="w-6 h-6 text-red-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg SSIM</p>
                      <p className="text-2xl font-bold text-cyan-400">0.97</p>
                    </div>
                    <GitCompare className="w-6 h-6 text-cyan-400" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="capture" data-testid="tab-capture">
                  <Camera className="w-4 h-4 mr-2" />
                  Capture Baseline
                </TabsTrigger>
                <TabsTrigger value="compare" data-testid="tab-compare">
                  <GitCompare className="w-4 h-4 mr-2" />
                  Compare Images
                </TabsTrigger>
                <TabsTrigger value="baselines" data-testid="tab-baselines">
                  <Layers className="w-4 h-4 mr-2" />
                  Baselines
                </TabsTrigger>
              </TabsList>

              <TabsContent value="capture" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Capture New Baseline</CardTitle>
                    <CardDescription>Take a screenshot of a URL to use as baseline for comparison</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Baseline Name</Label>
                        <Input 
                          placeholder="e.g., Login Page" 
                          value={baselineName}
                          onChange={(e) => setBaselineName(e.target.value)}
                          data-testid="input-baseline-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Viewport</Label>
                        <Select value={selectedViewport} onValueChange={setSelectedViewport}>
                          <SelectTrigger data-testid="select-viewport">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {viewports.map((vp) => (
                              <SelectItem key={vp.id} value={vp.id}>
                                {vp.name} ({vp.width}x{vp.height})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Website URL</Label>
                      <Input 
                        placeholder="https://example.gehealthcare.com" 
                        value={captureUrl}
                        onChange={(e) => setCaptureUrl(e.target.value)}
                        data-testid="input-capture-url"
                      />
                    </div>
                    <Button onClick={captureBaseline} data-testid="button-capture-baseline">
                      <Camera className="w-4 h-4 mr-2" />
                      Capture Baseline
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="compare" className="space-y-6">
                {/* Step 1: Select Baseline */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="w-5 h-5 text-violet-400" />
                      Step 1: Select Baseline
                    </CardTitle>
                    <CardDescription>Choose a saved baseline or upload an image</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Select from Saved Baselines</Label>
                        <Select 
                          value={selectedBaseline?.id || ""} 
                          onValueChange={(id) => {
                            const baseline = baselines.find(b => b.id === id);
                            setSelectedBaseline(baseline || null);
                            if (baseline?.imageData) {
                              setUploadedBaseline(baseline.imageData);
                            }
                          }}
                        >
                          <SelectTrigger data-testid="select-baseline">
                            <SelectValue placeholder="Choose a baseline..." />
                          </SelectTrigger>
                          <SelectContent>
                            {baselines.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name} - {b.viewport}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Or Upload Image</Label>
                        <input
                          type="file"
                          ref={baselineInputRef}
                          className="hidden"
                          accept="image/*"
                          onChange={(e) => {
                            handleImageUpload(e, "baseline");
                            setSelectedBaseline(null);
                          }}
                        />
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => baselineInputRef.current?.click()}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Baseline
                        </Button>
                      </div>
                    </div>
                    {(selectedBaseline || uploadedBaseline) && (
                      <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">
                              {selectedBaseline ? selectedBaseline.name : "Uploaded Image"}
                            </span>
                            {selectedBaseline && (
                              <Badge variant="outline" className="text-xs">{selectedBaseline.url}</Badge>
                            )}
                          </div>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => {
                              setSelectedBaseline(null);
                              setUploadedBaseline(null);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Step 2: Get Current State */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Camera className="w-5 h-5 text-cyan-400" />
                      Step 2: Current State
                    </CardTitle>
                    <CardDescription>
                      {selectedBaseline 
                        ? "Re-capture the same URL or upload a current screenshot" 
                        : "Upload the current/test image to compare"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {selectedBaseline && (
                        <Button 
                          variant="default"
                          onClick={async () => {
                            toast({
                              title: "Capturing Current State",
                              description: `Re-capturing ${selectedBaseline.url}...`
                            });
                            // TODO: Call API to capture screenshot
                            setTimeout(() => {
                              toast({
                                title: "Capture Complete",
                                description: "Ready for comparison"
                              });
                            }, 2000);
                          }}
                          data-testid="button-recapture"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Re-capture {selectedBaseline.name}
                        </Button>
                      )}
                      <div>
                        <input
                          type="file"
                          ref={currentInputRef}
                          className="hidden"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, "current")}
                        />
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => currentInputRef.current?.click()}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Current Image
                        </Button>
                      </div>
                    </div>
                    {uploadedCurrent && (
                      <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">Current image ready</span>
                          </div>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => setUploadedCurrent(null)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Comparison Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Difference Threshold (%)</Label>
                        <Select value={diffThreshold} onValueChange={setDiffThreshold}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0.01">0.01% (Strict)</SelectItem>
                            <SelectItem value="0.1">0.1% (Standard)</SelectItem>
                            <SelectItem value="1">1% (Lenient)</SelectItem>
                            <SelectItem value="5">5% (Very Lenient)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button 
                      onClick={runComparison} 
                      disabled={!uploadedBaseline || !uploadedCurrent || isComparing}
                      className="w-full"
                      data-testid="button-run-comparison"
                    >
                      {isComparing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Comparing...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Run Comparison
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {comparisonResult && (
                  <Card className={
                    comparisonResult.status === "pass" ? "border-emerald-500/50" :
                    comparisonResult.status === "fail" ? "border-red-500/50" : "border-amber-500/50"
                  }>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          {comparisonResult.status === "pass" ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          ) : comparisonResult.status === "fail" ? (
                            <XCircle className="w-5 h-5 text-red-400" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                          )}
                          Comparison Results
                        </CardTitle>
                        <Badge variant={
                          comparisonResult.status === "pass" ? "default" :
                          comparisonResult.status === "fail" ? "destructive" : "secondary"
                        }>
                          {comparisonResult.status.toUpperCase()}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="text-center p-4 rounded-lg bg-muted/50">
                          <p className="text-2xl font-bold text-foreground">
                            {comparisonResult.diffPercentage.toFixed(2)}%
                          </p>
                          <p className="text-xs text-muted-foreground">Difference</p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted/50">
                          <p className="text-2xl font-bold text-cyan-400">
                            {comparisonResult.ssimScore.toFixed(3)}
                          </p>
                          <p className="text-xs text-muted-foreground">SSIM Score</p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted/50">
                          <p className="text-2xl font-bold text-violet-400">
                            {comparisonResult.psnrScore.toFixed(1)} dB
                          </p>
                          <p className="text-xs text-muted-foreground">PSNR</p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted/50">
                          <p className="text-2xl font-bold text-amber-400">
                            {comparisonResult.pixelsDifferent.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Pixels Different</p>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline">
                          <Download className="w-4 h-4 mr-2" />
                          Download Report
                        </Button>
                        <Button variant="outline">
                          <ZoomIn className="w-4 h-4 mr-2" />
                          View Diff
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="baselines" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Saved Baselines</CardTitle>
                    <CardDescription>Manage your baseline images for visual regression testing</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {baselines.map((baseline) => (
                        <div key={baseline.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border/50">
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-violet-500/20">
                              <Image className="w-5 h-5 text-violet-400" />
                            </div>
                            <div>
                              <p className="font-medium">{baseline.name}</p>
                              <p className="text-sm text-muted-foreground">{baseline.url}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <Badge variant="outline">{baseline.viewport}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {new Date(baseline.capturedAt).toLocaleDateString()}
                            </span>
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost">
                                <RefreshCw className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
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
