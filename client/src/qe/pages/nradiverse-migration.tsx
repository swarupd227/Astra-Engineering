import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DashboardHeader } from "@/components/dashboard/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  FileCode,
  Download,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  Play,
  RefreshCw,
  ChevronRight,
  FileText,
  FolderTree,
  Sparkles,
  Zap,
  CheckCircle2,
  XCircle,
  Info
} from "lucide-react";

interface MigrationResult {
  success: boolean;
  fileType: 'feature' | 'stepDefinition' | 'pageObject' | 'hooks' | 'unknown';
  originalCode: string;
  convertedCode: string;
  warnings: string[];
  errors: string[];
  stats: {
    locatorsConverted: number;
    actionsConverted: number;
    assertionsConverted: number;
    hooksConverted: number;
    stepsConverted: number;
  };
}

interface ProjectStructure {
  stepDefinitions: { name: string; code: string }[];
  pageObjects: { name: string; code: string }[];
  features: { name: string; code: string }[];
  support: { name: string; code: string }[];
  config: { name: string; code: string }[];
}

interface SampleCode {
  stepDefinition: string;
  hooks: string;
  pageObject: string;
  feature: string;
}

export default function NRadiVerseMigrationPage() {
  const { toast } = useToast();
  
  const [sourceCode, setSourceCode] = useState('');
  const [convertedCode, setConvertedCode] = useState('');
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [activeInputTab, setActiveInputTab] = useState<'stepDefinition' | 'hooks' | 'pageObject' | 'feature'>('stepDefinition');
  const [copiedCode, setCopiedCode] = useState(false);
  const [showProjectStructure, setShowProjectStructure] = useState(false);
  
  const { data: samplesData } = useQuery<{ success: boolean; samples: SampleCode }>({
    queryKey: ['/api/nradiverse/migration/samples'],
  });
  
  const { data: projectStructureData } = useQuery<{ success: boolean; structure: ProjectStructure }>({
    queryKey: ['/api/nradiverse/migration/project-structure'],
    enabled: showProjectStructure,
  });
  
  const convertMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest('POST', '/api/nradiverse/migration/convert', { code, fileType: activeInputTab });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setMigrationResult(data.result);
        setConvertedCode(data.result.convertedCode);
        toast({ title: "Conversion Complete", description: `Detected: ${data.result.fileType}` });
      } else {
        toast({ title: "Conversion Failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
  
  const loadSample = (type: 'stepDefinition' | 'hooks' | 'pageObject' | 'feature') => {
    if (samplesData?.samples) {
      setSourceCode(samplesData.samples[type]);
      setActiveInputTab(type);
      setConvertedCode('');
      setMigrationResult(null);
    }
  };
  
  const handleConvert = () => {
    if (!sourceCode.trim()) {
      toast({ title: "No Code", description: "Please enter or paste C# code to convert", variant: "destructive" });
      return;
    }
    convertMutation.mutate(sourceCode);
  };
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(convertedCode);
      setCopiedCode(true);
      toast({ title: "Copied!", description: "TypeScript code copied to clipboard" });
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };
  
  const downloadCode = () => {
    if (!convertedCode) return;
    
    const fileExtension = migrationResult?.fileType === 'feature' ? '.feature' : '.ts';
    const fileName = `converted${fileExtension}`;
    
    const blob = new Blob([convertedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: "Downloaded", description: `File saved as ${fileName}` });
  };
  
  const getFileTypeIcon = (type: string) => {
    switch (type) {
      case 'stepDefinition': return <Code2 className="w-4 h-4" />;
      case 'hooks': return <Zap className="w-4 h-4" />;
      case 'pageObject': return <FileCode className="w-4 h-4" />;
      case 'feature': return <FileText className="w-4 h-4" />;
      default: return <FileCode className="w-4 h-4" />;
    }
  };
  
  const getFileTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'stepDefinition': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'hooks': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'pageObject': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'feature': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

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
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="heading-migration">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20">
                    <Code2 className="w-7 h-7 text-blue-400" />
                  </div>
                  Selenium C# to Playwright TypeScript Migration
                </h1>
                <p className="text-muted-foreground mt-1">
                  Convert SpecFlow BDD tests to Playwright-BDD with Cucumber.js
                </p>
              </div>
              <Button
                variant={showProjectStructure ? "default" : "outline"}
                onClick={() => setShowProjectStructure(!showProjectStructure)}
                data-testid="button-toggle-structure"
              >
                <FolderTree className="w-4 h-4 mr-2" />
                Project Templates
              </Button>
            </div>
            
            {showProjectStructure && projectStructureData?.structure && (
              <Card className="border-purple-500/30 bg-purple-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderTree className="w-5 h-5 text-purple-400" />
                    Playwright-BDD Project Structure
                  </CardTitle>
                  <CardDescription>
                    Download configuration files and support classes for your migrated project
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <FileCode className="w-4 h-4 text-cyan-400" />
                        Support Files
                      </h4>
                      {projectStructureData.structure.support.map((file) => (
                        <Button
                          key={file.name}
                          variant="outline"
                          size="sm"
                          className="w-full justify-start text-xs"
                          onClick={() => {
                            const blob = new Blob([file.code], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = file.name;
                            link.click();
                            URL.revokeObjectURL(url);
                          }}
                          data-testid={`button-download-${file.name}`}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          {file.name}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <FileText className="w-4 h-4 text-green-400" />
                        Config Files
                      </h4>
                      {projectStructureData.structure.config.map((file) => (
                        <Button
                          key={file.name}
                          variant="outline"
                          size="sm"
                          className="w-full justify-start text-xs"
                          onClick={() => {
                            const blob = new Blob([file.code], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = file.name;
                            link.click();
                            URL.revokeObjectURL(url);
                          }}
                          data-testid={`button-download-${file.name}`}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          {file.name}
                        </Button>
                      ))}
                    </div>
                    <div className="col-span-2 space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Info className="w-4 h-4 text-blue-400" />
                        Project Folder Structure
                      </h4>
                      <pre className="text-xs bg-muted/50 p-3 rounded-lg font-mono">
{`/migrated-project
  /features          # Gherkin feature files
  /step-definitions  # TypeScript step definitions
  /pages             # Page Object classes
  /support           # Custom world & hooks
  cucumber.js        # Cucumber configuration
  playwright.config.ts
  package.json
  tsconfig.json`}
                      </pre>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <Card className="border-dashed border-2 border-cyan-500/30 bg-cyan-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  Load Sample C# Code
                </CardTitle>
                <CardDescription>
                  Try the migration tool with sample SpecFlow/Selenium code
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSample('stepDefinition')}
                    data-testid="button-sample-stepdefinition"
                  >
                    <Code2 className="w-4 h-4 mr-2 text-blue-400" />
                    Step Definitions
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSample('hooks')}
                    data-testid="button-sample-hooks"
                  >
                    <Zap className="w-4 h-4 mr-2 text-purple-400" />
                    Hooks
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSample('pageObject')}
                    data-testid="button-sample-pageobject"
                  >
                    <FileCode className="w-4 h-4 mr-2 text-green-400" />
                    Page Object
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSample('feature')}
                    data-testid="button-sample-feature"
                  >
                    <FileText className="w-4 h-4 mr-2 text-orange-400" />
                    Feature File
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="h-[600px] flex flex-col">
                <CardHeader className="pb-3 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="p-1.5 rounded bg-blue-500/20">
                          <Code2 className="w-4 h-4 text-blue-400" />
                        </div>
                        Source: Selenium C# / SpecFlow
                      </CardTitle>
                      <CardDescription>Paste your C# BDD test code here</CardDescription>
                    </div>
                    <Button
                      onClick={handleConvert}
                      disabled={convertMutation.isPending || !sourceCode.trim()}
                      className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                      data-testid="button-convert"
                    >
                      {convertMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Converting...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Convert
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <textarea
                    value={sourceCode}
                    onChange={(e) => setSourceCode(e.target.value)}
                    placeholder={`// Paste your SpecFlow C# step definitions, hooks, or page objects here...

using TechTalk.SpecFlow;
using OpenQA.Selenium;

[Binding]
public class LoginSteps
{
    private readonly IWebDriver _driver;
    
    [Given(@"I am on the login page")]
    public void GivenIAmOnTheLoginPage()
    {
        _driver.Navigate().GoToUrl("https://example.com/login");
    }
    
    [When(@"I enter username ""(.*)""")]
    public void WhenIEnterUsername(string username)
    {
        _driver.FindElement(By.Id("username")).SendKeys(username);
    }
}`}
                    className="w-full h-full resize-none bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm p-4 border-0 focus:outline-none focus:ring-0"
                    spellCheck={false}
                    data-testid="textarea-source"
                  />
                </CardContent>
              </Card>
              
              <Card className="h-[600px] flex flex-col">
                <CardHeader className="pb-3 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="p-1.5 rounded bg-green-500/20">
                          <FileCode className="w-4 h-4 text-green-400" />
                        </div>
                        Output: Playwright TypeScript
                      </CardTitle>
                      <CardDescription>Converted Playwright-BDD code</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {migrationResult && (
                        <Badge className={getFileTypeBadgeColor(migrationResult.fileType)}>
                          {getFileTypeIcon(migrationResult.fileType)}
                          <span className="ml-1">{migrationResult.fileType}</span>
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyToClipboard}
                        disabled={!convertedCode}
                        data-testid="button-copy"
                      >
                        {copiedCode ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadCode}
                        disabled={!convertedCode}
                        data-testid="button-download"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full">
                    <pre className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm p-4 whitespace-pre-wrap">
                      {convertedCode || '// Converted TypeScript code will appear here...'}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
            
            {migrationResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {migrationResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-400" />
                    )}
                    Migration Report
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-blue-400">{migrationResult.stats.stepsConverted}</p>
                      <p className="text-xs text-muted-foreground">Steps Converted</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-purple-400">{migrationResult.stats.locatorsConverted}</p>
                      <p className="text-xs text-muted-foreground">Locators Mapped</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-cyan-400">{migrationResult.stats.actionsConverted}</p>
                      <p className="text-xs text-muted-foreground">Actions Converted</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-orange-400">{migrationResult.stats.assertionsConverted}</p>
                      <p className="text-xs text-muted-foreground">Assertions Mapped</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-400">{migrationResult.stats.hooksConverted}</p>
                      <p className="text-xs text-muted-foreground">Hooks Converted</p>
                    </div>
                  </div>
                  
                  {migrationResult.warnings.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-400" />
                        Warnings ({migrationResult.warnings.length})
                      </h4>
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                        {migrationResult.warnings.map((warning, idx) => (
                          <p key={idx} className="text-sm text-yellow-400 flex items-start gap-2">
                            <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {migrationResult.errors.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                        <XCircle className="w-4 h-4 text-red-400" />
                        Errors ({migrationResult.errors.length})
                      </h4>
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        {migrationResult.errors.map((error, idx) => (
                          <p key={idx} className="text-sm text-red-400 flex items-start gap-2">
                            <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            {error}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            
            <Card className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/30">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-400" />
                  Conversion Reference Guide
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <h4 className="font-medium text-sm mb-2 text-cyan-400">Locator Mappings</h4>
                    <div className="text-xs space-y-1 font-mono bg-muted/30 p-3 rounded-lg">
                      <p><span className="text-blue-400">By.Id("x")</span> → <span className="text-green-400">#x</span></p>
                      <p><span className="text-blue-400">By.ClassName("x")</span> → <span className="text-green-400">.x</span></p>
                      <p><span className="text-blue-400">By.CssSelector("x")</span> → <span className="text-green-400">x</span></p>
                      <p><span className="text-blue-400">By.XPath("//x")</span> → <span className="text-green-400">//x</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm mb-2 text-purple-400">Action Mappings</h4>
                    <div className="text-xs space-y-1 font-mono bg-muted/30 p-3 rounded-lg">
                      <p><span className="text-blue-400">.Click()</span> → <span className="text-green-400">.click()</span></p>
                      <p><span className="text-blue-400">.SendKeys(x)</span> → <span className="text-green-400">.fill(x)</span></p>
                      <p><span className="text-blue-400">.Text</span> → <span className="text-green-400">.textContent()</span></p>
                      <p><span className="text-blue-400">.Displayed</span> → <span className="text-green-400">.isVisible()</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm mb-2 text-orange-400">Hook Mappings</h4>
                    <div className="text-xs space-y-1 font-mono bg-muted/30 p-3 rounded-lg">
                      <p><span className="text-blue-400">[BeforeScenario]</span> → <span className="text-green-400">Before</span></p>
                      <p><span className="text-blue-400">[AfterScenario]</span> → <span className="text-green-400">After</span></p>
                      <p><span className="text-blue-400">[BeforeFeature]</span> → <span className="text-green-400">BeforeAll</span></p>
                      <p><span className="text-blue-400">[AfterFeature]</span> → <span className="text-green-400">AfterAll</span></p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
        </div>
      </main>
    </>
  );
}
