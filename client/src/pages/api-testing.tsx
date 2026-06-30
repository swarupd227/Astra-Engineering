import * as XLSX from "xlsx";
import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Network, Upload, Play, Send, Loader2, FileJson, X, FileCode, CheckCircle2, Database, FileCheck, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function ApiTestingPage() {
  const [, params] = useRoute("/api-testing/:projectId?");
  const routeProjectId = params?.projectId;
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const projectName = urlParams.get("projectName");
  const organization = urlParams.get("organization");
  const queryProjectId = urlParams.get("projectId");
  
  const apiProjectId = routeProjectId || queryProjectId;
  
  const { toast } = useToast();

  const [selectedBrdId, setSelectedBrdId] = useState<string | null>(null);
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [generatedResults, setGeneratedResults] = useState<{
    groups?: any[];
    testCases: any[];
    testData?: any[];
    syntheticData?: any[];
    summary: any;
  } | null>(null);
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number>(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBack = () => {
    const backParams = new URLSearchParams();
    if (organization) backParams.set("organization", organization);
    if (apiProjectId) backParams.set("projectId", apiProjectId);
    if (projectName) backParams.set("projectName", projectName);
    backParams.set("phase", "4");

    const query = backParams.toString();
    setLocation(query ? `/sdlc?${query}` : "/sdlc");
  };

  // 1. Fetch BRDs
  const { data: brdsDataRaw = [], isLoading: isLoadingBrds } = useQuery<any[]>({
    queryKey: ["/api/dev-brd/approved", apiProjectId],
    queryFn: async () => {
      if (!apiProjectId) return [];
      try {
        const response = await apiRequest(
          "GET",
          `/api/dev-brd/approved?projectId=${encodeURIComponent(apiProjectId)}`
        );
        return await response.json();
      } catch (error) {
        console.error("Error fetching BRDs:", error);
        return [];
      }
    },
    enabled: !!apiProjectId,
  });

  const brdsData = Array.from(new Map(brdsDataRaw.map((b: any) => [b.id, b])).values());

  // 2. Fetch hierarchy data (Epics → Features → User Stories) from dedicated hierarchy endpoint
  //    Fetch once using only projectId + ADO creds; filter client-side to avoid repeated ADO calls.
  const { data: hierarchyData, isLoading: isLoadingHierarchy } = useQuery<{ success: boolean; epics: any[]; features: any[]; userStories: any[]; summary: any }>({
    queryKey: ["/api/workflow/artifacts/hierarchy", apiProjectId, organization, projectName],
    queryFn: async () => {
      if (!apiProjectId) return { success: false, epics: [], features: [], userStories: [], summary: {} };
      try {
        const qp = new URLSearchParams({ projectId: apiProjectId });
        if (organization) qp.append("organization", organization);
        if (projectName) qp.append("projectName", projectName);

        const response = await apiRequest(
          "GET",
          `/api/workflow/artifacts/hierarchy?${qp.toString()}`
        );
        if (!response.ok) return { success: false, epics: [], features: [], userStories: [], summary: {} };
        return await response.json();
      } catch (error) {
        console.error("Error fetching hierarchy:", error);
        return { success: false, epics: [], features: [], userStories: [], summary: {} };
      }
    },
    enabled: !!apiProjectId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // 1. Technical deduplication (Aggressive: unique by ID and unique by Title)
  const dedup = (arr: any[]) => {
    const seenIds = new Set();
    const seenTitles = new Set();
    return arr.filter(item => {
      const id = String(item.id).toLowerCase();
      const title = String(item.title || "").trim().toLowerCase();
      
      if (!title || seenIds.has(id) || seenTitles.has(title)) return false;
      
      seenIds.add(id);
      seenTitles.add(title);
      return true;
    });
  };

  const allEpics = dedup(hierarchyData?.epics || []);
  const allFeatures = dedup(hierarchyData?.features || []);
  const allStories = dedup(hierarchyData?.userStories || []);

  // 2. Perfect Multi-level Filtering (Strict regarding other BRDs, lenient for unlinked items)
  // - Epics: show if matches selected BRD OR if it has no BRD link at all.
  //   Strictly exclude if it belongs to a DIFFERENT BRD.
  const filteredEpics = selectedBrdId && selectedBrdId !== "none"
    ? allEpics.filter((e: any) => {
        const itemBrdId = e.brdId ? String(e.brdId) : null;
        const targetBrdId = String(selectedBrdId);
        return !itemBrdId || itemBrdId === targetBrdId;
      })
    : allEpics;

  // - User Stories: Nested filtering (same logic as epics, but also respects selectedEpicId)
  const filteredStories = allStories.filter((s: any) => {
    // A. BRD Filtering: Exclude if linked to a different BRD
    if (selectedBrdId && selectedBrdId !== "none") {
      const targetBrdId = String(selectedBrdId);
      
      // Check story's own brdId if it exists
      if (s.brdId && String(s.brdId) !== targetBrdId) return false;
      
      // Check via its parent Epic
      const epicForStory = allEpics.find(e => String(e.id) === String(s.epicId));
      if (epicForStory && epicForStory.brdId && String(epicForStory.brdId) !== targetBrdId) return false;
    }
    
    // B. Epic Filtering: Strictly show only current epic's stories if one is selected
    if (selectedEpicId && selectedEpicId !== "none") {
      if (String(s.epicId) !== String(selectedEpicId)) return false;
    }
    
    return true;
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json") && !file.name.endsWith(".yaml") && !file.name.endsWith(".yml")) {
      toast({
        title: "Invalid file type",
        description: "Please upload a valid Swagger/OpenAPI JSON or YAML file.",
        variant: "destructive"
      });
      return;
    }
    
    setUploadedFile(file);
    setGenerationComplete(false); // Reset on new file
  };

  const handleGenerate = async () => {
    if (!uploadedFile) {
      toast({
        title: "Missing Requirements",
        description: "Please upload an API contract first.",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setGeneratedResults(null);
    setGenerationComplete(false);
    setSelectedGroupIdx(0);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const contractContent = event.target?.result as string;
        const story = allStories.find((s: any) => s.id === selectedStoryId);

        try {
          const response = await apiRequest("POST", "/api/testing/generate-api-tests", {
            storyId: selectedStoryId,
            storyTitle: story?.title,
            storyDescription: story?.description,
            contractContent,
            projectId: apiProjectId
          });

          const result = await response.json();
          setGeneratedResults(result);
          setSelectedGroupIdx(0);
          setGenerationComplete(true);
          setIsGenerating(false);
          toast({
            title: "Test Artifacts Generated",
            description: "Exhaustive functional scenarios successfully generated from the API contract.",
          });
        } catch (err: any) {
          console.error("Error generating tests:", err);
          setIsGenerating(false);
          toast({
            title: "Generation Failed",
            description: err.message || "Failed to generate test artifacts.",
            variant: "destructive"
          });
        }
      };
      reader.readAsText(uploadedFile);
    } catch (err) {
      console.error("FileReader error:", err);
      setIsGenerating(false);
    }
  };

  const handlePushToADO = async () => {
    if (!generatedResults) {
      toast({
        title: "Push Error",
        description: "Please generate tests first.",
        variant: "destructive"
      });
      return;
    }
    
    setIsPushing(true);
    try {
      // Aggregate all test cases from all groups to send to backend
      let allTestCases: any[] = [];
      if (generatedResults.groups && generatedResults.groups.length > 0) {
        generatedResults.groups.forEach((group: any) => {
          if (group.testCases && Array.isArray(group.testCases)) {
            allTestCases = [...allTestCases, ...group.testCases];
          }
        });
      } else {
        allTestCases = [...(generatedResults.testCases || [])];
      }

      if (allTestCases.length === 0) {
        throw new Error("No test cases are available to push.");
      }

      const syntheticData = generatedResults.testData ?? generatedResults.syntheticData ?? [];

      await apiRequest("POST", "/api/testing/push-to-ado", {
        projectId: apiProjectId,
        projectName: projectName, // From URL query params
        organization: organization, // From URL query params
        storyId: selectedStoryId ? String(selectedStoryId) : null, 
        testCases: allTestCases,
        syntheticData: syntheticData
      });

      setIsPushing(false);
      toast({
        title: "Pushed to ADO",
        description: `Successfully uploaded ${allTestCases.length} API test cases and data to Azure DevOps.`,
      });
      handleBack();
    } catch (err: any) {
      console.error("Error pushing to ADO:", err);
      setIsPushing(false);
      toast({
        title: "Push Failed",
        description: err.message || "Failed to push artifacts to Azure DevOps.",
        variant: "destructive"
      });
    }
  };

  const handleUpdateTestCase = (gIdx: number | null, tcIdx: number, field: string, value: string) => {
    if (!generatedResults) return;

    const newResults = { ...generatedResults };
    if (gIdx !== null && gIdx >= 0 && newResults.groups && newResults.groups[gIdx]) {
      newResults.groups[gIdx].testCases[tcIdx][field] = value;
    } else if (newResults.testCases) {
      newResults.testCases[tcIdx][field] = value;
    }
    setGeneratedResults(newResults);
  };
  const handleExportExcel = () => {
    if (!generatedResults) return;

    const workbook = XLSX.utils.book_new();
    
    // 1. Add Group Sheets (or single sheet if no groups)
    const columnWidths = [
      { wch: 15 }, // ID
      { wch: 10 }, // Type
      { wch: 30 }, // Scenario
      { wch: 40 }, // Steps
      { wch: 40 }, // Input
      { wch: 40 }  // Output
    ];

    if (generatedResults.groups && generatedResults.groups.length > 0) {
      generatedResults.groups.forEach((group: any) => {
        const groupData = group.testCases.map((tc: any) => ({
          "TestCaseID": tc.testCaseId,
          "CaseType": tc.caseType || "Positive",
          "Scenario": tc.scenario,
          "TestData": tc.testData || tc.input || "",
          "ExpectedOutput": typeof tc.expectedOutput === 'object' 
            ? `[${tc.expectedOutput.statusCode}] ${tc.expectedOutput.description}`
            : tc.expectedOutput
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(groupData);
        worksheet["!cols"] = columnWidths;
        
        // Clean sheet name (Excel limits to 31 chars and no certain symbols)
        // Strip common redundant suffixes like 'Test Cases' for cleaner tabs
        const cleanName = group.groupName
          .replace(/\stest\scases?$/i, "")
          .replace(/[\[\]\*\?\/\\]/g, "")
          .trim();
        
        const safeName = cleanName.substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, worksheet, safeName || "Test Cases");
      });
    } else if (generatedResults.testCases) {
      const flatData = generatedResults.testCases.map((tc: any) => ({
        "TestCaseID": tc.testCaseId,
        "CaseType": tc.caseType || "Positive",
        "Scenario": tc.scenario,
        "TestData": tc.testData || tc.input || "",
        "ExpectedOutput": typeof tc.expectedOutput === 'object' 
            ? `[${tc.expectedOutput.statusCode}] ${tc.expectedOutput.description}`
            : tc.expectedOutput
      }));
      const worksheet = XLSX.utils.json_to_sheet(flatData);
      worksheet["!cols"] = columnWidths;
      
      // Use story title for the sheet name if it's a flat list
      const storyObj = allStories.find(s => String(s.id) === String(selectedStoryId));
      const sheetName = (storyObj?.title || "API Test Cases").replace(/[\[\]\*\?\/\\]/g, "").substring(0, 31);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    // 3. Trigger Download
    const prefix = projectName ? `${projectName}_` : "API_";
    const fileName = `${prefix}Test_Artifacts_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };


  return (
    <div className="pt-6 pb-12 px-6 min-h-screen bg-background text-foreground selection:bg-purple-500/30">
      <div className="w-full mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Network className="h-5 w-5 text-purple-500" />
              API Testing
            </h1>
            <p className="text-sm text-muted-foreground">
              Generate and push API tests based on Swagger/OpenAPI contracts.
            </p>
            {(projectName || organization) && (
              <p className="text-xs text-muted-foreground">
                {projectName ? `Project: ${projectName}` : "Project selected"}
                {organization ? ` · Org: ${organization}` : ""}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to SDLC
          </Button>
        </div>

        <Card className="flex flex-col">
          <CardContent className="p-6">
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <FileCode className="h-4 w-4" /> Swagger / OpenAPI Contract
                </h3>
                
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
                    uploadedFile 
                      ? "border-green-500/50 bg-green-500/5 hover:bg-green-500/10" 
                      : "border-muted-foreground/20 hover:bg-accent/50 hover:border-primary/50"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".json,.yaml,.yml"
                    onChange={handleFileUpload}
                  />
                  
                  {uploadedFile ? (
                    <div className="space-y-3 flex flex-col items-center">
                      <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-600">
                        <FileJson className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="font-semibold">{uploadedFile.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {(uploadedFile.size / 1024).toFixed(1)} KB • Ready for generation
                        </p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="mt-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      >
                        <X className="h-3 w-3 mr-1"/> Remove File
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4 flex flex-col items-center">
                      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        <Upload className="h-8 w-8" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-medium">Click to upload API contract</p>
                        <p className="text-sm text-muted-foreground">
                          JSON or YAML files up to 10MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* LOADING PREVIEW — shown while generating */}
              {isGenerating && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  {/* Preview header */}
                  <div className="flex items-center gap-2 pb-1 border-b border-border">
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                    <span className="text-sm font-semibold text-foreground">Preview</span>
                    <span className="text-xs text-muted-foreground">Generating test cases…</span>
                  </div>

                  {/* Fake path toggle tabs — skeleton */}
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-7 rounded-full px-4 text-sm font-medium border animate-pulse",
                          "bg-muted border-border text-transparent"
                        )}
                        style={{ animationDelay: `${i * 80}ms`, minWidth: `${70 + i * 10}px` }}
                      >
                        &nbsp;
                      </div>
                    ))}
                  </div>

                  {/* Skeleton table */}
                  <div className="border rounded-lg overflow-hidden bg-card">
                    {/* Rows count badge */}
                    <div className="flex justify-end px-4 py-2 border-b text-[11px] text-muted-foreground">
                      <span className="animate-pulse">Analyzing contract paths…</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/30">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[120px]">TestCase ID</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs">Scenario</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs">Actions</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs">Test Data Input</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs">Expected Output</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...Array(5)].map((_, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="px-4 py-3">
                              <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: '70px', animationDelay: `${i * 60}ms` }} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="h-4 rounded-full bg-muted/60 animate-pulse" style={{ width: '60px', animationDelay: `${i * 60 + 20}ms` }} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${55 + (i % 4) * 12}%`, animationDelay: `${i * 60 + 40}ms` }} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="h-3.5 rounded bg-muted/70 animate-pulse font-mono" style={{ width: `${40 + (i % 3) * 15}%`, animationDelay: `${i * 60 + 70}ms` }} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="h-3.5 rounded bg-muted/80 animate-pulse font-mono" style={{ width: `${50 + (i % 3) * 10}%`, animationDelay: `${i * 60 + 90}ms` }} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="h-3.5 rounded bg-green-200/50 dark:bg-green-900/30 animate-pulse" style={{ width: `${45 + (i % 4) * 10}%`, animationDelay: `${i * 60 + 110}ms` }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Generation Preview area (if complete) */}
              {generationComplete && generatedResults && (
                <div className="space-y-4 animate-in fade-in duration-300">

                  {/* Preview header */}
                  <div className="flex items-center gap-2 pb-1">
                    <span className="text-sm font-semibold text-foreground">Preview</span>
                    <Badge variant="outline" className="text-[11px] px-2 py-0">
                      {generatedResults.groups && generatedResults.groups.length > 0
                        ? (generatedResults.groups[selectedGroupIdx]?.testCases?.length || 0)
                        : (generatedResults.testCases?.length || 0)} test cases
                    </Badge>
                  </div>

                  {/* Tab-style path buttons */}
                  {generatedResults.groups && generatedResults.groups.length > 0 && (
                    <>
                      <div className="flex gap-0 border-b border-border overflow-x-auto">
                        {generatedResults.groups.map((group: any, gIdx: number) => {
                          const formattedName = group.groupName
                            .replace(/^\//, '') // Remove lead slash
                            .replace(/\/\{[^}]+\}/g, '') // Remove /{id}
                            .replace(/\//g, ' ') // Replace remaining slashes with space
                            .split(/[_\-\s]/)
                            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ')
                            .trim();

                          return (
                            <button
                              key={gIdx}
                              onClick={() => setSelectedGroupIdx(gIdx)}
                              className={cn(
                                "px-6 py-3 text-sm whitespace-nowrap border-b-2 transition-all duration-200",
                                selectedGroupIdx === gIdx
                                  ? "border-blue-500 text-blue-600 dark:text-blue-400 font-semibold bg-blue-50/30 dark:bg-blue-900/10"
                                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                              )}
                            >
                              {formattedName || group.groupName}
                            </button>
                          );
                        })}
                      </div>

                      {/* Rows × columns info */}
                      <div className="flex justify-end text-[11px] text-muted-foreground">
                        {generatedResults.groups[selectedGroupIdx]?.testCases?.length || 0} rows × 5 columns (Editable)
                      </div>

                      {/* Clean flat table */}
                      <div className="border border-border rounded-md overflow-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/30">
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[120px]">TestCaseID</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[100px]">CaseType</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[250px]">Scenario</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[200px]">TestData</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[250px]">ExpectedOutput</th>
                            </tr>
                          </thead>
                          <tbody>
                            {generatedResults.groups[selectedGroupIdx]?.testCases?.map((tc: any, idx: number) => {
                              const caseType = tc.caseType || 'Positive';
                              const badgeClass =
                                caseType === 'Positive' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                caseType === 'Negative' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
                                
                              return (
                                  <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-400 font-medium align-top">{tc.testCaseId}</td>
                                    <td className="px-4 py-3 align-top">
                                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${badgeClass}`}>
                                        {caseType}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                      <textarea 
                                        className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-sm resize-none scrollbar-custom text-foreground transition-all hover:bg-muted/30"
                                        value={tc.scenario}
                                        onChange={(e) => handleUpdateTestCase(selectedGroupIdx, idx, 'scenario', e.target.value)}
                                        rows={3}
                                      />
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                      <textarea 
                                        className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-xs text-muted-foreground resize-none scrollbar-custom transition-all hover:bg-muted/30"
                                        value={tc.testData || (typeof tc.input === 'object' ? JSON.stringify(tc.input) : tc.input)}
                                        onChange={(e) => handleUpdateTestCase(selectedGroupIdx, idx, 'testData', e.target.value)}
                                        rows={4}
                                      />
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                      <div className="space-y-1.5 min-w-[200px]">
                                        {typeof tc.expectedOutput === 'object' ? (
                                          <>
                                            <Badge variant="outline" className="font-mono text-[10px] bg-muted/50">
                                              HTTP {tc.expectedOutput.statusCode}
                                            </Badge>
                                            <p className="text-xs text-foreground leading-relaxed">
                                              {tc.expectedOutput.description}
                                            </p>
                                          </>
                                        ) : (
                                          <textarea 
                                            className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-sm text-foreground resize-none scrollbar-custom transition-all hover:bg-muted/30"
                                            value={tc.expectedOutput}
                                            onChange={(e) => handleUpdateTestCase(selectedGroupIdx, idx, 'expectedOutput', e.target.value)}
                                            rows={4}
                                          />
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {/* Fallback flat view */}
                  {(!generatedResults.groups || generatedResults.groups.length === 0) && generatedResults.testCases && (
                    <div className="border border-border rounded-md overflow-auto scrollbar-custom">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[120px]">TestCase ID</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[100px]">Case Type</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[250px]">Scenario</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[200px]">Test Data</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs w-[250px]">Expected Output</th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedResults.testCases.map((tc: any, idx: number) => {
                            const caseType = tc.caseType || 'Positive';
                            const badgeClass =
                              caseType === 'Positive' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              caseType === 'Negative' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
                              
                            return (
                              <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                                <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-400 font-medium align-top">{tc.testCaseId}</td>
                                <td className="px-4 py-3 align-top">
                                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${badgeClass}`}>
                                    {caseType}
                                  </span>
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <textarea 
                                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-sm resize-none scrollbar-custom text-foreground transition-all hover:bg-muted/30"
                                    value={tc.scenario}
                                    onChange={(e) => handleUpdateTestCase(-1, idx, 'scenario', e.target.value)}
                                    rows={3}
                                  />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <textarea 
                                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-xs text-muted-foreground resize-none scrollbar-custom transition-all hover:bg-muted/30"
                                    value={tc.testData || (typeof tc.input === 'object' ? JSON.stringify(tc.input) : tc.input)}
                                    onChange={(e) => handleUpdateTestCase(-1, idx, 'testData', e.target.value)}
                                    rows={4}
                                  />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <div className="space-y-1.5 min-w-[200px]">
                                    {typeof tc.expectedOutput === 'object' ? (
                                      <>
                                        <Badge variant="outline" className="font-mono text-[10px] bg-muted/50">
                                          HTTP {tc.expectedOutput.statusCode}
                                        </Badge>
                                        <p className="text-xs text-foreground leading-relaxed">
                                          {tc.expectedOutput.description}
                                        </p>
                                      </>
                                    ) : (
                                      <textarea 
                                        className="w-full bg-transparent border-none focus:ring-1 focus:ring-primary/30 rounded p-1 text-sm text-foreground resize-none scrollbar-custom transition-all hover:bg-muted/30"
                                        value={tc.expectedOutput}
                                        onChange={(e) => handleUpdateTestCase(-1, idx, 'expectedOutput', e.target.value)}
                                        rows={4}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}



                </div>
              )}
              
              <div className="flex justify-end pt-4 border-t gap-3 mt-8">
                {generationComplete ? (
                  <div className="flex gap-3">
                    <Button 
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={handlePushToADO} 
                      disabled={isPushing}
                    >
                      {isPushing ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin"/> Pushing to ADO...</>
                      ) : (
                        <><Send className="h-4 w-4 mr-2"/> Push to ADO</>
                      )}
                    </Button>
                    <Button 
                      variant="outline"
                      className="border-primary/20 hover:bg-primary/5"
                      onClick={handleExportExcel} 
                      disabled={!generationComplete || isGenerating}
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                      Export to Excel
                    </Button>
                  </div>
                ) : (
                  <Button 
                    disabled={!uploadedFile || isGenerating}
                    onClick={handleGenerate}
                  >
                    {isGenerating ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin"/> Processing Contract...</>
                    ) : (
                      <><Play className="h-4 w-4 mr-2"/> Generate Test Case and Data</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
