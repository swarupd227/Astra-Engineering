import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Upload, Globe, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Link, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ApiEndpoint {
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
}

interface ApiDiscoveryResult {
  type: 'har_capture' | 'swagger_import';
  sourceUrl: string;
  endpoints: ApiEndpoint[];
  harEntries?: any[];
  spec?: any;
}

interface ApiDiscoveryPanelProps {
  baseUrl?: string;
  onDiscoveryComplete?: (result: ApiDiscoveryResult) => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  POST: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  PATCH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function ApiDiscoveryPanel({ baseUrl, onDiscoveryComplete }: ApiDiscoveryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'har' | 'swagger'>('swagger');

  // HAR capture state
  const [harTargetUrl, setHarTargetUrl] = useState(baseUrl || '');
  const [harDurationSec, setHarDurationSec] = useState(30);
  const [harStatus, setHarStatus] = useState<'idle' | 'capturing' | 'done' | 'error'>('idle');
  const [harMessage, setHarMessage] = useState('');

  // Swagger import state
  const [swaggerUrl, setSwaggerUrl] = useState('');
  const [swaggerStatus, setSwaggerStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [swaggerMessage, setSwaggerMessage] = useState('');

  // Results
  const [result, setResult] = useState<ApiDiscoveryResult | null>(null);
  const [showEndpoints, setShowEndpoints] = useState(false);

  const handleHarCapture = async () => {
    setHarStatus('capturing');
    setHarMessage(`Capturing traffic for ${harDurationSec}s...`);
    setResult(null);
    try {
      const res = await fetch('/api/api-discovery/capture-har', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: harTargetUrl, durationMs: harDurationSec * 1000 }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'HAR capture failed');
      }
      const data: ApiDiscoveryResult = await res.json();
      setResult(data);
      setHarStatus('done');
      setHarMessage(`Captured ${data.harEntries?.length ?? 0} requests, found ${data.endpoints.length} API endpoints`);
      onDiscoveryComplete?.(data);
    } catch (err: any) {
      setHarStatus('error');
      setHarMessage(err.message);
    }
  };

  const handleSwaggerImport = async () => {
    const isUrl = swaggerUrl.startsWith('http');
    setSwaggerStatus('importing');
    setSwaggerMessage('Parsing OpenAPI specification...');
    setResult(null);
    try {
      const res = await fetch('/api/api-discovery/import-swagger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specUrl: isUrl ? swaggerUrl : undefined, specContent: isUrl ? undefined : swaggerUrl, isUrl }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Swagger import failed');
      }
      const data: ApiDiscoveryResult = await res.json();
      setResult(data);
      setSwaggerStatus('done');
      setSwaggerMessage(`Imported ${data.endpoints.length} endpoints from spec`);
      onDiscoveryComplete?.(data);
    } catch (err: any) {
      setSwaggerStatus('error');
      setSwaggerMessage(err.message);
    }
  };

  const isHarBusy = harStatus === 'capturing';
  const isSwaggerBusy = swaggerStatus === 'importing';

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setIsExpanded(s => !s)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-sky-500" />
          <span className="text-sm font-semibold">API Discovery</span>
          {result && (
            <Badge variant="secondary" className="text-[10px] h-4 bg-sky-100 text-sky-700 dark:bg-sky-900/30">
              {result.endpoints.length} endpoints
            </Badge>
          )}
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="border-t border-border overflow-hidden"
          >
            <div className="p-4 space-y-4">
              {/* Tab switcher */}
              <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveTab('swagger')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                    activeTab === 'swagger' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <FileJson className="w-3.5 h-3.5" />
                  OpenAPI / Swagger
                </button>
                <button
                  onClick={() => setActiveTab('har')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                    activeTab === 'har' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Globe className="w-3.5 h-3.5" />
                  HAR Capture
                </button>
              </div>

              {/* Swagger tab */}
              {activeTab === 'swagger' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Swagger / OpenAPI URL or JSON</Label>
                    <Input
                      placeholder="https://api.example.com/swagger.json or paste spec JSON"
                      value={swaggerUrl}
                      onChange={e => setSwaggerUrl(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Enter a URL to a Swagger/OpenAPI spec or paste raw JSON/YAML content
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSwaggerImport}
                    disabled={!swaggerUrl.trim() || isSwaggerBusy}
                    className="w-full"
                  >
                    {isSwaggerBusy ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Importing...</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5 mr-1.5" /> Import Spec</>
                    )}
                  </Button>
                  {swaggerMessage && (
                    <div className={cn(
                      'flex items-center gap-2 text-xs p-2 rounded-lg',
                      swaggerStatus === 'done' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' :
                      swaggerStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {swaggerStatus === 'done' && <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                      {swaggerStatus === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                      {swaggerStatus === 'importing' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                      {swaggerMessage}
                    </div>
                  )}
                </div>
              )}

              {/* HAR capture tab */}
              {activeTab === 'har' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Target URL</Label>
                    <Input
                      placeholder="https://yourapp.com"
                      value={harTargetUrl}
                      onChange={e => setHarTargetUrl(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Capture Duration (seconds)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={harDurationSec}
                        onChange={e => setHarDurationSec(parseInt(e.target.value) || 30)}
                        min={5} max={120}
                        className="w-24 h-8 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">
                        Opens a browser, navigate your app, then close it
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleHarCapture}
                    disabled={!harTargetUrl.trim() || isHarBusy}
                    className="w-full"
                  >
                    {isHarBusy ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Capturing ({harDurationSec}s)...</>
                    ) : (
                      <><Globe className="w-3.5 h-3.5 mr-1.5" /> Start HAR Capture</>
                    )}
                  </Button>
                  {harMessage && (
                    <div className={cn(
                      'flex items-center gap-2 text-xs p-2 rounded-lg',
                      harStatus === 'done' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' :
                      harStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {harStatus === 'done' && <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                      {harStatus === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                      {harStatus === 'capturing' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                      {harMessage}
                    </div>
                  )}
                </div>
              )}

              {/* Discovered endpoints */}
              {result && result.endpoints.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowEndpoints(s => !s)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <Link className="w-3.5 h-3.5 text-sky-500" />
                      {result.endpoints.length} API Endpoints Discovered
                    </span>
                    {showEndpoints ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  {showEndpoints && (
                    <div className="max-h-48 overflow-y-auto divide-y divide-border/50">
                      {result.endpoints.map((ep, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                          <span className={cn(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0',
                            METHOD_COLORS[ep.method.toUpperCase()] ?? 'bg-muted text-muted-foreground'
                          )}>
                            {ep.method.toUpperCase()}
                          </span>
                          <span className="text-xs font-mono text-foreground truncate">{ep.path}</span>
                          {ep.summary && (
                            <span className="text-[10px] text-muted-foreground truncate hidden sm:block">{ep.summary}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
