//brdWorkSpace.


import React, { useState } from 'react';
import {
  FolderGit2,
  Users,
  FileText,
  CheckCircle2,
  FileText as FileTextIcon,
  Sparkles,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  RefreshCw,
  FileStack,
  Database as DatabaseIcon,
  AlertTriangle,
  ChevronDown,
  Check as CheckIcon,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { StageState, StageStatus } from './types.ts';


interface BRDWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export default function BRDWorkspace({
  stageState,
  onStatusChange,
  onComplete,
  selectedAdoProject,
  selectedOrganization
}: {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
  selectedAdoProject: any,
  selectedOrganization: any
}) {

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [openRepoPopover, setOpenRepoPopover] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [selectedPersona, setSelectedPersona] = useState('');
  const [openPersonaPopover, setOpenPersonaPopover] = useState(false);
  const [personaSearchQuery, setPersonaSearchQuery] = useState('');
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>([]);
  const [openArtifactPopover, setOpenArtifactPopover] = useState(false);
  const [artifactSearchQuery, setArtifactSearchQuery] = useState('');
  const [generatedBRD, setGeneratedBRD] = useState<any>(stageState.data || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hitlReviewRequired, setHitlReviewRequired] = useState(false);
  const [useGoldenRepo, setUseGoldenRepo] = useState(true);


  const repositories = [
    { id: 'repo-1', name: 'Healthcare', description: 'Healthcare & Life Sciences' },
    { id: 'repo-2', name: 'Retail', description: 'Retail & E-Commerce' },
    { id: 'repo-3', name: 'BFSI', description: 'Banking, Financial Services & Insurance' },
    { id: 'repo-4', name: 'Insurance', description: 'Insurance & Risk Management' },
    { id: 'repo-5', name: 'Automotive', description: 'Automotive & Manufacturing' },
  ];

  const personas = [
    { id: 'persona-1', name: 'Product Manager', role: 'Strategic Planning' },
    { id: 'persona-2', name: 'Technical Architect', role: 'System Design' },
    { id: 'persona-3', name: 'Business Analyst', role: 'Requirements Gathering' },
  ];

  const artifacts = [
    { id: 'artifact-1', name: 'User Stories', description: 'Agile user stories' },
    { id: 'artifact-2', name: 'Use Cases', description: 'Detailed use case diagrams' },
    { id: 'artifact-3', name: 'Process Flows', description: 'Business process workflows' },
    { id: 'artifact-4', name: 'Data Models', description: 'Entity relationship diagrams' },
    { id: 'artifact-5', name: 'API Specs', description: 'API documentation templates' },
  ];

  const handleArtifactToggle = (artifactId: string) => {
    setSelectedArtifacts(prev =>
      prev.includes(artifactId) ? prev.filter(id => id !== artifactId) : [...prev, artifactId]
    );
  };

  // Real API workflow for BRD generation
  const { toast } = useToast();
  const [apiError, setApiError] = useState<string | null>(null);

  // Get selected org/project from localStorage (same as main component)

  const handleGenerateBRD = async () => {
    // Validate organization and project selection
    if (!selectedOrganization || !selectedAdoProject) {
      toast({
        title: 'Organization & Project Required',
        description: 'Please select an organization and project before generating the BRD.',
        variant: 'destructive',
      });
      return;
    }
    // Validate all fields are filled
    if (!title || !prompt || !selectedRepo || !selectedPersona || selectedArtifacts.length === 0) {
      toast({
        title: 'Missing Required Fields',
        description: 'Please fill in the BRD title, prompt, repository, persona, and select at least one artifact.',
        variant: 'destructive',
      });
      return;
    }
    if (prompt.length < 10) {
      toast({
        title: 'Project Description Too Short',
        description: 'Project description must be at least 10 characters.',
        variant: 'destructive',
      });
      return;
    }
    setIsGenerating(true);
    setApiError(null);
    try {
      // 1. Create BRD draft
      const createRes = await fetch(getApiUrl('/api/dev-brd/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          projectId: selectedAdoProject?.id,
          organization: selectedOrganization?.id,
          title,
          createdBy: 'system',
          prompt,
          persona: personas.find(p => p.id === selectedPersona)?.name || '',
          artifacts: selectedArtifacts.map(id => artifacts.find(a => a.id === id)?.name).filter(Boolean),
        }),
      });
      if (!createRes.ok) throw new Error('Failed to create BRD draft');
      const createData = await createRes.json();
      const brdId = createData.id || createData.brdId || createData.brd_id;
      if (!brdId) throw new Error('No BRD ID returned from draft creation');

      // 2. Fetch BRD by ID (to get full draft)
      const brdRes = await fetch(getApiUrl(`/api/dev-brd/${brdId}`), {
        credentials: 'include',
      });
      if (!brdRes.ok) throw new Error('Failed to fetch BRD draft');
      const brdDraft = await brdRes.json();

      // 3. Call /api/brd/generate to generate the BRD, sending projectName and projectDescription as prompt
      const genRes = await fetch(getApiUrl('/api/brd/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          brdId,
          projectId: selectedAdoProject?.id,
          organization: selectedOrganization?.id,
          projectName: title,
          projectDescription: prompt,
          useGoldenRepo: useGoldenRepo,
        }),
      });

      if (!genRes.ok) {
        let errMsg = 'Failed to generate BRD';
        try {
          const errJson = await genRes.json();
          errMsg = errJson?.error || errMsg;
        } catch { }
        throw new Error(errMsg);
      }
      const genData = await genRes.json();

      // Async job mode: poll until BRD generation completes
      if (genData?.jobId) {
        const jobId = genData.jobId as string;
        const start = Date.now();
        const timeoutMs = 10 * 60 * 1000; // UX-friendly wait cap

        while (true) {
          const statusRes = await fetch(
            getApiUrl(
              `/api/brd/generate/status/${encodeURIComponent(jobId)}`
            ),
            {
              credentials: "include",
              cache: "no-store",
            }
          );

          if (!statusRes.ok) {
            throw new Error(
              `Failed to fetch BRD job status (${statusRes.status})`
            );
          }

          const statusData = await statusRes.json().catch(() => ({}));

          console.log("[BRD Job Poll][CIO Workspace]", {
            jobId,
            status: statusData.status,
            step: statusData.step,
          });

          if (statusData.status === "completed") {
            break;
          }

          if (statusData.status === "failed") {
            throw new Error(statusData.error || "BRD generation failed");
          }

          if (Date.now() - start > timeoutMs) {
            toast({
              title: 'Still generating in background',
              description:
                'BRD generation is taking longer than expected. It will continue in background — reopen this stage in a minute.',
            });
            return;
          }

          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // 4. Fetch the generated BRD again (final)
      const brdFinalRes = await fetch(getApiUrl(`/api/dev-brd/${brdId}`), {
        credentials: 'include',
      });
      if (!brdFinalRes.ok) throw new Error('Failed to fetch generated BRD');
      const brdFinal = await brdFinalRes.json();

      // If brdFinal contains a 'brd' property (from /api/brd/generate), use it
      const brdData = brdFinal.brd ? brdFinal.brd : brdFinal;

      setGeneratedBRD(brdData);
      setIsGenerating(false);
      onStatusChange('review', brdData);
      toast({ title: 'BRD Generated', description: 'Business Requirements Document generated successfully.' });
    } catch (err: any) {
      setIsGenerating(false);
      setApiError(err.message || 'Failed to generate BRD');
      toast({ title: 'BRD Generation Failed', description: err.message || 'Failed to generate BRD', variant: 'destructive' });
    }
  };

  const handleApprove = async () => {
    if (!generatedBRD || !generatedBRD.id) {
      onComplete(generatedBRD);
      return;
    }
    const brdId = generatedBRD.id || generatedBRD.brdId || generatedBRD.brd_id;
    try {
      // 1. Set status to 'review'
      await fetch(getApiUrl(`/api/dev-brd/${brdId}/status`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'review' }),
      });
      // 2. Set status to 'approved'
      await fetch(getApiUrl(`/api/dev-brd/${brdId}/status`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'approved' }),
      });
    } catch (err) {
      // Optionally handle error (toast, etc)
    }
    onComplete(generatedBRD);
  };

  const handleRequestChanges = () => {
    // send back to active so user can edit and regenerate
    setGeneratedBRD(null);
    onStatusChange('active');
  };

  const handleRegenerate = () => {
    // re-run generation with current selections
    handleGenerateBRD();
  };

  const isReviewMode = stageState.status === 'review';
  const isCompleted = stageState.status === 'completed';


  // Restore isCompleted rendering block for completed state
  if (isCompleted && generatedBRD) {
    // Prefer new API structure if present
    const brdJson = generatedBRD.generatedBrdJson || generatedBRD;
    const title = brdJson.title || generatedBRD.title;
    const version = brdJson.version;
    const date = brdJson.date;
    const sections = brdJson.sections || generatedBRD.sections;
    const rawMarkdown = brdJson.rawMarkdown || generatedBRD.generatedMarkdown || generatedBRD.rawMarkdown;
    return (
      <div className="bg-card rounded-2xl border border-green-300 flex flex-col h-full shadow-md">
        <div className="p-6 border-b border-green-200 flex items-center gap-4">
          <CheckCircle2 className="w-8 h-8 text-green-500" strokeWidth={2} />
          <div>
            <h2 className="text-lg font-semibold text-foreground">BRD Approved & Completed</h2>
            <p className="text-sm text-muted-foreground mt-1">Business Requirements Document has been approved. You can proceed to the next stage.</p>
          </div>
        </div>
        <div className="flex-1 p-6 space-y-4 overflow-y-auto min-h-[300px] max-h-[60vh] border-b border-border">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
            <div className="flex items-center gap-6 mt-1 text-xs text-muted-foreground flex-wrap">
              {version && (
                <span>Version: <span className="font-medium text-foreground">{version}</span></span>
              )}
              {date && (
                <span>Date: <span className="font-medium text-foreground">{date}</span></span>
              )}
            </div>
          </div>
          {sections && Array.isArray(sections) && sections.map((section: any, idx: number) => (
            <div key={idx} className="pb-4 border-b border-border last:border-b-0 last:pb-0">
              <h4 className="text-sm font-semibold text-foreground mb-1">{section.title}</h4>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{section.content}</p>
            </div>
          ))}
          {rawMarkdown && (
            <div className="mt-8">
              <h4 className="text-sm font-semibold text-foreground mb-2">Full BRD Markdown Preview</h4>
              <pre className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap border border-border">{rawMarkdown}</pre>
            </div>
          )}
        </div>
        <div className="p-6 text-center">
          <span className="inline-block px-4 py-2 bg-green-100 text-green-800 text-sm font-medium rounded-lg">BRD Stage Completed</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Business Requirements Document</h1>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 space-y-4">
          {/* Title Field */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-4 h-4 text-blue-600 flex items-center justify-center"><FileText strokeWidth={2} className="w-4 h-4" /></span>
              <h3 className="text-sm font-semibold text-foreground">BRD Title</h3>
            </div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Enter BRD title..."
              className="w-full px-3 py-2 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground placeholder:text-muted-foreground"
              maxLength={120}
              style={{ marginBottom: 0 }}
            />
          </div>
          {/* Prompt Field */}
          <div className="bg-blue-50 dark:bg-blue-950/20 rounded-2xl p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-blue-600" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-foreground">Prompt</h3>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your project requirements..."
              className="w-full h-24 px-3 py-2 border border-border rounded-xl text-xs focus:outline-none resize-none bg-background text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <FolderGit2 className="w-4 h-4 text-blue-600" strokeWidth={2} />
              <span className="text-sm font-semibold text-foreground">Golden Repository</span>
            </div>
            <Popover open={openRepoPopover} onOpenChange={setOpenRepoPopover}>
              <PopoverTrigger asChild>
                <button className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted text-left flex items-center justify-between w-full">
                  <span className={selectedRepo ? 'text-foreground' : 'text-muted-foreground'}>
                    {selectedRepo
                      ? repositories.find(r => r.id === selectedRepo)?.name + ' - ' + repositories.find(r => r.id === selectedRepo)?.description
                      : 'Select Repository...'}
                  </span>
                  <ChevronDown className="w-4 h-4" strokeWidth={2} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-full min-w-[220px] max-w-[400px] p-0" align="start">
                <Command className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-2">
                  <CommandInput
                    placeholder="Search repositories..."
                    value={repoSearchQuery}
                    onValueChange={setRepoSearchQuery}
                    className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none mb-2"
                  />
                  <CommandList className="bg-popover">
                    <CommandEmpty className="text-muted-foreground text-sm px-3 py-2">No repository found.</CommandEmpty>
                    <CommandGroup className="bg-popover">
                      {repositories.filter(repo =>
                        repo.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
                        repo.description.toLowerCase().includes(repoSearchQuery.toLowerCase())
                      ).map(repo => (
                        <CommandItem
                          key={repo.id}
                          value={repo.id}
                          onSelect={() => {
                            setSelectedRepo(repo.id);
                            setOpenRepoPopover(false);
                            setRepoSearchQuery('');
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm font-medium ${selectedRepo === repo.id ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' : 'hover:bg-muted text-foreground'}`}
                        >
                          <CheckIcon className={`mr-2 h-4 w-4 ${selectedRepo === repo.id ? 'opacity-100 text-blue-700' : 'opacity-0'}`} />
                          <div>{repo.name} <span className="text-xs text-muted-foreground">- {repo.description}</span></div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-4 h-4 text-blue-600" strokeWidth={2} />
                  <h3 className="text-sm font-semibold text-foreground">Golden Repo Guidance</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Enable RAG guidance from organizational repositories for higher quality results.
                </p>
              </div>
              <Switch
                checked={useGoldenRepo}
                onCheckedChange={setUseGoldenRepo}
                disabled={isGenerating}
                data-testid="toggle-use-golden-repo-cio"
              />
            </div>
          </div>


          {/* Persona Selection */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-4 h-4 text-blue-600" strokeWidth={2} />
              <span className="text-sm font-semibold text-foreground">Persona Selection</span>
            </div>
            <Popover open={openPersonaPopover} onOpenChange={setOpenPersonaPopover}>
              <PopoverTrigger asChild>
                <button className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted text-left flex items-center justify-between w-full">
                  <span className={selectedPersona ? 'text-foreground' : 'text-muted-foreground'}>
                    {selectedPersona
                      ? personas.find(p => p.id === selectedPersona)?.name + ' - ' + personas.find(p => p.id === selectedPersona)?.role
                      : 'Select Persona...'}
                  </span>
                  <ChevronDown className="w-4 h-4" strokeWidth={2} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-full min-w-[220px] max-w-[400px] p-0" align="start">
                <Command className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-2">
                  <CommandInput
                    placeholder="Search personas..."
                    value={personaSearchQuery}
                    onValueChange={setPersonaSearchQuery}
                    className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none mb-2"
                  />
                  <CommandList className="bg-popover">
                    <CommandEmpty className="text-muted-foreground text-sm px-3 py-2">No persona found.</CommandEmpty>
                    <CommandGroup className="bg-popover">
                      {personas.filter(persona =>
                        persona.name.toLowerCase().includes(personaSearchQuery.toLowerCase()) ||
                        persona.role.toLowerCase().includes(personaSearchQuery.toLowerCase())
                      ).map(persona => (
                        <CommandItem
                          key={persona.id}
                          value={persona.id}
                          onSelect={() => {
                            setSelectedPersona(persona.id);
                            setOpenPersonaPopover(false);
                            setPersonaSearchQuery('');
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm font-medium ${selectedPersona === persona.id ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' : 'hover:bg-muted text-foreground'}`}
                        >
                          <CheckIcon className={`mr-2 h-4 w-4 ${selectedPersona === persona.id ? 'opacity-100 text-blue-700' : 'opacity-0'}`} />
                          <div>{persona.name} <span className="text-xs text-muted-foreground">- {persona.role}</span></div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Artifact Selection */}
          <div className="bg-card rounded-2xl p-4 border border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <FileStack className="w-4 h-4 text-blue-600" strokeWidth={2} />
              <span className="text-sm font-semibold text-foreground">Artifact Selection</span>
            </div>
            <Popover open={openArtifactPopover} onOpenChange={setOpenArtifactPopover}>
              <PopoverTrigger asChild>
                <button className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted text-left flex items-center justify-between w-full">
                  <span className={selectedArtifacts.length ? 'text-foreground' : 'text-muted-foreground'}>
                    {selectedArtifacts.length
                      ? artifacts.filter(a => selectedArtifacts.includes(a.id)).map(a => a.name).join(', ')
                      : 'Select Artifacts...'}
                  </span>
                  <ChevronDown className="w-4 h-4" strokeWidth={2} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-full min-w-[220px] max-w-[400px] p-0" align="start">
                <Command className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-2">
                  <CommandInput
                    placeholder="Search artifacts..."
                    value={artifactSearchQuery}
                    onValueChange={setArtifactSearchQuery}
                    className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none mb-2"
                  />
                  <CommandList className="bg-popover">
                    <CommandEmpty className="text-muted-foreground text-sm px-3 py-2">No artifact found.</CommandEmpty>
                    <CommandGroup className="bg-popover">
                      {artifacts.filter(artifact =>
                        artifact.name.toLowerCase().includes(artifactSearchQuery.toLowerCase()) ||
                        artifact.description.toLowerCase().includes(artifactSearchQuery.toLowerCase())
                      ).map(artifact => (
                        <CommandItem
                          key={artifact.id}
                          value={artifact.id}
                          onSelect={() => {
                            setSelectedArtifacts(prev =>
                              prev.includes(artifact.id)
                                ? prev.filter(id => id !== artifact.id)
                                : [...prev, artifact.id]
                            );
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm font-medium ${selectedArtifacts.includes(artifact.id) ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' : 'hover:bg-muted text-foreground'}`}
                        >
                          <CheckIcon className={`mr-2 h-4 w-4 ${selectedArtifacts.includes(artifact.id) ? 'opacity-100 text-blue-700' : 'opacity-0'}`} />
                          <div>{artifact.name} <span className="text-xs text-muted-foreground">- {artifact.description}</span></div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <button
            onClick={handleGenerateBRD}
            disabled={isGenerating}
            className="w-full px-4 py-2.5 text-white text-sm font-medium rounded-xl disabled:opacity-50 bg-blue-600 hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            {isGenerating ? <>Generating...</> : <>Generate BRD</>}
          </button>
        </div>
        <div className="col-span-2 h-full min-h-[500px] max-h-[80vh] flex flex-col">
          {generatedBRD ? (
            (() => {
              // Prefer new API structure if present
              const brdJson = generatedBRD.generatedBrdJson || generatedBRD;
              const title = brdJson.title || generatedBRD.title;
              const version = brdJson.version;
              const date = brdJson.date;
              const sections = brdJson.sections || generatedBRD.sections;
              const rawMarkdown = brdJson.rawMarkdown || generatedBRD.generatedMarkdown || generatedBRD.rawMarkdown;
              return (
                <div className="bg-card rounded-2xl border border-border flex flex-col h-full">
                  <div className="p-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                    <div className="flex items-center gap-6 mt-2 text-sm text-muted-foreground flex-wrap">
                      {version && (
                        <span>Version: <span className="font-medium text-foreground">{version}</span></span>
                      )}
                      {date && (
                        <span>Date: <span className="font-medium text-foreground">{date}</span></span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 p-4 space-y-4 overflow-y-auto min-h-[300px] max-h-[60vh] border-b border-border">
                    {sections && Array.isArray(sections) && sections.map((section: any, idx: number) => (
                      <div key={idx} className="pb-4 border-b border-border last:border-b-0 last:pb-0">
                        <h3 className="text-base font-semibold text-foreground mb-2">{section.title}</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-line">{section.content}</p>
                      </div>
                    ))}
                    {rawMarkdown && (
                      <div className="mt-8">
                        <h3 className="text-base font-semibold text-foreground mb-2">Full BRD Markdown Preview</h3>
                        <pre className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap border border-border">{rawMarkdown}</pre>
                      </div>
                    )}
                  </div>
                  {isReviewMode && (
                    <div className="p-4 border-t border-border space-y-3 bg-muted/40">
                      <p className="text-xs text-muted-foreground p-2 bg-muted rounded-lg">Review the BRD and approve to proceed to Design stage</p>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={handleRequestChanges}
                          className="px-3 py-2 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-muted/80 flex items-center gap-1.5"
                        >
                          <AlertTriangle className="w-4 h-4" strokeWidth={2} />
                          Request Changes
                        </button>
                        <button
                          onClick={handleRegenerate}
                          className="px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/30 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/40 flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-4 h-4" strokeWidth={2} />
                          Regenerate
                        </button>
                        <button
                          onClick={handleApprove}
                          className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                          Approve & Continue
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="bg-card rounded-2xl p-8 text-center border border-border h-full flex flex-col items-center justify-center">
              <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No BRD generated yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
