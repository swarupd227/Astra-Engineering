import { useState, useEffect } from "react";
import { GenericModal } from "@/components/ui/generic-modal";
import { getIntegrationLabels } from "@/lib/integration-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Mail,
  MessageSquare,
  Webhook,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Search,
  Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api-config";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface AlertsModalProps {
  projectId: string;
  adoProject?: ADOProject | null;
  open: boolean;
  onClose: () => void;
  integrationType?: 'ado' | 'jira';
}

type AlertType = 'pipelineFailure' | 'deploymentError' | 'environmentWarning' | 'pendingApproval' | 'rolloutIssue' | 'systemWarning';

interface Alert {
  id: string;
  type: AlertType;
  category: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timestamp: string;
  ageInHours: number;
  status: 'active' | 'resolved' | 'pending';
  resolvedAt?: string;
  metadata?: any;
}

interface AlertsData {
  statistics: {
    activeAlerts: number;
    pipelineFailures: number;
    deploymentErrors: number;
    environmentWarnings: number;
    pendingApprovals: number;
    rolloutIssues: number;
    systemWarnings: number;
    resolvedToday: number;
    pendingTooLong: number;
    // Legacy fields
    buildFailures?: number;
    pending?: number;
  };
  alerts: Alert[];
  alertsByCategory: {
    pipelineFailures: Alert[];
    deploymentErrors: Alert[];
    environmentWarnings: Alert[];
    pendingApprovals: Alert[];
    rolloutIssues: Alert[];
    systemWarnings: Alert[];
  };
  trends: {
    alertsByDay: Array<{
      day: string;
      active: number;
      resolved: number;
    }>;
  };
  // Legacy fields for backward compatibility
  recentFailures?: Array<{
    id: number;
    buildNumber: string;
    definitionName: string;
    result: string;
    status?: string;
    finishTime: string;
    requestedFor: string;
  }>;
  recentPending?: Array<{
    id: number;
    buildNumber: string;
    definitionName: string;
    result: string;
    status?: string;
    finishTime: string;
    requestedFor: string;
  }>;
  recentResolved?: Array<{
    id: number;
    buildNumber: string;
    definitionName: string;
    result: string;
    status?: string;
    finishTime: string;
    requestedFor: string;
  }>;
}

type AlertDetailView = 'activeAlerts' | 'pipelineFailures' | 'deploymentErrors' | 'environmentWarnings' | 'pendingApprovals' | 'rolloutIssues' | 'systemWarnings' | 'resolvedToday' | 'trends' | 'buildFailures' | 'pending' | null;

