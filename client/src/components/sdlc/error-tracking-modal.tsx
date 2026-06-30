import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  RefreshCw,
  Bug,
  XCircle,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  ExternalLink,
  Loader2,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface ErrorTrackingModalProps {
  projectId: string;
  adoProject?: ADOProject | null;
  open: boolean;
  onClose: () => void;
}

interface BugData {
  statistics: {
    critical: number;
    highPriority: number;
    mediumSeverity: number;
    lowSeverity: number;
    criticalTotal?: number;
    highPriorityTotal?: number;
    mediumSeverityTotal?: number;
    lowSeverityTotal?: number;
    totalBugs: number;
    resolved: number;
    unresolved: number;
    resolvedThisMonth: number;
  };
  bugAge: {
    averageAge: number;
    oldestBugAge: number;
    bugsByAgeRange: {
      '0-7 days': number;
      '8-30 days': number;
      '31-90 days': number;
      '90+ days': number;
    };
  };
  timeToResolution: {
    averageTimeToResolution: number;
    medianTimeToResolution: number;
    resolutionTimeByRange: {
      '0-1 day': number;
      '2-7 days': number;
      '8-30 days': number;
      '31+ days': number;
    };
  };
  recentBugs: Array<{
    id: number;
    title: string;
    state: string;
    priority: number;
    severity: string;
    assignedTo: string;
    createdDate: string;
    ageInDays?: number;
    url: string;
  }>;
}

type ErrorDetailView = 'critical' | 'highPriority' | 'mediumSeverity' | 'lowSeverity' | 'totalBugs' | 'resolvedThisMonth' | null;

