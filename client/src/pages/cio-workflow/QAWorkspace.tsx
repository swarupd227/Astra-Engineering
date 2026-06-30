
import React, { useState } from 'react';
import { 
  CheckCircle2, 
  CheckCircle, 
  FileText as FileTextIcon,
  Users as UsersIcon,
  FolderGit2 as FolderGit2Icon,
  RefreshCw,
  Database as DatabaseIcon,
  XCircle,
  AlertTriangle,
  TrendingUp,
  FileCheck
} from 'lucide-react';
import type { StageState, StageStatus } from './types.ts';

interface QAWorkspaceProps {
  stageState: StageState;
  onStatusChange: (status: StageStatus, data?: any) => void;
  onComplete: (data: any) => void;
}

export default function QAWorkspace({ 
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
  const [testSuiteRun, setTestSuiteRun] = useState<any>(stageState.data || null);
  const [isRunning, setIsRunning] = useState(false);

  const mockQAData = {
    runId: 'QA-2026-02-02-001',
    startedAt: new Date().toISOString(),
    duration: '3m 24s',
    summary: {
      totalTests: 124,
      passed: 121,
      failed: 1,
      skipped: 1,
      passRate: '97.4%',
    },
    coverage: {
      statements: '94.2%',
      branches: '91.8%',
      functions: '96.1%',
      lines: '93.7%',
    },
    defects: [
      {
        id: 'DEF-001',
        severity: 'Medium',
        type: 'UI Bug',
        title: 'Login button alignment issue on mobile',
        status: 'Open',
      },
      {
        id: 'DEF-002',
        severity: 'Low',
        type: 'Performance',
        title: 'Dashboard load time exceeds 2s threshold',
        status: 'Open',
      },
      {
        id: 'DEF-003',
        severity: 'High',
        type: 'Functional',
        title: 'Payment processing timeout on slow networks',
        status: 'Critical',
      },
    ],
    performance: {
      avgResponseTime: '1.8s',
      p95ResponseTime: '3.2s',
      p99ResponseTime: '4.8s',
      throughput: '1,250 req/sec',
      errorRate: '0.12%',
    },
  };

  const handleRunTests = () => {
    setIsRunning(true);
    
    setTimeout(() => {
      setTestSuiteRun(mockQAData);
      setIsRunning(false);
      onStatusChange('review', mockQAData);
    }, 3000);
  };

  const handleApprove = () => {
    onComplete(testSuiteRun);
  };

  const handleRequestChanges = () => {
    onStatusChange('active');
  };

  const isReviewMode = stageState.status === 'review';
  const isCompleted = stageState.status === 'completed';

  if (isCompleted && testSuiteRun) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-7 h-7 text-green-500" strokeWidth={2} />
              Quality Assurance & Testing
            </h1>
            <p className="text-sm text-gray-600 mt-1">QA Sign-Off Complete - Release Ready</p>
          </div>
          <div className="px-4 py-2 bg-green-100 text-green-900 text-sm font-medium rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            Approved
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">QA Test Results</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span>Run ID: {testSuiteRun.runId}</span>
              <span>•</span>
              <span>Duration: {testSuiteRun.duration}</span>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-5 gap-3">
              <div className="p-3 bg-green-50 border border-green-200 rounded-md text-center">
                <div className="text-2xl font-semibold text-green-600">{testSuiteRun.summary.passed}</div>
                <div className="text-xs text-gray-600">Passed</div>
              </div>
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-center">
                <div className="text-2xl font-semibold text-red-600">{testSuiteRun.summary.failed}</div>
                <div className="text-xs text-gray-600">Failed</div>
              </div>
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md text-center">
                <div className="text-2xl font-semibold text-gray-600">{testSuiteRun.summary.skipped}</div>
                <div className="text-xs text-gray-600">Skipped</div>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-center">
                <div className="text-2xl font-semibold text-blue-600">{testSuiteRun.summary.totalTests}</div>
                <div className="text-xs text-gray-600">Total</div>
              </div>
              <div className="p-3 bg-green-50 border border-green-200 rounded-md text-center">
                <div className="text-2xl font-semibold text-green-600">{testSuiteRun.summary.passRate}</div>
                <div className="text-xs text-gray-600">Pass Rate</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Coverage</h3>
                <div className="space-y-2">
                  {Object.entries(testSuiteRun.coverage).map(([key, value]) => (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 capitalize">{key}</span>
                        <span className="font-medium text-gray-900">{String(value)}</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500" style={{ width: value as string }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Performance</h3>
                <div className="space-y-1 text-xs">
                  {Object.entries(testSuiteRun.performance).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1')}:</span>
                      <span className="font-medium text-gray-900">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Defects ({testSuiteRun.defects.length})</h3>
                <div className="space-y-1 text-xs">
                  {testSuiteRun.defects.map((defect: any) => (
                    <div key={defect.id} className="flex gap-1">
                      <span className="font-medium text-gray-900">{defect.id}</span>
                      <span className="text-gray-600">- {defect.severity}</span>
                    </div>
                  ))}
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
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">QA Sign-Off Complete</h2>
        <p className="text-gray-600 mb-2">Quality assurance has been completed and approved.</p>
        <p className="text-sm text-green-600 font-medium">✓ Release Ready for Production</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <CheckCircle className="w-7 h-7 text-blue-600" strokeWidth={2} />
          Quality Assurance & Testing
        </h1>
        <p className="text-sm text-gray-600 mt-1">Run comprehensive test suite and validate quality gates</p>
      </div>

      {!testSuiteRun && !isRunning ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <CheckCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" strokeWidth={1.5} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Run QA Tests</h3>
          <p className="text-sm text-gray-600 mb-8">Execute comprehensive test suite including unit, integration, and performance tests</p>
          <button
            onClick={handleRunTests}
            className="px-8 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 mx-auto"
          >
            <CheckCircle className="w-5 h-5" strokeWidth={2} />
            Run Test Suite
          </button>
        </div>
      ) : isRunning ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <RefreshCw className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" strokeWidth={2} />
          <h3 className="text-base font-medium text-gray-700 mb-1">Running Test Suite...</h3>
          <p className="text-xs text-gray-600">Executing {mockQAData.summary.totalTests} tests</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">QA Test Results</h2>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                <span>Run ID: {testSuiteRun?.runId}</span>
                <span>•</span>
                <span>Duration: {testSuiteRun?.duration}</span>
              </div>
            </div>
            <div className="px-3 py-1.5 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded">
              HITL QA Review
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-5 gap-3">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-teal-600">{testSuiteRun?.summary.passed}</div>
                <div className="text-sm text-gray-600 mt-1">Passed</div>
              </div>
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-red-600">{testSuiteRun?.summary.failed}</div>
                <div className="text-sm text-gray-600 mt-1">Failed</div>
              </div>
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-gray-600">{testSuiteRun?.summary.skipped}</div>
                <div className="text-sm text-gray-600 mt-1">Skipped</div>
              </div>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-blue-600">{testSuiteRun?.summary.totalTests}</div>
                <div className="text-sm text-gray-600 mt-1">Total</div>
              </div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-teal-600">{testSuiteRun?.summary.passRate}</div>
                <div className="text-sm text-gray-600 mt-1">Pass Rate</div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <FileCheck className="w-5 h-5 text-teal-600" strokeWidth={2} />
                  <h3 className="font-semibold text-gray-900">Coverage</h3>
                </div>
                <div className="space-y-3">
                  {Object.entries(testSuiteRun?.coverage || {}).map(([key, value]) => {
                    const percentage = parseInt(String(value));
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="text-gray-600 capitalize">{key}</span>
                          <span className="font-semibold text-gray-900">{String(value)}</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-teal-500" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-blue-600" strokeWidth={2} />
                  <h3 className="font-semibold text-gray-900">Performance</h3>
                </div>
                <div className="space-y-2 text-sm">
                  {Object.entries(testSuiteRun?.performance || {}).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                      <span className="font-semibold text-gray-900">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-5 h-5 text-red-600" strokeWidth={2} />
                  <h3 className="font-semibold text-gray-900">Defects ({testSuiteRun?.defects.length})</h3>
                </div>
                <div className="space-y-2 text-sm">
                  {(testSuiteRun?.defects || []).map((defect: any) => (
                    <div key={defect.id} className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-900">{defect.id}</span>
                      <span className="text-gray-600">- {defect.severity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {isReviewMode && (
            <div className="p-6 border-t border-gray-200">
              <p className="text-sm text-gray-600 mb-4">Review QA results and approve to complete SDLC</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleRunTests}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4" strokeWidth={2} />
                  Rerun Tests
                </button>
                <button
                  onClick={handleRequestChanges}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <XCircle className="w-4 h-4" strokeWidth={2} />
                  Request Fixes
                </button>
                <button
                  onClick={handleApprove}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  Sign Off & Complete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
