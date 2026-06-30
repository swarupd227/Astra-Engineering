import React, { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, FileCode, CheckCircle2, Download, File, Zap, ChevronRight, Link2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { PageHeader } from "@/components/ui/page-header";
import { TestViewSkeleton } from "@/components/ui/page-skeletons";
import toast from 'react-hot-toast';

export default function BDDFilesViewPage() {
  const [, params] = useRoute('/bdd-files-view/:projectId');
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
  const [bddFiles, setBddFiles] = useState<any>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  
  // File selection states
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

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
        
        if (data.summary?.adoFetchSuccessful) {
          const src = data.summary.integrationType === 'jira' ? 'Jira' : 'ADO';
          console.log(`[BDDFilesViewPage] ✅ User stories fetched from ${src} (${data.summary.userStoriesWithAdoId} stories)`);
        }
        
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

  const isLoading = isLoadingBrds || isLoadingHierarchy;

  // Check which stories have generated BDD files
  useEffect(() => {
    const checkGeneratedStories = async () => {
      if (!filteredStories.length || !organization || !projectName) return;

      try {
        const userStoryIds = filteredStories.map((story: any) => ({
          id: story.id,
          title: story.title
        }));

        const response = await apiRequest('POST', '/api/bdd-assets/check-generated', {
          userStories: userStoryIds,
          organization,
          projectName,
          projectId: projectId || undefined,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.results) {
            setGeneratedStories(data.results);
          }
        }
      } catch (error) {
        console.error('Error checking generated stories:', error);
      }
    };

    checkGeneratedStories();
  }, [filteredStories.length, organization, projectName]);

  const generatedCount = filteredStories.filter((story: any) => generatedStories[story.id]).length;

  // Fetch BDD files for selected user story
  const fetchBDDFiles = async (story: any) => {
    setIsLoadingFiles(true);
    setBddFiles(null);
    setSelectedFile(null);
    setFileContent('');

    try {
      const response = await apiRequest('POST', '/api/github/fetch-bdd-files', {
        userStoryId: story.id,
        userStoryTitle: story.title,
        organization,
        projectName
      });

      if (response.ok) {
        const data = await response.json();
        setBddFiles(data.files || null);
      } else {
        toast.error('Failed to fetch BDD files');
      }
    } catch (error) {
      console.error('Error fetching BDD files:', error);
      toast.error('Error loading BDD files');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Handle user story selection
  const handleUserStorySelect = (story: any) => {
    setSelectedUserStory(story);
    setSelectedFile(null);
    setFileContent('');
    
    // Only fetch if story has generated BDD files
    if (generatedStories[story.id]) {
      fetchBDDFiles(story);
    } else {
      setBddFiles(null);
      setIsLoadingFiles(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (file: any) => {
    setSelectedFile(file.path);
    setFileContent(file.content || '');
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

  // Loading state
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
              icon={FileCode}
              title="Feature Files"
              color="violet"
            >
              {projectName && (
                <Badge variant="secondary" className="text-sm bg-secondary text-secondary-foreground">
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
        <div className="w-[400px] border-r border-border bg-card flex flex-col">
          <div className="p-4 border-b border-border flex-shrink-0">
            <h2 className="text-lg font-semibold text-foreground">User Stories</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Select a story to view feature files
            </p>
            {generatedCount > 0 && (
              <p className="text-xs text-green-600 mt-1">
                ✓ {generatedCount} {generatedCount === 1 ? 'story has' : 'stories have'} generated feature files
              </p>
            )}
          </div>
          
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-3">
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
                      className={`cursor-pointer transition-all hover:shadow-md border-l-[3px] border-l-violet-500 ${
                        selectedUserStory?.id === story.id
                          ? 'bg-primary/5 border-primary border-2'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => handleUserStorySelect(story)}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-sm leading-snug line-clamp-2 text-foreground flex-1">
                              {story.title}
                            </h4>
                            {isGenerated && (
                              <Badge className="text-xs bg-green-100 text-green-700 border-green-300 flex-shrink-0">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Generated
                              </Badge>
                            )}
                          </div>
                          
                          {story.description && (
                            <p className="text-xs text-muted-foreground line-clamp-3">
                              {stripHtml(story.description)}
                            </p>
                          )}
                          
                          <div className="flex gap-2 flex-wrap">
                            {story.persona && (
                              <Badge variant="secondary" className="text-xs">
                                {story.persona}
                              </Badge>
                            )}
                            {story.storyPoints && (
                              <Badge variant="outline" className="text-xs">
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
                                  <span className="text-violet-600 dark:text-violet-400 font-medium truncate max-w-[90px]">
                                    {brdMap[selectedBrdId || story.brdId]}
                                  </span>
                                )}
                                {epicMap[story.epicId] && (
                                  <>
                                    {(selectedBrdId || story.brdId) && brdMap[selectedBrdId || story.brdId] && (
                                      <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" />
                                    )}
                                    <span className="truncate max-w-[80px]">{epicMap[story.epicId]}</span>
                                  </>
                                )}
                                {featureMap[story.featureId] && (
                                  <>
                                    {epicMap[story.epicId] && <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" />}
                                    <span className="truncate max-w-[80px]">{featureMap[story.featureId]}</span>
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

        {/* RIGHT PANEL - BDD FILES VIEW */}
        <div className="flex-1 flex flex-col bg-muted/30">
          {!selectedUserStory ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-md">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                  <FileCode className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">No Story Selected</h3>
                  <p className="text-muted-foreground mt-2">
                    Select a user story from the left panel to view its BDD feature files and step definitions.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Story Header with File Type Filter - Compact */}
              <div className="border-b border-border bg-muted/30 px-6 py-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex gap-2 flex-wrap mb-1.5">
                      <Badge variant="outline" className="border-border text-foreground text-xs">Story #{selectedUserStory.id}</Badge>
                      {selectedUserStory.role && (
                        <Badge variant="secondary" className="bg-secondary text-secondary-foreground text-xs">
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
                </div>
              </div>

              {/* BDD Files Content */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
                        <p className="text-sm text-muted-foreground">Loading files...</p>
                      </div>
                    </div>
                  ) : !bddFiles || !bddFiles.features || bddFiles.features.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
                        <FileCode className="h-8 w-8 text-yellow-600" />
                      </div>
                      <p className="text-foreground font-medium">No Feature Files Generated</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        This user story doesn't have BDD feature files yet.
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Go to "Test Artifacts Generator" to generate BDD assets.
                      </p>
                      
                      <Button
                        onClick={() => {
                          const url = `/test-generation/${projectId}?organization=${organization}&projectName=${projectName}&storyId=${selectedUserStory.id}&storyTitle=${encodeURIComponent(selectedUserStory.title)}`;
                          setLocation(url);
                        }}
                        className="mt-6 bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600"
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        Generate BDD Assets Now
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {bddFiles.features.map((file: any, index: number) => (
                        <Card
                          key={index}
                          className={`cursor-pointer transition-all hover:bg-accent/50 border-l-[3px] border-l-violet-500 ${
                            selectedFile === file.path
                              ? 'bg-blue-500/10 border-l-4 border-l-blue-500'
                              : 'border-border'
                          }`}
                          onClick={() => handleFileSelect(file)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <File className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm text-foreground mb-1 truncate">
                                  {file.name}
                                </h4>
                                {file.content && (
                                  <p className="text-xs text-muted-foreground line-clamp-2 font-mono">
                                    {file.content.split('\n')[0]}
                                  </p>
                                )}
                              </div>
                              {selectedFile === file.path && (
                                <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-xs">
                                  Viewing
                                </Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  
                  {/* File Content Display */}
                  {selectedFile && fileContent && (
                    <>
                    {/* Traceability Source Card */}
                    {(selectedBrdId || selectedUserStory.brdId || epicMap[selectedUserStory.epicId] || featureMap[selectedUserStory.featureId]) && (
                      <Card className="mt-6 border-violet-500/30 border-l-[3px] border-l-violet-500 bg-violet-500/5">
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
                    <Card className="mt-3 border-2 border-blue-500/30 border-l-[3px] border-l-violet-500">
                      <CardHeader className="pb-3 bg-blue-500/5">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <FileCode className="h-4 w-4" />
                            {selectedFile.split('/').pop()}
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-2 h-7 text-xs"
                            onClick={() => {
                              // Create a blob and download the file
                              const blob = new Blob([fileContent], { type: 'text/plain' });
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = selectedFile.split('/').pop() || 'feature-file.feature';
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                              toast.success('File downloaded successfully');
                            }}
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="h-[400px]">
                          <pre className="p-4 text-xs font-mono text-foreground bg-muted/30 whitespace-pre-wrap break-words rounded">
                            {fileContent}
                          </pre>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                    </>
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
