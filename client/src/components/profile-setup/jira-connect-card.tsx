import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, ExternalLink, Trash2, RefreshCw, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface JiraCredentialStatus {
  connected: boolean;
  instanceUrl?: string;
  email?: string;
  displayName?: string;
  accountId?: string;
  lastTestedAt?: string;
  tokenLast4?: string;
}

const QUERY_KEY = ["/api/user/jira-credentials"];

export function JiraConnectCard() {
  const { toast } = useToast();
  const [instanceUrl, setInstanceUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: credential, isLoading } = useQuery<JiraCredentialStatus>({ queryKey: QUERY_KEY });

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/user/jira-credentials", {
        instanceUrl: instanceUrl.trim(),
        email: email.trim(),
        apiToken: apiToken.trim(),
      }),
    onSuccess: () => {
      toast({ title: "Connected", description: "Jira account connected successfully." });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setApiToken("");
      setIsEditing(false);
    },
    onError: (err: any) => {
      toast({
        title: "Connection failed",
        description: err.message || "Failed to connect to Jira. Check your credentials.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/user/jira-credentials/test"),
    onSuccess: () => {
      toast({ title: "Success", description: "Jira credentials are valid." });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: any) => {
      toast({
        title: "Test failed",
        description: err.message || "Jira credentials are invalid or expired.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/user/jira-credentials"),
    onSuccess: () => {
      toast({ title: "Removed", description: "Jira credentials removed." });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setIsEditing(false);
    },
  });

  const handleEdit = () => {
    setInstanceUrl(credential?.instanceUrl || "");
    setEmail(credential?.email || "");
    setApiToken("");
    setIsEditing(true);
  };

  if (isLoading) {
    return (
      <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (credential?.connected && !isEditing) {
    return (
      <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-emerald-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <div>
                <CardTitle className="text-lg">Jira Connected</CardTitle>
                <CardDescription>
                  Authenticated as <span className="font-medium text-foreground">{credential.displayName}</span> ({credential.email})
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Instance</p>
              <p className="font-medium">{credential.instanceUrl}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Token</p>
              <p className="font-mono">****{credential.tokenLast4}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            <Button variant="outline" size="sm" onClick={handleEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit Token
            </Button>
            <Button variant="destructive" size="sm" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-violet-500">
      <CardHeader>
        <CardTitle className="text-lg">
          {isEditing ? "Update Your Jira Token" : "Connect Your Jira Account"}
        </CardTitle>
        <CardDescription>
          {isEditing ? "Enter your new personal API token." : "Enter your Jira instance URL, email, and a personal API token. All Jira actions will be attributed to your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="jira-instance-url">Jira Instance URL</Label>
            <Input id="jira-instance-url" placeholder="https://your-org.atlassian.net" value={instanceUrl} onChange={(e) => setInstanceUrl(e.target.value)} required readOnly={isEditing} className={isEditing ? "bg-muted" : ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-email">Email</Label>
            <Input id="jira-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={isEditing} className={isEditing ? "bg-muted" : ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-api-token">API Token</Label>
            <Input id="jira-api-token" type="password" placeholder="Your Jira API token" value={apiToken} onChange={(e) => setApiToken(e.target.value)} required />
            <p className="text-xs text-muted-foreground">
              Generate a token at{" "}
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Atlassian API Tokens <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saveMutation.isPending || !instanceUrl || !email || !apiToken}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Test and Save
            </Button>
            {isEditing && (
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

