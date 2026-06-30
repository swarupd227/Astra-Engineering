
import React, { useState } from 'react';
import { 
  Shield, 
  CheckCircle2, 
  Rocket, 
  FileText as FileTextIcon,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  RefreshCw,
  Cloud,
  Database as DatabaseIcon,
  XCircle,
  TrendingUp
} from 'lucide-react';
import type { StageState, StageStatus } from './types.ts';

interface DeployWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export default function DeployWorkspace({ 
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
  const [selectedEnvironment, setSelectedEnvironment] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [deploymentStrategy, setDeploymentStrategy] = useState('');
  const [deploymentPreview, setDeploymentPreview] = useState<any>(stageState.data || null);
  const [isGenerating, setIsGenerating] = useState(false);

  const environments = [
    { id: 'staging', name: 'Staging', description: 'Pre-production testing' },
    { id: 'production', name: 'Production', description: 'Live production' },
    { id: 'qa', name: 'QA', description: 'Quality assurance' },
  ];

  const regions = [
    { id: 'us-east', name: 'US East (N. Virginia)', latency: '15ms' },
    { id: 'us-west', name: 'US West (Oregon)', latency: '45ms' },
    { id: 'eu-west', name: 'EU West (Ireland)', latency: '120ms' },
    { id: 'ap-southeast', name: 'Asia Pacific (Singapore)', latency: '180ms' },
  ];

  const strategies = [
    { id: 'blue-green', name: 'Blue-Green Deployment', description: 'Zero downtime', riskLevel: 'Low' },
    { id: 'canary', name: 'Canary Release', description: 'Gradual rollout', riskLevel: 'Low' },
    { id: 'rolling', name: 'Rolling Update', description: 'Sequential updates', riskLevel: 'Medium' },
  ];

  const handleGeneratePreview = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      const mockPreview = {
        environment: environments.find(e => e.id === selectedEnvironment)?.name,
        region: regions.find(r => r.id === selectedRegion)?.name,
        strategy: strategies.find(s => s.id === deploymentStrategy)?.name,
        generatedAt: new Date().toISOString(),
        configuration: {
          instances: 3,
          loadBalancer: 'Application Load Balancer',
          autoScaling: 'Enabled (2-10 instances)',
          cdn: 'CloudFront',
          ssl: 'TLS 1.3',
          monitoring: 'CloudWatch + Prometheus',
        },
        compliance: [
          { name: 'GDPR Compliance', status: 'Passed', score: '100%' },
          { name: 'SOC 2 Type II', status: 'Passed', score: '98%' },
          { name: 'ISO 27001', status: 'Passed', score: '99%' },
          { name: 'HIPAA Ready', status: 'Passed', score: '97%' },
        ],
        preDeploymentChecks: [
          { name: 'Security Scan', status: 'Passed', details: 'No vulnerabilities found' },
          { name: 'Performance Test', status: 'Passed', details: 'All metrics within SLA' },
          { name: 'Integration Tests', status: 'Passed', details: '1,247 tests passed' },
          { name: 'Backup Verification', status: 'Passed', details: 'Latest backup: 2 hours ago' },
          { name: 'Rollback Plan', status: 'Ready', details: 'Automated rollback configured' },
        ],
      };
      
      setDeploymentPreview(mockPreview);
      setIsGenerating(false);
      onStatusChange('review', mockPreview);
    }, 2000);
  };

  const handleApprove = () => {
    onComplete(deploymentPreview);
  };

  const handleRequestChanges = () => {
    onStatusChange('active');
  };

  const handleRegenerate = () => {
    setDeploymentPreview(null);
    onStatusChange('active');
  };

  const isReviewMode = stageState.status === 'review';
  const isCompleted = stageState.status === 'completed';

  if (isCompleted && deploymentPreview) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <Rocket className="w-7 h-7 text-green-500" strokeWidth={2} />
              Deployment Configuration
            </h1>
            <p className="text-sm text-gray-600 mt-1">Approved Deployment - Read Only</p>
          </div>
          <div className="px-4 py-2 bg-green-100 text-green-900 text-sm font-medium rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            Deployed
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Deployment Summary</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span>{deploymentPreview.environment}</span>
              <span>•</span>
              <span>{deploymentPreview.region}</span>
              <span>•</span>
              <span>{deploymentPreview.strategy}</span>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Infrastructure</h3>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(deploymentPreview.configuration).map(([key, value]) => (
                  <div key={key} className="p-3 bg-gray-50 rounded-md">
                    <div className="text-xs text-gray-600 capitalize">{key}</div>
                    <div className="text-sm font-medium text-gray-900 mt-1">{value as string}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Compliance</h3>
              <div className="grid grid-cols-2 gap-2">
                {deploymentPreview.compliance.map((item: any, idx: number) => (
                  <div key={idx} className="p-3 border border-gray-200 rounded-md">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" strokeWidth={2} />
                      <span className="text-sm font-medium text-gray-900">{item.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{item.score}</div>
                  </div>
                ))}
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
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Deployment Approved</h2>
        <p className="text-gray-600">Deployment has been executed successfully.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Rocket className="w-6 h-6 text-orange-500" strokeWidth={2} />
          Deployment Configuration
        </h1>
        <p className="text-sm text-gray-600 mt-1">Configure deployment settings and validate readiness</p>
      </div>
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${isReviewMode ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-3 gap-6">
          {/* Environment */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Cloud className="w-4 h-4 text-blue-500" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">Environment</h3>
            </div>
            <div className="space-y-2">
              {environments.map((env) => (
                <div
                  key={env.id}
                  onClick={() => setSelectedEnvironment(env.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-all border ${
                    selectedEnvironment === env.id
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900">{env.name}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{env.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Region */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-green-500" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">Region</h3>
            </div>
            <div className="space-y-2">
              {regions.map((region) => (
                <div
                  key={region.id}
                  onClick={() => setSelectedRegion(region.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-all border flex items-center justify-between ${
                    selectedRegion === region.id
                      ? 'bg-green-50 border-green-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900">{region.name}</div>
                  <span className={`text-xs font-medium ${selectedRegion === region.id ? 'text-green-700' : 'text-gray-600'}`}>
                    {region.latency}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Strategy */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-purple-500" strokeWidth={2} />
              <h3 className="text-sm font-semibold text-gray-900">Strategy</h3>
            </div>
            <div className="space-y-2">
              {strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  onClick={() => setDeploymentStrategy(strategy.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-all border ${
                    deploymentStrategy === strategy.id
                      ? 'bg-purple-50 border-purple-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900">{strategy.name}</div>
                  <div className={`text-xs mt-0.5 ${deploymentStrategy === strategy.id ? 'text-purple-700' : 'text-gray-600'}`}>
                    Risk: {strategy.riskLevel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {!isReviewMode && (
          <button
            onClick={handleGeneratePreview}
            disabled={!selectedEnvironment || !selectedRegion || !deploymentStrategy || isGenerating}
            className="w-full mt-6 px-4 py-3 text-white text-sm font-medium rounded-lg disabled:opacity-50 bg-gray-400 hover:bg-gray-500 flex items-center justify-center gap-2"
          >
            <Rocket className="w-4 h-4" strokeWidth={2} />
            {isGenerating ? <>Validating...</> : <>Validate & Preview</>}
          </button>
        )}
      </div>
      {deploymentPreview ? (
        <div className="bg-white rounded-lg border border-gray-200 flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Deployment Preview</h2>
              <span className="px-3 py-1 bg-yellow-100 text-yellow-900 text-xs font-medium rounded-lg">HITL Deploy Review</span>
            </div>
            <div className="text-sm text-gray-600 space-x-2">
              <span>Env: <span className="font-medium text-gray-900">{deploymentPreview.environment}</span></span>
              <span>•</span>
              <span>Region: <span className="font-medium text-gray-900">{deploymentPreview.region}</span></span>
              <span>•</span>
              <span>Strategy: <span className="font-medium text-gray-900">{deploymentPreview.strategy}</span></span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-6 p-6">
            {/* Infrastructure */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Infrastructure</h3>
              <div className="space-y-3 mb-6">
                <div>
                  <span className="text-xs text-gray-600">Instances:</span>
                  <div className="text-lg font-bold text-gray-900">{deploymentPreview.configuration.instances}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">Load Balancer:</span>
                  <div className="text-sm font-medium text-gray-900">{deploymentPreview.configuration.loadBalancer}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{deploymentPreview.configuration.autoScaling}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-600">Auto Scaling:</span>
                  <div className="text-sm font-medium text-gray-900">{deploymentPreview.configuration.autoScaling}</div>
                </div>
              </div>

              {/* Pre-Deploy Checks */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Pre-Deploy Checks</h4>
                <div className="space-y-2">
                  {deploymentPreview.preDeploymentChecks.slice(0, 3).map((check: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-teal-600" strokeWidth={2} />
                      <span className="text-gray-900">{check.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Compliance */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Compliance</h3>
              <div className="space-y-3">
                {deploymentPreview.compliance.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3 flex-1">
                      <CheckCircle2 className="w-4 h-4 text-teal-600" strokeWidth={2} />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{item.name}</div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{item.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {isReviewMode && (
            <div className="p-6 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-600">Review deployment configuration and approve to execute deployment</p>
              <div className="flex gap-2">
                <button
                  onClick={handleRequestChanges}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2} />
                  Reconfigure
                </button>
                <button
                  onClick={handleRequestChanges}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <XCircle className="w-4 h-4" strokeWidth={2} />
                  Request Changes
                </button>
                <button
                  onClick={handleApprove}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  Approve & Deploy
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <Rocket className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">No deployment configured yet</p>
        </div>
      )}
    </div>
  );
}
