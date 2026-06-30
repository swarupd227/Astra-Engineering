import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { invalidateTmOverview } from "@/lib/tm-overview";
import { DashboardHeader } from "@/components/dashboard/header";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestFolder {
  id: string;
  name: string;
  type: 'module' | 'suite';
  parentId: string | null;
  createdAt: number;
}

interface RecordedTest {
  id: string;
  folderId: string;
  name: string;
  url: string;
  projectName?: string;
  nlSteps: string[];
  tags: string[];
  lastRunStatus: 'passed' | 'failed' | 'never';
  lastRunAt: number | null;
  lastRunDuration: number | null;
  createdAt: number;
  updatedAt: number;
}

interface RunResult {
  testId: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface ActiveRun {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  passCount: number;
  failCount: number;
  results: RunResult[];
  startedAt: number;
  completedAt: number | null;
}

interface FlakinessData {
  testId: string;
  testName: string;
  stability: number;
  isFlaky: boolean;
  runCount: number;
  lastStatus?: string;
  lastRunAt?: number;
}

interface Suite {
  id: string;
  name: string;
  type: string;
  testIds: string[];
}

// ─── Project Tree Node ────────────────────────────────────────────────────────

function ProjectNode({
  projectName, allFolders, projectTests, selectedFolderId, selectedTestIds,
  onSelectFolder, onToggleTest, expandedFolderIds, onToggleFolderExpand,
  expandedProjects, onToggleProject,
}: {
  projectName: string;
  allFolders: TestFolder[];
  projectTests: RecordedTest[];
  selectedFolderId: string | null;
  selectedTestIds: Set<string>;
  onSelectFolder: (id: string) => void;
  onToggleTest: (id: string) => void;
  expandedFolderIds: Set<string>;
  onToggleFolderExpand: (id: string) => void;
  expandedProjects: Set<string>;
  onToggleProject: (name: string) => void;
}) {
  const isExpanded = expandedProjects.has(projectName);
  const allSel = projectTests.length > 0 && projectTests.every(t => selectedTestIds.has(t.id));
  const someSel = projectTests.some(t => selectedTestIds.has(t.id));

  // Only show root folders that have at least one test (direct or via children) in this project
  const rootFolders = allFolders.filter(f => f.parentId === null);
  const folderHasProjectTests = (folderId: string): boolean => {
    if (projectTests.some(t => t.folderId === folderId)) return true;
    return allFolders.filter(f => f.parentId === folderId).some(child => folderHasProjectTests(child.id));
  };
  const relevantRootFolders = rootFolders.filter(f => folderHasProjectTests(f.id));

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors hover:bg-blue-50 text-blue-700 font-semibold"
        onClick={() => onToggleProject(projectName)}
      >
        <span className="text-blue-400 w-3 text-center flex-shrink-0 transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : '' }}>
          {projectTests.length > 0 ? '▶' : ' '}
        </span>
        <input type="checkbox"
          checked={allSel}
          ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = someSel && !allSel; }}
          onChange={e => { e.stopPropagation(); projectTests.forEach(t => onToggleTest(t.id)); }}
          onClick={e => e.stopPropagation()}
          className="w-3 h-3 rounded accent-blue-500 flex-shrink-0 cursor-pointer"
        />
        <span className="flex-shrink-0">🏗</span>
        <span className="flex-1 truncate">{projectName}</span>
        <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1 font-semibold">{projectTests.length}</span>
      </div>

      {isExpanded && (
        <div className="ml-4 border-l border-blue-200 pl-2">
          {relevantRootFolders.map(folder => (
            <FolderNode
              key={`${projectName}-${folder.id}`}
              folder={folder}
              allFolders={allFolders}
              tests={projectTests}
              selectedFolderId={selectedFolderId}
              selectedTestIds={selectedTestIds}
              onSelectFolder={onSelectFolder}
              onToggleTest={onToggleTest}
              expandedIds={expandedFolderIds}
              onToggleExpand={onToggleFolderExpand}
              onRenameFolder={() => {}}
              onNewFolder={() => {}}
              onDeleteFolder={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Folder Tree Node ─────────────────────────────────────────────────────────

function FolderNode({
  folder, allFolders, tests, selectedFolderId, selectedTestIds,
  onSelectFolder, onToggleTest, expandedIds, onToggleExpand,
  onRenameFolder, onNewFolder, onDeleteFolder
}: {
  folder: TestFolder;
  allFolders: TestFolder[];
  tests: RecordedTest[];
  selectedFolderId: string | null;
  selectedTestIds: Set<string>;
  onSelectFolder: (id: string) => void;
  onToggleTest: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onNewFolder: (parentId: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const children = allFolders.filter(f => f.parentId === folder.id);
  const folderTests = tests.filter(t => t.folderId === folder.id);
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedFolderId === folder.id;
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(folder.name);
  const [showCtx, setShowCtx] = useState(false);

  const allSelected = folderTests.length > 0 && folderTests.every(t => selectedTestIds.has(t.id));
  const someSelected = folderTests.some(t => selectedTestIds.has(t.id));

  const icon = folder.type === 'suite'
    ? (folder.name === 'Smoke' ? '💨' : folder.name === 'Regression' ? '🔁' : folder.name === 'Sanity' ? '🩺' : '📋')
    : '📁';

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors relative ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/10 text-slate-700'}`}
        onClick={() => { onSelectFolder(folder.id); onToggleExpand(folder.id); }}
      >
        {/* Expand arrow */}
        <span className="text-blue-400 w-3 text-center flex-shrink-0 transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : '' }}>
          {(children.length > 0 || folderTests.length > 0) ? '▶' : ' '}
        </span>

        {/* Folder checkbox (select all tests in folder) */}
        <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
          onChange={e => { e.stopPropagation(); folderTests.forEach(t => onToggleTest(t.id)); }}
          onClick={e => e.stopPropagation()}
          className="w-3 h-3 rounded accent-blue-500 flex-shrink-0 cursor-pointer"
        />

        <span className="flex-shrink-0">{icon}</span>

        {renaming ? (
          <input
            value={renameVal}
            autoFocus
            className="flex-1 bg-white border border-blue-400 rounded px-1 py-0 text-xs text-slate-800 outline-none min-w-0"
            onChange={e => setRenameVal(e.target.value)}
            onBlur={() => { onRenameFolder(folder.id, renameVal); setRenaming(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onRenameFolder(folder.id, renameVal); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate font-medium">{folder.name}</span>
        )}

        <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1 font-semibold">{folderTests.length}</span>

        {/* Context menu trigger */}
        <button
          onClick={e => { e.stopPropagation(); setShowCtx(v => !v); }}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-slate-400 hover:text-blue-600 px-0.5 transition-opacity"
        >⋯</button>

        {showCtx && (
          <div className="absolute right-2 top-7 z-50 bg-white border border-slate-200 rounded-lg shadow-xl text-xs w-36 overflow-hidden" onClick={e => e.stopPropagation()}>
            <button className="w-full text-left px-3 py-2 hover:bg-blue-50 text-slate-700" onClick={() => { setRenaming(true); setShowCtx(false); }}>✏️ Rename</button>
            <button className="w-full text-left px-3 py-2 hover:bg-blue-50 text-slate-700" onClick={() => { onNewFolder(folder.id); setShowCtx(false); }}>📁 New Subfolder</button>
            <button className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-500" onClick={() => { onDeleteFolder(folder.id); setShowCtx(false); }}>🗑 Delete Folder</button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="ml-4 border-l border-blue-200 pl-2">
          {children.map(child => (
            <FolderNode key={child.id} folder={child} allFolders={allFolders} tests={tests}
              selectedFolderId={selectedFolderId} selectedTestIds={selectedTestIds}
              onSelectFolder={onSelectFolder} onToggleTest={onToggleTest}
              expandedIds={expandedIds} onToggleExpand={onToggleExpand}
              onRenameFolder={onRenameFolder} onNewFolder={onNewFolder} onDeleteFolder={onDeleteFolder}
            />
          ))}
          {folderTests.map(test => (
            <TestRow key={test.id} test={test} selected={selectedTestIds.has(test.id)} onToggle={onToggleTest} />
          ))}
        </div>
      )}
    </div>
  );
}

function TestRow({ test, selected, onToggle }: { test: RecordedTest; selected: boolean; onToggle: (id: string) => void }) {
  const statusDot = test.lastRunStatus === 'passed' ? 'bg-emerald-400' :
    test.lastRunStatus === 'failed' ? 'bg-red-400' : 'bg-slate-600';

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer text-[11px] transition-colors ${selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-600'}`}
      onClick={() => onToggle(test.id)}
    >
      <input type="checkbox" checked={selected} onChange={() => onToggle(test.id)}
        onClick={e => e.stopPropagation()}
        className="w-3 h-3 rounded accent-blue-500 flex-shrink-0" />
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
      <span className="flex-1 truncate">{test.name}</span>
      {test.lastRunDuration && <span className="text-[9px] text-slate-700">{(test.lastRunDuration / 1000).toFixed(1)}s</span>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TestLibraryPage() {
  const [, navigate] = useLocation();

  // Data
  const [folders, setFolders] = useState<TestFolder[]>([]);
  const [tests, setTests] = useState<RecordedTest[]>([]);
  const [stats, setStats] = useState({ totalTests: 0, passed: 0, failed: 0, never: 0 });

  // Selection
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['f-modules', 'f-suites']));

  // Projects
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Execution
  const [runId, setRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [runOutput, setRunOutput] = useState<{testId:string;line:string;isError?:boolean}[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [visualAnalysis, setVisualAnalysis] = useState<{testId: string; text: string; done: boolean} | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // UI
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('f-modules');
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [activeTest, setActiveTest] = useState<RecordedTest & { script?: string } | null>(null);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [runHistory, setRunHistory] = useState<ActiveRun[]>([]);
  const [editingProject, setEditingProject] = useState(false);
  const [projectInputVal, setProjectInputVal] = useState('');
  const [flakinessMap, setFlakinessMap]   = useState<Record<string, FlakinessData>>({});
  const [suites, setSuites]               = useState<Suite[]>([]);
  const [showTMLink, setShowTMLink]       = useState(true);

  // Load data
  const loadData = useCallback(async () => {
    const [fRes, sRes] = await Promise.all([
      fetch('/api/test-library/folders'),
      fetch('/api/test-library/stats')
    ]);
    const [fData, sData] = await Promise.all([fRes.json(), sRes.json()]);
    setFolders(fData);
    setStats(sData);

    const tRes = await fetch('/api/test-library/tests');
    setTests(await tRes.json());
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [runOutput]);

  // Load flakiness data and suites from test management API
  useEffect(() => {
    fetch('/api/tm/flakiness')
      .then(r => r.json())
      .then((data: FlakinessData[]) => {
        const map: Record<string, FlakinessData> = {};
        data.forEach(d => { map[d.testId] = d; map[d.testName] = d; });
        setFlakinessMap(map);
      })
      .catch(() => {});

    fetch('/api/tm/suites')
      .then(r => r.json())
      .then((data: Suite[]) => setSuites(data))
      .catch(() => {});
  }, []);

  const addTestToSuite = async (suiteId: string, testId: string) => {
    const suite = suites.find(s => s.id === suiteId);
    if (!suite) return;
    if (suite.testIds.includes(testId)) return;
    await fetch(`/api/tm/suites/${suiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testIds: [...suite.testIds, testId] }),
    });
    // Refresh suites
    fetch('/api/tm/suites').then(r => r.json()).then(setSuites).catch(() => {});
  };

  // ── Folder operations ──────────────────────────────────────────────────────

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await fetch('/api/test-library/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFolderName.trim(), parentId: newFolderParent || null, type: 'module' })
    });
    setNewFolderName('');
    setShowNewFolder(false);
    loadData();
  };

  const renameFolder = async (id: string, name: string) => {
    await fetch(`/api/test-library/folders/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    loadData();
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Delete folder and move its tests to Modules?')) return;
    await fetch(`/api/test-library/folders/${id}`, { method: 'DELETE' });
    loadData();
  };

  // ── Test operations ────────────────────────────────────────────────────────

  const openTest = async (testId: string) => {
    setActiveTestId(testId);
    setEditingProject(false);
    const res = await fetch(`/api/test-library/tests/${testId}`);
    const data = await res.json();
    setActiveTest(data);
    setProjectInputVal(data.projectName || '');
  };

  const deleteTest = async (testId: string) => {
    if (!confirm('Delete this test?')) return;
    await fetch(`/api/test-library/tests/${testId}`, { method: 'DELETE' });
    setActiveTestId(null);
    setActiveTest(null);
    setSelectedTestIds(prev => { const s = new Set(prev); s.delete(testId); return s; });
    loadData();
  };

  const moveTest = async (testId: string, folderId: string) => {
    await fetch(`/api/test-library/tests/${testId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId })
    });
    loadData();
  };

  const assignProject = async (testId: string, projectName: string) => {
    await fetch(`/api/test-library/tests/${testId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: projectName.trim() || '' })
    });
    setActiveTest(prev => prev ? { ...prev, projectName: projectName.trim() || undefined } : null);
    loadData();
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleTest = (id: string) => {
    setSelectedTestIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  // ── Execution ──────────────────────────────────────────────────────────────

  const executeSelected = async () => {
    if (selectedTestIds.size === 0) return;
    setIsRunning(true);
    setRunOutput([]);
    setVisualAnalysis(null);
    setActiveRun(null);

    const res = await fetch('/api/test-library/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testIds: Array.from(selectedTestIds) })
    });
    const { runId: rid } = await res.json();
    setRunId(rid);

    // Connect SSE
    sseRef.current?.close();
    const sse = new EventSource(`/api/test-library/execute/${rid}/stream`);
    sseRef.current = sse;

    sse.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'test_start') {
        setVisualAnalysis(null);
        setRunOutput(prev => [...prev, { testId: event.testId, line: `\n▶ Running: ${event.testName} (${event.index}/${event.total})`, isError: false }]);
      } else if (event.type === 'output') {
        setRunOutput(prev => [...prev, { testId: event.testId, line: event.line, isError: event.isError }]);
      } else if (event.type === 'test_result') {
        const r: RunResult = event.result;
        const icon = r.status === 'passed' ? '✅' : '❌';
        setRunOutput(prev => [...prev, { testId: r.testId, line: `${icon} ${r.testName} — ${(r.duration/1000).toFixed(1)}s${r.error ? '\n   ' + r.error : ''}`, isError: r.status !== 'passed' }]);
        // Record to test management history
        fetch('/api/tm/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            testId: r.testId || r.testName,
            testName: r.testName,
            status: r.status,
            duration: r.duration,
            environment: 'default',
            errorMessage: r.error,
          }),
        })
          .then(() => invalidateTmOverview())
          .catch(() => {});
      } else if (event.type === 'visual_analysis_start') {
        setVisualAnalysis({ testId: event.testId, text: '', done: false });
      } else if (event.type === 'visual_analysis_chunk') {
        setVisualAnalysis(prev => prev ? { ...prev, text: prev.text + event.text } : { testId: event.testId, text: event.text, done: false });
      } else if (event.type === 'visual_analysis_done') {
        setVisualAnalysis(prev => prev ? { ...prev, done: true } : null);
      } else if (event.type === 'run_complete') {
        setActiveRun(event.run);
        setIsRunning(false);
        sse.close();
        invalidateTmOverview();
        loadData(); // refresh last run status
      }
    };
    sse.onerror = () => { setIsRunning(false); sse.close(); };
  };

  const loadRunHistory = async () => {
    const res = await fetch('/api/test-library/runs');
    setRunHistory(await res.json());
    setShowRunHistory(true);
  };

  // Root-level folders
  const rootFolders = folders.filter(f => f.parentId === null);
  const selectedCount = selectedTestIds.size;
  // When a folder is selected inside a project context, filter to that project's tests in that folder
  // When no project is selected, show unassigned tests for that folder
  const folderTests = selectedFolderId
    ? tests.filter(t => t.folderId === selectedFolderId && (selectedProject ? t.projectName?.toLowerCase() === selectedProject.toLowerCase() : !t.projectName))
    : [];

  // Projects: unique projectNames derived from tests — case-insensitive deduplication
  // e.g. "OneSpan" and "Onespan" are treated as the same project
  const projectNameMap = new Map<string, string>(); // lowercase key → original display name (first seen)
  for (const t of tests) {
    if (t.projectName) {
      const key = t.projectName.toLowerCase();
      if (!projectNameMap.has(key)) projectNameMap.set(key, t.projectName);
    }
  }
  const projectNames = Array.from(projectNameMap.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const projectTests = selectedProject
    ? tests.filter(t => t.projectName?.toLowerCase() === selectedProject.toLowerCase())
    : [];

  return (
    <div className="flex flex-col h-full bg-white text-slate-800 overflow-hidden">

          <DashboardHeader />

          {/* Test Management Banner */}
          {showTMLink && (
            <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-200 text-xs">
              <div className="flex items-center gap-2 text-blue-700">
                <span>📊</span>
                <span>View pass rate trends, RTM, CI/CD pipelines and flakiness reports in</span>
                <a href="/qe/test-management" className="font-bold text-blue-600 underline hover:text-blue-800">Test Management Dashboard →</a>
              </div>
              <button onClick={() => setShowTMLink(false)} className="text-blue-400 hover:text-blue-600 ml-4">✕</button>
            </div>
          )}

      {/* ── Quick-action bar (Dashboard + Coverage + New Recording) ─────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 bg-white">
        <Link href="/dashboard">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition-colors border border-slate-200">
            ← Dashboard
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/coverage">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition-colors border border-slate-200">
              📊 Coverage
            </button>
          </Link>
          <Link href="/recorder">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-600/80 to-red-600/80 hover:from-rose-600 hover:to-red-600 text-white text-xs font-semibold transition-all">
              <span className="text-[10px]">⏺</span> New Recording
            </button>
          </Link>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

      {/* ── Left: Folder Tree ────────────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 border-r border-slate-200 flex flex-col bg-slate-50">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center text-xs">🗂</div>
              <span className="text-sm font-bold text-primary">Test Library</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowNewFolder(true)} title="New Folder"
                className="w-6 h-6 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs flex items-center justify-center transition-colors">+</button>
              <button onClick={loadRunHistory} title="Run History"
                className="w-6 h-6 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs flex items-center justify-center transition-colors">🕘</button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-1">
            {[
              { label: 'Total', val: stats.totalTests, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Passed', val: stats.passed, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Failed', val: stats.failed, color: 'text-red-500', bg: 'bg-red-50' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-lg px-2 py-1.5 text-center border border-slate-200`}>
                <div className={`text-sm font-bold ${s.color}`}>{s.val}</div>
                <div className="text-[9px] text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* New folder form */}
        {showNewFolder && (
          <div className="px-3 py-2 border-b border-slate-200 bg-blue-50 flex-shrink-0">
            <div className="text-[10px] text-blue-600 mb-1.5 font-semibold">NEW FOLDER</div>
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
              placeholder="Folder name..."
              className="w-full bg-white border border-blue-300 rounded-lg px-2 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500 mb-1.5"
            />
            <select value={newFolderParent} onChange={e => setNewFolderParent(e.target.value)}
              className="w-full bg-white border border-blue-300 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none mb-2">
              <option value="">Root</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <div className="flex gap-1.5">
              <button onClick={() => setShowNewFolder(false)} className="flex-1 py-1 rounded bg-white border border-slate-200 text-xs text-slate-600">Cancel</button>
              <button onClick={createFolder} className="flex-1 py-1 rounded bg-primary hover:bg-primary/90 text-xs text-primary-foreground font-semibold">Create</button>
            </div>
          </div>
        )}

        {/* Tree */}
        <div className="flex-1 overflow-auto px-2 py-2 space-y-0.5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>

          {/* ── Projects section ── */}
          {projectNames.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                <span>🏗</span> Projects
              </div>
              {projectNames.map(proj => (
                <ProjectNode
                  key={proj}
                  projectName={proj}
                  allFolders={folders}
                  projectTests={tests.filter(t => t.projectName?.toLowerCase() === proj.toLowerCase())}
                  selectedFolderId={selectedFolderId}
                  selectedTestIds={selectedTestIds}
                  onSelectFolder={id => { setSelectedFolderId(id); setSelectedProject(proj); }}
                  onToggleTest={toggleTest}
                  expandedFolderIds={expandedIds}
                  onToggleFolderExpand={toggleExpand}
                  expandedProjects={expandedProjects}
                  onToggleProject={name => {
                    setExpandedProjects(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* In-app execution removed by product decision — the recommended
            flow is to open / export the test and run it in the user's own
            Playwright project. The selection state is still useful for
            future export / bulk-edit actions, so we keep the Clear
            selection affordance. */}
        {selectedCount > 0 && (
          <div className="px-3 py-3 border-t border-slate-200 flex-shrink-0">
            <button onClick={() => setSelectedTestIds(new Set())} className="w-full py-1 text-[10px] text-slate-500 hover:text-blue-600 transition-colors">Clear selection ({selectedCount})</button>
          </div>
        )}
      </div>

      {/* ── Middle: Test list for selected folder / project ─────────────────── */}
      <div className="w-72 flex-shrink-0 border-r border-slate-200 flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {selectedProject && (
              <>
                <span className="text-[10px] text-blue-600 font-semibold">🏗 {selectedProject}</span>
                {selectedFolderId && <span className="text-slate-400 text-[10px]">/</span>}
              </>
            )}
            {selectedFolderId && (
              <span className="text-xs font-bold text-slate-800 truncate">
                {folders.find(f => f.id === selectedFolderId)?.name || 'Folder'}
              </span>
            )}
            {!selectedProject && !selectedFolderId && (
              <span className="text-xs font-bold text-slate-400">Select a folder</span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {(selectedProject ? projectTests : folderTests).length} test{(selectedProject ? projectTests : folderTests).length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="flex-1 overflow-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
          {(selectedProject ? projectTests : folderTests).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-700 text-xs gap-2">
              <span className="text-2xl">📭</span>
              {selectedProject ? 'No tests in this project' : selectedFolderId ? 'No tests in this folder' : 'Select a folder to view tests'}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {(selectedProject ? projectTests : folderTests).map(test => (
                <div
                  key={test.id}
                  onClick={() => { openTest(test.id); }}
                  className={`group flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${activeTestId === test.id ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-200 hover:border-blue-300'}`}
                >
                  <input type="checkbox" checked={selectedTestIds.has(test.id)}
                    onChange={() => toggleTest(test.id)} onClick={e => e.stopPropagation()}
                    className="mt-0.5 w-3.5 h-3.5 rounded accent-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate flex items-center gap-1">
                      <span className="truncate">{test.name}</span>
                      {/* Flakiness indicator */}
                      {(() => {
                        const f = flakinessMap[test.id] || flakinessMap[test.name];
                        if (!f || f.runCount === 0) return null;
                        return (
                          <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${f.isFlaky ? 'bg-amber-100 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600'}`}>
                            {f.isFlaky ? `⚠ ${f.stability}%` : `✓ ${f.stability}%`}
                          </span>
                        );
                      })()}
                    </div>
                    {test.projectName && !selectedProject && (
                      <div className="text-[10px] text-blue-500 truncate mt-0.5">🏗 {test.projectName}</div>
                    )}
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{test.url}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        test.lastRunStatus === 'passed' ? 'bg-emerald-50 text-emerald-600' :
                        test.lastRunStatus === 'failed' ? 'bg-red-50 text-red-500' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {test.lastRunStatus === 'passed' ? '✓ Passed' : test.lastRunStatus === 'failed' ? '✗ Failed' : '◦ Not run'}
                      </div>
                      {test.lastRunDuration && <span className="text-[9px] text-slate-700">{(test.lastRunDuration/1000).toFixed(1)}s</span>}
                      {suites.length > 0 && (
                        <select
                          onChange={e => { if (e.target.value) addTestToSuite(e.target.value, test.id); e.target.value = ''; }}
                          className="text-[9px] bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-400 cursor-pointer"
                          defaultValue=""
                          title="Add to suite"
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="" disabled>+ Suite</option>
                          {suites.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Test detail + Execution output ────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Run results banner */}
        {activeRun && (
          <div className={`flex-shrink-0 px-4 py-2.5 border-b border-slate-800/60 flex items-center gap-4 ${activeRun.failCount > 0 ? 'bg-red-500/5' : 'bg-emerald-500/5'}`}>
            <div className={`text-sm font-bold ${activeRun.failCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {activeRun.failCount > 0 ? `❌ ${activeRun.failCount} Failed` : '✅ All Passed'}
            </div>
            <div className="flex gap-3 text-xs text-slate-500">
              <span>✓ {activeRun.passCount} passed</span>
              <span>✗ {activeRun.failCount} failed</span>
              <span>⏱ {activeRun.completedAt ? ((activeRun.completedAt - activeRun.startedAt) / 1000).toFixed(1) + 's total' : ''}</span>
            </div>
            <button onClick={() => setActiveRun(null)} className="ml-auto text-slate-600 hover:text-slate-400 text-sm">✕</button>
          </div>
        )}

        <div className="flex-1 flex flex-row overflow-hidden min-h-0 min-w-0">
        {activeTest && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Test detail */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 flex-shrink-0 bg-white">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-bold text-slate-800 truncate">{activeTest.name}</div>
                    {activeTest.projectName && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 text-[10px] font-semibold flex-shrink-0">
                        🏗 {activeTest.projectName}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{activeTest.url}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Project assign */}
                  {editingProject ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={projectInputVal}
                        onChange={e => setProjectInputVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { assignProject(activeTest.id, projectInputVal); setEditingProject(false); }
                          if (e.key === 'Escape') setEditingProject(false);
                        }}
                        placeholder="Project name..."
                        className="bg-white border border-blue-400 rounded-lg px-2 py-1.5 text-xs text-slate-800 outline-none w-32 placeholder-slate-400"
                      />
                      <button
                        onClick={() => { assignProject(activeTest.id, projectInputVal); setEditingProject(false); }}
                        className="px-2 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold"
                      >✓</button>
                      <button onClick={() => setEditingProject(false)} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-xs">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setProjectInputVal(activeTest.projectName || ''); setEditingProject(true); }}
                      title={activeTest.projectName ? `Project: ${activeTest.projectName} — click to change` : 'Assign to project'}
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs transition-colors ${activeTest.projectName ? 'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100' : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700'}`}
                    >
                      🏗 {activeTest.projectName || 'Set Project'}
                    </button>
                  )}
                  <select
                    value={activeTest.folderId}
                    onChange={e => { moveTest(activeTest.id, e.target.value); setActiveTest(prev => prev ? {...prev, folderId: e.target.value} : null); }}
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none"
                  >
                    {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  {/* In-app per-test Run button removed by product decision —
                      use Open in Recorder or copy the script and run it
                      locally. */}
                  <button onClick={() => deleteTest(activeTest.id)} className="px-2 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 text-red-400 text-xs transition-colors">🗑</button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}>
                {/* NL Steps */}
                {activeTest.nlSteps && activeTest.nlSteps.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Recorded Steps</div>
                    <div className="space-y-1">
                      {activeTest.nlSteps.map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-1.5">
                          <span className="text-slate-700 flex-shrink-0 font-mono text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                          <span>{step.replace(/^Step \d+:\s*/, '')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Script */}
                {activeTest.script && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Playwright Script</div>
                      <div className="flex gap-2">
                        <button onClick={() => navigator.clipboard.writeText(activeTest.script || '')}
                          className="text-[10px] text-slate-500 hover:text-blue-600 px-2 py-1 rounded bg-slate-100 border border-slate-200 transition-colors">📋 Copy</button>
                        <a href={`/api/test-library/tests/${activeTest.id}/script`}
                          download className="text-[10px] text-slate-500 hover:text-blue-600 px-2 py-1 rounded bg-slate-100 border border-slate-200 transition-colors">↓ Download</a>
                      </div>
                    </div>
                    <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-auto max-h-96 leading-relaxed whitespace-pre-wrap" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                      {activeTest.script.split('\n').map((line, i) => (
                        <span key={i} className={
                          line.trim().startsWith('//') ? 'text-slate-400' :
                          line.startsWith('import') ? 'text-blue-600' :
                          line.includes("test(") ? 'text-blue-700 font-semibold' :
                          line.includes('await') ? 'text-emerald-700' :
                          'text-slate-700'
                        }>{line}{'\n'}</span>
                      ))}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!activeTest && !(isRunning || runOutput.length > 0) && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-700">
            <div className="text-5xl">🗂</div>
            <div className="text-sm font-semibold text-slate-500">Select a test to preview</div>
            <div className="text-xs text-slate-700 max-w-xs text-center">
              Use the folder tree on the left to browse and select tests, then click Execute to run them.
            </div>
            <button onClick={() => navigate('/recorder')}
              className="mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-primary/70 hover:from-primary/90 text-primary-foreground text-xs font-bold transition-all">
              + Record New Test
            </button>
          </div>
        )}

        {(isRunning || runOutput.length > 0) && (
          <div className={`flex flex-col bg-white min-h-0 ${activeTest ? 'w-96 flex-shrink-0 border-l border-slate-200' : 'flex-1 min-w-0'}`}>
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
              <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-yellow-400 animate-pulse' : activeRun?.failCount ? 'bg-red-400' : 'bg-emerald-400'}`} />
              <span className="text-xs font-semibold text-slate-700">Execution Output</span>
              <button onClick={() => { setRunOutput([]); setVisualAnalysis(null); }} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">Clear</button>
            </div>
            <div ref={outputRef} className="flex-1 overflow-auto p-3 font-mono text-[10px] space-y-0.5 bg-slate-50 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
              {runOutput.map((line, i) => (
                <div key={i} className={`leading-relaxed whitespace-pre-wrap break-all ${line.isError ? 'text-red-500' : line.line.startsWith('\n▶') ? 'text-blue-600 font-bold mt-2' : line.line.includes('✅') ? 'text-emerald-600 font-bold' : line.line.includes('❌') ? 'text-red-500 font-bold' : 'text-slate-600'}`}>
                  {line.line}
                </div>
              ))}

              {visualAnalysis && (
                <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-950/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-500/20 bg-blue-900/20">
                    <span className="text-blue-400 text-[11px]">🔍</span>
                    <span className="text-blue-300 font-semibold text-[10px] tracking-wide">CLAUDE VISION — FAILURE ANALYSIS</span>
                    {!visualAnalysis.done && (
                      <div className="ml-auto flex gap-1">
                        {[0,100,200].map(d => (
                          <div key={d} className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:`${d}ms`}} />
                        ))}
                      </div>
                    )}
                    {visualAnalysis.done && <span className="ml-auto text-blue-500 text-[9px]">✓ done</span>}
                  </div>
                  <div className="px-3 py-2 text-blue-200/80 font-sans text-[10px] leading-relaxed whitespace-pre-wrap">
                    {visualAnalysis.text || <span className="text-blue-500/60 italic">Analysing screenshot…</span>}
                  </div>
                </div>
              )}

              {isRunning && !visualAnalysis && (
                <div className="flex items-center gap-1.5 text-slate-700 mt-1">
                  {[0, 150, 300].map(d => <div key={d} className="w-1 h-1 bg-yellow-500 rounded-full animate-bounce" style={{animationDelay:`${d}ms`}} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      </div>{/* end inner flex */}

      {/* ── Run History modal ────────────────────────────────────────────────── */}
      {showRunHistory && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[560px] max-h-[70vh] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="text-sm font-bold text-slate-800">🕘 Run History</div>
              <button onClick={() => setShowRunHistory(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {runHistory.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-8">No runs yet</div>
              ) : runHistory.map(run => (
                <div key={run.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${run.failCount > 0 ? 'bg-red-400' : 'bg-emerald-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-700 truncate">{run.name}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {run.passCount} passed · {run.failCount} failed · {new Date(run.startedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${run.failCount > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                    {run.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
