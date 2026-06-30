
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { 
  CheckCircle2, 
  Palette, 
  FileText as FileTextIcon,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  RefreshCw,
  Smartphone,
  Monitor,
  Database as DatabaseIcon,
  AlertTriangle,
} from 'lucide-react';
import type { StageState, StageStatus } from './types.ts';
import { getApiUrl } from '@/lib/api-config.ts';

interface DesignWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export default function DesignWorkspace({ 
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
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [colorScheme, setColorScheme] = useState('');
  const [generatedDesign, setGeneratedDesign] = useState<any>(stageState.data || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uiLayoutPrompt, setUiLayoutPrompt] = useState('');
  const [figmaLink, setFigmaLink] = useState('');
  const [figmaLinkInput, setFigmaLinkInput] = useState('');
  const [isSavingFigmaLink, setIsSavingFigmaLink] = useState(false);
  const [guidelineContent, setGuidelineContent] = useState('');
  const [guidelineStep, setGuidelineStep] = useState<1 | 2 | 3>(1);

  const templates = [
    { 
      id: 'template-1', 
      name: 'Modern Dashboard', 
      category: 'Analytics',
      preview: 'Clean, data-focused layout with cards and charts'
    },
    { 
      id: 'template-2', 
      name: 'Enterprise Portal', 
      category: 'Business',
      preview: 'Professional layout with sidebar navigation'
    },
    { 
      id: 'template-3', 
      name: 'SaaS Application', 
      category: 'Product',
      preview: 'Modern, minimal design with focus on usability'
    },
    { 
      id: 'template-4', 
      name: 'E-Commerce Platform', 
      category: 'Retail',
      preview: 'Product-focused design with shopping features'
    },
  ];

  const colorSchemes = [
    { id: 'blue', name: 'Professional Blue', colors: ['#2563eb', '#3b82f6', '#60a5fa'] },
    { id: 'purple', name: 'Creative Purple', colors: ['#7c3aed', '#8b5cf6', '#a78bfa'] },
    { id: 'green', name: 'Growth Green', colors: ['#059669', '#10b981', '#34d399'] },
    { id: 'slate', name: 'Corporate Slate', colors: ['#475569', '#64748b', '#94a3b8'] },
  ];

  const handleGenerateDesign = async () => {
    setIsGenerating(true);
    try {
      // Use available epic and user story data if passed via props or context
      const projectId = selectedAdoProject?.id;
      // 1. Generate Guidelines (POST)
      const guidelinePayload = {
        designType: 'Guidelines',
        userPrompt: uiLayoutPrompt,
        guidelinesContent: '',
        context: {},
      };
      const guidelineRes = await fetch(
        getApiUrl(`/api/sdlc/projects/${projectId}/generate-guidelines`)
        , {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guidelinePayload),
      });
      const guidelineResult = await guidelineRes.json();
      setGuidelineContent(guidelineResult.content || '');

      // 2. Save Figma Link (POST)
        setIsSavingFigmaLink(true);
        const response = await fetch(
          getApiUrl(`/api/sdlc/projects/${projectId}/design-guidelines`),
          {
            method: "GET",
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          }
        );
  
        if (response.ok) {
          const guidelines = await response.json();
          const guidelineWithFigma = guidelines.find((g: any) => 
            g.figmaLink && g.figmaLink.trim().length > 0
          );
  
          if (guidelineWithFigma) {
            console.log('guidelineWithFigma', guidelineWithFigma);
            
            setFigmaLink(guidelineWithFigma.figmaLink);
            console.log("[UI/UX Design] Project Figma link found:", guidelineWithFigma.figmaLink);
          } else {
            console.log("[UI/UX Design] No project Figma link found");
            setFigmaLink("");
          }
        }
        setIsSavingFigmaLink(false);

      // Use mock data for UI output
      const mockDesign = {
        template: templates.find(t => t.id === selectedTemplate)?.name,
        device: selectedDevice,
        colorScheme: colorSchemes.find(c => c.id === colorScheme)?.name,
        generatedAt: new Date().toISOString(),
        components: [
          { name: 'Navigation Bar', status: 'Complete' },
          { name: 'Hero Section', status: 'Complete' },
          { name: 'Dashboard Cards', status: 'Complete' },
          { name: 'Data Visualization', status: 'Complete' },
          { name: 'Footer', status: 'Complete' },
        ],
        specifications: {
          typography: 'Inter, system-ui, sans-serif',
          spacing: '8px base unit',
          breakpoints: 'Responsive (mobile-first)',
          accessibility: 'WCAG 2.1 AA compliant',
        },
        guidelineContent: guidelineResult.content || '',
        figmaLink: figmaLinkInput.trim(),
      };
      setGeneratedDesign(mockDesign);
      onStatusChange('review', mockDesign);
    } catch (err) {
      setGeneratedDesign(null);
    }
    setIsGenerating(false);
  };

  const handleApprove = () => {
    onComplete(generatedDesign);
  };

  const handleRequestChanges = () => {
    onStatusChange('active');
  };

  const handleRegenerate = () => {
    setGeneratedDesign(null);
    onStatusChange('active');
  };

  const isReviewMode = stageState.status === 'review';
  const isCompleted = stageState.status === 'completed';

  if (isCompleted && generatedDesign) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">{generatedDesign.template}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span>Device: {generatedDesign.device}</span>
              <span>•</span>
              <span>{generatedDesign.colorScheme}</span>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-lg flex items-center">
              <div className=" text-white">
                <button
            type="button"
            onClick={() => {
              if (generatedDesign?.figmaLink) {
                window.open(generatedDesign.figmaLink, '_blank', 'noopener');
              }
            }}
            disabled={!generatedDesign?.figmaLink}
            className={`inline-flex items-center justify-center gap-2 px-6 py-2 rounded-xl font-semibold text-white bg-gradient-to-r from-fuchsia-600 to-pink-500 shadow-md hover:from-fuchsia-700 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-300 transition disabled:opacity-50 disabled:cursor-not-allowed mx-auto ${!generatedDesign?.figmaLink ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={{ minWidth: 180 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="12" fill="#fff"/>
              <g>
                <circle cx="12" cy="7" r="2.5" fill="#F24E1E"/>
                <circle cx="12" cy="12" r="2.5" fill="#A259FF"/>
                <circle cx="12" cy="17" r="2.5" fill="#1ABCFE"/>
                <circle cx="16.5" cy="9.5" r="2.5" fill="#0ACF83"/>
                <circle cx="7.5" cy="9.5" r="2.5" fill="#FF7262"/>
              </g>
            </svg>
            <span className="text-base font-semibold">Open in Figma</span>
          </button>
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
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Design Approved</h2>
        <p className="text-gray-600">Design specifications have been approved.</p>
      </div>
    );
  }

  // Step-based UI
  if (guidelineStep === 1) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Design Configuration</h1>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-4">
            {/* UI Layout Prompt Section */}
            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200">
              <div className="flex items-center gap-1.5 mb-2">
                <FileTextIcon className="w-4 h-4 text-blue-600" strokeWidth={2} />
                <h3 className="text-sm font-semibold text-gray-900">Describe the UI layout you want to create</h3>
              </div>
              <textarea
                value={uiLayoutPrompt}
                onChange={e => setUiLayoutPrompt(e.target.value)}
                placeholder="Example: Create a dashboard with sidebar navigation, header, and main content area for an insurance application"
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-xl text-xs focus:outline-none resize-none"
              />
            </div>
            <div className="bg-purple-50 rounded-2xl p-4 border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Palette className="w-4 h-4 text-purple-600" strokeWidth={2} />
                <h3 className="text-sm font-semibold text-gray-900">Template</h3>
              </div>
              <div className="space-y-1.5">
                {templates.map((template) => (
                  <label key={template.id} className="flex items-center gap-2 p-2 rounded-xl cursor-pointer hover:bg-white transition-colors">
                    <input
                      type="radio"
                      name="template"
                      value={template.id}
                      checked={selectedTemplate === template.id}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    />
                    <div>
                      <div className="text-xs font-medium text-gray-900">{template.name}</div>
                      <div className="text-xs text-gray-500">{template.category}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Device</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedDevice('desktop')}
                  className={`flex-1 p-2 rounded-xl transition-all ${
                    selectedDevice === 'desktop'
                      ? 'bg-purple-100 border-2 border-purple-600'
                      : 'bg-gray-100 border-2 border-gray-300'
                  }`}
                >
                  <Monitor className="w-5 h-5 mx-auto mb-1 text-purple-600" strokeWidth={2} />
                  <div className="text-xs font-medium">Desktop</div>
                </button>
                <button
                  onClick={() => setSelectedDevice('mobile')}
                  className={`flex-1 p-2 rounded-xl transition-all ${
                    selectedDevice === 'mobile'
                      ? 'bg-purple-100 border-2 border-purple-600'
                      : 'bg-gray-100 border-2 border-gray-300'
                  }`}
                >
                  <Smartphone className="w-5 h-5 mx-auto mb-1 text-purple-600" strokeWidth={2} />
                  <div className="text-xs font-medium">Mobile</div>
                </button>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Color Scheme</h3>
              <div className="space-y-1.5">
                {colorSchemes.map((scheme) => (
                  <label key={scheme.id} className="flex items-center gap-2 p-2 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                      type="radio"
                      name="colorScheme"
                      value={scheme.id}
                      checked={colorScheme === scheme.id}
                      onChange={(e) => setColorScheme(e.target.value)}
                    />
                    <span className="text-xs font-medium text-gray-900">{scheme.name}</span>
                    <div className="flex gap-1 ml-auto">
                      {scheme.colors.map((color, idx) => (
                        <div key={idx} className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <button
                onClick={handleGenerateDesign}
                disabled={!selectedTemplate || !colorScheme || isGenerating}
                className="w-full px-4 py-2.5 text-white text-sm font-medium rounded-xl disabled:opacity-50 bg-purple-600 hover:bg-purple-700 flex items-center justify-center gap-2"
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <>Generate Design</>}
              </button>
            </div>
          </div>
          {/* Right side card restored */}
          <div className="col-span-2">
            <div className="bg-white rounded-2xl border border-gray-200 flex flex-col h-full min-h-[480px] max-h-[600px]">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Generated Guidelines Preview</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-700 whitespace-pre-wrap min-h-[120px] max-h-[320px] overflow-y-auto">
                  {guidelineContent ? guidelineContent : ''}
                </div>
              </div>
              {/* Review action buttons restored */}
              {isReviewMode && (
                <div className="p-4 border-t border-gray-200 space-y-3">
                  <p className="text-xs text-gray-600 p-2 bg-gray-50 rounded-lg">Review the generated guidelines and approve to proceed to CodeGen stage</p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={handleRequestChanges}
                      className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1.5"
                    >
                      <AlertTriangle className="w-4 h-4" strokeWidth={2} />
                      Request Changes
                    </button>
                    <button
                      onClick={handleRegenerate}
                      className="px-3 py-2 text-sm font-medium text-gray-700 bg-purple-100 rounded-lg hover:bg-purple-200 flex items-center gap-1.5"
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
          </div>
        </div>
      </div>
    );
  }
}