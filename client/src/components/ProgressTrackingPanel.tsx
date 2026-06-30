import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_BASE_URL } from '@/lib/api-config';

// Type definitions
interface ProgressEvent {
  id: string;
  sessionId: string;
  repositoryName: string;
  type: 'repo-creation' | 'pipeline-run' | 'deployment' | 'qa-analysis' | 'ai-fix' | 'health-check';
  stage: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'warning';
  message: string;
  timestamp: Date;
  details?: any;
  fileChanges?: FileChange[];
  duration?: number;
  progress?: number;
}

interface FileChange {
  filePath: string;
  action: 'created' | 'modified' | 'deleted' | 'analyzed' | 'fixed';
  error?: string;
  aiGeneratedFix?: string;
  originalContent?: string;
  newContent?: string;
  status: 'pending' | 'applying' | 'applied' | 'failed';
  timestamp: Date;
}

interface ProgressSession {
  id: string;
  repositoryName: string;
  organizationName: string;
  projectId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  events: ProgressEvent[];
  currentStage: string;
  totalStages: number;
  completedStages: number;
  lastUpdate: Date;
}

// Props interface
interface ProgressTrackingPanelProps {
  repositoryName?: string;
  onSessionComplete?: (session: ProgressSession) => void;
  onError?: (error: string) => void;
  className?: string;
}

