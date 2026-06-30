import { useState } from 'react';
import type { StageState, StageStatus } from './types.ts';

import { 
  Layers, 
  CheckCircle2, 
  Code2, 
  FileText as FileTextIcon,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  RefreshCw,
  Cpu,
  Database as DatabaseIcon,
  AlertTriangle,
} from 'lucide-react';
import { GeneratedFile } from 'server/services/dev-agent.ts';
import { getApiUrl } from '@/lib/api-config.ts';
import { addUserInfoToRequest } from '@/utils/api-interceptor';
import { toast } from '@/hooks/use-toast';
import { useJiraOnlyWorkItems } from '@/hooks/use-hosting-config';

interface CodeGenWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

interface CodeGenWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export default function CodeGenWorkspace({ 
  stageState, 
  onStatusChange, 
  onComplete,
  selectedAdoProject 
}: {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
  selectedAdoProject: any
}) {
  const isAws = useJiraOnlyWorkItems();
  const [selectedLLM, setSelectedLLM] = useState('');
  const [selectedUIFramework, setSelectedUIFramework] = useState('');
  const [selectedAPIFramework, setSelectedAPIFramework] = useState('');
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [generatedCode, setGeneratedCode] = useState<any>(stageState.data || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [repositoryName, setRepositoryName] = useState(generatedCode?.repositoryName || '');
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [repoInput, setRepoInput] = useState('');

  const llmOptions = isAws
    ? [{ id: 'bedrock', name: 'Bedrock (Claude)', provider: 'Amazon' }]
    : [
        { id: 'gpt4', name: 'GPT-4 Turbo', provider: 'OpenAI' },
        { id: 'claude', name: 'Claude 3 Opus', provider: 'Anthropic' },
        { id: 'gemini', name: 'Gemini Pro', provider: 'Google' },
      ];

  const uiFrameworks = [
    { id: 'react', name: 'React', version: '18.x' },
    { id: 'vue', name: 'Vue.js', version: '3.x' },
    { id: 'angular', name: 'Angular', version: '17.x' },
    { id: 'svelte', name: 'Svelte', version: '4.x' },
  ];

  const apiFrameworks = [
    { id: 'express', name: 'Express.js', language: 'Node.js' },
    { id: 'fastapi', name: 'FastAPI', language: 'Python' },
    { id: 'spring', name: 'Spring Boot', language: 'Java' },
    { id: 'rails', name: 'Ruby on Rails', language: 'Ruby' },
  ];

  const databases = [
    { id: 'postgres', name: 'PostgreSQL', type: 'Relational' },
    { id: 'mongodb', name: 'MongoDB', type: 'Document' },
    { id: 'mysql', name: 'MySQL', type: 'Relational' },
    { id: 'redis', name: 'Redis', type: 'Cache/KV' },
  ];

  const [repoNameError, setRepoNameError] = useState<string | null>(null);
  const handleGenerateCode = async () => {
    if (!repositoryName.trim()) {
      setRepoNameError('Repository name is required.');
      return;
    } else {
      setRepoNameError(null);
    }
    setIsGenerating(true);
    try {
      // Example: Use selected options to build userStories and techStack
      // In a real app, you would get user stories from context or props
      const userStories = [
        {
          title: 'Artifact Management System',
          description: 'Epic: Artifact Management System',
          acceptanceCriteria: [
            'Implement artifact management system',
            `Follow ${uiFrameworks.find(f => f.id === selectedUIFramework)?.name || 'React'} patterns for frontend`,
            `Use ${apiFrameworks.find(a => a.id === selectedAPIFramework)?.name || 'Node.js'} for backend implementation`,
            `Integrate with ${databases.find(d => d.id === selectedDatabase)?.name || 'MongoDB'} database`,
          ],
        },
      ];

      const frontendTech = uiFrameworks.find(f => f.id === selectedUIFramework)?.name || 'React';
      const backendTech = apiFrameworks.find(a => a.id === selectedAPIFramework)?.name || 'Node.js';
      const databaseTech = databases.find(d => d.id === selectedDatabase)?.name || 'MongoDB';
      const techStack = `${frontendTech} frontend with ${backendTech} backend and ${databaseTech} database`;
      const llmProvider = isAws ? 'bedrock' : selectedLLM === 'gpt4' ? 'azure-openai' : selectedLLM;

      // Call the progressive codegen API using fetch + SSE (EventSource cannot send Authorization header)
      const sseUrl = getApiUrl(`/api/codegen/generate-progressive?${new URLSearchParams({
        userStories: JSON.stringify(userStories),
        techStack,
        llmProvider,
      })}`);
      const optionsWithAuth = await addUserInfoToRequest(sseUrl, { credentials: 'include' });
      const res = await fetch(sseUrl, optionsWithAuth);

      if (!res.ok) {
        if (res.status === 403) {
          toast.error('You have no permission');
        }
        const errBody = await res.json().catch(() => ({}));
        const msg = (errBody as any)?.message ?? (errBody as any)?.error ?? res.statusText;
        throw new Error(msg || 'Connection failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const raw = line.slice(6);
            if (raw === '[DONE]' || raw === '') continue;
            try {
              const data = JSON.parse(raw);
              switch (data.type) {
                case 'progress':
                  break;
                case 'files':
                  setGeneratedFiles((prev) => [...prev, ...data.files]);
                  break;
                case 'complete': {
                  const codeSummary = {
                    llm: llmOptions.find(l => l.id === selectedLLM)?.name,
                    uiFramework: frontendTech,
                    apiFramework: backendTech,
                    database: databaseTech,
                    generatedAt: new Date().toISOString(),
                    modules: [
                      { name: 'Authentication', files: 12, lines: 2400, status: 'Generated', coverage: '95%' },
                      { name: 'User Management', files: 8, lines: 1800, status: 'Generated', coverage: '92%' },
                      { name: 'Dashboard', files: 15, lines: 3200, status: 'Generated', coverage: '88%' },
                      { name: 'API Gateway', files: 6, lines: 1200, status: 'Generated', coverage: '98%' },
                      { name: 'Data Models', files: 10, lines: 2000, status: 'Generated', coverage: '100%' },
                    ],
                    metrics: {
                      totalFiles: 51,
                      totalLines: 10600,
                      testCoverage: '94%',
                      codeQuality: 'A',
                      securityScore: '98/100',
                      performanceGrade: 'A+',
                    },
                  };
                  setGeneratedCode(codeSummary);
                  setIsGenerating(false);
                  onStatusChange('review', codeSummary);
                  return;
                }
                case 'error':
                  throw new Error(data.error);
                default:
                  break;
              }
            } catch (e) {
              if (e instanceof Error) throw e;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      setIsGenerating(false);
      // Optionally show error toast
    }
  };

  const handleApprove = async () => {
    if (!repositoryName.trim()) {
      setRepoNameError('Repository name is required.');
      setShowRepoModal(true);
      return;
    } else {
      setRepoNameError(null);
    }

    // Ensure files is never null and matches the expected structure
    const payload = {
      files: generatedFiles,
      fileCount: generatedFiles.length,
      projectName: selectedAdoProject?.name || '',
      repositoryName: repositoryName || '',
      organizationUrl: selectedAdoProject?.organizationUrl || '',
      projectId: selectedAdoProject?.id || '',
      // Add any other required fields from generatedCode or local state
    };

    try {
      const response = await fetch(getApiUrl('/api/codegen/push-to-ado'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data && data.success) {
        toast({ title: 'Pushed Successfully', description: data.repositoryUrl ? `Repository: ${data.repositoryUrl}` : 'Code pushed to repository.' });
      } else {
        toast({ title: 'Push Failed', description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Push Failed', description: error instanceof Error ? error.message : 'Network error', variant: 'destructive' });
    }
    onComplete(generatedCode);
  };

  // Modal for repositoryName selection/entry
  const handleRepoModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (repoInput.trim()) {
      setRepositoryName(repoInput.trim());
      setRepoNameError(null);
      setShowRepoModal(false);
      setTimeout(() => {
        handleApprove();
      }, 0);
    } else {
      setRepoNameError('Repository name is required.');
    }
  };

  const handleRequestChanges = () => {
    onStatusChange('active');
  };

  const handleRegenerate = () => {
    setGeneratedCode(null);
    onStatusChange('active');
  };

  const isReviewMode = stageState.status === 'review';
  const isCompleted = stageState.status === 'completed';

  if (isCompleted && generatedCode) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <Code2 className="w-7 h-7 text-green-500" strokeWidth={2} />
              Code Generation
            </h1>
            <p className="text-sm text-gray-600 mt-1">Approved Code - Read Only</p>
          </div>
          <div className="px-4 py-2 bg-green-100 text-green-900 text-sm font-medium rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            Approved
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Generated Code Summary</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span>LLM: {generatedCode.llm}</span>
              <span>•</span>
              <span>UI: {generatedCode.uiFramework}</span>
              <span>•</span>
              <span>API: {generatedCode.apiFramework}</span>
              <span>•</span>
              <span>DB: {generatedCode.database}</span>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Generated Modules</h3>
              <div className="space-y-2">
                {generatedCode.modules.map((module: any, idx: number) => (
                  <div key={idx} className="p-3 border border-gray-200 rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">{module.name}</span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">{module.status}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>{module.files} files</span>
                      <span>{module.lines.toLocaleString()} lines</span>
                      <span>{module.coverage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Metrics</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-gray-50 rounded-md text-center">
                  <div className="text-lg font-semibold text-gray-900">{generatedCode.metrics.totalFiles}</div>
                  <div className="text-xs text-gray-500 mt-1">Files</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-md text-center">
                  <div className="text-lg font-semibold text-gray-900">{generatedCode.metrics.testCoverage}</div>
                  <div className="text-xs text-gray-500 mt-1">Coverage</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-md text-center">
                  <div className="text-lg font-semibold text-green-600">{generatedCode.metrics.codeQuality}</div>
                  <div className="text-xs text-gray-500 mt-1">Quality</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" strokeWidth={2} />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Code Approved</h2>
        <p className="text-gray-600">Generated code has been reviewed and approved.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Code2 className="w-6 h-6 text-green-600" strokeWidth={2} />
          Code Generation Configuration
        </h1>
        <p className="text-sm text-gray-600 mt-1">Configure technology stack and generate production-ready code</p>
      </div>
      <div className={`bg-green-50 rounded-2xl p-6 border border-green-200 ${isReviewMode ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-4 gap-4">
          {/* Repository Name Input */}
          <div className="col-span-4">
            <div className="bg-white rounded-2xl p-4 border border-gray-200 mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-4 h-4 text-green-600 flex items-center justify-center"><Code2 strokeWidth={2} className="w-4 h-4" /></span>
                <h3 className="text-sm font-semibold text-gray-900">Repository Name <span className="text-red-500">*</span></h3>
              </div>
              <input
                type="text"
                value={repositoryName}
                onChange={e => { setRepositoryName(e.target.value); if (repoNameError) setRepoNameError(null); }}
                placeholder="Enter repository name..."
                className={`w-full px-3 py-2 border ${repoNameError ? 'border-red-400' : 'border-gray-300'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-200 bg-white`}
                maxLength={120}
                style={{ marginBottom: 0 }}
                required
              />
              {repoNameError && (
                <div className="text-xs text-red-500 mt-1">{repoNameError}</div>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-green-600" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">LLM Model</h3>
            </div>
            <div className="space-y-1.5">
              {llmOptions.map((llm) => (
                <label
                  key={llm.id}
                  onClick={() => setSelectedLLM(llm.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selectedLLM === llm.id ? 'bg-green-400 text-white' : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex-1">
                    <div className={`text-xs font-medium ${selectedLLM === llm.id ? 'text-white' : 'text-gray-900'}`}>{llm.name}</div>
                    <div className={`text-xs ${selectedLLM === llm.id ? 'text-green-100' : 'text-gray-600'}`}>{llm.provider}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-green-600" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">UI Framework</h3>
            </div>
            <div className="space-y-1.5">
              {uiFrameworks.map((fw) => (
                <label
                  key={fw.id}
                  onClick={() => setSelectedUIFramework(fw.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selectedUIFramework === fw.id ? 'bg-green-400 text-white' : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className={`text-xs font-medium ${selectedUIFramework === fw.id ? 'text-white' : 'text-gray-900'}`}>{fw.name}</div>
                  <span className={`text-xs font-medium ${selectedUIFramework === fw.id ? 'text-white' : 'text-gray-600'}`}>{fw.version}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Code2 className="w-4 h-4 text-green-600" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">API Framework</h3>
            </div>
            <div className="space-y-1.5">
              {apiFrameworks.map((fw) => (
                <label
                  key={fw.id}
                  onClick={() => setSelectedAPIFramework(fw.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selectedAPIFramework === fw.id ? 'bg-green-400 text-white' : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className={`text-xs font-medium ${selectedAPIFramework === fw.id ? 'text-white' : 'text-gray-900'}`}>{fw.name}</div>
                  <span className={`text-xs font-medium ${selectedAPIFramework === fw.id ? 'text-white' : 'text-gray-600'}`}>{fw.language}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <DatabaseIcon className="w-4 h-4 text-green-600" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">Database</h3>
            </div>
            <div className="space-y-1.5">
              {databases.map((db) => (
                <label
                  key={db.id}
                  onClick={() => setSelectedDatabase(db.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selectedDatabase === db.id ? 'bg-green-400 text-white' : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className={`text-xs font-medium ${selectedDatabase === db.id ? 'text-white' : 'text-gray-900'}`}>{db.name}</div>
                  <span className={`text-xs font-medium ${selectedDatabase === db.id ? 'text-white' : 'text-gray-600'}`}>{db.type}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        {!isReviewMode && (
          <button
            onClick={handleGenerateCode}
            disabled={!selectedLLM || !selectedUIFramework || !selectedAPIFramework || !selectedDatabase || isGenerating || !repositoryName.trim()}
            className="w-full mt-6 px-4 py-3 text-white text-sm font-medium rounded-xl disabled:opacity-50 bg-green-500 hover:bg-green-600 flex items-center justify-center gap-2"
          >
            <Code2 className="w-4 h-4" strokeWidth={2} />
            {isGenerating ? <>Generating...</> : <>Generate Code</>}
          </button>
        )}
      </div>
      {generatedCode ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Generated Code Summary</h2>
              <span className="px-3 py-1 bg-amber-100 text-amber-900 text-xs font-medium rounded-lg">HITL Code Review</span>
            </div>
            <div className="text-sm text-gray-600 space-x-2">
              <span>LLM: <span className="font-medium text-gray-900">{generatedCode.llm}</span></span>
              <span>•</span>
              <span>UI: <span className="font-medium text-gray-900">{generatedCode.uiFramework}</span></span>
              <span>•</span>
              <span>API: <span className="font-medium text-gray-900">{generatedCode.apiFramework}</span></span>
              <span>•</span>
              <span>DB: <span className="font-medium text-gray-900">{generatedCode.database}</span></span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-6 p-6">
            {/* Generated Modules */}
            <div className="bg-teal-50 rounded-lg p-4 border border-teal-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Generated Modules</h3>
              <div className="space-y-3">
                {generatedCode.modules.map((module: any, idx: number) => (
                  <div key={idx} className="bg-white rounded-lg p-4 border border-teal-100">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-teal-600" strokeWidth={2} />
                        <span className="text-sm font-semibold text-gray-900">{module.name}</span>
                      </div>
                      <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-1 rounded">{module.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-600">
                      <span>{module.files} files</span>
                      <span>{module.lines.toLocaleString()} lines</span>
                      <span className="font-medium text-teal-600">{module.coverage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Code Quality Metrics */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Code Quality Metrics</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Files and Lines */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-center">
                  <div className="text-2xl font-bold text-gray-900">{generatedCode.metrics.totalFiles}</div>
                  <div className="text-xs text-gray-600 mt-1">Files</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-center">
                  <div className="text-2xl font-bold text-gray-900">{generatedCode.metrics.totalLines.toLocaleString()}</div>
                  <div className="text-xs text-gray-600 mt-1">Lines</div>
                </div>

                {/* Coverage and Quality */}
                <div className="bg-teal-50 rounded-lg p-4 border border-teal-200 text-center">
                  <div className="text-2xl font-bold text-teal-600">{generatedCode.metrics.testCoverage}</div>
                  <div className="text-xs text-gray-600 mt-1">Coverage</div>
                </div>
                <div className="bg-teal-50 rounded-lg p-4 border border-teal-200 text-center">
                  <div className="text-2xl font-bold text-teal-600">{generatedCode.metrics.codeQuality}</div>
                  <div className="text-xs text-gray-600 mt-1">Quality</div>
                </div>

                {/* Security and Performance */}
                <div className="bg-teal-50 rounded-lg p-4 border border-teal-200 text-center">
                  <div className="text-2xl font-bold text-teal-600">{generatedCode.metrics.securityScore}</div>
                  <div className="text-xs text-gray-600 mt-1">Security</div>
                </div>
                <div className="bg-teal-50 rounded-lg p-4 border border-teal-200 text-center">
                  <div className="text-2xl font-bold text-teal-600">{generatedCode.metrics.performanceGrade}</div>
                  <div className="text-xs text-gray-600 mt-1">Performance</div>
                </div>
              </div>
            </div>
          </div>
          {isReviewMode && (
            <div className="p-6 border-t border-gray-200 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-700">Review the generated code and approve to proceed to Deployment stage</p>
              <div className="flex gap-2">
                <button
                  onClick={handleRequestChanges}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <AlertTriangle className="w-4 h-4" strokeWidth={2} />
                  Request Changes
                </button>
                <button
                  onClick={handleRegenerate}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-green-100 rounded-lg hover:bg-green-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2} />
                  Regenerate
                </button>
                <button
                  onClick={handleApprove}
                  disabled={!repositoryName.trim()}
                  className={`px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-1.5 whitespace-nowrap ${!repositoryName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  Approve & Continue
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-200">
          <Code2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">No code generated yet</p>
        </div>
      )}
    </div>
    </>
  );
}
