import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { UserCog, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { JiraConnectCard, type JiraCredentialStatus } from "@/components/profile-setup/jira-connect-card";
import { GitlabConnectCard, type GitlabCredentialStatus } from "@/components/profile-setup/gitlab-connect-card";

export default function ProfileSetup() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: jira } = useQuery<JiraCredentialStatus>({ queryKey: ["/api/user/jira-credentials"] });
  const { data: gitlab } = useQuery<GitlabCredentialStatus>({ queryKey: ["/api/user/gitlab-credentials"] });

  const bothConnected = Boolean(jira?.connected) && Boolean(gitlab?.connected);

  const finishMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/user/complete-onboarding"),
    onSuccess: async () => {
      toast({ title: "All set!", description: "Your profile is configured. Welcome aboard." });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      navigate("/overview");
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't finish setup",
        description: err.message || "Make sure both your JIRA and GitLab tokens are valid.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={UserCog}
        title="Profile Setup"
        subtitle="Manage personal credentials used for Jira and repository actions"
        color="violet"
      />

      <p className="text-sm text-muted-foreground max-w-3xl">
        Every external action is attributed to your own account. You can add credentials here, or connect them
        later from the organization and project screens when a specific Jira site or repository needs access.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <JiraConnectCard />
        <GitlabConnectCard />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <span className="text-sm text-muted-foreground">
          {bothConnected ? "Both accounts connected" : "Credentials can also be connected later"}
        </span>
        <Button onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}>
          {finishMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : bothConnected ? (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          Done
        </Button>
      </div>
    </div>
  );
}
