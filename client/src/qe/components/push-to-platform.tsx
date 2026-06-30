import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { 
  Upload, 
  ChevronDown, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  Cloud,
  Database,
  FileText,
  TestTube,
  Layers,
  BarChart3,
  Settings
} from "lucide-react";
import { Link } from "wouter";

interface ConnectedIntegration {
  id: string;
  platform: string;
  name: string;
  lastSyncedAt: string | null;
}

interface TestCaseForPush {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  priority?: string;
  steps?: Array<{ action: string; expected?: string }>;
  test_steps?: Array<{ action: string; expected_behavior?: string }>;
}

interface PushToPlatformProps {
  testCases: TestCaseForPush[];
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}

const platformIcons: Record<string, React.ReactNode> = {
  azure_devops: <Cloud className="w-4 h-4" />,
  jira: <Database className="w-4 h-4" />,
  zephyr: <TestTube className="w-4 h-4" />,
  testrail: <FileText className="w-4 h-4" />,
  qtest: <Layers className="w-4 h-4" />,
  qmetry: <BarChart3 className="w-4 h-4" />,
};

const platformNames: Record<string, string> = {
  azure_devops: "Azure DevOps",
  jira: "JIRA",
  zephyr: "Zephyr",
  testrail: "TestRail",
  qtest: "qTest",
  qmetry: "QMetry",
};

export function PushToPlatform({ 
  testCases, 
  disabled = false, 
  variant = "outline",
  size = "default",
  className 
}: PushToPlatformProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<ConnectedIntegration | null>(null);
  const { toast } = useToast();

  const { data: integrationsData, isLoading } = useQuery<{ success: boolean; integrations: ConnectedIntegration[] }>({
    queryKey: ["/api/integrations/connected"],
  });

  const connectedIntegrations = integrationsData?.integrations || [];

  const pushMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      const response = await apiRequest("POST", `/api/integrations/${integrationId}/push-test-cases`, {
        testCases,
      });
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: "Test Cases Pushed",
          description: result.message || `Successfully pushed ${result.pushedCount} test cases`,
        });
      } else {
        toast({
          title: "Push Failed",
          description: result.error || "Failed to push test cases",
          variant: "destructive",
        });
      }
      setShowConfirmDialog(false);
      setSelectedIntegration(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to push test cases",
        variant: "destructive",
      });
    },
  });

  const handleSelectIntegration = (integration: ConnectedIntegration) => {
    setSelectedIntegration(integration);
    setShowConfirmDialog(true);
  };

  const handleConfirmPush = () => {
    if (selectedIntegration) {
      pushMutation.mutate(selectedIntegration.id);
    }
  };

  const hasTestCases = testCases.length > 0;
  const hasConnectedIntegrations = connectedIntegrations.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled || !hasTestCases || isLoading}
            className={cn("gap-2", className)}
            data-testid="button-push-to-platform"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Push to Platform
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {!hasConnectedIntegrations ? (
            <div className="px-3 py-4 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-2">
                <Settings className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                No connected integrations
              </p>
              <Link href="/integration-management">
                <Button size="sm" variant="outline" className="w-full">
                  Configure Integrations
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Connected Platforms
              </div>
              {connectedIntegrations.map((integration) => (
                <DropdownMenuItem
                  key={integration.id}
                  onClick={() => handleSelectIntegration(integration)}
                  className="cursor-pointer"
                  data-testid={`menu-item-${integration.platform}`}
                >
                  <div className="flex items-center gap-2 flex-1">
                    {platformIcons[integration.platform]}
                    <span>{platformNames[integration.platform] || integration.name}</span>
                  </div>
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">
                    Connected
                  </Badge>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <Link href="/integration-management">
                <DropdownMenuItem className="cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage Integrations
                </DropdownMenuItem>
              </Link>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedIntegration && platformIcons[selectedIntegration.platform]}
              Push to {selectedIntegration && (platformNames[selectedIntegration.platform] || selectedIntegration.name)}
            </DialogTitle>
            <DialogDescription>
              You are about to push {testCases.length} test case{testCases.length !== 1 ? 's' : ''} to {selectedIntegration && (platformNames[selectedIntegration.platform] || selectedIntegration.name)}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Test Cases</span>
              <span className="font-medium">{testCases.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Target Platform</span>
              <span className="font-medium">{selectedIntegration && (platformNames[selectedIntegration.platform] || selectedIntegration.name)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              disabled={pushMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmPush}
              disabled={pushMutation.isPending}
              data-testid="button-confirm-push"
            >
              {pushMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pushing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Push Test Cases
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
