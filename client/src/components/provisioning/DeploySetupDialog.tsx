import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle2, XCircle, GitBranch, Plus, Trash2, FileText } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { deploySetupService } from "@/services/deploySetupService";
import type { DeploymentType } from "@/services/deploySetupService";
import type { ProvisionInstanceResponse } from "@shared/types/provisioning.types";
import { azureManagementRequest, msalClientId } from "@/config/msalConfig";

interface Props {
  open: boolean;
  onClose: () => void;
  armToken: string | null;
  deploymentType: DeploymentType;
  // Full stack
  frontendInstance?: ProvisionInstanceResponse;
  backendInstance?: ProvisionInstanceResponse;
  dbInstance?: ProvisionInstanceResponse;
  // Single service
  singleInstance?: ProvisionInstanceResponse;
}

type Step = 1 | 2 | 3;
interface AppSettingRow { key: string; value: string; }

export function DeploySetupDialog({
  open, onClose, armToken, deploymentType,
  frontendInstance, backendInstance, dbInstance, singleInstance,
}: Props) {
  const { instance: msalInstance } = useMsal();

  // Determine the primary instance (used for environment key defaults, API call anchor)
  const primaryInstance =
    deploymentType === "fullstack" ? (frontendInstance ?? backendInstance) :
    deploymentType === "single-appservice" ? singleInstance :
    singleInstance; // single-swa

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingSwaTk, setFetchingSwaTk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — Branch Setup
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranchMode, setTargetBranchMode] = useState<"new" | "existing">("new");
  const [newBranchName, setNewBranchName] = useState(() => {
    const p = primaryInstance;
    return p ? `deploy/${p.environment.toLowerCase()}/${p.instanceName}` : "deploy/env/name";
  });
  const [existingBranch, setExistingBranch] = useState("");

  // Step 2 — Pipeline config (shared)
  const [environmentKey, setEnvironmentKey] = useState(
    primaryInstance?.instanceName.replace(/-/g, "").toLowerCase() ?? ""
  );
  const [environmentLabel, setEnvironmentLabel] = useState(primaryInstance?.instanceName ?? "");
  const [azureSubscription, setAzureSubscription] = useState("devxmanagedidentity");

  // SWA fields (fullstack or single-swa)
  const [swaToken, setSwaToken] = useState("");
  const [staticWebAppHostname, setStaticWebAppHostname] = useState(() => {
    const swa = deploymentType === "fullstack" ? frontendInstance : singleInstance;
    if (swa?.url) { try { return new URL(swa.url).hostname; } catch { return ""; } }
    return "";
  });

  // App Service fields (fullstack or single-appservice)
  const appSvcSource = deploymentType === "fullstack" ? backendInstance : singleInstance;
  const [appServiceName, setAppServiceName] = useState(appSvcSource?.appServiceName ?? "");
  const [resourceGroupName, setResourceGroupName] = useState(appSvcSource?.resourceGroupName ?? "");
  const [appServiceUrl, setAppServiceUrl] = useState(appSvcSource?.url ?? "");

  // CORS: pre-fill with SWA URL when in fullstack mode
  const defaultCorsOrigin = (() => {
    if (deploymentType === "fullstack" && frontendInstance?.url) {
      try { return new URL(frontendInstance.url).origin; } catch { return frontendInstance.url; }
    }
    return "";
  })();
  const [corsOrigin, setCorsOrigin] = useState(defaultCorsOrigin);

  // DB fields (fullstack only, optional)
  const [dbConnectionString, setDbConnectionString] = useState(
    dbInstance ? `Server=${dbInstance.databaseServerName ?? ""};Database=${dbInstance.databaseName ?? ""};` : ""
  );

  // Step 3 — App Settings
  const [appSettings, setAppSettings] = useState<AppSettingRow[]>([
    { key: "NODE_ENV", value: primaryInstance?.environment.toLowerCase() ?? "development" },
    { key: "WEBSITE_NODE_DEFAULT_VERSION", value: "20" },
  ]);

  const hasSwa = deploymentType === "fullstack" || deploymentType === "single-swa";
  const hasAppSvc = deploymentType === "fullstack" || deploymentType === "single-appservice";

  // Load ADO repos
  const { data: reposData, isLoading: reposLoading, error: reposError } = useQuery({
    queryKey: ["/api/provisioning/ado-repos"],
    queryFn: () => deploySetupService.listAdoRepos(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Load branches when repo selected
  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ["/api/provisioning/ado-repos", selectedRepoId, "branches"],
    queryFn: () => deploySetupService.listAdoBranches(selectedRepoId),
    enabled: !!selectedRepoId,
    staleTime: 2 * 60 * 1000,
  });

  // Pre-select default branch
  useEffect(() => {
    if (branchesData?.branches.length && !sourceBranch) {
      const main = branchesData.branches.find(b => b.name === "main") ?? branchesData.branches[0];
      setSourceBranch(main.name);
    }
  }, [branchesData, sourceBranch]);

  const targetBranch = targetBranchMode === "new" ? newBranchName : existingBranch;
  const step1Valid = !!selectedRepoId && !!sourceBranch && !!targetBranch;
  const step2Valid =
    !!environmentKey && !!environmentLabel &&
    (hasSwa ? !!swaToken : true) &&
    (hasAppSvc ? !!appServiceName : true);
  const step3Valid = true;

  const handleSubmit = async () => {
    if (!primaryInstance) return;
    setSubmitting(true);
    setError(null);
    try {
      const settingsMap: Record<string, string> = {};
      appSettings.forEach(row => { if (row.key) settingsMap[row.key] = row.value; });
      if (dbConnectionString) settingsMap["DATABASE_CONNECTION_STRING"] = dbConnectionString;

      const accounts = msalInstance.getAllAccounts();
      const account = accounts[0] ?? null;

      // Acquire ARM token — must happen before any long async calls (popup needs user-gesture context)
      let freshArmToken: string | null = armToken;
      if (account) {
        try {
          const r = await msalInstance.acquireTokenSilent({ ...azureManagementRequest, account });
          freshArmToken = r.accessToken || null;
        } catch {
          try {
            const r = await msalInstance.acquireTokenPopup(azureManagementRequest);
            freshArmToken = r.accessToken || null;
          } catch { /* fall through with prop token */ }
        }
      }

      // Now run the main (long) API operations
      const res = await deploySetupService.setupDeployment(
        primaryInstance.id,
        {
          deploymentType,
          sourceRepoId: selectedRepoId,
          sourceBranch,
          targetBranchMode,
          targetBranch,
          pipelineConfig: {
            environmentKey,
            environmentLabel,
            appServiceName,
            resourceGroupName,
            azureSubscription,
            appServiceUrl,
            swaToken: hasSwa ? swaToken : undefined,
            staticWebAppHostname: hasSwa ? staticWebAppHostname : undefined,
            corsOrigin: hasAppSvc && corsOrigin.trim() ? corsOrigin.trim() : undefined,
          },
          appSettings: settingsMap,
          backendInstanceId: deploymentType === "fullstack" ? backendInstance?.id : undefined,
          backendSubscriptionId: deploymentType === "fullstack" ? backendInstance?.subscriptionId : undefined,
        },
        freshArmToken
      );

      const parts = [];
      if (res.branchCreated) parts.push(`Branch "${res.branchName}" created`);
      if (res.pipelineUpdated) parts.push("Pipeline updated");
      if (res.apiConfigUpdated) parts.push("API config updated");
      if (res.appSettingsUpdated) parts.push("App settings pushed to Azure");
      if (!res.appSettingsUpdated && res.appSettingsError) parts.push(`⚠ App settings failed: ${res.appSettingsError}`);

      // Register SWA URL as redirect URI in Azure AD app registration (server handles auth)
      if (hasSwa) {
        const swaInstance = deploymentType === "fullstack" ? frontendInstance : singleInstance;
        const swaOrigin = swaInstance?.url
          ? (() => { try { return new URL(swaInstance.url).origin; } catch { return swaInstance.url; } })()
          : null;
        if (swaOrigin) {
          try {
            const reg = await deploySetupService.registerRedirectUri(swaOrigin, msalClientId);
            parts.push(reg.added ? "Redirect URI registered in Azure AD" : "Redirect URI already registered");
          } catch (regErr: any) {
            parts.push(`⚠ Redirect URI registration failed: ${regErr.message}`);
          }
        }
      }

      setResult({ success: true, message: parts.join(" · ") || "Setup complete" });
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const parseBulkEnv = (text: string): AppSettingRow[] =>
    text.split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#") && line.includes("="))
      .map(line => {
        // Strip leading "export " (shell syntax)
        const stripped = line.replace(/^export\s+/, "");
        const idx = stripped.indexOf("=");
        const key = stripped.slice(0, idx).trim();
        const value = stripped.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        return { key, value };
      })
      .filter(({ key }) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)); // skip invalid keys

  const applyBulkEnv = () => {
    const parsed = parseBulkEnv(bulkText);
    if (parsed.length > 0) setAppSettings(parsed);
    setBulkMode(false);
  };

  const addSettingRow = () => setAppSettings(prev => [...prev, { key: "", value: "" }]);
  const removeSettingRow = (i: number) => setAppSettings(prev => prev.filter((_, idx) => idx !== i));
  const updateSettingRow = (i: number, field: "key" | "value", val: string) =>
    setAppSettings(prev => prev.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const handleClose = () => { setStep(1); setResult(null); setError(null); setSubmitting(false); onClose(); };

  const dialogTitle =
    deploymentType === "fullstack" ? "Full Stack Deployment Setup" :
    deploymentType === "single-appservice" ? "App Service Deployment Setup" :
    "Static Web App Deployment Setup";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            {dialogTitle}
          </DialogTitle>
          {deploymentType === "fullstack" && (
            <p className="text-xs text-muted-foreground pt-1">
              Frontend: <strong>{frontendInstance?.instanceName}</strong> &nbsp;·&nbsp;
              Backend: <strong>{backendInstance?.instanceName}</strong>
              {dbInstance && <> &nbsp;·&nbsp; DB: <strong>{dbInstance.instanceName}</strong></>}
            </p>
          )}
          {(deploymentType === "single-appservice" || deploymentType === "single-swa") && (
            <p className="text-xs text-muted-foreground pt-1">
              Service: <strong>{singleInstance?.instanceName}</strong>
            </p>
          )}
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s ? "bg-primary text-primary-foreground" :
                step > s ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}>{s}</div>
              {s < 3 && <div className="h-px w-8 bg-border" />}
            </div>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">
            {step === 1 ? "Branch Setup" : step === 2 ? "Pipeline Config" : "Environment Variables"}
          </span>
        </div>

        {result && (
          <Alert variant={result.success ? "default" : "destructive"} className="border-l-4">
            <div className="flex items-start gap-2">
              {result.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5" /> : <XCircle className="h-4 w-4 mt-0.5" />}
              <AlertDescription>{result.message}</AlertDescription>
            </div>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!result && (
          <div className="space-y-5">
            {/* ─── STEP 1 ─── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Repository <span className="text-destructive">*</span></Label>
                  {reposLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading repos...</div>
                  ) : reposError ? (
                    <p className="text-sm text-destructive">Failed to load repos: {(reposError as any).message}</p>
                  ) : (
                    <Select value={selectedRepoId} onValueChange={v => { setSelectedRepoId(v); setSourceBranch(""); }}>
                      <SelectTrigger><SelectValue placeholder="Select repository" /></SelectTrigger>
                      <SelectContent>{reposData?.repos.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Source Branch <span className="text-destructive">*</span></Label>
                  {branchesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading branches...</div>
                  ) : (
                    <Select value={sourceBranch} onValueChange={setSourceBranch} disabled={!selectedRepoId}>
                      <SelectTrigger><SelectValue placeholder="Select source branch" /></SelectTrigger>
                      <SelectContent>{branchesData?.branches.map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">Branch to sync code from</p>
                </div>

                <div className="space-y-2">
                  <Label>Target Branch <span className="text-destructive">*</span></Label>
                  <div className="flex gap-3">
                    <Button type="button" size="sm" variant={targetBranchMode === "new" ? "default" : "outline"} onClick={() => setTargetBranchMode("new")}>New Branch</Button>
                    <Button type="button" size="sm" variant={targetBranchMode === "existing" ? "default" : "outline"} onClick={() => setTargetBranchMode("existing")} disabled={!selectedRepoId}>Existing Branch</Button>
                  </div>
                  {targetBranchMode === "new" ? (
                    <Input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="deploy/env/name" />
                  ) : branchesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading branches...</div>
                  ) : (
                    <Select value={existingBranch} onValueChange={setExistingBranch}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>{branchesData?.branches.map(b => <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            {/* ─── STEP 2 ─── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Environment Key <span className="text-destructive">*</span></Label>
                    <Input value={environmentKey} onChange={e => setEnvironmentKey(e.target.value.replace(/[^a-z0-9]/gi, ""))} placeholder="devmyapp" />
                    <p className="text-xs text-muted-foreground">Used in variable names (no hyphens)</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Environment Label <span className="text-destructive">*</span></Label>
                    <Input value={environmentLabel} onChange={e => setEnvironmentLabel(e.target.value)} placeholder="Dev MyApp" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Azure Subscription Service Connection</Label>
                  <Input value={azureSubscription} onChange={e => setAzureSubscription(e.target.value)} />
                </div>

                {/* Frontend (SWA) section */}
                {hasSwa && (
                  <>
                    <Separator />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Frontend — Static Web App {deploymentType === "fullstack" && frontendInstance && `(${frontendInstance.instanceName})`}
                    </p>
                    <div className="space-y-2">
                      <Label>SWA URL</Label>
                      <Input value={(deploymentType === "fullstack" ? frontendInstance?.url : singleInstance?.url) ?? ""} readOnly className="bg-muted text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <Label>Static Web App Hostname</Label>
                      <Input value={staticWebAppHostname} onChange={e => setStaticWebAppHostname(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Deployment Token <span className="text-destructive">*</span></Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={fetchingSwaTk}
                          onClick={async () => {
                            const swaInstance = deploymentType === "fullstack" ? frontendInstance : singleInstance;
                            if (!swaInstance) return;
                            setFetchingSwaTk(true);
                            try {
                              const accounts = msalInstance.getAllAccounts();
                              let token: string | null = armToken;
                              if (accounts.length > 0) {
                                try {
                                  const r = await msalInstance.acquireTokenSilent({ ...azureManagementRequest, account: accounts[0] });
                                  token = r.accessToken || null;
                                } catch {
                                  const r = await msalInstance.acquireTokenPopup(azureManagementRequest);
                                  token = r.accessToken || null;
                                }
                              }
                              if (!token) throw new Error("Could not acquire Azure token");
                              const fetched = await deploySetupService.fetchSwaToken(swaInstance.id, token);
                              setSwaToken(fetched);
                            } catch (err: any) {
                              setError(`Failed to fetch SWA token: ${err.message}`);
                            } finally {
                              setFetchingSwaTk(false);
                            }
                          }}
                        >
                          {fetchingSwaTk ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          {fetchingSwaTk ? "Fetching…" : "Fetch automatically"}
                        </Button>
                      </div>
                      <Input type="password" value={swaToken} onChange={e => setSwaToken(e.target.value)} placeholder="Click 'Fetch automatically' or paste manually" />
                    </div>
                  </>
                )}

                {/* Backend (App Service) section */}
                {hasAppSvc && (
                  <>
                    <Separator />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Backend — App Service {deploymentType === "fullstack" && backendInstance && `(${backendInstance.instanceName})`}
                    </p>
                    <div className="space-y-2">
                      <Label>App Service Name <span className="text-destructive">*</span></Label>
                      <Input value={appServiceName} onChange={e => setAppServiceName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Resource Group</Label>
                      <Input value={resourceGroupName} onChange={e => setResourceGroupName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>App Service URL</Label>
                      <Input value={appServiceUrl} onChange={e => setAppServiceUrl(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>CORS Origin (Frontend URL)</Label>
                      <Input
                        value={corsOrigin}
                        onChange={e => setCorsOrigin(e.target.value)}
                        placeholder="https://your-frontend.azurestaticapps.net"
                      />
                      <p className="text-xs text-muted-foreground">
                        Enables <code>Access-Control-Allow-Credentials</code> for this origin on the App Service.
                      </p>
                    </div>
                  </>
                )}

                {/* Database section (fullstack only, optional) */}
                {deploymentType === "fullstack" && dbInstance && (
                  <>
                    <Separator />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Database ({dbInstance.instanceName})
                    </p>
                    <div className="space-y-2">
                      <Label>Connection String</Label>
                      <Input value={dbConnectionString} onChange={e => setDbConnectionString(e.target.value)} placeholder="Server=...;Database=...;" />
                      <p className="text-xs text-muted-foreground">Will be added as DATABASE_CONNECTION_STRING app setting</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─── STEP 3 ─── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Key-value pairs pushed to {deploymentType === "fullstack" ? "the backend App Service" : "Azure App Service"} application settings.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setBulkMode(!bulkMode); setBulkText(""); }}>
                    <FileText className="h-4 w-4 mr-2" />
                    {bulkMode ? "Switch to Table" : "Paste .env"}
                  </Button>
                </div>

                {bulkMode ? (
                  <div className="space-y-2">
                    <Textarea
                      className="font-mono text-xs h-48"
                      placeholder={"NODE_ENV=production\nDATABASE_URL=postgres://...\nAPI_KEY=your-key"}
                      value={bulkText}
                      onChange={e => setBulkText(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Paste your .env file. Comments (#) and blank lines are ignored.</p>
                    <Button type="button" size="sm" onClick={applyBulkEnv} disabled={!bulkText.trim()}>
                      Apply Variables
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {appSettings.map((row, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Input className="flex-1 font-mono text-xs" placeholder="KEY" value={row.key} onChange={e => updateSettingRow(i, "key", e.target.value)} />
                          <Input className="flex-1 font-mono text-xs" placeholder="value" value={row.value} onChange={e => updateSettingRow(i, "value", e.target.value)} />
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeSettingRow(i)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addSettingRow}>
                      <Plus className="mr-2 h-4 w-4" /> Add Variable
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {result ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancel</Button>
              {step > 1 && !submitting && (
                <Button variant="outline" onClick={() => setStep(s => (s - 1) as Step)}>Back</Button>
              )}
              {step < 3 ? (
                <Button
                  onClick={() => setStep(s => (s + 1) as Step)}
                  disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                >
                  Next
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {submitting ? "Configuring..." : "Sync & Configure"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
