import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { PDFComparisonViewer } from "@/components/pdf-viewer";
import { ValidationReportPDF } from "@/components/validation-report-pdf";
import { pdf } from '@react-pdf/renderer';
import {
  ArrowLeft,
  FileSpreadsheet,
  Upload,
  FolderOpen,
  FileText,
  FileCheck,
  X,
  Eye,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Brain,
  Loader2,
  Download,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Columns,
  Table,
  BarChart3,
  Clock,
  Sparkles,
  FileImage,
  History,
  Trash2
} from "lucide-react";

interface FileInfo {
  name: string;
  size: number;
  type: 'excel' | 'pdf';
  file: File;
  preview?: any;
}

interface ValidationStage {
  id: string;
  name: string;
  icon: any;
  status: 'pending' | 'active' | 'complete' | 'error';
  progress: number;
  subStatus: string;
}

interface ValidationConfig {
  comparisonMode: 'strict' | 'tolerant' | 'smart';
  numericTolerance: number;
  percentageTolerance: number;
  dateHandling: 'strict' | 'flexible';
  ignoreColumns: string;
  caseSensitive: boolean;
  whitespaceHandling: 'strict' | 'trim' | 'normalize';
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface CellDifference {
  row: number;
  column: string;
  sourceValue: string;
  targetValue: string;
  difference: string;
  percentDiff?: number;
  status: 'exact' | 'tolerance' | 'mismatch';
  aiAnalysis?: string;
}

interface HistoryItem {
  id: string;
  sourceFilename: string;
  targetFilename: string;
  sourceFileType: string;
  targetFileType: string;
  status: string;
  result: string;
  matchPercentage: number;
  summary: any;
  aiAnalysis: string | null;
  createdAt: string;
}

interface ValidationResult {
  status: 'pass' | 'fail' | 'warning';
  matchPercentage: number;
  summary: {
    totalCells: number;
    matchedCells: number;
    toleranceCells: number;
    mismatchedCells: number;
    sourceRowCount: number;
    targetRowCount: number;
    sourceColumnCount: number;
    targetColumnCount: number;
    criticalIssues: number;
    warnings: number;
  };
  differences: CellDifference[];
  aiAnalysis?: string;
  sourcePreview?: Record<string, any>[];
  targetPreview?: Record<string, any>[];
}

export default function NRadiVerseSSRSPowerBIPage() {
  const { toast } = useToast();
  
  // File state
  const [sourceFile, setSourceFile] = useState<FileInfo | null>(null);
  const [targetFile, setTargetFile] = useState<FileInfo | null>(null);
  const [sourceInputMode, setSourceInputMode] = useState<'upload' | 'path'>('upload');
  const [targetInputMode, setTargetInputMode] = useState<'upload' | 'path'>('upload');
  const [sourcePath, setSourcePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  
  // Validation config
  const [config, setConfig] = useState<ValidationConfig>({
    comparisonMode: 'tolerant',
    numericTolerance: 0.01,
    percentageTolerance: 0.1,
    dateHandling: 'flexible',
    ignoreColumns: '',
    caseSensitive: false,
    whitespaceHandling: 'trim'
  });
  
  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationComplete, setValidationComplete] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [stages, setStages] = useState<ValidationStage[]>([
    { id: 'parsing', name: 'File Parsing', icon: FileText, status: 'pending', progress: 0, subStatus: 'Waiting...' },
    { id: 'extraction', name: 'Data Extraction', icon: Table, status: 'pending', progress: 0, subStatus: 'Waiting...' },
    { id: 'analysis', name: 'AI Analysis', icon: Brain, status: 'pending', progress: 0, subStatus: 'Waiting...' },
    { id: 'comparison', name: 'Comparison', icon: Columns, status: 'pending', progress: 0, subStatus: 'Waiting...' },
    { id: 'report', name: 'Report Generation', icon: FileCheck, status: 'pending', progress: 0, subStatus: 'Waiting...' }
  ]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  
  // Side-by-side viewer state
  const [showViewer, setShowViewer] = useState(false);
  const [viewerMode, setViewerMode] = useState<'data' | 'pdf'>('data');
  const [currentDiffIndex, setCurrentDiffIndex] = useState(0);
  
  // History state
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();
  
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  
  // Fetch validation history with React Query
  const { data: historyData, isLoading: loadingHistory, refetch: fetchHistory } = useQuery<{ success: boolean; validations: HistoryItem[] }>({
    queryKey: ['/api/nradiverse/ssrs-powerbi/history'],
    enabled: showHistory,
  });
  const historyItems = historyData?.validations || [];
  
  // Save validation to history mutation
  const saveHistoryMutation = useMutation({
    mutationFn: async (data: { result: ValidationResult; srcFile: FileInfo; tgtFile: FileInfo }) => {
      return apiRequest('POST', '/api/nradiverse/ssrs-powerbi/history', {
        sourceFilename: data.srcFile.name,
        targetFilename: data.tgtFile.name,
        sourceFileType: data.srcFile.type,
        targetFileType: data.tgtFile.type,
        result: data.result.status,
        matchPercentage: data.result.matchPercentage,
        config,
        summary: data.result.summary,
        aiAnalysis: data.result.aiAnalysis,
        differences: data.result.differences
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nradiverse/ssrs-powerbi/history'] });
      console.log('Validation saved to history');
    },
    onError: (error) => {
      console.error('Failed to save to history:', error);
    }
  });
  
  const saveToHistory = (result: ValidationResult, srcFile: FileInfo, tgtFile: FileInfo) => {
    saveHistoryMutation.mutate({ result, srcFile, tgtFile });
  };
  
  // Delete validation from history mutation
  const deleteHistoryMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/nradiverse/ssrs-powerbi/history/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nradiverse/ssrs-powerbi/history'] });
      toast({ title: "Deleted", description: "Validation removed from history." });
    },
    onError: (error) => {
      console.error('Failed to delete:', error);
    }
  });
  
  const deleteFromHistory = (id: string) => {
    deleteHistoryMutation.mutate(id);
  };
  
  // Download report for history item
  const downloadHistoryReport = async (item: HistoryItem) => {
    try {
      toast({ title: "Generating PDF Report", description: "Please wait while we generate your report..." });
      
      // Fetch full details including differences
      const response = await fetch(`/api/nradiverse/ssrs-powerbi/history/${item.id}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error('Failed to fetch validation details');
      }
      
      const differences = data.differences.map((d: any) => ({
        row: d.rowNumber,
        column: d.columnName,
        sourceValue: d.sourceValue,
        targetValue: d.targetValue,
        difference: d.difference,
        percentDiff: d.percentDiff ? parseFloat(d.percentDiff) : undefined,
        status: d.matchStatus,
        aiAnalysis: d.aiAnalysis
      }));
      
      const generatedAt = new Date(item.createdAt).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const validationResultForPDF: ValidationResult = {
        status: item.result as any,
        matchPercentage: item.matchPercentage,
        summary: item.summary,
        differences,
        aiAnalysis: item.aiAnalysis || undefined
      };
      
      const pdfDoc = (
        <ValidationReportPDF
          sourceFileName={item.sourceFilename}
          targetFileName={item.targetFilename}
          validationResult={validationResultForPDF}
          generatedAt={generatedAt}
        />
      );
      
      const blob = await pdf(pdfDoc).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAT2.0_Validation_Report_${item.id.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({ title: "Report Downloaded", description: "Your PDF report has been downloaded successfully." });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({ title: "Error", description: "Failed to generate PDF report. Please try again.", variant: "destructive" });
    }
  };
  
  // Load history on mount and when showing history
  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory]);
  
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadPDFReport = async () => {
    if (!validationResult || !sourceFile || !targetFile) return;
    
    try {
      toast({ title: "Generating PDF Report", description: "Please wait while we generate your report..." });
      
      const generatedAt = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const pdfDoc = (
        <ValidationReportPDF
          sourceFileName={sourceFile.name}
          targetFileName={targetFile.name}
          validationResult={validationResult}
          generatedAt={generatedAt}
        />
      );
      
      const blob = await pdf(pdfDoc).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NAT2.0_Validation_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({ title: "Report Downloaded", description: "Your PDF report has been downloaded successfully." });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({ title: "Error", description: "Failed to generate PDF report. Please try again.", variant: "destructive" });
    }
  };
  
  const getFileType = (file: File): 'excel' | 'pdf' | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'pdf') return 'pdf';
    return null;
  };
  
  const handleFileDrop = useCallback((e: React.DragEvent, target: 'source' | 'target') => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    
    const fileType = getFileType(file);
    if (!fileType) {
      toast({ title: "Invalid file type", description: "Please upload Excel (.xlsx, .xls) or PDF files", variant: "destructive" });
      return;
    }
    
    const fileInfo: FileInfo = {
      name: file.name,
      size: file.size,
      type: fileType,
      file
    };
    
    if (target === 'source') {
      setSourceFile(fileInfo);
    } else {
      setTargetFile(fileInfo);
    }
  }, [toast]);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, target: 'source' | 'target') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const fileType = getFileType(file);
    if (!fileType) {
      toast({ title: "Invalid file type", description: "Please upload Excel (.xlsx, .xls) or PDF files", variant: "destructive" });
      return;
    }
    
    const fileInfo: FileInfo = {
      name: file.name,
      size: file.size,
      type: fileType,
      file
    };
    
    if (target === 'source') {
      setSourceFile(fileInfo);
    } else {
      setTargetFile(fileInfo);
    }
  };
  
  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, { timestamp, type, message }]);
  };
  
  const updateStage = (stageId: string, updates: Partial<ValidationStage>) => {
    setStages(prev => prev.map(s => s.id === stageId ? { ...s, ...updates } : s));
  };
  
  const runValidation = async () => {
    if (!sourceFile || !targetFile) {
      toast({ title: "Missing files", description: "Please upload both source and target files", variant: "destructive" });
      return;
    }
    
    setIsValidating(true);
    setValidationComplete(false);
    setValidationResult(null);
    setLogs([]);
    setOverallProgress(0);
    
    // Reset stages
    setStages(prev => prev.map(s => ({ ...s, status: 'pending', progress: 0, subStatus: 'Waiting...' })));
    
    try {
      // Stage 1: File Parsing - Upload files
      updateStage('parsing', { status: 'active', subStatus: `Uploading ${sourceFile.name}...` });
      addLog('info', `Uploading SSRS report: ${sourceFile.name}`);
      
      // Simulate progress for upload stage
      for (let i = 0; i <= 50; i += 10) {
        await new Promise(r => setTimeout(r, 50));
        updateStage('parsing', { progress: i });
        setOverallProgress(i * 0.2);
      }
      
      addLog('info', `Uploading PowerBI report: ${targetFile.name}`);
      
      for (let i = 50; i <= 100; i += 10) {
        await new Promise(r => setTimeout(r, 50));
        updateStage('parsing', { progress: i });
        setOverallProgress(i * 0.2);
      }
      
      updateStage('parsing', { status: 'complete', progress: 100, subStatus: 'Complete' });
      addLog('success', 'Files uploaded successfully');
      
      // Stage 2: Data Extraction - Start API call
      updateStage('extraction', { status: 'active', subStatus: 'Extracting data...' });
      addLog('info', 'Sending files to backend for parsing...');
      
      // Create FormData with files and config
      const formData = new FormData();
      formData.append('sourceFile', sourceFile.file);
      formData.append('targetFile', targetFile.file);
      formData.append('config', JSON.stringify(config));
      
      // Start API call and simulate progress
      const apiPromise = fetch('/api/nradiverse/ssrs-powerbi/validate', {
        method: 'POST',
        body: formData
      });
      
      // Simulate extraction progress
      for (let i = 0; i <= 100; i += 5) {
        await new Promise(r => setTimeout(r, 100));
        updateStage('extraction', { progress: i, subStatus: `Extracting data... ${i}%` });
        setOverallProgress(20 + i * 0.2);
      }
      
      updateStage('extraction', { status: 'complete', progress: 100, subStatus: 'Complete' });
      addLog('success', 'Data extraction complete');
      
      // Stage 3: AI Analysis
      updateStage('analysis', { status: 'active', subStatus: 'Analyzing structure...' });
      addLog('info', 'Analyzing report structure and patterns...');
      
      for (let i = 0; i <= 100; i += 8) {
        await new Promise(r => setTimeout(r, 80));
        updateStage('analysis', { progress: i, subStatus: i < 50 ? 'Detecting patterns...' : 'Mapping columns...' });
        setOverallProgress(40 + i * 0.2);
      }
      
      updateStage('analysis', { status: 'complete', progress: 100, subStatus: 'Complete' });
      addLog('success', 'Structure analysis complete');
      
      // Stage 4: Comparison - Wait for API response
      updateStage('comparison', { status: 'active', subStatus: 'Comparing cells...' });
      addLog('info', 'Starting cell-by-cell comparison...');
      
      // Wait for API response
      const response = await apiPromise;
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Validation failed');
      }
      
      const result = data.result;
      
      updateStage('comparison', { progress: 100, subStatus: 'Complete' });
      setOverallProgress(80);
      
      // Log actual results
      if (result.summary.sourceRowCount === result.summary.targetRowCount) {
        addLog('success', `Row count matches: ${result.summary.sourceRowCount.toLocaleString()} rows ✓`);
      } else {
        addLog('warning', `Row count mismatch: ${result.summary.sourceRowCount} vs ${result.summary.targetRowCount}`);
      }
      
      if (result.summary.toleranceCells > 0) {
        addLog('warning', `${result.summary.toleranceCells} cells differ within tolerance`);
      }
      
      if (result.summary.mismatchedCells > 0) {
        addLog('warning', `${result.summary.mismatchedCells} cells have significant differences`);
      }
      
      addLog('success', `${result.summary.matchedCells.toLocaleString()} exact matches found`);
      updateStage('comparison', { status: 'complete', progress: 100, subStatus: 'Complete' });
      
      // Stage 5: Report Generation
      updateStage('report', { status: 'active', subStatus: 'Generating report...' });
      addLog('info', 'Generating detailed validation report...');
      
      for (let i = 0; i <= 100; i += 15) {
        await new Promise(r => setTimeout(r, 60));
        updateStage('report', { progress: i });
        setOverallProgress(80 + i * 0.2);
      }
      
      addLog('success', 'Validation report generated successfully');
      updateStage('report', { status: 'complete', progress: 100, subStatus: 'Complete' });
      setOverallProgress(100);
      
      setValidationResult(result);
      setValidationComplete(true);
      
      // Auto-save to history
      if (sourceFile && targetFile) {
        saveToHistory(result, sourceFile, targetFile);
      }
      
      toast({ 
        title: "Validation Complete", 
        description: `${result.matchPercentage}% match rate - ${result.differences.length} differences found`
      });
      
    } catch (error: any) {
      console.error('Validation error:', error);
      addLog('error', `Validation failed: ${error.message}`);
      
      // Mark current active stage as error
      setStages(prev => prev.map(s => 
        s.status === 'active' ? { ...s, status: 'error', subStatus: 'Failed' } : s
      ));
      
      toast({ 
        title: "Validation Failed", 
        description: error.message || "Failed to compare files", 
        variant: "destructive" 
      });
    } finally {
      setIsValidating(false);
    }
  };
  
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);
  
  const CircularProgress = ({ stage }: { stage: ValidationStage }) => {
    const circumference = 2 * Math.PI * 35;
    const offset = circumference - (stage.progress / 100) * circumference;
    const IconComponent = stage.icon;
    
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 transform -rotate-90">
            <circle
              cx="40"
              cy="40"
              r="35"
              className="stroke-muted fill-none"
              strokeWidth="6"
            />
            <circle
              cx="40"
              cy="40"
              r="35"
              className={`fill-none transition-all duration-300 ${
                stage.status === 'complete' ? 'stroke-emerald-500' :
                stage.status === 'error' ? 'stroke-red-500' :
                stage.status === 'active' ? 'stroke-cyan-500' : 'stroke-muted-foreground/30'
              }`}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{
                filter: stage.status === 'active' ? 'drop-shadow(0 0 8px rgba(0, 212, 170, 0.6))' : 'none'
              }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {stage.status === 'complete' ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            ) : stage.status === 'error' ? (
              <XCircle className="w-6 h-6 text-red-500" />
            ) : stage.status === 'active' ? (
              <IconComponent className="w-6 h-6 text-cyan-400 animate-pulse" />
            ) : (
              <IconComponent className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{stage.name}</p>
          <p className="text-xs text-muted-foreground">{stage.progress}%</p>
        </div>
        <p className="text-xs text-muted-foreground text-center max-w-[120px] truncate">{stage.subStatus}</p>
      </div>
    );
  };
  
  const FileUploadZone = ({ 
    target, 
    file, 
    inputMode, 
    path, 
    onModeChange, 
    onPathChange, 
    inputRef 
  }: { 
    target: 'source' | 'target';
    file: FileInfo | null;
    inputMode: 'upload' | 'path';
    path: string;
    onModeChange: (mode: 'upload' | 'path') => void;
    onPathChange: (path: string) => void;
    inputRef: React.RefObject<HTMLInputElement>;
  }) => (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {target === 'source' ? (
            <>
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">SSRS</Badge>
              Source Report
            </>
          ) : (
            <>
              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">PowerBI</Badge>
              Target Report
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={inputMode} onValueChange={(v) => onModeChange(v as 'upload' | 'path')}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="upload" className="text-xs">
              <Upload className="w-3 h-3 mr-1" />
              Upload File
            </TabsTrigger>
            <TabsTrigger value="path" className="text-xs">
              <FolderOpen className="w-3 h-3 mr-1" />
              Local Path
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="upload">
            {file ? (
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${file.type === 'excel' ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                      <FileSpreadsheet className={`w-5 h-5 ${file.type === 'excel' ? 'text-emerald-400' : 'text-red-400'}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)} • {file.type.toUpperCase()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-preview-${target}`}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-red-400 hover:text-red-300"
                      onClick={() => target === 'source' ? setSourceFile(null) : setTargetFile(null)}
                      data-testid={`button-remove-${target}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleFileDrop(e, target)}
                onClick={() => inputRef.current?.click()}
                data-testid={`dropzone-${target}`}
              >
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drop {target === 'source' ? 'SSRS' : 'PowerBI'} export here or click to browse
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Badge variant="secondary" className="text-xs">Excel (.xlsx, .xls)</Badge>
                  <Badge variant="secondary" className="text-xs">PDF (.pdf)</Badge>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.pdf"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, target)}
                  data-testid={`input-file-${target}`}
                />
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="path">
            <div className="space-y-3">
              <Input
                placeholder={`C:\\Reports\\${target === 'source' ? 'SSRS' : 'PowerBI'}\\Report_2024.xlsx`}
                value={path}
                onChange={(e) => onPathChange(e.target.value)}
                data-testid={`input-path-${target}`}
              />
              <Button variant="outline" className="w-full" data-testid={`button-load-${target}`}>
                Load File
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );

  return (
    <>
      <DashboardHeader />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Link href="/nradiverse">
                <Button variant="ghost" size="icon" data-testid="button-back">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-ssrs-powerbi">
                  <div className="p-2 rounded-lg bg-orange-500/20">
                    <FileSpreadsheet className="w-7 h-7 text-orange-400" />
                  </div>
                  SSRS to PowerBI Migration Validator
                </h1>
                <p className="text-muted-foreground mt-1">
                  Compare SSRS exports against PowerBI equivalents with AI-powered analysis
                </p>
              </div>
              <Button
                variant={showHistory ? "default" : "outline"}
                onClick={() => setShowHistory(!showHistory)}
                data-testid="button-toggle-history"
              >
                <History className="w-4 h-4 mr-2" />
                {showHistory ? "Hide History" : "View History"}
              </Button>
            </div>
            
            {/* History Panel */}
            {showHistory && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <History className="w-5 h-5" />
                        Validation History
                      </CardTitle>
                      <CardDescription>View and download previous validation reports</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => fetchHistory()} data-testid="button-refresh-history">
                      <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : historyItems.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No validation history yet</p>
                      <p className="text-sm">Run a validation to see it here</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {historyItems.map((item) => (
                        <div 
                          key={item.id} 
                          className="flex items-center justify-between p-4 rounded-lg border bg-card hover-elevate"
                          data-testid={`history-item-${item.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <Badge 
                                variant={
                                  item.result === 'pass' ? 'default' : 
                                  item.result === 'warning' ? 'secondary' : 'destructive'
                                }
                                className={
                                  item.result === 'pass' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                  item.result === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                  'bg-red-500/20 text-red-400 border-red-500/30'
                                }
                              >
                                {item.matchPercentage}% Match
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(item.createdAt).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium truncate max-w-[200px]" title={item.sourceFilename}>
                                {item.sourceFilename}
                              </span>
                              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="font-medium truncate max-w-[200px]" title={item.targetFilename}>
                                {item.targetFilename}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => downloadHistoryReport(item)}
                              data-testid={`button-download-history-${item.id}`}
                            >
                              <Download className="w-4 h-4 mr-1" />
                              Download
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => deleteFromHistory(item.id)}
                              data-testid={`button-delete-history-${item.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Sample Files Section */}
            <Card className="border-dashed border-2 border-cyan-500/30 bg-cyan-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="w-5 h-5 text-cyan-400" />
                  Sample Files for Testing
                </CardTitle>
                <CardDescription>
                  Download ABC Insurance sample reports to test the validation module
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-green-400" />
                      Excel Reports
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <a href="/samples/ABC_Insurance_SSRS_Report.xlsx" download>
                        <Button variant="outline" size="sm" data-testid="button-download-sample-excel-source">
                          <Download className="w-3 h-3 mr-1" />
                          SSRS Export (.xlsx)
                        </Button>
                      </a>
                      <a href="/samples/ABC_Insurance_PowerBI_Report.xlsx" download>
                        <Button variant="outline" size="sm" data-testid="button-download-sample-excel-target">
                          <Download className="w-3 h-3 mr-1" />
                          PowerBI Export (.xlsx)
                        </Button>
                      </a>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <FileImage className="w-4 h-4 text-red-400" />
                      PDF Reports
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <a href="/samples/ABC_Insurance_SSRS_Report.pdf" download>
                        <Button variant="outline" size="sm" data-testid="button-download-sample-pdf-source">
                          <Download className="w-3 h-3 mr-1" />
                          SSRS Export (.pdf)
                        </Button>
                      </a>
                      <a href="/samples/ABC_Insurance_PowerBI_Report.pdf" download>
                        <Button variant="outline" size="sm" data-testid="button-download-sample-pdf-target">
                          <Download className="w-3 h-3 mr-1" />
                          PowerBI Export (.pdf)
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  The sample files contain ABC Insurance policy data with intentional differences for testing: Premium variations, status changes, and claim count discrepancies.
                </p>
              </CardContent>
            </Card>
            
            {!isValidating && !validationComplete && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FileUploadZone
                    target="source"
                    file={sourceFile}
                    inputMode={sourceInputMode}
                    path={sourcePath}
                    onModeChange={setSourceInputMode}
                    onPathChange={setSourcePath}
                    inputRef={sourceInputRef as React.RefObject<HTMLInputElement>}
                  />
                  <FileUploadZone
                    target="target"
                    file={targetFile}
                    inputMode={targetInputMode}
                    path={targetPath}
                    onModeChange={setTargetInputMode}
                    onPathChange={setTargetPath}
                    inputRef={targetInputRef as React.RefObject<HTMLInputElement>}
                  />
                </div>
                
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Validation Settings</CardTitle>
                    <CardDescription>Configure comparison parameters and tolerances</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <Label>Comparison Mode</Label>
                        <Select value={config.comparisonMode} onValueChange={(v) => setConfig(c => ({ ...c, comparisonMode: v as any }))}>
                          <SelectTrigger data-testid="select-comparison-mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">Strict (Exact Match)</SelectItem>
                            <SelectItem value="tolerant">Tolerant (Configurable)</SelectItem>
                            <SelectItem value="smart">Smart (AI-Assisted)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Date Handling</Label>
                        <Select value={config.dateHandling} onValueChange={(v) => setConfig(c => ({ ...c, dateHandling: v as any }))}>
                          <SelectTrigger data-testid="select-date-handling">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">Strict (Exact Format)</SelectItem>
                            <SelectItem value="flexible">Flexible (Same Date)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Whitespace Handling</Label>
                        <Select value={config.whitespaceHandling} onValueChange={(v) => setConfig(c => ({ ...c, whitespaceHandling: v as any }))}>
                          <SelectTrigger data-testid="select-whitespace">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">Strict</SelectItem>
                            <SelectItem value="trim">Trim</SelectItem>
                            <SelectItem value="normalize">Normalize</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Numeric Tolerance</Label>
                          <span className="text-sm text-muted-foreground">{config.numericTolerance}</span>
                        </div>
                        <Slider
                          value={[config.numericTolerance]}
                          min={0}
                          max={1}
                          step={0.01}
                          onValueChange={([v]) => setConfig(c => ({ ...c, numericTolerance: v }))}
                          data-testid="slider-numeric-tolerance"
                        />
                        <p className="text-xs text-muted-foreground">Allow differences up to this value</p>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Percentage Tolerance</Label>
                          <span className="text-sm text-muted-foreground">{config.percentageTolerance}%</span>
                        </div>
                        <Slider
                          value={[config.percentageTolerance]}
                          min={0}
                          max={5}
                          step={0.1}
                          onValueChange={([v]) => setConfig(c => ({ ...c, percentageTolerance: v }))}
                          data-testid="slider-percentage-tolerance"
                        />
                        <p className="text-xs text-muted-foreground">Allow percentage differences for calculated fields</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label>Ignore Columns</Label>
                        <Input
                          placeholder="timestamp, id, created_at"
                          value={config.ignoreColumns}
                          onChange={(e) => setConfig(c => ({ ...c, ignoreColumns: e.target.value }))}
                          data-testid="input-ignore-columns"
                        />
                        <p className="text-xs text-muted-foreground">Comma-separated column names to skip</p>
                      </div>
                      
                      <div className="flex items-center justify-between pt-6">
                        <div>
                          <Label>Case Sensitivity</Label>
                          <p className="text-xs text-muted-foreground">Enable for exact text matching</p>
                        </div>
                        <Switch
                          checked={config.caseSensitive}
                          onCheckedChange={(v) => setConfig(c => ({ ...c, caseSensitive: v }))}
                          data-testid="switch-case-sensitive"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <div className="flex justify-center">
                  <Button
                    size="lg"
                    onClick={runValidation}
                    disabled={!sourceFile || !targetFile}
                    className="bg-cyan-600 hover:bg-cyan-700 px-8"
                    data-testid="button-start-validation"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Start Validation
                  </Button>
                </div>
              </>
            )}
            
            {(isValidating || validationComplete) && (
              <Card className="bg-gradient-to-b from-background to-muted/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-cyan-400" />
                    AI Agent Validation Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-around py-4">
                    {stages.map((stage, i) => (
                      <div key={stage.id} className="flex items-center">
                        <CircularProgress stage={stage} />
                        {i < stages.length - 1 && (
                          <div className={`w-12 h-0.5 mx-2 ${
                            stages[i + 1].status === 'pending' ? 'border-t-2 border-dashed border-muted-foreground/30' :
                            'bg-cyan-500'
                          }`} />
                        )}
                      </div>
                    ))}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Overall Progress</span>
                      <span className="font-medium">{Math.round(overallProgress)}%</span>
                    </div>
                    <Progress value={overallProgress} className="h-2" />
                    {isValidating && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Estimated time remaining: ~{Math.max(5, Math.round((100 - overallProgress) / 3))} seconds
                      </p>
                    )}
                  </div>
                  
                  <div className="border rounded-lg bg-black/50">
                    <div className="flex items-center justify-between px-4 py-2 border-b">
                      <span className="text-sm font-medium">Real-time Log</span>
                      <Badge variant="secondary" className="text-xs">{logs.length} entries</Badge>
                    </div>
                    <ScrollArea className="h-48" ref={logScrollRef}>
                      <div className="p-4 font-mono text-xs space-y-1">
                        {logs.map((log, i) => (
                          <div key={i} className={`flex gap-2 ${
                            log.type === 'success' ? 'text-emerald-400' :
                            log.type === 'warning' ? 'text-yellow-400' :
                            log.type === 'error' ? 'text-red-400' :
                            'text-blue-400'
                          }`}>
                            <span className="text-muted-foreground">[{log.timestamp}]</span>
                            <span className="uppercase">{log.type}:</span>
                            <span className="text-foreground">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {validationComplete && validationResult && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Match Rate</p>
                          <p className="text-2xl font-bold text-emerald-400">{validationResult.matchPercentage}%</p>
                        </div>
                        <div className={`p-3 rounded-full ${
                          validationResult.status === 'pass' ? 'bg-emerald-500/20' :
                          validationResult.status === 'warning' ? 'bg-yellow-500/20' :
                          'bg-red-500/20'
                        }`}>
                          {validationResult.status === 'pass' ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> :
                           validationResult.status === 'warning' ? <AlertTriangle className="w-6 h-6 text-yellow-400" /> :
                           <XCircle className="w-6 h-6 text-red-400" />}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Total Cells</p>
                      <p className="text-2xl font-bold">{validationResult.summary.totalCells.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {validationResult.summary.sourceRowCount} rows × {validationResult.summary.sourceColumnCount} cols
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Differences</p>
                      <p className="text-2xl font-bold text-yellow-400">{validationResult.summary.mismatchedCells + validationResult.summary.toleranceCells}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {validationResult.summary.toleranceCells} within tolerance, {validationResult.summary.mismatchedCells} mismatched
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Issues</p>
                      <p className="text-2xl font-bold">
                        <span className="text-red-400">{validationResult.summary.criticalIssues}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span className="text-yellow-400">{validationResult.summary.warnings}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Critical / Warnings</p>
                    </CardContent>
                  </Card>
                </div>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">AI Analysis Summary</CardTitle>
                      <CardDescription>Claude's assessment of the validation results</CardDescription>
                    </div>
                    <Badge className={
                      validationResult.status === 'pass' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      validationResult.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                      'bg-red-500/20 text-red-400 border-red-500/30'
                    }>
                      {validationResult.status.toUpperCase()}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm prose-invert max-w-none">
                      <div className="bg-muted/30 rounded-lg p-4 whitespace-pre-wrap text-sm">
                        {validationResult.aiAnalysis}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Differences Found</CardTitle>
                      <CardDescription>
                        {validationResult.differences.length} differences detected
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowViewer(!showViewer)} data-testid="button-toggle-viewer">
                        <Columns className="w-4 h-4 mr-1" />
                        {showViewer ? 'Hide' : 'Show'} Side-by-Side
                      </Button>
                      {showViewer && sourceFile?.type === 'pdf' && targetFile?.type === 'pdf' && (
                        <div className="flex items-center border rounded-md overflow-hidden">
                          <Button 
                            variant={viewerMode === 'data' ? 'default' : 'ghost'} 
                            size="sm" 
                            className="rounded-none"
                            onClick={() => setViewerMode('data')}
                            data-testid="button-view-data"
                          >
                            <Table className="w-4 h-4 mr-1" />
                            Data
                          </Button>
                          <Button 
                            variant={viewerMode === 'pdf' ? 'default' : 'ghost'} 
                            size="sm"
                            className="rounded-none"
                            onClick={() => setViewerMode('pdf')}
                            data-testid="button-view-pdf"
                          >
                            <FileImage className="w-4 h-4 mr-1" />
                            PDF
                          </Button>
                        </div>
                      )}
                      <Button variant="outline" size="sm" data-testid="button-export-report">
                        <Download className="w-4 h-4 mr-1" />
                        Export Report
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {showViewer && viewerMode === 'pdf' && sourceFile?.type === 'pdf' && targetFile?.type === 'pdf' && (
                      <div className="mb-6">
                        <PDFComparisonViewer
                          sourceFile={sourceFile.file}
                          targetFile={targetFile.file}
                          sourceName={sourceFile.name}
                          targetName={targetFile.name}
                          differences={validationResult.differences}
                          currentDiffIndex={currentDiffIndex}
                          onDiffIndexChange={setCurrentDiffIndex}
                        />
                      </div>
                    )}
                    
                    {showViewer && viewerMode === 'data' && validationResult.sourcePreview && validationResult.targetPreview && (
                      <div className="mb-6 space-y-4" data-testid="side-by-side-viewer">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium flex items-center gap-2">
                            <Columns className="w-4 h-4 text-cyan-400" />
                            Side-by-Side Data Comparison
                          </h4>
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              disabled={currentDiffIndex === 0}
                              onClick={() => setCurrentDiffIndex(i => Math.max(0, i - 1))}
                              data-testid="button-viewer-prev"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              {validationResult.differences.length > 0 
                                ? `Diff ${currentDiffIndex + 1}/${validationResult.differences.length}` 
                                : 'No differences'}
                            </span>
                            <Button 
                              variant="outline" 
                              size="sm"
                              disabled={currentDiffIndex >= validationResult.differences.length - 1}
                              onClick={() => setCurrentDiffIndex(i => Math.min(validationResult.differences.length - 1, i + 1))}
                              data-testid="button-viewer-next"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="border rounded-lg overflow-hidden">
                            <div className="bg-blue-500/10 border-b px-4 py-2 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-blue-400" />
                              <span className="text-sm font-medium text-blue-400">Source (SSRS)</span>
                              <Badge variant="outline" className="ml-auto text-xs">
                                {sourceFile?.name || 'Source File'}
                              </Badge>
                            </div>
                            <ScrollArea className="h-[400px]">
                              <div className="p-2">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/30 sticky top-0">
                                    <tr>
                                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">#</th>
                                      {validationResult.sourcePreview[0] && Object.keys(validationResult.sourcePreview[0])
                                        .filter(k => k !== 'rowNum')
                                        .map(header => (
                                          <th key={header} className="px-2 py-1 text-left font-medium text-muted-foreground truncate max-w-[120px]">
                                            {header}
                                          </th>
                                        ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {validationResult.sourcePreview.map((row, rowIndex) => {
                                      const rowDiffs = validationResult.differences.filter(d => d.row === row.rowNum);
                                      const isHighlightedRow = validationResult.differences[currentDiffIndex]?.row === row.rowNum;
                                      return (
                                        <tr 
                                          key={rowIndex} 
                                          className={`border-t ${isHighlightedRow ? 'bg-cyan-500/20' : rowDiffs.length > 0 ? 'bg-red-500/5' : ''}`}
                                        >
                                          <td className="px-2 py-1 font-mono text-muted-foreground">{row.rowNum}</td>
                                          {Object.entries(row)
                                            .filter(([k]) => k !== 'rowNum')
                                            .map(([col, val], colIndex) => {
                                              const cellDiff = rowDiffs.find(d => d.column === col);
                                              const isCurrentDiff = validationResult.differences[currentDiffIndex]?.row === row.rowNum && 
                                                                   validationResult.differences[currentDiffIndex]?.column === col;
                                              return (
                                                <td 
                                                  key={colIndex} 
                                                  className={`px-2 py-1 font-mono truncate max-w-[120px] ${
                                                    isCurrentDiff ? 'bg-cyan-500/40 ring-2 ring-cyan-400 ring-inset' :
                                                    cellDiff?.status === 'mismatch' ? 'bg-red-500/20 text-red-400' :
                                                    cellDiff?.status === 'tolerance' ? 'bg-yellow-500/20 text-yellow-400' : ''
                                                  }`}
                                                  title={String(val ?? '')}
                                                >
                                                  {String(val ?? '')}
                                                </td>
                                              );
                                            })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </ScrollArea>
                          </div>
                          
                          <div className="border rounded-lg overflow-hidden">
                            <div className="bg-yellow-500/10 border-b px-4 py-2 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-yellow-400" />
                              <span className="text-sm font-medium text-yellow-400">Target (PowerBI)</span>
                              <Badge variant="outline" className="ml-auto text-xs">
                                {targetFile?.name || 'Target File'}
                              </Badge>
                            </div>
                            <ScrollArea className="h-[400px]">
                              <div className="p-2">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/30 sticky top-0">
                                    <tr>
                                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">#</th>
                                      {validationResult.targetPreview[0] && Object.keys(validationResult.targetPreview[0])
                                        .filter(k => k !== 'rowNum')
                                        .map(header => (
                                          <th key={header} className="px-2 py-1 text-left font-medium text-muted-foreground truncate max-w-[120px]">
                                            {header}
                                          </th>
                                        ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {validationResult.targetPreview.map((row, rowIndex) => {
                                      const rowDiffs = validationResult.differences.filter(d => d.row === row.rowNum);
                                      const isHighlightedRow = validationResult.differences[currentDiffIndex]?.row === row.rowNum;
                                      return (
                                        <tr 
                                          key={rowIndex} 
                                          className={`border-t ${isHighlightedRow ? 'bg-cyan-500/20' : rowDiffs.length > 0 ? 'bg-red-500/5' : ''}`}
                                        >
                                          <td className="px-2 py-1 font-mono text-muted-foreground">{row.rowNum}</td>
                                          {Object.entries(row)
                                            .filter(([k]) => k !== 'rowNum')
                                            .map(([col, val], colIndex) => {
                                              const cellDiff = rowDiffs.find(d => d.column === col);
                                              const isCurrentDiff = validationResult.differences[currentDiffIndex]?.row === row.rowNum && 
                                                                   validationResult.differences[currentDiffIndex]?.column === col;
                                              return (
                                                <td 
                                                  key={colIndex} 
                                                  className={`px-2 py-1 font-mono truncate max-w-[120px] ${
                                                    isCurrentDiff ? 'bg-cyan-500/40 ring-2 ring-cyan-400 ring-inset' :
                                                    cellDiff?.status === 'mismatch' ? 'bg-red-500/20 text-red-400' :
                                                    cellDiff?.status === 'tolerance' ? 'bg-yellow-500/20 text-yellow-400' : ''
                                                  }`}
                                                  title={String(val ?? '')}
                                                >
                                                  {String(val ?? '')}
                                                </td>
                                              );
                                            })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </ScrollArea>
                          </div>
                        </div>
                        
                        {validationResult.differences[currentDiffIndex] && (
                          <div className="bg-muted/30 rounded-lg p-4 border">
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <span className="text-xs text-muted-foreground">Current Difference:</span>
                                <div className="flex items-center gap-4 mt-1">
                                  <span className="text-sm">
                                    <span className="text-muted-foreground">Row</span> <span className="font-mono font-medium">{validationResult.differences[currentDiffIndex].row}</span>
                                  </span>
                                  <span className="text-sm">
                                    <span className="text-muted-foreground">Column</span> <span className="font-mono font-medium">{validationResult.differences[currentDiffIndex].column}</span>
                                  </span>
                                  <Badge className={
                                    validationResult.differences[currentDiffIndex].status === 'tolerance' 
                                      ? 'bg-yellow-500/20 text-yellow-400' 
                                      : 'bg-red-500/20 text-red-400'
                                  }>
                                    {validationResult.differences[currentDiffIndex].status}
                                  </Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-center">
                                  <span className="text-xs text-blue-400">Source</span>
                                  <div className="font-mono text-sm bg-blue-500/10 px-2 py-1 rounded mt-1">
                                    {validationResult.differences[currentDiffIndex].sourceValue || '(empty)'}
                                  </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                <div className="text-center">
                                  <span className="text-xs text-yellow-400">Target</span>
                                  <div className="font-mono text-sm bg-yellow-500/10 px-2 py-1 rounded mt-1">
                                    {validationResult.differences[currentDiffIndex].targetValue || '(empty)'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {validationResult.differences.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              disabled={currentDiffIndex === 0}
                              onClick={() => setCurrentDiffIndex(i => Math.max(0, i - 1))}
                              data-testid="button-prev-diff"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Difference {currentDiffIndex + 1} of {validationResult.differences.length}
                            </span>
                            <Button 
                              variant="outline" 
                              size="sm"
                              disabled={currentDiffIndex === validationResult.differences.length - 1}
                              onClick={() => setCurrentDiffIndex(i => Math.min(validationResult.differences.length - 1, i + 1))}
                              data-testid="button-next-diff"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-4 py-2 text-left font-medium">Row</th>
                                <th className="px-4 py-2 text-left font-medium">Column</th>
                                <th className="px-4 py-2 text-left font-medium">Source (SSRS)</th>
                                <th className="px-4 py-2 text-left font-medium">Target (PowerBI)</th>
                                <th className="px-4 py-2 text-left font-medium">Difference</th>
                                <th className="px-4 py-2 text-left font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationResult.differences.map((diff, i) => (
                                <tr 
                                  key={i} 
                                  className={`border-t ${i === currentDiffIndex ? 'bg-cyan-500/10' : 'hover:bg-muted/30'}`}
                                  onClick={() => setCurrentDiffIndex(i)}
                                >
                                  <td className="px-4 py-2 font-mono">{diff.row}</td>
                                  <td className="px-4 py-2">{diff.column}</td>
                                  <td className="px-4 py-2 font-mono text-blue-400">{diff.sourceValue}</td>
                                  <td className="px-4 py-2 font-mono text-yellow-400">{diff.targetValue}</td>
                                  <td className="px-4 py-2 font-mono">{diff.difference}</td>
                                  <td className="px-4 py-2">
                                    <Badge className={
                                      diff.status === 'exact' ? 'bg-emerald-500/20 text-emerald-400' :
                                      diff.status === 'tolerance' ? 'bg-yellow-500/20 text-yellow-400' :
                                      'bg-red-500/20 text-red-400'
                                    }>
                                      {diff.status}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        
                        {validationResult.differences[currentDiffIndex]?.aiAnalysis && (
                          <div className="bg-muted/30 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Brain className="w-4 h-4 text-cyan-400" />
                              <span className="text-sm font-medium">AI Analysis</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {validationResult.differences[currentDiffIndex].aiAnalysis}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <div className="flex justify-center gap-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setValidationComplete(false);
                      setValidationResult(null);
                      setSourceFile(null);
                      setTargetFile(null);
                      setStages(prev => prev.map(s => ({ ...s, status: 'pending', progress: 0, subStatus: 'Waiting...' })));
                    }}
                    data-testid="button-new-validation"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    New Validation
                  </Button>
                  <Button onClick={handleDownloadPDFReport} data-testid="button-download-pdf">
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF Report
                  </Button>
                </div>
              </>
            )}
        </div>
      </main>
    </>
  );
}
