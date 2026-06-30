import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle, CheckCircle2, Loader2, Info, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TargetPromptCardProps {
  detectedStack: {
    runtime?: string;
    runtimeVersion?: string;
    currentVersion?: string;
    frameworks?: Array<{ name: string; version: string }>;
    languages?: string[];
    projectType?: string;
    runtimeInfo?: Array<{ name: string; version: string }>;
  };
  onSubmit: (userPrompt: string, enhancedPlan: string, upgradePath?: any) => void;
  disabled?: boolean;
}

export function TargetPromptCard({ detectedStack, onSubmit, disabled }: TargetPromptCardProps) {
  const { toast } = useToast();
  const [userPrompt, setUserPrompt] = useState("");
  const [enhancedPlan, setEnhancedPlan] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [upgradePath, setUpgradePath] = useState<any>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  
  // Auto-populate text box with recommended upgrade on mount
  useEffect(() => {
    const runtime = detectedStack.runtime || detectedStack.runtimeInfo?.[0]?.name;
    const currentVersion = detectedStack.currentVersion || detectedStack.runtimeVersion || detectedStack.runtimeInfo?.[0]?.version;
    
    
    if (runtime && currentVersion && (runtime.includes('.NET') || runtime.includes('dotnet'))) {
      // Generate default .NET upgrade prompt
      const versionNum = parseFloat(currentVersion);
      let recommendedTarget = "8.0"; // Default LTS
      
      
      if (versionNum < 5) {
        // Old .NET Framework
        recommendedTarget = "8.0";
      } else if (versionNum >= 5 && versionNum < 8) {
        // .NET 5, 6, 7
        recommendedTarget = "10.0";
      }
      
      const defaultPrompt = `Migrate ${runtime} ${currentVersion} to .NET ${recommendedTarget} (Latest LTS)
Upgrade all NuGet packages to compatible versions
Modernize deprecated APIs
Update project configuration files`;
      
      setUserPrompt(defaultPrompt);
    } else if (detectedStack.frameworks && detectedStack.frameworks.length > 0) {
      // Generate upgrade prompt for detected frameworks
      const frameworkPrompts = detectedStack.frameworks
        .slice(0, 3)
        .map(fw => `Upgrade ${fw.name} to latest stable version`)
        .join('\n');
      setUserPrompt(frameworkPrompts);
    }
  }, [detectedStack]);

  const handleAIEnhance = async () => {
    if (!userPrompt.trim()) {
      toast({
        title: "Enter a prompt",
        description: "Please describe what you'd like to upgrade",
        variant: "destructive"
      });
      return;
    }

    setIsEnhancing(true);
    setEnhancedPlan("");
    setWarnings([]);
    setSuggestions([]);
    setUpgradePath(null);

    try {
      const response = await apiRequest("POST", "/api/stack-modernization/enhance-prompt", {
        userPrompt,
        detectedStack
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to enhance prompt");
      }

      const data = await response.json();

      if (!data.success) {
        // Invalid request (e.g., .NET 15)
        setWarnings(data.warnings || []);
        setSuggestions(data.suggestions || []);
        setEnhancedPlan(data.enhancedPlan || "");
        
        toast({
          title: "Invalid Upgrade Request",
          description: data.warnings?.[0] || "Please review the suggestions",
          variant: "destructive"
        });
      } else {
        // Valid request
        setEnhancedPlan(data.enhancedPlan);
        setUpgradePath(data.upgradePath);
        
        toast({
          title: "✨ Plan Generated",
          description: "AI-enhanced upgrade plan is ready. Review and proceed.",
        });
      }
    } catch (error) {
      console.error("[TargetPromptCard] Error:", error);
      toast({
        title: "Enhancement Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleSubmit = () => {
    if (!enhancedPlan) {
      toast({
        title: "Generate Plan First",
        description: "Click 'AI Enhance' to generate an upgrade plan",
        variant: "destructive"
      });
      return;
    }

    if (warnings.length > 0) {
      toast({
        title: "Cannot Proceed",
        description: "Fix the warnings before proceeding",
        variant: "destructive"
      });
      return;
    }

    onSubmit(userPrompt, enhancedPlan, upgradePath);
  };

  // Generate example prompts based on detected stack
  const getExamplePrompts = () => {
    const examples: string[] = [];
    
    if (detectedStack.runtime?.includes('.NET')) {
      examples.push('Migrate .NET 7 to .NET 10');
      examples.push('Upgrade to latest .NET LTS version');
    }
    
    if (detectedStack.frameworks?.some(f => f.name.includes('jQuery'))) {
      examples.push('Upgrade jQuery to latest version');
    }
    
    if (detectedStack.frameworks?.some(f => f.name.includes('Bootstrap'))) {
      examples.push('Upgrade Bootstrap to v5');
    }
    
    if (examples.length === 0) {
      examples.push('Upgrade all dependencies to latest stable versions');
      examples.push('Modernize frontend libraries');
    }
    
    return examples;
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          What would you like to upgrade?
        </CardTitle>
        <CardDescription>
          Describe your upgrade goals or click AI Enhance for guided recommendations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Detected Stack Summary */}
        <Alert className="border-primary/50 bg-primary/5">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="text-primary font-semibold">Detected Technology Stack</AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-2">
              {detectedStack.runtimeInfo && detectedStack.runtimeInfo.length > 0 ? (
                detectedStack.runtimeInfo.map((runtime, idx) => (
                  <Badge key={idx} variant="secondary" className="font-mono text-sm">
                    {runtime.name} {runtime.version}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary" className="font-mono text-sm">
                  {detectedStack.runtime || "Unknown"} {detectedStack.runtimeVersion || detectedStack.currentVersion}
                </Badge>
              )}
              {detectedStack.frameworks?.slice(0, 3).map((fw, idx) => (
                <Badge key={idx} variant="outline" className="font-mono text-sm">
                  {fw.name} {fw.version}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <TrendingUp className="h-3 w-3 inline mr-1" />
              Review the upgrade plan below and modify if needed
            </p>
          </AlertDescription>
        </Alert>
        
        {/* User Input */}
        <div>
          <label className="text-sm font-medium mb-2 block">Upgrade Requirements</label>
          <Textarea
            placeholder="Describe what you'd like to upgrade..."
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            className="min-h-[140px] font-mono text-sm"
            disabled={disabled || isEnhancing}
          />
          <p className="text-xs text-muted-foreground mt-2">
            💡 Edit the pre-populated plan or enter your own upgrade requirements
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            onClick={handleAIEnhance} 
            variant="outline"
            disabled={disabled || isEnhancing || !userPrompt.trim()}
            className="flex-1"
          >
            {isEnhancing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enhancing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                AI Enhance
              </>
            )}
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={disabled || !enhancedPlan || warnings.length > 0}
            className="flex-1"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Start Upgrade Process
          </Button>
        </div>

        {/* Warnings (Invalid Version) */}
        {warnings.length > 0 && (
          <Alert variant="destructive" className="border-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Invalid Upgrade Request</AlertTitle>
            <AlertDescription className="space-y-2">
              {warnings.map((warning, idx) => (
                <p key={idx} className="text-sm">{warning}</p>
              ))}
              {suggestions.length > 0 && (
                <div className="mt-3">
                  <p className="font-semibold text-sm mb-2">Available Versions:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((version, idx) => (
                      <Badge 
                        key={idx} 
                        variant="outline"
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => {
                          const newPrompt = userPrompt.replace(/\d+(\.\d+)?/g, version);
                          setUserPrompt(newPrompt);
                          setWarnings([]);
                        }}
                      >
                        .NET {version}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* AI-Enhanced Plan (Success) */}
        {enhancedPlan && warnings.length === 0 && (
          <Alert className="border-primary/50 bg-primary/5 dark:bg-primary/10 border-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">AI-Enhanced Upgrade Plan</AlertTitle>
            <AlertDescription>
              <div className="mt-2 text-sm whitespace-pre-wrap bg-background/50 p-3 rounded-md max-h-[250px] overflow-y-auto">
                {enhancedPlan}
              </div>
              {upgradePath && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={
                      upgradePath.riskLevel === 'low' ? 'default' :
                      upgradePath.riskLevel === 'medium' ? 'secondary' :
                      'destructive'
                    }>
                      Risk: {upgradePath.riskLevel?.toUpperCase()}
                    </Badge>
                    <Badge variant="outline">
                      Effort: {upgradePath.estimatedEffort}
                    </Badge>
                    <Badge variant="outline">
                      {upgradePath.breakingChanges?.length || 0} breaking changes
                    </Badge>
                  </div>
                  
                  {/* Risk Details */}
                  {upgradePath.breakingChanges && upgradePath.breakingChanges.length > 0 && (
                    <div className="mt-3 p-3 bg-destructive/10 rounded border border-destructive/30">
                      <p className="text-xs font-semibold mb-2">⚠️ Breaking Changes:</p>
                      <ul className="text-xs space-y-1">
                        {upgradePath.breakingChanges.slice(0, 5).map((change: string, idx: number) => (
                          <li key={idx} className="text-muted-foreground">• {change}</li>
                        ))}
                        {upgradePath.breakingChanges.length > 5 && (
                          <li className="text-muted-foreground italic">... and {upgradePath.breakingChanges.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  
                  {/* Required Actions */}
                  {upgradePath.requiredActions && upgradePath.requiredActions.length > 0 && (
                    <div className="mt-2 p-3 bg-accent rounded border">
                      <p className="text-xs font-semibold mb-2">📋 Required Actions:</p>
                      <ul className="text-xs space-y-1">
                        {upgradePath.requiredActions.slice(0, 5).map((action: string, idx: number) => (
                          <li key={idx} className="text-muted-foreground">• {action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Detected Stack Info (Bottom) */}
        <div className="text-xs text-muted-foreground border-t pt-3">
          <p className="font-semibold mb-2">Recommendations based on:</p>
          <ul className="space-y-1">
            <li>✓ Project Type: {detectedStack.projectType || 'Unknown'}</li>
            <li>✓ Languages: {detectedStack.languages?.join(', ') || 'None'}</li>
            <li>✓ Files Analyzed: {detectedStack.frameworks?.length || 0} frameworks detected</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
