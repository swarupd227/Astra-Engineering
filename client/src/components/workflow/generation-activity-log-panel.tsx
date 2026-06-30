import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X, ChevronDown, ChevronUp, Loader2, Timer, Download, Globe } from "lucide-react";
import { useWorkflow } from "@/context/workflow-context";
import { useState, useEffect, useRef } from "react";
import type React from "react";

export function GenerationActivityLogPanel() {
  const {
    isGeneratingArtifacts,
    generationLogs,
    generationCancelled,
    cancelGeneration,
    setCurrentStep,
    setGenerationLogs,
    setIsGeneratingArtifacts,
    qualityReport,
    domainExpertAnalysis,
  } = useWorkflow();
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [generationEndTime, setGenerationEndTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    if (isGeneratingArtifacts) {
      if (!generationStartTime || generationEndTime) {
        const startTime = Date.now();
        startTimeRef.current = startTime;
        setGenerationStartTime(startTime);
        setGenerationEndTime(null);
        setElapsedSeconds(0);
      } else {
        if (generationStartTime) {
          startTimeRef.current = generationStartTime;
        }
      }
      
      timerIntervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const now = Date.now();
          const elapsed = Math.floor((now - startTimeRef.current) / 1000);
          setElapsedSeconds(elapsed);
        }
      }, 1000);
    } else if (!isGeneratingArtifacts && generationStartTime && !generationEndTime) {
      const endTime = Date.now();
      setGenerationEndTime(endTime);
      if (generationStartTime) {
        const finalElapsed = Math.floor((endTime - generationStartTime) / 1000);
        setElapsedSeconds(finalElapsed);
      }
      
      timerIntervalRef.current = null;
      startTimeRef.current = null;
    } else if (!isGeneratingArtifacts && generationLogs.length === 0 && generationStartTime) {
      setGenerationStartTime(null);
      setGenerationEndTime(null);
      setElapsedSeconds(0);
      startTimeRef.current = null;
    }
    
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isGeneratingArtifacts, generationStartTime, generationEndTime, generationLogs.length]);
  
  useEffect(() => {
    if (!isCollapsed && scrollContainerRef.current) {
      const timer = setTimeout(() => {
        const viewport = scrollContainerRef.current?.closest('.relative')?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [generationLogs, isCollapsed]);
  
  const handleCancel = () => {
    setShowConfirmDialog(true);
  };
  
  const handleConfirmCancel = () => {
    if (cancelGeneration) {
      cancelGeneration();
    } else {
      setCurrentStep(1);
    }
    
    setGenerationLogs([]);
    setIsGeneratingArtifacts(false);
    
    setShowConfirmDialog(false);
  };

  const handleDownloadQAReport = () => {
    if (!qualityReport) return;

    const reportLines: string[] = [];
    reportLines.push("═══════════════════════════════════════════════════════════════");
    reportLines.push("                    QUALITY AGENT REPORT                       ");
    reportLines.push("═══════════════════════════════════════════════════════════════");
    reportLines.push("");
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push(`Total Duration: ${qualityReport.totalDuration || 'N/A'}s`);
    reportLines.push("");

    if (qualityReport.deduplicationStats) {
      reportLines.push("── DEDUPLICATION & CLEANUP ────────────────────────────────────");
      reportLines.push(`  Duplicate Epics Removed: ${qualityReport.deduplicationStats.epicsRemoved || 0}`);
      reportLines.push(`  Duplicate Features Removed: ${qualityReport.deduplicationStats.featuresRemoved || 0}`);
      reportLines.push(`  Duplicate Stories Removed: ${qualityReport.deduplicationStats.storiesRemoved || 0}`);
      reportLines.push(`  Stories Generated for Empty Features: ${qualityReport.deduplicationStats.storiesGeneratedForEmptyFeatures || 0}`);
      reportLines.push(`  Orphan Epics Removed (0 features): ${qualityReport.deduplicationStats.orphanEpicsRemoved || 0}`);
      reportLines.push("");
    }

    if (qualityReport.brdCoverage) {
      const cov = qualityReport.brdCoverage;
      reportLines.push("── BRD COVERAGE ──────────────────────────────────────────────");
      reportLines.push(`  Total Requirements: ${cov.totalRequirements}`);
      reportLines.push(`  Fully Covered: ${cov.fullyCovered}`);
      reportLines.push(`  Partially Covered: ${cov.partiallyCovered}`);
      reportLines.push(`  Uncovered: ${cov.uncovered}`);
      reportLines.push(`  Coverage %: ${cov.coveragePercentage}%`);
      reportLines.push(`  Gap Stories Generated: ${cov.gapStoriesGenerated || 0}`);
      reportLines.push("");

      if (cov.details && Array.isArray(cov.details)) {
        reportLines.push("  Requirement Details:");
        for (const detail of cov.details) {
          const strengthIcon = detail.coverageStrength === 'full' ? '[FULL]' : detail.coverageStrength === 'partial' ? '[PARTIAL]' : '[NONE]';
          reportLines.push(`    ${strengthIcon} ${detail.requirementId}: ${detail.requirementName}`);
          if (detail.coveringStories && detail.coveringStories.length > 0) {
            reportLines.push(`      Covering Stories: ${detail.coveringStories.join(', ')}`);
          }
        }
        reportLines.push("");
      }
    }

    if (qualityReport.architecturalLayers) {
      const arch = qualityReport.architecturalLayers;
      reportLines.push("── ARCHITECTURAL LAYERS ──────────────────────────────────────");
      reportLines.push(`  Covered: ${arch.covered}/${arch.totalLayers}`);
      if (arch.missing && arch.missing.length > 0) {
        reportLines.push(`  Missing: ${arch.missing.join(', ')}`);
      }
      reportLines.push("");
      if (arch.details && Array.isArray(arch.details)) {
        for (const layer of arch.details) {
          const status = layer.covered ? '[COVERED]' : '[MISSING]';
          reportLines.push(`    ${status} ${layer.layerName}`);
        }
        reportLines.push("");
      }
    }

    reportLines.push("═══════════════════════════════════════════════════════════════");

    const blob = new Blob([reportLines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-quality-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  if (!isGeneratingArtifacts && generationLogs.length === 0 && !qualityReport) {
    return null;
  }
  
  const isComplete = !isGeneratingArtifacts && generationLogs.length > 0;
  const completedSuccessfully = generationLogs.some(log => log.message === 'Complete!');
  const hasError = !completedSuccessfully && !isGeneratingArtifacts && generationLogs.length > 0 && generationLogs.some(log => {
    const msg = log.message;
    if (msg.startsWith('⚠️') || msg.startsWith('🔴') || msg.startsWith('📋') || msg.startsWith('🏗️')) return false;
    if (msg.includes('Quality Agent:')) return false;
    if (msg.includes('Missing coverage') || msg.includes('Missing layers') || msg.includes('non-critical')) return false;
    return msg.toLowerCase().includes('failed to generate') || msg.toLowerCase().includes('generation failed');
  });
  
  const formatTimestamp = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };
  
  const formatElapsedTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  const getTimerDisplay = (): string | null => {
    if (!generationStartTime) {
      return null;
    }
    
    if (isGeneratingArtifacts && !generationCancelled) {
      return `Elapsed: ${formatElapsedTime(elapsedSeconds)}`;
    } else if (generationCancelled) {
      return `Cancelled at: ${formatElapsedTime(elapsedSeconds)}`;
    } else if (!isGeneratingArtifacts && generationEndTime) {
      return `Total time: ${formatElapsedTime(elapsedSeconds)}`;
    }
    
    return null;
  };
  
  return (
    <>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Generation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the artifact generation? This action cannot be undone and the generation log will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Yes, Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <Card className="border-2 mb-4" data-testid="generation-activity-log-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isGeneratingArtifacts && !generationCancelled && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            <CardTitle className="text-base font-semibold">
              Generation Activity Log
            </CardTitle>
            {isComplete && !hasError && (
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                Complete
              </span>
            )}
            {generationCancelled && (
              <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                Cancelled
              </span>
            )}
            {hasError && (
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                Error
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {getTimerDisplay() && (
              <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                <span>{getTimerDisplay()}</span>
              </div>
            )}
            {qualityReport && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadQAReport}
                data-testid="download-qa-report-button"
              >
                <Download className="h-4 w-4 mr-1" />
                QA Report
              </Button>
            )}
            {isGeneratingArtifacts && !generationCancelled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-200 dark:border-red-900 hover:border-red-300 dark:hover:border-red-800"
                data-testid="cancel-generation-button"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel Generation
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? "Expand log" : "Collapse log"}
            >
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="pt-0 space-y-3">
          {domainExpertAnalysis && (
            <div className="rounded-md border bg-muted/30 p-3" data-testid="domain-expert-analysis">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold">Domain Expert Agent — {(domainExpertAnalysis.domain || 'General').toUpperCase()}</span>
              </div>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                {domainExpertAnalysis.domainAnalysis}
              </div>
            </div>
          )}
          <div ref={scrollContainerRef}>
            <ScrollArea className="h-[200px] w-full rounded-md border bg-muted/30 p-4">
              <div className="space-y-1 font-mono text-sm">
              {generationLogs.length === 0 ? (
                <div className="text-muted-foreground italic">
                  Waiting for generation to start...
                </div>
              ) : (
                generationLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`${
                      log.message.includes("⚠️") || log.message.includes("🔴")
                        ? "text-amber-600 dark:text-amber-400"
                        : log.message.toLowerCase().includes('failed to generate') || log.message.toLowerCase().includes('generation failed')
                        ? "text-red-600 dark:text-red-400"
                        : log.message.includes("✅") || log.message === "Complete!" || log.message.toLowerCase().includes("successfully")
                        ? "text-green-600 dark:text-green-400"
                        : "text-foreground"
                    }`}
                  >
                    <span className="text-muted-foreground mr-2">
                      [{formatTimestamp(log.timestamp)}]
                    </span>
                    {log.message}
                  </div>
                ))
              )}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      )}
    </Card>
    </>
  );
}
