// This page renders the ./cio-workflowication with backend API integration
// Maps 5 stages to sdlc.tsx's 7-phase model with real data fetching

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { getApiUrl } from '@/lib/api-config';
import { addUserInfoToRequest } from '@/utils/api-interceptor';
import { useJiraOnlyWorkItems } from '@/hooks/use-hosting-config';
import type { SDLCProject, SDLCPhase } from '@shared/schema';

// Import icons from lucide-react (same as sdlc2)
import {
  ChevronDown,
  FileText as FileTextIcon,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  Database as DatabaseIcon,
  Check,
  Workflow,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import QAWorkspace from './QAWorkspace';
import DeployWorkspace from './DeployWorkspace';
import CodeGenWorkspace from './CodeGenWorkspace';
import DesignWorkspace from './DesignWorkspace';
import BRDWorkspace from './BRDWorkspace';
import SDLCProgressTracker from './SDLCProgressTracker';
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from '@/contexts/selected-organization-context';

// Type definitions
interface ADOProject {
  id: string;
  name: string;
  organization: string;
}

interface ProjectData {
  project: SDLCProject;
  phases: SDLCPhase[];
}

interface WorkspaceProps {
  stageState: StageState;
  projectData: ProjectData;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export type SDLCStage = 'BRD' | 'Design' | 'CodeGen' | 'Deploy' | 'QA';
export type StageStatus = 'locked' | 'active' | 'review' | 'completed';

export interface StageState {
  status: StageStatus;
  data?: any;
}

// Main App Component
export default function NewsSDLCScreens() {
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();
  // Stage navigation state
  const [activeStage, setActiveStage] = useState<SDLCStage>('BRD');
  const [stageStates, setStageStates] = useState<Record<SDLCStage, StageState>>({
    BRD: { status: 'active' },
    Design: { status: 'locked' },
    CodeGen: { status: 'locked' },
    Deploy: { status: 'locked' },
    QA: { status: 'locked' },
  });

  const [selectedAdoProject, setSelectedAdoProject] = useState<any>('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [openProjectPopover, setOpenProjectPopover] = useState(false);
  const isGlobalAllOrganizations =
    globalSelectedOrganization?.id === GLOBAL_ALL_ORGANIZATIONS_ID;
  const isGlobalSpecificOrganizationSelected =
    !!globalSelectedOrganization && !isGlobalAllOrganizations;
  const selectedOrganization = isGlobalSpecificOrganizationSelected
    ? { id: globalSelectedOrganization.name, name: globalSelectedOrganization.name, organization: globalSelectedOrganization.name }
    : isGlobalAllOrganizations ? { id: '', name: 'All Organizations', organization: '' } : null;

  const jiraOnlyHosting = useJiraOnlyWorkItems();

  // In Jira-only mode, load local SDLC projects; otherwise load from ADO
  const { data: adoProjectsData, isLoading: adoProjectsLoading } = useQuery({
    queryKey: jiraOnlyHosting ? ['/api/sdlc/projects'] : ['ado-projects'],
    queryFn: async () => {
      if (jiraOnlyHosting) {
        const url = getApiUrl('/api/sdlc/projects');
        const options = await addUserInfoToRequest(url, { credentials: 'include' });
        const response = await fetch(url, options);
        if (!response.ok) throw new Error('Failed to fetch SDLC projects');
        const projects = await response.json();
        return {
          projects: (projects as SDLCProject[]).map((p: SDLCProject) => ({
            id: p.id,
            name: p.name,
            organization: p.organization || 'Jira',
          })),
        };
      }
      const url = getApiUrl('/api/ado-projects');
      const options = await addUserInfoToRequest(url, { credentials: 'include' });
      const response = await fetch(url, options);
      if (!response.ok) throw new Error('Failed to fetch ADO projects');
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: projectData, isLoading: projectDataLoading } = useQuery({
    queryKey: ['sdlc-project', selectedAdoProject?.id],
    queryFn: async () => {
      if (!selectedAdoProject?.id) return null;
      const url = getApiUrl(`/api/sdlc/projects/by-ado/${selectedAdoProject.id}`);
      const options = await addUserInfoToRequest(url, { credentials: 'include' });
      const response = await fetch(url, options);
      if (!response.ok) throw new Error('Failed to fetch project data');
      return response.json();
    },
    enabled: !!selectedAdoProject?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const handleSelectProject = (project: any) => {
    setSelectedAdoProject(project);
  };

  const updateStageStatus = (stage: SDLCStage, status: StageStatus, data?: any) => {
    setStageStates(prev => ({
      ...prev,
      [stage]: { status, data },
    }));
  };

  // Store design data for Design stage
  const [designEpics, setDesignEpics] = useState<any[]>([]);
  const [designUserStories, setDesignUserStories] = useState<any[]>([]);
  const [designGenerationResult, setDesignGenerationResult] = useState<any>(null);

  const handleStageComplete = async (stage: SDLCStage, data?: any) => {
    updateStageStatus(stage, 'completed', data);
    const stages: SDLCStage[] = ['BRD', 'Design', 'CodeGen', 'Deploy', 'QA'];
    const currentIndex = stages.indexOf(stage);
    if (currentIndex < stages.length - 1) {
      const nextStage = stages[currentIndex + 1];
      updateStageStatus(nextStage, 'active');
      setActiveStage(nextStage);
    }
  };

  const handleStageSelect = (stage: SDLCStage) => {
    if (stageStates[stage].status !== 'locked') {
      setActiveStage(stage);
    }
  };

  const projects = useMemo(() => {
    if (!adoProjectsData?.projects) return [];
    const filtered = adoProjectsData.projects.filter((proj: ADOProject) =>
      proj.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) &&
      (selectedOrganization?.id === '' || proj.organization === selectedOrganization?.id)
    );
    return filtered || [];
  }, [adoProjectsData, projectSearchQuery, selectedOrganization]);

  useEffect(() => {
    if (!isGlobalSpecificOrganizationSelected || !adoProjectsData?.projects) return;
    setSelectedAdoProject((current: any) =>
      current && current.organization?.toLowerCase() === globalSelectedOrganization.name.toLowerCase()
        ? current
        : ''
    );
  }, [adoProjectsData, globalSelectedOrganization, isGlobalSpecificOrganizationSelected]);
  
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Page Header */}
      <div className="border-b bg-card p-6">
        <PageHeader
          icon={Workflow}
          title="Quick Workflow"
          subtitle="End-to-end SDLC pipeline from requirements to deployment"
          color="violet"
        />
      </div>

      {/* SDLC Progress Tracker */}
      <div className="border-b bg-card px-6 py-3 overflow-x-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
        <SDLCProgressTracker
          activeStage={activeStage}
          stageStates={stageStates}
          onStageSelect={handleStageSelect}
          selectedAdoProject={selectedAdoProject}
        />
      </div>

      {/* Organization and Project Selector below tracker - only show when BRD is active */}
      {activeStage === 'BRD' && (
        <div className="border-b bg-card px-6 py-4" style={{ maxHeight: '260px', overflowY: 'auto' }}>
          <div className="max-w-[1800px] mx-auto">
            <div className="grid grid-cols-1 gap-3">
              {/* Project Selector */}
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground mb-1">Select Project <span className="text-destructive">*</span></h3>
                <Popover open={openProjectPopover} onOpenChange={setOpenProjectPopover}>
                  <PopoverTrigger asChild>
                    <button
                      disabled={!selectedOrganization && !isGlobalAllOrganizations}
                      className="px-3 py-2 text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center justify-between"
                    >
                      <span className={selectedAdoProject ? 'text-foreground' : 'text-muted-foreground'}>
                        {selectedAdoProject
                          ? adoProjectsData?.projects?.find((proj: ADOProject) => proj.id === selectedAdoProject?.id)?.name
                          : 'Select Project...'}
                      </span>
                      <ChevronDown className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full min-w-[320px] max-w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search projects..."
                        value={projectSearchQuery}
                        onValueChange={setProjectSearchQuery}
                      />
                      <CommandList>
                        <CommandEmpty>No project found.</CommandEmpty>
                        <CommandGroup>
                          {projects.map((proj: ADOProject) => (
                            <CommandItem
                              key={proj.id}
                              value={proj.id}
                              onSelect={() => {
                                handleSelectProject(proj);
                                setOpenProjectPopover(false);
                                setProjectSearchQuery('');
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${selectedAdoProject?.id === proj.id ? 'opacity-100' : 'opacity-0'}`}
                              />
                              <div>{proj.name}</div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Stage Workspaces */}
          {activeStage === 'BRD' && (
            <BRDWorkspace
              stageState={stageStates.BRD}
              onStatusChange={(status, data) => updateStageStatus('BRD', status, data)}
              onComplete={(data) => handleStageComplete('BRD', data)}
              selectedAdoProject={selectedAdoProject}
              selectedOrganization={selectedOrganization}
            />
          )}
          {activeStage === 'Design' && (
            <DesignWorkspace
              stageState={stageStates.Design}
              onStatusChange={(status, data) => updateStageStatus('Design', status, data)}
              onComplete={(data) => handleStageComplete('Design', data)}
              selectedAdoProject={selectedAdoProject}
            />
          )}
          {activeStage === 'CodeGen' && (
            <CodeGenWorkspace
              stageState={stageStates.CodeGen}
              onStatusChange={(status, data) => updateStageStatus('CodeGen', status, data)}
              onComplete={(data) => handleStageComplete('CodeGen', data)}
              selectedAdoProject={selectedAdoProject}
            />
          )}
          {activeStage === 'Deploy' && (
            <DeployWorkspace
              stageState={stageStates.Deploy}
              onStatusChange={(status, data) => updateStageStatus('Deploy', status, data)}
              onComplete={(data) => handleStageComplete('Deploy', data)}
              selectedAdoProject={selectedAdoProject}
            />
          )}
          {activeStage === 'QA' && (
            <QAWorkspace
              stageState={stageStates.QA}
              onStatusChange={(status, data) => updateStageStatus('QA', status, data)}
              onComplete={(data) => handleStageComplete('QA', data)}
              selectedAdoProject={selectedAdoProject}
            />
          )}
        </div>
      </main>
      {/* ChatBot removed */}
    </div>
  );
}