export const ProgressTrackingPanel: React.FC<ProgressTrackingPanelProps> = ({
  repositoryName,
  onSessionComplete,
  onError,
  className = ''
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ProgressSession[]>([]);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [fileChanges, setFileChanges] = useState<{ [sessionId: string]: FileChange[] }>({});
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'detailed' | 'files'>('overview');
  const [isExpanded, setIsExpanded] = useState(true);
  
  const socketRef = useRef<Socket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const socket = io(SOCKET_BASE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[ProgressPanel] Connected to WebSocket');
      setIsConnected(true);
      
      if (repositoryName) {
        socket.emit('join-repo', repositoryName);
      }
    });

    socket.on('disconnect', () => {
      console.log('[ProgressPanel] Disconnected from WebSocket');
      setIsConnected(false);
    });

    socket.on('progress:session', (session: ProgressSession) => {
      console.log('[ProgressPanel] Session update:', session);
      
      setActiveSessions(prev => {
        const filtered = prev.filter(s => s.id !== session.id);
        return [...filtered, session].sort((a, b) => 
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
      });

      if (session.status === 'completed' || session.status === 'failed') {
        onSessionComplete?.(session);
      }
    });

    socket.on('progress:event', (event: ProgressEvent) => {
      console.log('[ProgressPanel] Progress event:', event);
      
      setEvents(prev => {
        const filtered = prev.filter(e => e.id !== event.id);
        return [...filtered, event].sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      });
    });

    socket.on('progress:file-change', ({ sessionId, fileChange }: { sessionId: string; fileChange: FileChange }) => {
      console.log('[ProgressPanel] File change:', fileChange);
      
      setFileChanges(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), fileChange].sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
      }));
    });

    return () => {
      if (repositoryName) {
        socket.emit('leave-repo', repositoryName);
      }
      socket.disconnect();
    };
  }, [repositoryName, onSessionComplete]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Fetch initial sessions
  useEffect(() => {
    fetch('/api/progress/sessions')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setActiveSessions(data.sessions);
        }
      })
      .catch(err => {
        console.error('[ProgressPanel] Failed to fetch sessions:', err);
        onError?.('Failed to load progress sessions');
      });
  }, [onError]);

  const getStatusIcon = (status: ProgressEvent['status']) => {
    switch (status) {
      case 'pending': return '○';
      case 'in-progress': return '●';
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'warning': return '!';
      default: return '○';
    }
  };

  const getStatusColor = (status: ProgressEvent['status']) => {
    switch (status) {
      case 'pending': return 'text-gray-500';
      case 'in-progress': return 'text-blue-500';
      case 'completed': return 'text-green-500';
      case 'failed': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const getTypeIcon = (type: ProgressEvent['type']) => {
    switch (type) {
      case 'repo-creation': return '📁';
      case 'pipeline-run': return '⚙';
      case 'deployment': return '▲';
      case 'qa-analysis': return '●';
      case 'ai-fix': return '◆';
      case 'health-check': return '✓';
      default: return '■';
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatTimestamp = (timestamp: Date | string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const renderSessionOverview = () => (
    <div className="space-y-4">
      {activeSessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-medium mb-2">No active sessions</p>
          <p className="text-sm">Start a repository creation or deployment to see real-time progress</p>
        </div>
      ) : (
        activeSessions.map(session => (
          <div
            key={session.id}
            className={`border border-border rounded-lg p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
              selectedSession === session.id ? 'ring-2 ring-primary bg-primary/10' : ''
            }`}
            onClick={() => setSelectedSession(session.id)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <span className="font-semibold text-foreground">{session.repositoryName}</span>
                <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                  session.status === 'active' ? 'bg-blue-100 text-blue-800' :
                  session.status === 'completed' ? 'bg-green-100 text-green-800' :
                  session.status === 'failed' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {session.status.toUpperCase()}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">
                {formatTimestamp(session.startedAt)}
              </span>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                <span>Progress: {session.completedStages}/{session.totalStages} stages</span>
                <span className="font-medium">{Math.round((session.completedStages / session.totalStages) * 100)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    session.status === 'failed' ? 'bg-red-500' :
                    session.status === 'completed' ? 'bg-green-500' :
                    'bg-blue-500'
                  }`}
                  style={{ width: `${Math.round((session.completedStages / session.totalStages) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Current: {session.currentStage}
              </span>
              {session.completedAt && (
                <span className="text-xs text-muted-foreground">
                  Duration: {formatDuration(
                    new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()
                  )}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderDetailedEvents = () => {
    const sessionEvents = selectedSession 
      ? events.filter(e => e.sessionId === selectedSession)
      : events.slice(0, 50);

    return (
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {sessionEvents.map(event => (
          <div
            key={event.id}
            className={`border-l-4 pl-4 py-2 ${
              event.status === 'failed' ? 'border-red-500 bg-red-50' :
              event.status === 'completed' ? 'border-green-500 bg-green-50' :
              event.status === 'in-progress' ? 'border-blue-500 bg-blue-50' :
              'border-gray-300 bg-gray-50'
            }`}
          >
            <div className="flex items-center space-x-2 mb-1">
              <span>{getTypeIcon(event.type)}</span>
              <span>{getStatusIcon(event.status)}</span>
              <span className="font-medium text-sm">{event.stage}</span>
              <span className="text-xs text-gray-500">{formatTimestamp(event.timestamp)}</span>
              {event.progress && (
                <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                  {event.progress}%
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700">{event.message}</p>
            
            {event.details && (
              <div className="mt-2 p-2 bg-white rounded text-xs">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(event.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
        <div ref={eventsEndRef} />
      </div>
    );
  };

  const renderFileChanges = () => {
    const sessionFileChanges = selectedSession ? fileChanges[selectedSession] || [] : [];

    return (
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {sessionFileChanges.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <p>No file changes tracked for this session</p>
          </div>
        ) : (
          sessionFileChanges.map((change, index) => (
            <div
              key={`${change.filePath}-${index}`}
              className={`border border-gray-200 rounded p-3 ${
                change.status === 'failed' ? 'bg-red-50 border-red-300' :
                change.status === 'applied' ? 'bg-green-50 border-green-300' :
                change.status === 'applying' ? 'bg-blue-50 border-blue-300' :
                'bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className={`w-3 h-3 rounded-full ${
                    change.status === 'failed' ? 'bg-red-500' :
                    change.status === 'applied' ? 'bg-green-500' :
                    change.status === 'applying' ? 'bg-blue-500' :
                    'bg-gray-400'
                  }`} />
                  <span className="font-mono text-sm">{change.filePath}</span>
                  <span className={`px-2 py-1 text-xs rounded ${
                    change.action === 'created' ? 'bg-green-100 text-green-800' :
                    change.action === 'modified' ? 'bg-blue-100 text-blue-800' :
                    change.action === 'deleted' ? 'bg-red-100 text-red-800' :
                    change.action === 'fixed' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {change.action.toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {formatTimestamp(change.timestamp)}
                </span>
              </div>

              {change.error && (
                <div className="text-sm text-red-600 mb-2">
                  Error: {change.error}
                </div>
              )}

              {change.aiGeneratedFix && (
                <div className="mb-2">
                  <p className="text-sm font-medium text-purple-700 mb-1">🤖 AI Generated Fix:</p>
                  <p className="text-sm text-gray-700 bg-purple-50 p-2 rounded">
                    {change.aiGeneratedFix}
                  </p>
                </div>
              )}

              {change.newContent && (
                <div className="mt-2">
                  <p className="text-xs text-gray-600 mb-1">New Content:</p>
                  <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                    {change.newContent.substring(0, 200)}
                    {change.newContent.length > 200 && '...'}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    );
  };

  if (!isExpanded) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
        <div
          className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
          onClick={() => setIsExpanded(true)}
        >
          <div className="flex items-center space-x-2">
            <span className="text-lg">📊</span>
            <span className="font-semibold">Progress Tracking</span>
            {activeSessions.length > 0 && (
              <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                {activeSessions.length} active
              </span>
            )}
          </div>
          <span className="text-gray-400">▶️</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col bg-background ${className}`}>
      {/* Tab Navigation */}
      <div className="flex border-b border-border bg-muted/50">
        {[
          { id: 'overview', label: 'Overview', icon: '📋' },
          { id: 'detailed', label: 'Events', icon: '📝' },
          { id: 'files', label: 'File Changes', icon: '📁' }
        ].map(tab => (
          <button
            key={tab.id}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors ${
              viewMode === tab.id
                ? 'bg-background text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            onClick={() => setViewMode(tab.id as typeof viewMode)}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
        <div className="flex-1 flex items-center justify-end px-4">
          <div className={`w-2 h-2 rounded-full mr-2 ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-muted-foreground">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'overview' && renderSessionOverview()}
        {viewMode === 'detailed' && renderDetailedEvents()}
        {viewMode === 'files' && renderFileChanges()}
      </div>
    </div>
  );
};

export default ProgressTrackingPanel;