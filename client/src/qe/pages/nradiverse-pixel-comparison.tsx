import { useState, useRef } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { 
  Image, 
  Upload, 
  Play,
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Download,
  Settings,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Layers,
  Activity,
  BarChart3,
  Thermometer,
  Stethoscope,
  Brain,
  FileText,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowLeft
} from "lucide-react";
import { useLocation } from "wouter";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ComparisonMetrics {
  ssim: number;
  psnr: number;
  mse: number;
  diffPercentage: number;
  pixelsDifferent: number;
  totalPixels: number;
  histogramCorrelation: number;
}

interface MedicalAIAnalysis {
  summary: string;
  clinicalFindings: {
    finding: string;
    location: string;
    significance: string;
    changeType: 'improvement' | 'regression' | 'stable' | 'new';
  }[];
  overallAssessment: 'significant_improvement' | 'moderate_improvement' | 'stable' | 'slight_regression' | 'significant_regression';
  recommendations: string[];
  technicalNotes: string;
}

export default function NRadiVersePixelComparisonPage() {
  const [activeTab, setActiveTab] = useState("compare");
  const [image1, setImage1] = useState<string | null>(null);
  const [image2, setImage2] = useState<string | null>(null);
  const [diffImage, setDiffImage] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [metrics, setMetrics] = useState<ComparisonMetrics | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<MedicalAIAnalysis | null>(null);
  const [viewMode, setViewMode] = useState<"side-by-side" | "overlay" | "diff-only">("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState([50]);
  const [threshold, setThreshold] = useState("0.1");
  const [antiAliasing, setAntiAliasing] = useState(true);
  const image1Ref = useRef<HTMLInputElement>(null);
  const image2Ref = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleBack = () => {
    if (metrics) {
      // Clear results and images to go back to upload area for a new set
      setMetrics(null);
      setDiffImage(null);
      setAiAnalysis(null);
      setImage1(null);
      setImage2(null);
      setActiveTab("compare");
      // Reset file input values
      if (image1Ref.current) image1Ref.current.value = "";
      if (image2Ref.current) image2Ref.current.value = "";
      
      toast({
        title: "Reset Complete",
        description: "You can now upload a new set of images for analysis."
      });
    } else {
      // Navigate back to the AI Quality Engine menu
      setLocation("/nradiverse");
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, imageNumber: 1 | 2) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (imageNumber === 1) {
          setImage1(dataUrl);
        } else {
          setImage2(dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const runComparison = async () => {
    if (!image1 || !image2) {
      toast({
        title: "Missing Images",
        description: "Please upload both Before and After treatment images.",
        variant: "destructive"
      });
      return;
    }

    setIsComparing(true);
    setAiAnalysis(null);
    
    try {
      // Step 1: Submit the job — returns immediately with a jobId
      const submitResponse = await fetch("/api/nradiverse/medical-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beforeImage: image1,
          afterImage: image2,
          threshold: parseFloat(threshold),
          antiAliasing,
          medicalContext: true
        })
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to start comparison");
      }

      const { jobId } = await submitResponse.json();
      if (!jobId) throw new Error("No jobId returned from server");

      // Step 2: Poll for results every 2 seconds
      const pollForResult = (): Promise<any> => {
        return new Promise((resolve, reject) => {
          const poll = async () => {
            try {
              const statusResponse = await fetch(`/api/nradiverse/medical-compare/status/${jobId}`);
              if (!statusResponse.ok) {
                const errData = await statusResponse.json().catch(() => ({}));
                reject(new Error(errData.error || "Failed to check analysis status"));
                return;
              }

              const statusData = await statusResponse.json();

              if (statusData.phase === 'processing') {
                // Still working — poll again in 2 seconds
                setTimeout(poll, 2000);
                return;
              }

              if (statusData.phase === 'error') {
                reject(new Error(statusData.error || "Analysis failed on server"));
                return;
              }

              // phase === 'complete' — result is spread into the response
              resolve(statusData);
            } catch (err) {
              reject(err);
            }
          };
          poll();
        });
      };

      const result = await pollForResult();
      setMetrics(result.metrics);
      setDiffImage(result.diffImage);
      setAiAnalysis(result.aiAnalysis);
      
      toast({
        title: "Medical Analysis Complete",
        description: "Radiological comparison and AI analysis finished"
      });
    } catch (error: any) {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze images. Please try again.",
        variant: "destructive"
      });
    }
    
    setIsComparing(false);
  };

  const getScoreColor = (score: number, threshold: number) => {
    if (score >= threshold) return "text-emerald-400";
    if (score >= threshold * 0.8) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <button 
              onClick={handleBack}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border w-fit"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-pixel-comparison">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
                    <Stethoscope className="w-7 h-7 text-cyan-400" />
                  </div>
                  Medical Image Analysis
                </h1>
                <p className="text-muted-foreground mt-1">
                  AI-powered radiological comparison for before/after treatment analysis
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  <Brain className="w-3 h-3 mr-1" />
                  AI-Powered
                </Badge>
              </div>
            </div>

            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                  <CardContent className="p-4 text-center">
                    <Activity className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                    <p className={`text-2xl font-bold ${getScoreColor(metrics.ssim, 0.95)}`}>
                      {metrics.ssim.toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">SSIM Score</p>
                    <p className="text-xs text-muted-foreground mt-1">Target: &gt;0.95</p>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/30">
                  <CardContent className="p-4 text-center">
                    <BarChart3 className="w-6 h-6 text-violet-400 mx-auto mb-2" />
                    <p className={`text-2xl font-bold ${getScoreColor(metrics.psnr, 30)}`}>
                      {metrics.psnr.toFixed(1)} dB
                    </p>
                    <p className="text-xs text-muted-foreground">PSNR</p>
                    <p className="text-xs text-muted-foreground mt-1">Target: &gt;30 dB</p>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
                  <CardContent className="p-4 text-center">
                    <Thermometer className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-amber-400">
                      {metrics.mse.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">MSE</p>
                    <p className="text-xs text-muted-foreground mt-1">Lower is better</p>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/30">
                  <CardContent className="p-4 text-center">
                    <Layers className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                    <p className={`text-2xl font-bold ${metrics.diffPercentage < 1 ? "text-emerald-400" : metrics.diffPercentage < 5 ? "text-amber-400" : "text-red-400"}`}>
                      {metrics.diffPercentage.toFixed(2)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className="text-xs text-muted-foreground mt-1">{metrics.pixelsDifferent.toLocaleString()} px</p>
                  </CardContent>
                </Card>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="bg-card border">
                <TabsTrigger value="compare" data-testid="tab-compare">
                  <Image className="w-4 h-4 mr-2" />
                  Compare
                </TabsTrigger>
                <TabsTrigger value="analysis" data-testid="tab-analysis" disabled={!metrics}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Analysis
                </TabsTrigger>
                <TabsTrigger value="settings" data-testid="tab-settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="compare" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-amber-500/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-amber-400" />
                        Before Treatment
                      </CardTitle>
                      <CardDescription>Upload the initial/pre-treatment medical image (X-ray, CT, MRI)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <input
                        type="file"
                        ref={image1Ref}
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, 1)}
                        data-testid="input-before-image"
                      />
                      {image1 ? (
                        <div className="relative">
                          <Badge className="absolute top-2 left-2 z-10 bg-amber-500/90">Before</Badge>
                          <img 
                            src={image1} 
                            alt="Before Treatment" 
                            className="w-full rounded-lg border border-amber-500/30"
                            data-testid="img-before"
                          />
                          <Button 
                            size="sm" 
                            variant="destructive" 
                            className="absolute top-2 right-2"
                            onClick={() => setImage1(null)}
                            data-testid="button-remove-before"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div 
                          onClick={() => image1Ref.current?.click()}
                          className="border-2 border-dashed border-amber-500/30 rounded-lg p-12 text-center cursor-pointer hover:border-amber-500/50 transition-colors bg-amber-500/5"
                          data-testid="upload-before"
                        >
                          <Upload className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                          <p className="text-foreground font-medium">Upload Before Treatment Image</p>
                          <p className="text-xs text-muted-foreground mt-1">X-ray, CT scan, MRI, or other medical imaging</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-emerald-500/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                        After Treatment
                      </CardTitle>
                      <CardDescription>Upload the follow-up/post-treatment medical image</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <input
                        type="file"
                        ref={image2Ref}
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, 2)}
                        data-testid="input-after-image"
                      />
                      {image2 ? (
                        <div className="relative">
                          <Badge className="absolute top-2 left-2 z-10 bg-emerald-500/90">After</Badge>
                          <img 
                            src={image2} 
                            alt="After Treatment" 
                            className="w-full rounded-lg border border-emerald-500/30"
                            data-testid="img-after"
                          />
                          <Button 
                            size="sm" 
                            variant="destructive" 
                            className="absolute top-2 right-2"
                            onClick={() => setImage2(null)}
                            data-testid="button-remove-after"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div 
                          onClick={() => image2Ref.current?.click()}
                          className="border-2 border-dashed border-emerald-500/30 rounded-lg p-12 text-center cursor-pointer hover:border-emerald-500/50 transition-colors bg-emerald-500/5"
                          data-testid="upload-after"
                        >
                          <Upload className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                          <p className="text-foreground font-medium">Upload After Treatment Image</p>
                          <p className="text-xs text-muted-foreground mt-1">X-ray, CT scan, MRI, or other medical imaging</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Select value={viewMode} onValueChange={(v: "side-by-side" | "overlay" | "diff-only") => setViewMode(v)}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="side-by-side">Side by Side</SelectItem>
                            <SelectItem value="overlay">Overlay</SelectItem>
                            <SelectItem value="diff-only">Difference Only</SelectItem>
                          </SelectContent>
                        </Select>
                        {viewMode === "overlay" && (
                          <div className="flex items-center gap-2 w-48">
                            <span className="text-sm text-muted-foreground">Opacity:</span>
                            <Slider 
                              value={overlayOpacity} 
                              onValueChange={setOverlayOpacity}
                              max={100}
                              step={1}
                            />
                            <span className="text-sm w-8">{overlayOpacity}%</span>
                          </div>
                        )}
                      </div>
                      <Button 
                        onClick={runComparison} 
                        disabled={!image1 || !image2 || isComparing}
                        size="lg"
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                        data-testid="button-compare"
                      >
                        {isComparing ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Analyzing Medical Images...
                          </>
                        ) : (
                          <>
                            <Stethoscope className="w-4 h-4 mr-2" />
                            Analyze & Compare
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {metrics && diffImage && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            {metrics.diffPercentage < 1 ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-400" />
                            )}
                            Comparison Result
                          </CardTitle>
                          <CardDescription>
                            {metrics.diffPercentage < 1 
                              ? "Images are within acceptable tolerance" 
                              : "Significant differences detected"}
                          </CardDescription>
                        </div>
                        <Badge variant={metrics.diffPercentage < 1 ? "default" : "destructive"}>
                          {metrics.diffPercentage < 1 ? "PASS" : "FAIL"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border relative overflow-hidden">
                        {diffImage ? (
                          <img src={diffImage} alt="Difference Map" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <div className="text-center text-muted-foreground">
                            <Layers className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>Difference visualization</p>
                            <p className="text-xs">Red pixels indicate differences</p>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        Red/magenta pixels highlight areas of difference between the two images
                      </p>
                      <div className="flex justify-end gap-2 mt-4">
                        <Button variant="outline" data-testid="button-zoom">
                          <ZoomIn className="w-4 h-4 mr-2" />
                          Zoom
                        </Button>
                        <Button variant="outline" data-testid="button-export">
                          <Download className="w-4 h-4 mr-2" />
                          Export Report
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="analysis" className="space-y-4">
                {metrics && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle>Quality Metrics</CardTitle>
                          <CardDescription>Detailed image quality analysis</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="text-sm">SSIM (Structural Similarity)</span>
                              <span className={`font-bold ${getScoreColor(metrics.ssim, 0.95)}`}>
                                {metrics.ssim.toFixed(4)}
                              </span>
                            </div>
                            <Progress value={metrics.ssim * 100} className="h-2" />
                            
                            <div className="flex justify-between items-center">
                              <span className="text-sm">PSNR (Signal-to-Noise)</span>
                              <span className={`font-bold ${getScoreColor(metrics.psnr, 30)}`}>
                                {metrics.psnr.toFixed(2)} dB
                              </span>
                            </div>
                            <Progress value={Math.min(metrics.psnr / 50 * 100, 100)} className="h-2" />
                            
                            <div className="flex justify-between items-center">
                              <span className="text-sm">Histogram Correlation</span>
                              <span className={`font-bold ${getScoreColor(metrics.histogramCorrelation, 0.9)}`}>
                                {metrics.histogramCorrelation.toFixed(4)}
                              </span>
                            </div>
                            <Progress value={metrics.histogramCorrelation * 100} className="h-2" />
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Pixel Statistics</CardTitle>
                          <CardDescription>Detailed pixel-level comparison data</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-muted/50 text-center">
                              <p className="text-2xl font-bold text-foreground">
                                {metrics.totalPixels.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground">Total Pixels</p>
                            </div>
                            <div className="p-4 rounded-lg bg-muted/50 text-center">
                              <p className="text-2xl font-bold text-red-400">
                                {metrics.pixelsDifferent.toLocaleString()}
                              </p>
                              <p className="text-xs text-muted-foreground">Pixels Different</p>
                            </div>
                            <div className="p-4 rounded-lg bg-muted/50 text-center">
                              <p className="text-2xl font-bold text-amber-400">
                                {metrics.mse.toFixed(2)}
                              </p>
                              <p className="text-xs text-muted-foreground">Mean Squared Error</p>
                            </div>
                            <div className="p-4 rounded-lg bg-muted/50 text-center">
                              <p className={`text-2xl font-bold ${metrics.diffPercentage < 1 ? "text-emerald-400" : "text-red-400"}`}>
                                {metrics.diffPercentage.toFixed(4)}%
                              </p>
                              <p className="text-xs text-muted-foreground">Difference %</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* AI Medical Analysis Section */}
                    {aiAnalysis && (
                      <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Brain className="w-5 h-5 text-cyan-400" />
                            Radiologist AI Interpretation
                          </CardTitle>
                          <CardDescription>
                            AI-powered medical image analysis comparing before and after treatment
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {/* Overall Assessment Badge */}
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">Overall Assessment:</span>
                            <Badge 
                              className={
                                aiAnalysis.overallAssessment === 'significant_improvement' ? 'bg-emerald-500' :
                                aiAnalysis.overallAssessment === 'moderate_improvement' ? 'bg-emerald-400' :
                                aiAnalysis.overallAssessment === 'stable' ? 'bg-blue-500' :
                                aiAnalysis.overallAssessment === 'slight_regression' ? 'bg-amber-500' :
                                'bg-red-500'
                              }
                            >
                              {aiAnalysis.overallAssessment === 'significant_improvement' && <TrendingUp className="w-3 h-3 mr-1" />}
                              {aiAnalysis.overallAssessment === 'moderate_improvement' && <TrendingUp className="w-3 h-3 mr-1" />}
                              {aiAnalysis.overallAssessment === 'stable' && <Activity className="w-3 h-3 mr-1" />}
                              {aiAnalysis.overallAssessment === 'slight_regression' && <TrendingDown className="w-3 h-3 mr-1" />}
                              {aiAnalysis.overallAssessment === 'significant_regression' && <TrendingDown className="w-3 h-3 mr-1" />}
                              {aiAnalysis.overallAssessment.replace(/_/g, ' ').toUpperCase()}
                            </Badge>
                          </div>

                          {/* Summary */}
                          <div className="p-4 rounded-lg bg-background/50 border border-border/50">
                            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              Clinical Summary
                            </h4>
                            <p className="text-sm leading-relaxed">{aiAnalysis.summary}</p>
                          </div>

                          {/* Clinical Findings */}
                          {aiAnalysis.clinicalFindings && aiAnalysis.clinicalFindings.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <Stethoscope className="w-4 h-4 text-cyan-400" />
                                Clinical Findings
                              </h4>
                              <ScrollArea className="h-[250px]">
                                <div className="space-y-3">
                                  {aiAnalysis.clinicalFindings.map((finding, idx) => (
                                    <div key={idx} className="p-3 rounded-lg border border-border/50 bg-muted/30">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium">{finding.finding}</span>
                                            <Badge 
                                              variant="outline" 
                                              className={
                                                finding.changeType === 'improvement' ? 'text-emerald-400 border-emerald-400/50' :
                                                finding.changeType === 'regression' ? 'text-red-400 border-red-400/50' :
                                                finding.changeType === 'new' ? 'text-amber-400 border-amber-400/50' :
                                                'text-blue-400 border-blue-400/50'
                                              }
                                            >
                                              {finding.changeType === 'improvement' && <TrendingUp className="w-3 h-3 mr-1" />}
                                              {finding.changeType === 'regression' && <TrendingDown className="w-3 h-3 mr-1" />}
                                              {finding.changeType === 'new' && <AlertTriangle className="w-3 h-3 mr-1" />}
                                              {finding.changeType}
                                            </Badge>
                                          </div>
                                          <p className="text-xs text-muted-foreground mb-1">
                                            <span className="font-medium">Location:</span> {finding.location}
                                          </p>
                                          <p className="text-sm">{finding.significance}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          )}

                          {/* Recommendations */}
                          {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                            <div>
                              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                Recommendations
                              </h4>
                              <div className="space-y-2">
                                {aiAnalysis.recommendations.map((rec, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-sm">{rec}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Technical Notes */}
                          {aiAnalysis.technicalNotes && (
                            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                              <h4 className="text-xs font-medium mb-1 text-muted-foreground">Technical Notes</h4>
                              <p className="text-xs text-muted-foreground">{aiAnalysis.technicalNotes}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {!aiAnalysis && (
                      <Card className="border-dashed">
                        <CardContent className="p-8 text-center">
                          <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                          <p className="text-muted-foreground">AI medical analysis will appear here after comparison</p>
                          <p className="text-xs text-muted-foreground mt-1">Upload both images and click "Analyze & Compare"</p>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Comparison Settings</CardTitle>
                    <CardDescription>Configure pixel comparison parameters</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label>Difference Threshold</Label>
                        <Select value={threshold} onValueChange={setThreshold}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0.01">0.01 (Exact match)</SelectItem>
                            <SelectItem value="0.05">0.05 (Strict)</SelectItem>
                            <SelectItem value="0.1">0.1 (Standard)</SelectItem>
                            <SelectItem value="0.5">0.5 (Lenient)</SelectItem>
                            <SelectItem value="1">1.0 (Very Lenient)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Tolerance for pixel color differences (0-1 scale)
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Anti-Aliasing Detection</Label>
                        <Select 
                          value={antiAliasing ? "enabled" : "disabled"} 
                          onValueChange={(v) => setAntiAliasing(v === "enabled")}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="enabled">Enabled</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Ignore anti-aliased pixels in comparison
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                      <h4 className="font-medium mb-2">Quality Thresholds</h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">SSIM Pass</p>
                          <p className="font-medium">&gt; 0.95</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">PSNR Pass</p>
                          <p className="font-medium">&gt; 30 dB</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Diff Pass</p>
                          <p className="font-medium">&lt; 1%</p>
                        </div>
                      </div>
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