export function AlertsModal({ projectId, adoProject, open, onClose, integrationType = 'ado' }: AlertsModalProps) {
  const { toast } = useToast();
  
  const [detailView, setDetailView] = useState<AlertDetailView>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());

  // Build query params for ADO project info
  const params = new URLSearchParams();
  if (adoProject?.organization) {
    params.append('organization', adoProject.organization);
  }
  if (adoProject?.name) {
    params.append('projectName', adoProject.name);
  }
  const queryString = params.toString();

  // Fetch ADO config (cached) - only if we don't have adoProject
  const { data: adoConfig, error: configError } = useQuery<{ hasConfig: boolean; organization: string; project: string }>({
    queryKey: [`/api/sdlc/projects/${projectId}/ado-config`, queryString],
    queryFn: async () => {
      const configUrl = getApiUrl(`/api/sdlc/projects/${projectId}/ado-config${queryString ? `?${queryString}` : ''}`);
      console.log('[Alerts Modal] Fetching ADO config from:', configUrl);
      const configRes = await fetch(configUrl, { credentials: "include" });
      
      if (!configRes.ok) {
        const errorText = await configRes.text();
        console.error('[Alerts Modal] Failed to fetch ADO config:', configRes.status, errorText);
        throw new Error(`Configuration check failed: ${configRes.status} ${configRes.statusText}`);
      }

      const data = await configRes.json();
      console.log('[Alerts Modal] ADO config received:', data);
      return data;
    },
    enabled: open && !!projectId && !adoProject?.organization && integrationType === 'ado', // Only fetch if we don't have adoProject and it's ADO
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

  // Fetch alerts data (cached)
  const { 
    data: alertsData, 
    isLoading: loading, 
    isFetching: refreshing,
    error: alertsError,
    refetch: refetchAlerts 
  } = useQuery<AlertsData>({
    queryKey: ['/api/sdlc/projects', projectId, 'maintenance/alerts', adoOrganization, adoProjectName],
    queryFn: async () => {
      const alertsUrl = getApiUrl(`/api/sdlc/projects/${projectId}/maintenance/alerts${maintenanceQueryString ? `?${maintenanceQueryString}` : ''}`);
      console.log('[Alerts Modal] Fetching alerts from:', alertsUrl);
      const alertsRes = await fetch(alertsUrl, { credentials: "include" });
      
      if (!alertsRes.ok) {
        const errorText = await alertsRes.text();
        console.error('[Alerts Modal] Failed to fetch alerts:', alertsRes.status, errorText);
        throw new Error(`Failed to fetch alerts: ${alertsRes.status} ${alertsRes.statusText}`);
      }

      const data = await alertsRes.json();
      console.log('[Alerts Modal] Alerts data received:', data);
      return data;
    },
    enabled: open && !!projectId && (integrationType === 'jira' || hasAdoConfig || !!adoProject?.organization),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Debug logging
  useEffect(() => {
    console.log('[Alerts Modal] State:', {
      open,
      projectId,
      hasAdoConfig,
      adoOrganization,
      adoProjectName,
      adoProject: adoProject ? { organization: adoProject.organization, name: adoProject.name } : null,
      queryEnabled: open && !!projectId && (hasAdoConfig || !!adoProject?.organization),
      loading,
      alertsData: alertsData ? 'present' : 'missing'
    });
  }, [open, projectId, hasAdoConfig, adoOrganization, adoProjectName, adoProject, loading, alertsData]);

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
    if (alertsError) {
      toast({
        title: "Error",
        description: alertsError instanceof Error ? alertsError.message : "Failed to fetch alerts data",
        variant: "destructive",
      });
    }
  }, [alertsError, toast]);

  // Fetch assignees from ADO for filter
  const { data: assigneesData, error: assigneesError } = useQuery<{ members: Array<{ displayName: string; uniqueName: string; id: string }> }>({
    queryKey: ['/api/sdlc/projects', projectId, 'team-members', adoOrganization, adoProjectName],
    queryFn: async () => {
      const membersUrl = getApiUrl(`/api/sdlc/projects/${projectId}/team-members?organization=${adoOrganization}&projectName=${adoProjectName}`);
      console.log('[Alerts Modal] Fetching team members from:', membersUrl);
      const membersRes = await fetch(membersUrl, { credentials: "include" });
      if (!membersRes.ok) {
        const errorText = await membersRes.text();
        console.error('[Alerts Modal] Failed to fetch team members:', membersRes.status, errorText);
        return { members: [] };
      }
      const data = await membersRes.json();
      console.log('[Alerts Modal] Team members fetched:', data.members?.length || 0);
      return data;
    },
    enabled: open && !!projectId && integrationType === 'ado' && hasAdoConfig && !!adoOrganization && !!adoProjectName,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Log assignees error
  useEffect(() => {
    if (assigneesError) {
      console.error('[Alerts Modal] Error fetching assignees:', assigneesError);
    }
  }, [assigneesError]);

  const handleRefresh = async () => {
    await refetchAlerts();
  };

  // Handle acknowledge
  const handleAcknowledge = async (alertId: string) => {
    try {
      const acknowledgeUrl = getApiUrl(`/api/sdlc/projects/${projectId}/maintenance/alerts/${alertId}/acknowledge`);
      console.log('[Alerts Modal] Acknowledging alert:', acknowledgeUrl, alertId);
      
      const response = await fetch(acknowledgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ acknowledgedBy: 'Current User' }) // In production, use actual user
      });

      console.log('[Alerts Modal] Acknowledge response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Alerts Modal] Acknowledge failed:', response.status, errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Failed to acknowledge alert' };
        }
        throw new Error(errorData.error || 'Failed to acknowledge alert');
      }

      const result = await response.json();
      console.log('[Alerts Modal] Acknowledge result:', result);
      
      if (result.success) {
        setAcknowledgedAlerts(prev => new Set([...prev, alertId]));
        toast({
          title: "Alert Acknowledged",
          description: "The alert has been acknowledged.",
        });
      } else {
        throw new Error('Acknowledgment failed');
      }
    } catch (error) {
      console.error('[Alerts Modal] Error acknowledging alert:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to acknowledge alert",
        variant: "destructive",
      });
    }
  };

  // Get alerts that require immediate attention (critical/high priority active)
  const getImmediateAttentionAlerts = (alerts: Alert[]) => {
    return alerts.filter(a => 
      a.status === 'active' && (a.severity === 'critical' || a.severity === 'high')
    ).sort((a, b) => {
      // Sort by severity first (critical > high), then by age (oldest first)
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (a.severity !== 'critical' && b.severity === 'critical') return 1;
      return b.ageInHours - a.ageInHours; // Older alerts first
    });
  };

  // Get alerts that have been pending too long (more than 24 hours)
  const getPendingTooLongAlerts = (alerts: Alert[]) => {
    return alerts.filter(a => 
      (a.status === 'pending' || a.status === 'active') && a.ageInHours > 24
    ).sort((a, b) => b.ageInHours - a.ageInHours); // Oldest first
  };

  // Filter alerts based on search and filters
  const getFilteredAlerts = (alerts: Alert[]) => {
    return alerts.filter(alert => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!alert.title.toLowerCase().includes(query) && 
            !alert.description.toLowerCase().includes(query) &&
            !alert.category.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Status filter
      if (filterStatus !== 'all') {
        if (filterStatus === 'firing' && alert.status !== 'active') return false;
        if (filterStatus === 'resolved' && alert.status !== 'resolved') return false;
        if (filterStatus === 'pending' && alert.status !== 'pending') return false;
        if (filterStatus === 'acknowledged' && !acknowledgedAlerts.has(alert.id)) return false;
      }

      // Severity filter
      if (filterSeverity !== 'all' && alert.severity !== filterSeverity) {
        return false;
      }

      // Assignee filter
      if (filterAssignee !== 'all') {
        const assignee = alert.metadata?.requestedFor || alert.metadata?.approver || '';
        if (assignee !== filterAssignee) return false;
      }

      return true;
    });
  };

  const configureAlerts = () => {
    if (adoOrganization && adoProjectName) {
      const url = `https://dev.azure.com/${adoOrganization}/${adoProjectName}/_settings/notifications`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast({
        title: "Configuration Missing",
        description: "Azure DevOps organization and project information not found.",
        variant: "destructive",
      });
    }
  };

  const openServiceHooks = () => {
    if (adoOrganization && adoProjectName) {
      const url = `https://dev.azure.com/${adoOrganization}/${adoProjectName}/_settings/serviceHooks`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast({
        title: "Configuration Missing",
        description: "Azure DevOps organization and project information not found.",
        variant: "destructive",
      });
    }
  };

  const openEmailSettings = () => {
    if (adoOrganization) {
      const url = `https://dev.azure.com/${adoOrganization}/_settings/notifications`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast({
        title: "Configuration Missing",
        description: "Azure DevOps organization information not found.",
        variant: "destructive",
      });
    }
  };

  return (
    <GenericModal
      open={open}
      onOpenChange={onClose}
      title="Alerts"
      description="Issues requiring immediate or upcoming attention: Pipeline failures, Deployment errors, Environment warnings, Pending approvals, Rollout issues, and System warnings from external monitors"
      icon={Bell}
      iconClassName="bg-gradient-to-br from-amber-500 to-amber-600"
      fullScreen={true}
      contentClassName="space-y-6"
      headerActions={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="h-8 w-8 p-0 flex items-center justify-center"
                aria-label="Refresh monitoring data"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            }
    >
      

      {!hasAdoConfig && integrationType === 'ado' ? (
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
      ) : integrationType === 'jira' && !alertsData ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <Bell className="h-12 w-12 text-blue-500 mx-auto" />
              <h3 className="text-lg font-semibold">{getIntegrationLabels(integrationType).name} Monitoring</h3>
              <p className="text-muted-foreground mt-2">
                Monitoring alerts for {getIntegrationLabels(integrationType).name} projects are currently limited to system-level notifications.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading alerts data...
            </p>
          </CardContent>
          </Card>
        ) : (
          <ScrollArea className="flex-1 h-[calc(90vh-120px)]">
            <div className="space-y-6 pb-6 pr-4">
            {/* Alert Statistics and Categories - Only show in overview */}
            {detailView === null && (
              <>
                <div className="grid grid-cols-4 gap-4">
                    <Card 
                      className="border-amber-200 dark:border-amber-800 cursor-pointer hover:shadow-lg transition-all"
                      onClick={() => setDetailView('activeAlerts')}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <Bell className="h-4 w-4 text-amber-600" />
                          Active Alerts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-amber-600">{alertsData?.statistics?.activeAlerts || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Currently active</p>
                      </CardContent>
                    </Card>

                    <Card 
                      className="border-red-200 dark:border-red-800 cursor-pointer hover:shadow-lg transition-all"
                      onClick={() => setDetailView('buildFailures')}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          Build Failures
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-red-600">{alertsData?.statistics?.buildFailures || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Last 24 hours</p>
                      </CardContent>
                    </Card>

                    <Card 
                      className="border-blue-200 dark:border-blue-800 cursor-pointer hover:shadow-lg transition-all"
                      onClick={() => setDetailView('pending')}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <Clock className="h-4 w-4 text-blue-600" />
                          Pending
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-blue-600">{alertsData?.statistics?.pending || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Awaiting action</p>
                      </CardContent>
                    </Card>

                    <Card 
                      className="border-green-200 dark:border-green-800 cursor-pointer hover:shadow-lg transition-all"
                      onClick={() => setDetailView('resolvedToday')}
                    >
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          Resolved
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-green-600">{alertsData?.statistics?.resolvedToday || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Today</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Alert Categories Breakdown */}
                  {alertsData && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3">Alert Categories</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <Card 
                          className="border-red-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('pipelineFailures')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">Pipeline Failures</div>
                                <div className="text-2xl font-bold text-red-600">
                                  {alertsData?.statistics?.pipelineFailures || 0}
                                </div>
                              </div>
                              <XCircle className="h-8 w-8 text-red-600" />
                            </div>
                          </CardContent>
                        </Card>

                        <Card 
                          className="border-orange-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('deploymentErrors')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">Deployment Errors</div>
                                <div className="text-2xl font-bold text-orange-600">
                                  {alertsData?.statistics?.deploymentErrors || 0}
                                </div>
                              </div>
                              <AlertTriangle className="h-8 w-8 text-orange-600" />
                            </div>
                          </CardContent>
                        </Card>

                        <Card 
                          className="border-yellow-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('environmentWarnings')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">Environment Warnings</div>
                                <div className="text-2xl font-bold text-yellow-600">
                                  {alertsData?.statistics?.environmentWarnings || 0}
                                </div>
                              </div>
                              <AlertTriangle className="h-8 w-8 text-yellow-600" />
                            </div>
                          </CardContent>
                        </Card>

                        <Card 
                          className="border-blue-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('pendingApprovals')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">Pending Approvals</div>
                                <div className="text-2xl font-bold text-blue-600">
                                  {alertsData?.statistics?.pendingApprovals || 0}
                                </div>
                              </div>
                              <Clock className="h-8 w-8 text-blue-600" />
                            </div>
                          </CardContent>
                        </Card>

                        <Card 
                          className="border-purple-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('rolloutIssues')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">Rollout Issues</div>
                                <div className="text-2xl font-bold text-purple-600">
                                  {alertsData?.statistics?.rolloutIssues || 0}
                                </div>
                              </div>
                              <AlertCircle className="h-8 w-8 text-purple-600" />
                            </div>
                          </CardContent>
                        </Card>

                        <Card 
                          className="border-cyan-200 cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => setDetailView('systemWarnings')}
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-muted-foreground">System Warnings</div>
                                <div className="text-2xl font-bold text-cyan-600">
                                  {alertsData?.statistics?.systemWarnings || 0}
                                </div>
                              </div>
                              <AlertTriangle className="h-8 w-8 text-cyan-600" />
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}
              </>
            )}

            {/* Detail Views */}
            {detailView !== null && (
              <div className="space-y-4">
                  <Button variant="outline" size="sm" onClick={() => setDetailView(null)}>
                    ← Back to Overview
                  </Button>
                  {detailView === 'trends' ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Bell className="h-6 w-6 text-amber-600" /> Alert Trends
                        </CardTitle>
                        <CardDescription>Alert trends over the last 7 days</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {alertsData?.trends?.alertsByDay?.map((day, idx) => (
                            <div key={idx} className="space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">
                                  {new Date(day.day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                                </span>
                                <div className="flex items-center gap-4">
                                  <span className="text-red-600 font-semibold">{day.active} active</span>
                                  <span className="text-green-600 font-semibold">{day.resolved} resolved</span>
                                </div>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 flex overflow-hidden">
                                <div
                                  className="bg-red-500 h-2 transition-all"
                                  style={{ width: `${day.active + day.resolved > 0 ? (day.active / (day.active + day.resolved)) * 100 : 0}%` }}
                                />
                                <div
                                  className="bg-green-500 h-2 transition-all"
                                  style={{ width: `${day.active + day.resolved > 0 ? (day.resolved / (day.active + day.resolved)) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className={
                      detailView === 'activeAlerts' ? 'border-amber-200' :
                      detailView === 'pipelineFailures' ? 'border-red-200' :
                      detailView === 'deploymentErrors' ? 'border-orange-200' :
                      detailView === 'environmentWarnings' ? 'border-yellow-200' :
                      detailView === 'pendingApprovals' ? 'border-blue-200' :
                      detailView === 'rolloutIssues' ? 'border-purple-200' :
                      detailView === 'systemWarnings' ? 'border-cyan-200' :
                      'border-green-200'
                    }>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {detailView === 'activeAlerts' && (
                            <>
                              <Bell className="h-6 w-6 text-amber-600" /> Active Alerts
                            </>
                          )}
                          {detailView === 'pipelineFailures' && (
                            <>
                              <XCircle className="h-6 w-6 text-red-600" /> Pipeline Failures
                            </>
                          )}
                          {detailView === 'deploymentErrors' && (
                            <>
                              <AlertTriangle className="h-6 w-6 text-orange-600" /> Deployment Errors
                            </>
                          )}
                          {detailView === 'environmentWarnings' && (
                            <>
                              <AlertTriangle className="h-6 w-6 text-yellow-600" /> Environment Warnings
                            </>
                          )}
                          {detailView === 'pendingApprovals' && (
                            <>
                              <Clock className="h-6 w-6 text-blue-600" /> Pending Approvals
                            </>
                          )}
                          {detailView === 'rolloutIssues' && (
                            <>
                              <AlertCircle className="h-6 w-6 text-purple-600" /> Rollout Issues
                            </>
                          )}
                          {detailView === 'systemWarnings' && (
                            <>
                              <AlertTriangle className="h-6 w-6 text-cyan-600" /> System Warnings
                            </>
                          )}
                          {detailView === 'resolvedToday' && (
                            <>
                              <CheckCircle2 className="h-6 w-6 text-green-600" /> Resolved Today
                            </>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {detailView === 'activeAlerts' && 'Currently active alerts requiring immediate attention'}
                          {detailView === 'pipelineFailures' && 'Build pipeline failures from the last 24 hours'}
                          {detailView === 'deploymentErrors' && 'Failed release deployments'}
                          {detailView === 'environmentWarnings' && 'Environment-level warnings and partial failures'}
                          {detailView === 'pendingApprovals' && 'Release approvals awaiting action'}
                          {detailView === 'rolloutIssues' && 'Deployments stuck in progress'}
                          {detailView === 'systemWarnings' && 'System warnings from builds, releases, and external monitoring systems'}
                          {detailView === 'resolvedToday' && 'Alerts resolved in the current day'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Search and Filters */}
                        <div className="mb-4 space-y-3">
                          <div className="flex gap-3">
                            <div className="flex-1 relative">
                              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Search alerts..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                              />
                            </div>
                            <Select value={filterStatus} onValueChange={setFilterStatus}>
                              <SelectTrigger className="w-[150px]">
                                <Filter className="h-4 w-4 mr-2" />
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="firing">Firing</SelectItem>
                                <SelectItem value="resolved">Resolved</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                              <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="Severity" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Severity</SelectItem>
                                <SelectItem value="critical">Critical</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                              <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Assignee" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Assignees</SelectItem>
                                {assigneesData?.members?.map((member) => (
                                  <SelectItem key={member.id} value={member.displayName}>
                                    {member.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <ScrollArea className="h-[500px] pr-4">
                          <div className="space-y-3">
                            {(() => {
                              if (!alertsData) {
                                return (
                                  <div className="text-center py-8 text-muted-foreground">
                                    <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                    <p>No alerts data available</p>
                                  </div>
                                );
                              }
                              
                              // Get alerts based on detail view
                              let alertsToShow: Alert[] = [];
                              
                              if (detailView === 'activeAlerts') {
                                alertsToShow = alertsData.alerts.filter(a => a.status === 'active');
                              } else if (detailView === 'pipelineFailures') {
                                alertsToShow = alertsData.alertsByCategory?.pipelineFailures || [];
                              } else if (detailView === 'deploymentErrors') {
                                alertsToShow = alertsData.alertsByCategory?.deploymentErrors || [];
                              } else if (detailView === 'environmentWarnings') {
                                alertsToShow = alertsData.alertsByCategory?.environmentWarnings || [];
                              } else if (detailView === 'pendingApprovals') {
                                alertsToShow = alertsData.alertsByCategory?.pendingApprovals || [];
                              } else if (detailView === 'rolloutIssues') {
                                alertsToShow = alertsData.alertsByCategory?.rolloutIssues || [];
                              } else if (detailView === 'systemWarnings') {
                                alertsToShow = alertsData.alertsByCategory?.systemWarnings || [];
                              } else if (detailView === 'resolvedToday') {
                                // For resolved, show from legacy data or filter resolved alerts
                                alertsToShow = alertsData.alerts.filter(a => a.status === 'resolved') || [];
                              }
                              
                              // Apply filters
                              alertsToShow = getFilteredAlerts(alertsToShow);
                              
                              if (alertsToShow.length === 0) {
                                return (
                                  <div className="text-center py-8 text-muted-foreground">
                                    <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
                                    <p>No alerts found</p>
                                  </div>
                                );
                              }
                              
                              const severityColors = {
                                critical: 'text-red-600 border-red-600 bg-red-50 dark:bg-red-950/20',
                                high: 'text-orange-600 border-orange-600 bg-orange-50 dark:bg-orange-950/20',
                                medium: 'text-yellow-600 border-yellow-600 bg-yellow-50 dark:bg-yellow-950/20',
                                low: 'text-blue-600 border-blue-600 bg-blue-50 dark:bg-blue-950/20'
                              };
                              
                              return alertsToShow.map((alert) => {
                                const alertTime = new Date(alert.timestamp);
                                const isPendingTooLong = alert.status === 'pending' && alert.ageInHours > 24;
                                
                                return (
                                  <Card 
                                    key={alert.id} 
                                    className={`border ${severityColors[alert.severity]?.split(' ')[0] || 'border-gray-200'}`}
                                  >
                                    <CardContent className="pt-4">
                                      <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <Badge 
                                                variant="outline" 
                                                className={severityColors[alert.severity] || ''}
                                              >
                                                {alert.severity.toUpperCase()}
                                              </Badge>
                                              <Badge variant="secondary">{alert.category}</Badge>
                                              {isPendingTooLong && (
                                                <Badge variant="destructive">Pending Too Long</Badge>
                                              )}
                                              {alert.status === 'active' && (
                                                <Badge variant="outline" className="text-amber-600 border-amber-600">Active</Badge>
                                              )}
                                            </div>
                                            <h4 className="font-semibold mt-2">{alert.title}</h4>
                                            <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 text-sm pt-3 border-t">
                                          <div>
                                            <p className="text-muted-foreground">Timestamp</p>
                                            <p className="font-medium">{alertTime.toLocaleString()}</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                              {alert.ageInHours < 1 
                                                ? `${Math.round(alert.ageInHours * 60)} minutes ago`
                                                : `${Math.round(alert.ageInHours)} hours ago`}
                                            </p>
                                          </div>
                                          <div>
                                            {alert.metadata && (
                                              <div>
                                                {alert.metadata.buildNumber && (
                                                  <div>
                                                    <p className="text-muted-foreground">Build</p>
                                                    <p className="font-medium">#{alert.metadata.buildNumber}</p>
                                                  </div>
                                                )}
                                                {alert.metadata.environmentName && (
                                                  <div>
                                                    <p className="text-muted-foreground">Environment</p>
                                                    <p className="font-medium">{alert.metadata.environmentName}</p>
                                                  </div>
                                                )}
                                                {alert.metadata.releaseName && (
                                                  <div>
                                                    <p className="text-muted-foreground">Release</p>
                                                    <p className="font-medium">{alert.metadata.releaseName}</p>
                                                  </div>
                                                )}
                                                {alert.metadata.approver && (
                                                  <div>
                                                    <p className="text-muted-foreground">Approver</p>
                                                    <p className="font-medium">{alert.metadata.approver}</p>
                                                  </div>
                                                )}
                                                {alert.metadata.source && (
                                                  <div>
                                                    <p className="text-muted-foreground">Source</p>
                                                    <p className="font-medium">
                                                      {alert.metadata.source === 'external-monitor' 
                                                        ? 'External Monitor' 
                                                        : alert.metadata.source === 'build-pipeline'
                                                        ? 'Build Pipeline'
                                                        : alert.metadata.source === 'release-pipeline'
                                                        ? 'Release Pipeline'
                                                        : alert.metadata.source}
                                                    </p>
                                                  </div>
                                                )}
                                                {alert.metadata.monitorSystem && (
                                                  <div>
                                                    <p className="text-muted-foreground">Monitor System</p>
                                                    <p className="font-medium">{alert.metadata.monitorSystem}</p>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {/* Acknowledge Button */}
                                        {alert.status === 'active' && !acknowledgedAlerts.has(alert.id) && (
                                          <div className="pt-3 border-t">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleAcknowledge(alert.id)}
                                              className="w-full"
                                            >
                                              Acknowledge
                                            </Button>
                                          </div>
                                        )}
                                        {acknowledgedAlerts.has(alert.id) && (
                                          <div className="pt-3 border-t">
                                            <Badge variant="outline" className="text-green-600 border-green-600">
                                              Acknowledged
                                            </Badge>
                                          </div>
                                        )}
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              });
                            })()}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Quick Actions */}
              {detailView === null && (
              <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                <CardHeader>
                  <CardTitle className="text-sm">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={configureAlerts}
                      disabled={!adoOrganization || !adoProjectName}
                    >
                      <Bell className="h-4 w-4 mr-2" />
                      Configure Alerts
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={openServiceHooks}
                      disabled={!adoOrganization || !adoProjectName}
                    >
                      <Webhook className="h-4 w-4 mr-2" />
                      Service Hooks
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={openEmailSettings}
                      disabled={!adoOrganization}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Email Settings
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </div>
          </ScrollArea>
        )}
    </GenericModal>
  );
}



