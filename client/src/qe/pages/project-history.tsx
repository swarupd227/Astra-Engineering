import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/contexts/ProjectContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, formatDistanceToNow } from "date-fns";
import { Clock, CheckCircle, XCircle, AlertCircle, ArrowLeft, History, ExternalLink, FileText, Zap } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState } from "react";
import type { FunctionalTestRun, FunctionalTestRunWithCases } from "@shared/qe-schema";
import { DashboardHeader } from "@/components/dashboard/header";

interface Project {
  id: string;
  name: string;
  description: string | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

export default function ProjectHistory() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", selectedProjectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${selectedProjectId}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch project");
      }
      return response.json();
    },
    enabled: !!selectedProjectId,
  });

  const historyQueryKey = selectedProjectId 
    ? `/api/test-runs?projectId=${selectedProjectId}`
    : '/api/test-runs';

  const { data: testRuns = [], isLoading: runsLoading } = useQuery<FunctionalTestRun[]>({
    queryKey: ['/api/test-runs', selectedProjectId || 'all'],
    queryFn: async () => {
      const res = await fetch(historyQueryKey);
      if (!res.ok) throw new Error('Failed to fetch test runs');
      return res.json();
    },
  });

  const { data: selectedRunDetails, isLoading: isLoadingRunDetails } = useQuery<FunctionalTestRunWithCases>({
    queryKey: ['/api/test-runs', selectedRunId],
    enabled: !!selectedRunId,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4" />;
      case "running":
        return <Clock className="w-4 h-4 text-cyan-500 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  if (runsLoading || (selectedProjectId && projectLoading)) {
    return (
      <>
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardHeader />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
      
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs transition-colors border border-border">
                ← Dashboard
              </button>
            </Link>
            <CardTitle className="text-2xl flex items-center gap-2">
              <History className="w-6 h-6 text-cyan-500" />
              Project History
            </CardTitle>
          </div>
          <CardDescription>
            {selectedProjectId 
              ? `Viewing: ${project?.name || 'Selected Project'} - ${project?.description || "Project test history"}`
              : "View all functional test runs across all projects"
            }
          </CardDescription>
          {selectedProjectId && project && (
            <div className="flex items-center gap-2 pt-2">
              <Badge variant="secondary">{project.type}</Badge>
              <span className="text-sm text-muted-foreground">
                Created {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
              </span>
            </div>
          )}
          {!selectedProjectId && (
            <div className="text-xs text-muted-foreground pt-2">
              Select a project from the header to filter by project, or view all runs below.
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Run Details View */}
      {selectedRunId && selectedRunDetails ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ExternalLink className="w-5 h-5" />
                {selectedRunDetails.websiteUrl}
              </CardTitle>
              <CardDescription>
                Run details and generated test cases
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Domain</span>
                  <p className="font-medium">{selectedRunDetails.domain || 'General'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Test Focus</span>
                  <p className="font-medium">{selectedRunDetails.testFocus}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Mode</span>
                  <p className="font-medium flex items-center gap-1">
                    {selectedRunDetails.sampleMode === 'quick' && <Zap className="w-3 h-3 text-cyan-500" />}
                    {selectedRunDetails.sampleMode === 'quick' ? 'Quick Sample' : 'Comprehensive'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-medium flex items-center gap-1">
                    {getStatusIcon(selectedRunDetails.status)}
                    {selectedRunDetails.status}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 pt-4 border-t">
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.totalTestCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.workflowCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Workflow</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.functionalCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Functional</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.negativeCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Negative</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.edgeCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Edge Cases</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{selectedRunDetails.textValidationCases || 0}</div>
                  <div className="text-xs text-muted-foreground">Text</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Test Cases List */}
          {selectedRunDetails.testCases && selectedRunDetails.testCases.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Test Cases ({selectedRunDetails.testCases.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {selectedRunDetails.testCases.map((tc, index) => (
                    <div key={tc.id || index} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{tc.name}</div>
                          {tc.objective && (
                            <div className="text-xs text-muted-foreground mt-1">{tc.objective}</div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs">{tc.category}</Badge>
                          <Badge variant="secondary" className="text-xs">{tc.priority}</Badge>
                        </div>
                      </div>
                      {tc.testSteps && tc.testSteps.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {tc.testSteps.length} step{tc.testSteps.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        /* Test Runs List */
        <div className="space-y-4">
          {testRuns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {selectedProjectId ? 'No test runs for this project yet.' : 'No test runs yet.'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Run a functional test to see history here.
                </p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => setLocation('/functional-testing')}
                  data-testid="button-go-functional-testing"
                >
                  Go to Functional Testing
                </Button>
              </CardContent>
            </Card>
          ) : (
            testRuns.map((run) => (
              <Card 
                key={run.id} 
                className="hover-elevate cursor-pointer"
                onClick={() => setSelectedRunId(run.id)}
                data-testid={`history-run-${run.id}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{run.websiteUrl}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(run.createdAt), 'PPpp')}
                      </CardDescription>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="secondary">{run.domain || 'General'}</Badge>
                        <Badge variant="outline">Focus: {run.testFocus}</Badge>
                        {run.sampleMode && (
                          <Badge variant={run.sampleMode === 'quick' ? 'default' : 'secondary'} className={run.sampleMode === 'quick' ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' : ''}>
                            {run.sampleMode === 'quick' && <Zap className="w-3 h-3 mr-1" />}
                            {run.sampleMode === 'quick' ? 'Quick Sample' : 'Comprehensive'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>
                          {run.status}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold">{run.totalTestCases || 0}</span>
                        <span className="text-sm text-muted-foreground ml-1">test cases</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>
      )}
      </main>
    </>
  );
}