export function ErrorTrackingModal({ projectId, adoProject, open, onClose }: ErrorTrackingModalProps) {
  const { toast } = useToast();
  
  const [detailView, setDetailView] = useState<ErrorDetailView>(null);

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  const queryString = params.toString();

  // Fetch ADO config (cached)
  const { data: adoConfig, error: configError } = useQuery<{ hasConfig: boolean; organization: string; project: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      const configRes = await fetch(configUrl, { credentials: "include" });
      
      if (!configRes.ok) {
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      return configRes.json();
    },
    enabled: open && !!projectId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hasAdoConfig = adoConfig?.hasConfig || false;
  const adoOrganization = adoProject?.organization || adoConfig?.organization || "";
  const adoProjectName = adoProject?.name || adoConfig?.project || "";

  // Build query params for maintenance API calls
  const maintenanceParams = new URLSearchParams();
  if (adoOrganization) {
    maintenanceParams.append('organization', adoOrganization);
  }
  if (adoProjectName) {
    maintenanceParams.append('projectName', adoProjectName);
  }
  const maintenanceQueryString = maintenanceParams.toString();

  // Fetch bug data (cached)
  const { 
    data: bugData, 
    isLoading: loading, 
    isFetching: refreshing,
    error: bugsError,
    refetch: refetchBugs 
  } = useQuery<BugData>({
    queryKey: ['/api/sdlc/projects', projectId, 'maintenance/bugs', adoOrganization, adoProjectName],
    queryFn: async () => {
      const bugsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/maintenance/bugs${maintenanceQueryString ? `?${maintenanceQueryString}` : ''}`);
      const bugsRes = await fetch(bugsUrl, { credentials: "include" });
      
      if (!bugsRes.ok) {
        throw new Error(`Failed to fetch bugs: ${bugsRes.status} ${bugsRes.statusText}`);
      }

      return bugsRes.json();
    },
    enabled: open && !!projectId && hasAdoConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Show error toasts
  useEffect(() => {
    if (configError) {
      toast({
        title: "Error",
        description: configError instanceof Error ? configError.message : "Failed to fetch ADO configuration",
        variant: "destructive",
      });
    }
  }, [configError, toast]);

  useEffect(() => {
    if (bugsError) {
      toast({
        title: "Error",
        description: bugsError instanceof Error ? bugsError.message : "Failed to fetch error tracking data",
        variant: "destructive",
      });
    }
  }, [bugsError, toast]);

  const handleRefresh = async () => {
    await refetchBugs();
  };

  const createBug = () => {
    if (adoOrganization && adoProjectName) {
      const url = `https://dev.azure.com/${adoOrganization}/${adoProjectName}/_workitems/create/Bug`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast({
        title: "Configuration Missing",
        description: "Azure DevOps organization and project information not found.",
        variant: "destructive",
      });
    }
  };

  const viewOpenBugs = () => {
    if (adoOrganization && adoProjectName) {
      const url = `https://dev.azure.com/${adoOrganization}/${adoProjectName}/_workitems/recentlyupdated/?type=Bug&state=Active`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast({
        title: "Configuration Missing",
        description: "Azure DevOps organization and project information not found.",
        variant: "destructive",
      });
    }
  };

  const openAppInsights = () => {
    toast({
      title: "Application Insights",
      description: "Application Insights integration requires Azure portal configuration. Please configure Application Insights in your Azure subscription.",
    });
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Error Tracking"
      description="Track and Resolve Errors & Bugs in Production"
      icon={Bug}
      iconClassName="bg-gradient-to-br from-red-500 to-red-600"
      fullScreen={true}
      contentClassName="space-y-6"
    >
      {/* Refresh Button */}
      <div className="flex justify-end -mt-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {!hasAdoConfig ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto" />
              <h3 className="text-lg font-semibold">No Data Available</h3>
              <p className="text-muted-foreground">
                No data is available for this metric at the moment.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading error tracking data...
            </p>
          </CardContent>
          </Card>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="space-y-6 pb-6">
              {/* Error Statistics */}
              {detailView === null ? (
                <div className="space-y-6">
                  {/* Severity Breakdown */}
                  <div>
                    <h3 className="text-sm font-semibold mb-4">Bug Severity Breakdown</h3>
                    <div className="grid grid-cols-4 gap-4">
                      <Card 
                        className="border-red-200 dark:border-red-800 cursor-pointer hover:shadow-lg transition-all"
                        onClick={() => setDetailView('critical')}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            Critical
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-red-600">{bugData?.statistics?.critical || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Unresolved bugs</p>
                        </CardContent>
                      </Card>

                      <Card 
                        className="border-amber-200 dark:border-amber-800 cursor-pointer hover:shadow-lg transition-all"
                        onClick={() => setDetailView('highPriority')}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            High Priority
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-amber-600">{bugData?.statistics?.highPriority || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Unresolved bugs</p>
                        </CardContent>
                      </Card>

                      <Card 
                        className="border-yellow-200 dark:border-yellow-800 cursor-pointer hover:shadow-lg transition-all"
                        onClick={() => setDetailView('mediumSeverity')}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-yellow-600" />
                            Medium Severity
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-yellow-600">{bugData?.statistics?.mediumSeverity || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Unresolved bugs</p>
                        </CardContent>
                      </Card>

                      <Card 
                        className="border-blue-200 dark:border-blue-800 cursor-pointer hover:shadow-lg transition-all"
                        onClick={() => setDetailView('lowSeverity')}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <Info className="h-4 w-4 text-blue-600" />
                            Low Severity
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-blue-600">{bugData?.statistics?.lowSeverity || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Unresolved bugs</p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Resolved vs Unresolved */}
                  <div>
                    <h3 className="text-sm font-semibold mb-4">Resolved vs Unresolved</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <Card className="border-green-200 dark:border-green-800">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            Resolved
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-green-600">{bugData?.statistics?.resolved || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Total resolved bugs</p>
                          {bugData?.statistics?.totalBugs && bugData.statistics.totalBugs > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {Math.round((bugData.statistics.resolved / bugData.statistics.totalBugs) * 100)}% of all bugs
                            </p>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border-red-200 dark:border-red-800">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            Unresolved
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-red-600">{bugData?.statistics?.unresolved || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">Total unresolved bugs</p>
                          {bugData?.statistics?.totalBugs && bugData.statistics.totalBugs > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {Math.round((bugData.statistics.unresolved / bugData.statistics.totalBugs) * 100)}% of all bugs
                            </p>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border-blue-200 dark:border-blue-800">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <Bug className="h-4 w-4 text-blue-600" />
                            Total Bugs
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold text-blue-600">{bugData?.statistics?.totalBugs || 0}</div>
                          <p className="text-xs text-muted-foreground mt-1">All time</p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Bug Age Patterns */}
                  {bugData?.bugAge && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Bug Age Patterns</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Average Age</div>
                              <div className="text-2xl font-bold">{bugData.bugAge.averageAge || 0} days</div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Oldest Bug Age</div>
                              <div className="text-2xl font-bold">{bugData.bugAge.oldestBugAge || 0} days</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium mb-2">Bugs by Age Range</div>
                            <div className="space-y-2">
                              {Object.entries(bugData.bugAge.bugsByAgeRange).map(([range, count]) => (
                                <div key={range} className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">{range}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                      <div
                                        className="bg-blue-500 h-2 rounded-full"
                                        style={{ width: `${bugData.statistics.unresolved > 0 ? (count / bugData.statistics.unresolved) * 100 : 0}%` }}
                                      />
                                    </div>
                                    <span className="text-sm font-semibold w-12 text-right">{count}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Time to Resolution Patterns */}
                  {bugData?.timeToResolution && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Time to Resolution Patterns</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Average Time</div>
                              <div className="text-2xl font-bold">{bugData.timeToResolution.averageTimeToResolution || 0} days</div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Median Time</div>
                              <div className="text-2xl font-bold">{bugData.timeToResolution.medianTimeToResolution || 0} days</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium mb-2">Resolution Time Distribution</div>
                            <div className="space-y-2">
                              {Object.entries(bugData.timeToResolution.resolutionTimeByRange).map(([range, count]) => (
                                <div key={range} className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">{range}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                      <div
                                        className="bg-green-500 h-2 rounded-full"
                                        style={{ width: `${bugData.statistics.resolved > 0 ? (count / bugData.statistics.resolved) * 100 : 0}%` }}
                                      />
                                    </div>
                                    <span className="text-sm font-semibold w-12 text-right">{count}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Resolved This Month */}
                  <Card className="border-green-200 dark:border-green-800">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        Resolved This Month
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-green-600">{bugData?.statistics?.resolvedThisMonth || 0}</div>
                      <p className="text-xs text-muted-foreground mt-1">Bugs resolved in current month</p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                // Detailed Views
                <div className="space-y-4">
                  <Button variant="outline" size="sm" onClick={() => setDetailView(null)}>
                    ← Back to Overview
                  </Button>
                  
                  {detailView === 'critical' && (
                    <Card className="border-red-200 dark:border-red-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <XCircle className="h-6 w-6 text-red-600" />
                          Critical Bugs
                        </CardTitle>
                        <CardDescription>High-severity issues requiring immediate attention</CardDescription>
                      </CardHeader>
                      <CardContent>
                          <div className="space-y-3">
                            {bugData?.recentBugs.filter(bug => bug.severity === 'Critical' && bug.state !== 'Closed').length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                <p>No critical bugs found!</p>
                              </div>
                            ) : (
                              bugData?.recentBugs
                                .filter(bug => bug.severity === 'Critical' && bug.state !== 'Closed')
                                .map((bug) => (
                                  <Card key={bug.id} className="border-red-200">
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              <Badge variant="destructive">#{bug.id}</Badge>
                                              <Badge variant="outline" className="text-red-600 border-red-600">Critical</Badge>
                                              <Badge>{bug.state}</Badge>
                                            </div>
                                            <h4 className="font-semibold mt-2">{bug.title}</h4>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => window.open(bug.url, '_blank')}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Priority</p>
                                            <p className="font-medium">{bug.priority}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Assigned To</p>
                                            <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Created</p>
                                            <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                            )}
                          </div>

                      </CardContent>
                    </Card>
                  )}

                  {detailView === 'highPriority' && (
                    <Card className="border-amber-200 dark:border-amber-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <AlertCircle className="h-6 w-6 text-amber-600" />
                          High Priority Bugs
                        </CardTitle>
                        <CardDescription>Important bugs that need attention soon</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {bugData?.recentBugs.filter(bug => bug.priority === 1 && bug.state !== 'Closed').length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                <p>No high priority bugs found!</p>
                              </div>
                            ) : (
                              bugData?.recentBugs
                                .filter(bug => bug.priority === 1 && bug.state !== 'Closed')
                                .map((bug) => (
                                  <Card key={bug.id} className="border-amber-200">
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              <Badge variant="destructive">#{bug.id}</Badge>
                                              <Badge variant="outline" className="text-amber-600 border-amber-600">{bug.severity}</Badge>
                                              <Badge>{bug.state}</Badge>
                                            </div>
                                            <h4 className="font-semibold mt-2">{bug.title}</h4>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => window.open(bug.url, '_blank')}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Priority</p>
                                            <p className="font-medium">{bug.priority}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Assigned To</p>
                                            <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Created</p>
                                            <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {detailView === 'mediumSeverity' && (
                    <Card className="border-yellow-200 dark:border-yellow-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <AlertCircle className="h-6 w-6 text-yellow-600" />
                          Medium Severity Bugs
                        </CardTitle>
                        <CardDescription>Medium-severity bugs that need attention</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {bugData?.recentBugs.filter(bug => {
                              const severity = bug.severity?.toString() || '';
                              return (severity.includes('Medium') || severity === '3') && bug.state !== 'Closed' && bug.state !== 'Resolved';
                            }).length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                <p>No medium severity bugs found!</p>
                              </div>
                            ) : (
                              bugData?.recentBugs
                                .filter(bug => {
                                  const severity = bug.severity?.toString() || '';
                                  return (severity.includes('Medium') || severity === '3') && bug.state !== 'Closed' && bug.state !== 'Resolved';
                                })
                                .map((bug) => (
                                  <Card key={bug.id} className="border-yellow-200">
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <Badge variant="outline">#{bug.id}</Badge>
                                              <Badge variant="outline" className="text-yellow-600 border-yellow-600">Medium</Badge>
                                              <Badge>{bug.state}</Badge>
                                              {bug.ageInDays !== undefined && (
                                                <Badge variant="secondary">{bug.ageInDays} days old</Badge>
                                              )}
                                            </div>
                                            <h4 className="font-semibold mt-2">{bug.title}</h4>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => window.open(bug.url, '_blank')}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Priority</p>
                                            <p className="font-medium">{bug.priority || 'N/A'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Assigned To</p>
                                            <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Created</p>
                                            <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {detailView === 'lowSeverity' && (
                    <Card className="border-blue-200 dark:border-blue-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Info className="h-6 w-6 text-blue-600" />
                          Low Severity Bugs
                        </CardTitle>
                        <CardDescription>Low-severity bugs that can be addressed when time permits</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {bugData?.recentBugs.filter(bug => {
                              const severity = bug.severity?.toString() || '';
                              return (severity.includes('Low') || severity === '4') && bug.state !== 'Closed' && bug.state !== 'Resolved';
                            }).length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                <p>No low severity bugs found!</p>
                              </div>
                            ) : (
                              bugData?.recentBugs
                                .filter(bug => {
                                  const severity = bug.severity?.toString() || '';
                                  return (severity.includes('Low') || severity === '4') && bug.state !== 'Closed' && bug.state !== 'Resolved';
                                })
                                .map((bug) => (
                                  <Card key={bug.id} className="border-blue-200">
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <Badge variant="outline">#{bug.id}</Badge>
                                              <Badge variant="outline" className="text-blue-600 border-blue-600">Low</Badge>
                                              <Badge>{bug.state}</Badge>
                                              {bug.ageInDays !== undefined && (
                                                <Badge variant="secondary">{bug.ageInDays} days old</Badge>
                                              )}
                                            </div>
                                            <h4 className="font-semibold mt-2">{bug.title}</h4>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => window.open(bug.url, '_blank')}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Priority</p>
                                            <p className="font-medium">{bug.priority || 'N/A'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Assigned To</p>
                                            <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Created</p>
                                            <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {detailView === 'totalBugs' && (
                    <Card className="border-blue-200 dark:border-blue-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Bug className="h-6 w-6 text-blue-600" />
                          All Bugs
                        </CardTitle>
                        <CardDescription>Complete list of all bugs in the system</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {bugData?.recentBugs.length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                <p>No bugs found!</p>
                              </div>
                            ) : (
                              bugData?.recentBugs.map((bug) => (
                                <Card key={bug.id} className="border-blue-200">
                                  <CardContent className="pt-4">
                                    <div className="space-y-3">
                                      <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2">
                                            <Badge variant="destructive">#{bug.id}</Badge>
                                            <Badge variant="outline" className={`${
                                              bug.severity === 'Critical' ? 'text-red-600 border-red-600' :
                                              bug.severity === 'High' ? 'text-amber-600 border-amber-600' :
                                              'text-blue-600 border-blue-600'
                                            }`}>{bug.severity}</Badge>
                                            <Badge variant={bug.state === 'Closed' ? 'secondary' : 'default'}>{bug.state}</Badge>
                                          </div>
                                          <h4 className="font-semibold mt-2">{bug.title}</h4>
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => window.open(bug.url, '_blank')}
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </Button>
                                      </div>
                                      <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                        <div>
                                          <p className="text-muted-foreground">Priority</p>
                                          <p className="font-medium">{bug.priority}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Assigned To</p>
                                          <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Created</p>
                                          <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {detailView === 'resolvedThisMonth' && (
                    <Card className="border-green-200 dark:border-green-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <CheckCircle2 className="h-6 w-6 text-green-600" />
                          Resolved Bugs This Month
                        </CardTitle>
                        <CardDescription>Bugs that were successfully resolved in the current month</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {bugData?.recentBugs.filter(bug => {
                              const bugDate = new Date(bug.createdDate);
                              const now = new Date();
                              return bug.state === 'Closed' && 
                                     bugDate.getMonth() === now.getMonth() && 
                                     bugDate.getFullYear() === now.getFullYear();
                            }).length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground">
                                <Bug className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                                <p>No bugs resolved this month</p>
                              </div>
                            ) : (
                              bugData?.recentBugs
                                .filter(bug => {
                                  const bugDate = new Date(bug.createdDate);
                                  const now = new Date();
                                  return bug.state === 'Closed' && 
                                         bugDate.getMonth() === now.getMonth() && 
                                         bugDate.getFullYear() === now.getFullYear();
                                })
                                .map((bug) => (
                                  <Card key={bug.id} className="border-green-200">
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              <Badge variant="secondary">#{bug.id}</Badge>
                                              <Badge variant="outline" className="text-green-600 border-green-600">{bug.severity}</Badge>
                                              <Badge variant="secondary" className="bg-green-100 text-green-700">Resolved</Badge>
                                            </div>
                                            <h4 className="font-semibold mt-2">{bug.title}</h4>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => window.open(bug.url, '_blank')}
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Priority</p>
                                            <p className="font-medium">{bug.priority}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Assigned To</p>
                                            <p className="font-medium">{bug.assignedTo || 'Unassigned'}</p>
                                          </div>
                                          <div>
                                            <p className="text-muted-foreground">Resolved</p>
                                            <p className="font-medium">{new Date(bug.createdDate).toLocaleDateString()}</p>
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Quick Actions */}
              {detailView === null && (
                <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                  <CardHeader>
                    <CardTitle className="text-sm">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={createBug}
                        disabled={!adoOrganization || !adoProjectName}
                      >
                        <Bug className="h-4 w-4 mr-2" />
                        Create Bug
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={viewOpenBugs}
                        disabled={!adoOrganization || !adoProjectName}
                      >
                        <AlertCircle className="h-4 w-4 mr-2" />
                        View Open Bugs
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={openAppInsights}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      App Insights
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </div>
          </div>
        )}
    </GenericModal>
  );
}



