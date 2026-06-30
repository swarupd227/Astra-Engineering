import React, { useState, useEffect } from 'react';
import { useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, FileSpreadsheet, CheckCircle2, ChevronDown, ChevronRight, Filter, Zap, CheckSquare, Link2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { PageHeader } from "@/components/ui/page-header";
import { TestViewSkeleton } from "@/components/ui/page-skeletons";
import toast from 'react-hot-toast';
import { useLocation } from 'wouter';

export default function TestCasesViewPage() {
  const [, params] = useRoute('/test-cases-view/:projectId');
  const [, setLocation] = useLocation();
  const projectId = params?.projectId;
  
  // Get project details from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const organization = urlParams.get('organization');
  const projectName = urlParams.get('projectName');
  
  // Helper function to strip HTML tags and decode entities for display
  const stripHtml = (html: string): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  };

  // State management
  const [selectedBrdId, setSelectedBrdId] = useState<string>('');
  const [selectedEpicId, setSelectedEpicId] = useState<string>('');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('');
  const [selectedUserStory, setSelectedUserStory] = useState<any>(null);
  const [generatedStories, setGeneratedStories] = useState<Record<string, boolean>>({});
  const [testCasesData, setTestCasesData] = useState<any>(null);
  const [isLoadingTestCases, setIsLoadingTestCases] = useState<boolean>(false);
  
  // Test case filtering and expansion states
  const [selectedTestType, setSelectedTestType] = useState<string>('all');
  const [expandedTestCase, setExpandedTestCase] = useState<string | null>(null);

  // Fetch BRDs
  const { data: brdsData = [], isLoading: isLoadingBrds } = useQuery({
    queryKey: [`/api/dev-brd/approved`, projectId],
    queryFn: async () => {
      if (!projectId) return [];
      try {
        const response = await apiRequest("GET", `/api/dev-brd/approved?projectId=${projectId}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data;
      } catch (error) {
        console.error("Error fetching BRDs:", error);
        return [];
      }
    },
    enabled: !!projectId,
  });

  // Fetch hierarchical workflow artifacts data (BRD → Epic → Feature → User Story)
  // **CRITICAL: Now fetches from ADO first, then enriches with DB data**
  const { data: hierarchyData, isLoading: isLoadingHierarchy } = useQuery({
    queryKey: ["/api/workflow/artifacts/hierarchy", projectId, selectedBrdId, selectedEpicId, selectedFeatureId, organization, projectName],
    queryFn: async () => {
      if (!projectId) return { success: false, epics: [], features: [], userStories: [], summary: {} };
      
      try {
        const params = new URLSearchParams({ projectId });
        if (selectedBrdId) params.append('brdId', selectedBrdId);
        if (selectedEpicId) params.append('epicId', selectedEpicId);
        if (selectedFeatureId) params.append('featureId', selectedFeatureId);
        // **CRITICAL: Pass organization and projectName to fetch from ADO**
        if (organization) params.append('organization', organization);
        if (projectName) params.append('projectName', projectName);
        
        const response = await apiRequest("GET", `/api/workflow/artifacts/hierarchy?${params.toString()}`);
        
        if (!response.ok) return { success: false, epics: [], features: [], userStories: [], summary: {} };
        const data = await response.json();
        
        
        // Show warning if filtering returned 0 results
        if (data.filteringNote) {
          toast.error(data.filteringNote, { duration: 8000 });
        }
        
        return data;
      } catch (error) {
        console.error("Error fetching hierarchy data:", error);
        return { success: false, epics: [], features: [], userStories: [], summary: {} };
      }
    },
    enabled: !!projectId,
  });

  // Extract hierarchical data
  const workflowEpics = hierarchyData?.epics || [];
  const workflowFeatures = hierarchyData?.features || [];
  const workflowUserStories = hierarchyData?.userStories || [];

  // Traceability lookup maps: id → title
  const epicMap = workflowEpics.reduce((acc: Record<string, string>, epic: any) => {
    acc[epic.id] = epic.title;
    return acc;
  }, {} as Record<string, string>);

  const featureMap = workflowFeatures.reduce((acc: Record<string, string>, feature: any) => {
    acc[feature.id] = feature.title;
    return acc;
  }, {} as Record<string, string>);

  const brdMap = brdsData.reduce((acc: Record<string, string>, brd: any) => {
    acc[brd.id] = brd.title;
    return acc;
  }, {} as Record<string, string>);

  // User stories are already filtered by the API
  const filteredStories = workflowUserStories;
  const storyCount = filteredStories.length;
  const generatedCount = filteredStories.filter((story: any) => generatedStories[story.id]).length;

  const isLoading = isLoadingBrds || isLoadingHierarchy;

  // Check GitHub for generated artifacts when user stories load
  useEffect(() => {
    const checkGeneratedArtifacts = async () => {
      if (filteredStories.length === 0 || !organization || !projectName) {
        return;
      }

      try {
        const response = await apiRequest('POST', '/api/bdd-assets/check-generated', {
          userStories: filteredStories.map((story: any) => ({
            id: story.id,
            title: story.title
          })),
          organization,
          projectId: projectId || undefined,
          projectName
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.results) {
            setGeneratedStories(data.results);
          }
        }
      } catch (error) {
        console.error('[TestCasesViewPage] Error checking GitHub for generated artifacts:', error);
      }
    };

    checkGeneratedArtifacts();
  }, [filteredStories.length, organization, projectName]);

  // Fetch test cases for selected user story
  const fetchTestCases = async (story: any) => {
    if (!organization || !projectName) {
      toast.error('Missing organization or project name');
      return;
    }

    setIsLoadingTestCases(true);
    setTestCasesData(null);

    try {
      // Fetch test-cases.json from GitHub
      const response = await apiRequest('POST', '/api/github/fetch-test-cases', {
        userStory: story,
        organization,
        projectName
      });

      if (response.ok) {
        const data = await response.json();
        setTestCasesData(data.testCases);
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch test cases');
      }
    } catch (error: any) {
      console.error('Error fetching test cases:', error);
      toast.error(error.message || 'Failed to load test cases');
      setTestCasesData(null);
    } finally {
      setIsLoadingTestCases(false);
    }
  };

  // Handle user story selection
  const handleUserStorySelect = (story: any) => {
    setSelectedUserStory(story);
    setExpandedTestCase(null); // Reset expanded state
    setSelectedTestType('all'); // Reset filter
    
    // Only fetch if story has generated test cases
    if (generatedStories[story.id]) {
      fetchTestCases(story);
    } else {
      setTestCasesData(null);
      setIsLoadingTestCases(false);
    }
  };

  // Handle back to list
  const handleCancel = () => {
    const backParams = new URLSearchParams();
    if (organization) backParams.set('organization', organization);
    if (projectId) backParams.set('projectId', projectId);
    if (projectName) backParams.set('projectName', projectName);
    backParams.set('phase', '4');

    const query = backParams.toString();
    setLocation(query ? `/sdlc?${query}` : '/sdlc');
  };

  // Export to Excel
  const handleExportToExcel = async () => {
    if (!testCasesData || !selectedUserStory) {
      toast.error('No test cases to export');
      return;
    }

    try {
      const response = await apiRequest('POST', '/api/export-testcases-excel', {
        testCases: testCasesData,
        metadata: {
          storyTitle: selectedUserStory.title,
          storyId: selectedUserStory.id,
          generatedAt: new Date().toISOString()
        }
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const dateStr = new Date().toISOString().split('T')[0];
      const titleSlug = (selectedUserStory?.title || 'TestCases')
        .replace(/[^a-z0-9]/gi, '_')
        .substring(0, 50);
      link.download = `TestCases_${titleSlug}_${dateStr}.xlsx`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Exported to Excel successfully');
    } catch (error: any) {
      console.error('Export error:', error);
      toast.error(error.message || 'Failed to export test cases');
    }
  };

  if (isLoading) {
    return <TestViewSkeleton />;
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* TOP FILTER BAR */}
      <div className="border-b border-border bg-card p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <PageHeader
              icon={CheckSquare}
              title="Test Cases"
              color="emerald"
            >
              {projectName && (
                <Badge variant="secondary" className="text-sm">
                  {projectName}
                </Badge>
              )}
            </PageHeader>
          </div>
          
          {/* Filters and Story Count */}
          <div className="flex items-center gap-6">
            <div className="flex gap-3">
              <Select value={selectedBrdId || 'all'} onValueChange={(value) => { setSelectedBrdId(value === 'all' ? '' : value); setSelectedUserStory(null); }}>
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All BRDs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All BRDs</SelectItem>
                  {brdsData.map((brd: any) => (
                    <SelectItem key={brd.id} value={brd.id}>
                      {brd.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={selectedEpicId || 'all'} onValueChange={(value) => { setSelectedEpicId(value === 'all' ? '' : value); setSelectedUserStory(null); }}>
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All Epics" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Epics</SelectItem>
                  {workflowEpics.map((epic: any) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={selectedFeatureId || 'all'} onValueChange={(value) => { setSelectedFeatureId(value === 'all' ? '' : value); setSelectedUserStory(null); }}>
                <SelectTrigger className="w-44 border-border">
                  <SelectValue placeholder="All Features" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Features</SelectItem>
                  {workflowFeatures.map((feature: any) => (
                    <SelectItem key={feature.id} value={feature.id}>
                      {feature.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-3">
              {(selectedBrdId || selectedEpicId || selectedFeatureId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedBrdId('');
                    setSelectedEpicId('');
                    setSelectedFeatureId('');
                    setSelectedUserStory(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Reset all filters to 'All'"
                >
                  Clear Filters
                </Button>
              )}
              <Badge variant="outline" className="px-3 py-1 border-green-300 bg-green-50 text-green-700">
                {generatedCount} Generated
              </Badge>
              <Badge variant="outline" className="px-3 py-1 border-border text-foreground">
                {storyCount} {storyCount === 1 ? 'Story' : 'Stories'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to SDLC
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT - TWO COLUMN */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL - USER STORY LIST */}
        <div className="w-[500px] border-r border-border bg-card flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-border flex-shrink-0">
            <h2 className="text-lg font-semibold text-foreground">User Stories</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Select a story to view test cases
            </p>
            {generatedCount > 0 && (
              <p className="text-xs text-green-600 mt-1">
                ✓ {generatedCount} {generatedCount === 1 ? 'story has' : 'stories have'} generated test cases
              </p>
            )}
          </div>
          
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full">
              <div className="p-4 space-y-3 pr-3">
                {filteredStories.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">No user stories found</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Try adjusting your filters
                    </p>
                  </div>
                ) : (
                  filteredStories.map((story: any) => {
                    const isGenerated = generatedStories[story.id];
                    
                    return (
                    <Card
                      key={story.id}
                      className={`cursor-pointer transition-all hover:shadow-md border-l-[3px] border-l-emerald-500 ${
                        selectedUserStory?.id === story.id
                          ? 'bg-primary/5 border-primary border-2'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => handleUserStorySelect(story)}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-2 w-full">
                          <div className="flex items-start justify-between gap-2 w-full">
                            <h4 className="font-semibold text-sm leading-snug text-foreground flex-1 min-w-0 break-words" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                              {story.title}
                            </h4>
                            {isGenerated && (
                              <Badge className="text-xs bg-green-100 text-green-700 border-green-300 flex-shrink-0 whitespace-nowrap">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Generated
                              </Badge>
                            )}
                          </div>
                          
                          {story.description && (
                            <p className="text-xs text-muted-foreground min-w-0 break-words line-clamp-2" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                              {stripHtml(story.description)}
                            </p>
                          )}
                          
                          <div className="flex gap-2 flex-wrap justify-start">
                            {story.persona && (
                              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                {story.persona}
                              </Badge>
                            )}
                            {story.storyPoints && (
                              <Badge variant="outline" className="text-xs whitespace-nowrap">
                                {story.storyPoints} pts
                              </Badge>
                            )}
                          </div>

                          {/* Traceability breadcrumb */}
                          {(selectedBrdId || story.brdId || story.epicId || story.featureId) && (
                            <div className="flex items-center gap-1 pt-1.5 border-t border-border/50 mt-0.5">
                              <Link2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap min-w-0">
                                {(selectedBrdId || story.brdId) && brdMap[selectedBrdId || story.brdId] && (
                                  <span className="text-violet-600 dark:text-violet-400 font-medium break-words">
                                    {brdMap[selectedBrdId || story.brdId]}
                                  </span>
                                )}
                                {epicMap[story.epicId] && (
                                  <>
                                    {(selectedBrdId || story.brdId) && brdMap[selectedBrdId || story.brdId] && (
                                      <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" />
                                    )}
                                    <span className="break-words">{epicMap[story.epicId]}</span>
                                  </>
                                )}
                                {featureMap[story.featureId] && (
                                  <>
                                    {epicMap[story.epicId] && <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" />}
                                    <span className="break-words">{featureMap[story.featureId]}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* RIGHT PANEL - TEST CASES VIEWER */}
        <div className="flex-1 flex flex-col bg-muted/30">
          {!selectedUserStory ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                  <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">No Story Selected</h3>
                  <p className="text-muted-foreground mt-2">
                    Select a user story from the left panel to view its test cases.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Story Header with Filters - Compact */}
              <div className="border-b border-border bg-muted/30 px-6 py-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex gap-2 flex-wrap mb-1.5">
                      <Badge variant="outline" className="border-gray-300 text-foreground text-xs">Story #{selectedUserStory.id}</Badge>
                      {selectedUserStory.role && (
                        <Badge variant="secondary" className="bg-muted/50 text-foreground text-xs">
                          {selectedUserStory.role}
                        </Badge>
                      )}
                    </div>
                    <h2 className="text-base font-semibold text-foreground leading-snug">
                      {selectedUserStory.title}
                    </h2>
                    {/* Traceability chain */}
                    {(selectedBrdId || selectedUserStory.brdId || epicMap[selectedUserStory.epicId] || featureMap[selectedUserStory.featureId]) && (
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap px-2.5 py-1.5 bg-violet-500/5 border border-violet-500/20 rounded-md text-xs">
                        <Link2 className="h-3 w-3 text-violet-500 flex-shrink-0" />
                        <span className="text-violet-600 dark:text-violet-400 font-semibold">Source:</span>
                        {(selectedBrdId || selectedUserStory.brdId) && brdMap[selectedBrdId || selectedUserStory.brdId] && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-violet-300 text-violet-700 dark:text-violet-400 font-normal">
                            {brdMap[selectedBrdId || selectedUserStory.brdId]}
                          </Badge>
                        )}
                        {epicMap[selectedUserStory.epicId] && (
                          <>
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-blue-300 text-blue-700 dark:text-blue-400 font-normal">
                              {epicMap[selectedUserStory.epicId]}
                            </Badge>
                          </>
                        )}
                        {featureMap[selectedUserStory.featureId] && (
                          <>
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-teal-300 text-teal-700 dark:text-teal-400 font-normal">
                              {featureMap[selectedUserStory.featureId]}
                            </Badge>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {testCasesData && (
                    <Button
                      onClick={handleExportToExcel}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2 border-green-300 text-green-700 hover:bg-green-50"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Export to Excel
                    </Button>
                  )}
                </div>
                
                {/* Filter for Test Case Types */}
                {testCasesData && (
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    <Select value={selectedTestType} onValueChange={setSelectedTestType}>
                      <SelectTrigger className="w-56 h-8 border-gray-300 text-sm">
                        <SelectValue placeholder="Filter by test type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Test Cases</SelectItem>
                        <SelectItem value="functional">Functional Tests Only</SelectItem>
                        <SelectItem value="negative">Negative Tests Only</SelectItem>
                        <SelectItem value="edgeCases">Edge Cases Only</SelectItem>
                        <SelectItem value="accessibility">Accessibility Tests Only</SelectItem>
                        <SelectItem value="performance">Performance Tests Only</SelectItem>
                        <SelectItem value="security">Security Tests Only</SelectItem>
                        <SelectItem value="usability">Usability Tests Only</SelectItem>
                        <SelectItem value="reliability">Reliability Tests Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Test Cases Content */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {isLoadingTestCases ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-center space-y-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary mx-auto"></div>
                        <p className="text-sm text-muted-foreground">Loading test cases...</p>
                      </div>
                    </div>
                  ) : !testCasesData ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
                        <FileSpreadsheet className="h-8 w-8 text-yellow-600" />
                      </div>
                      <p className="text-foreground font-medium">No test cases generated yet</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        This user story doesn't have test cases yet.
                      </p>
                      <p className="text-sm text-muted-foreground mt-1 mb-4">
                        Go to "Test Artifacts Generator" to generate test cases for this story.
                      </p>
                      <Button
                        onClick={() => {
                          const url = `/test-generation/${projectId}?organization=${organization}&projectName=${projectName}&storyId=${selectedUserStory.id}&storyTitle=${encodeURIComponent(selectedUserStory.title)}`;
                          setLocation(url);
                        }}
                        className="mt-6 bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600"
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        Generate Test Cases Now
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Requirement Traceability Panel */}
                      {(selectedBrdId || selectedUserStory.brdId || epicMap[selectedUserStory.epicId] || featureMap[selectedUserStory.featureId]) && (
                        <Card className="border-violet-500/30 border-l-[3px] border-l-violet-500 bg-violet-500/5">
                          <CardHeader className="pb-2 pt-3">
                            <CardTitle className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5 uppercase tracking-wide">
                              <Link2 className="h-3.5 w-3.5" />
                              Requirement Traceability
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0 pb-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {(selectedBrdId || selectedUserStory.brdId) && brdMap[selectedBrdId || selectedUserStory.brdId] && (
                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-500/10 border border-violet-500/25 rounded-full">
                                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
                                  <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-400 whitespace-nowrap">BRD</span>
                                  <span className="text-[11px] text-foreground font-medium">{brdMap[selectedBrdId || selectedUserStory.brdId]}</span>
                                </div>
                              )}
                              {epicMap[selectedUserStory.epicId] && (
                                <>
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/25 rounded-full">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                    <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">Epic</span>
                                    <span className="text-[11px] text-foreground font-medium">{epicMap[selectedUserStory.epicId]}</span>
                                  </div>
                                </>
                              )}
                              {featureMap[selectedUserStory.featureId] && (
                                <>
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-500/10 border border-teal-500/25 rounded-full">
                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                                    <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 whitespace-nowrap">Feature</span>
                                    <span className="text-[11px] text-foreground font-medium">{featureMap[selectedUserStory.featureId]}</span>
                                  </div>
                                </>
                              )}
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/25 rounded-full">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">Story</span>
                                <span className="text-[11px] text-foreground font-medium line-clamp-1 max-w-[160px]">{selectedUserStory.title}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Test Case Summary Section - All 8 Types */}
                      <Card className="border-blue-500/30 bg-blue-500/5 border-l-[3px] border-l-emerald-500">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold text-foreground">Test Coverage Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
                            {Object.entries(testCasesData)
                              .filter(([category]) => {
                                // Only show test case categories (exclude metadata fields)
                                const validCategories = ['functional', 'negative', 'edgeCases', 'accessibility', 
                                                       'performance', 'security', 'usability', 'reliability'];
                                return validCategories.includes(category);
                              })
                              .map(([category, tests]: [string, any]) => {
                                const testArray = Array.isArray(tests) ? tests : [];
                                // Skip empty categories (not selected or failed to generate)
                                if (testArray.length === 0) return null;
                                
                                return (
                                  <div key={category} className="text-center p-2 bg-card rounded border border-border">
                                    <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{testArray.length}</div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5 capitalize leading-tight">
                                      {category.replace(/([A-Z])/g, ' $1').trim()}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                          <div className="mt-3 pt-3 border-t border-border">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-foreground font-medium">Total Test Cases:</span>
                              <span className="font-bold text-foreground text-lg">
                                {Object.entries(testCasesData)
                                  .filter(([category]) => {
                                    // Only count valid test case categories
                                    const validCategories = ['functional', 'negative', 'edgeCases', 'accessibility', 
                                                           'performance', 'security', 'usability', 'reliability'];
                                    return validCategories.includes(category);
                                  })
                                  .reduce((sum: number, [, tests]: [string, any]) => {
                                    const testArray = Array.isArray(tests) ? tests : [];
                                    return sum + testArray.length;
                                  }, 0)}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Detailed Test Cases by Category - Accordion Style */}
                      {Object.entries(testCasesData)
                        .filter(([category]) => {
                          // Only show valid test case categories (exclude metadata fields)
                          const validCategories = ['functional', 'negative', 'edgeCases', 'accessibility', 
                                                 'performance', 'security', 'usability', 'reliability'];
                          if (!validCategories.includes(category)) return false;
                          // Apply user's filter selection
                          return selectedTestType === 'all' || selectedTestType === category;
                        })
                        .map(([category, tests]: [string, any]) => {
                        // Ensure tests is always an array
                        const testArray = Array.isArray(tests) ? tests : [];
                        
                        // Skip empty categories (not selected or failed to generate)
                        if (testArray.length === 0) return null;
                        
                        // Category color themes - Subtle with good contrast
                        const categoryThemes: Record<string, { bg: string; border: string; text: string; badge: string }> = {
                          functional: { 
                            bg: 'bg-blue-500/5', 
                            border: 'border-blue-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' 
                          },
                          negative: { 
                            bg: 'bg-red-500/5', 
                            border: 'border-red-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' 
                          },
                          edgeCases: { 
                            bg: 'bg-orange-500/5', 
                            border: 'border-orange-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' 
                          },
                          accessibility: { 
                            bg: 'bg-purple-500/5', 
                            border: 'border-purple-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' 
                          },
                          // Extended test types
                          performance: { 
                            bg: 'bg-green-500/5', 
                            border: 'border-green-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' 
                          },
                          security: { 
                            bg: 'bg-yellow-500/5', 
                            border: 'border-yellow-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20' 
                          },
                          usability: { 
                            bg: 'bg-pink-500/5', 
                            border: 'border-pink-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' 
                          },
                          reliability: { 
                            bg: 'bg-teal-500/5', 
                            border: 'border-teal-500/30', 
                            text: 'text-foreground', 
                            badge: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' 
                          },
                        };
                        
                        const theme = categoryThemes[category] || { bg: 'bg-muted/30', border: 'border-border', text: 'text-foreground', badge: 'bg-secondary text-secondary-foreground' };
                        
                        return (
                        <Card key={category} className={`${theme.border} border-2 border-l-[3px] border-l-emerald-500`}>
                          <CardHeader className={`${theme.bg} py-3`}>
                            <CardTitle className={`text-sm capitalize flex items-center justify-between ${theme.text}`}>
                              <span className="font-bold">{category.replace(/([A-Z])/g, ' $1').trim()} Test Cases</span>
                              <Badge className={`${theme.badge} text-xs`}>{testArray.length} tests</Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 space-y-2">
                            {testArray.map((test: any, index: number) => {
                              const testId = `${category}-${index}`;
                              const isExpanded = expandedTestCase === testId;
                              
                              return (
                              <Card
                                key={index}
                                className={`border border-l-[3px] border-l-emerald-500 ${isExpanded ? `${theme.border} border-2 shadow-md` : 'border-border'} transition-all`}
                              >
                                {/* Test Case Header - Always Visible */}
                                <div
                                  className={`p-3 cursor-pointer hover:bg-accent/30 transition-colors ${isExpanded ? theme.bg : ''}`}
                                  onClick={() => setExpandedTestCase(isExpanded ? null : testId)}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-2 flex-1">
                                      <div className="mt-0.5">
                                        {isExpanded ? (
                                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </div>
                                      <div className="flex-1">
                                        <h4 className="font-medium text-sm text-foreground mb-0.5">
                                          {index + 1}. {test.title}
                                        </h4>
                                        {!isExpanded && test.description && (
                                          <p className="text-xs text-muted-foreground line-clamp-1">
                                            {test.description}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <Badge 
                                        variant={test.priority === 'High' ? 'destructive' : test.priority === 'Low' ? 'secondary' : 'default'} 
                                        className="text-xs whitespace-nowrap"
                                      >
                                        {test.priority || 'Medium'}
                                      </Badge>
                                      {test.steps && (
                                        <Badge variant="outline" className="text-xs whitespace-nowrap border-gray-300">
                                          {test.steps.length} steps
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Test Case Details - Shown When Expanded */}
                                {isExpanded && (
                                  <div className="px-3 pb-3 pt-3 space-y-3 border-t border-border">
                                    {test.description && (
                                      <div>
                                        <h5 className="text-xs font-semibold text-foreground uppercase mb-2">Description</h5>
                                        <p className="text-sm text-foreground leading-relaxed">
                                          {test.description}
                                        </p>
                                      </div>
                                    )}
                                    
                                    {test.preconditions && (
                                      <div>
                                        <h5 className="text-xs font-semibold text-foreground uppercase mb-2">Preconditions</h5>
                                        <p className="text-sm text-foreground leading-relaxed bg-muted/30 p-3 rounded border border-border">
                                          {test.preconditions}
                                        </p>
                                      </div>
                                    )}
                                    
                                    {test.steps && test.steps.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-semibold text-foreground uppercase mb-2">Test Steps</h5>
                                        <div className="space-y-3">
                                          {test.steps.map((step: any, stepIndex: number) => (
                                            <div key={stepIndex} className="flex gap-3">
                                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-semibold">
                                                {stepIndex + 1}
                                              </div>
                                              <div className="flex-1 space-y-1">
                                                <div className="text-sm text-foreground">
                                                  <span className="font-medium">Action: </span>
                                                  {step.action}
                                                </div>
                                                {step.expectedResult && (
                                                  <div className="text-sm text-green-700 bg-green-50 p-2 rounded border border-green-200">
                                                    <span className="font-medium">Expected: </span>
                                                    {step.expectedResult}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {test.expectedResult && !test.steps && (
                                      <div>
                                        <h5 className="text-xs font-semibold text-foreground uppercase mb-2">Expected Result</h5>
                                        <p className="text-sm text-green-700 bg-green-50 p-3 rounded border border-green-200">
                                          {test.expectedResult}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </Card>
                              );
                            })}
                          </CardContent>
                        </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
