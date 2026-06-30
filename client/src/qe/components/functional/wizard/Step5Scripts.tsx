import { useState } from 'react';
import { motion } from 'framer-motion';
import { Code, Download, Loader2, Save, RotateCcw, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { AgentPanel } from '../AgentPanel';
import { MonacoEditor } from '../MonacoEditor';
import { ScriptFileTree } from '../ScriptFileTree';
import type { AgentState } from '../AgentPanel';

interface Script {
  id: string;
  fileName: string;
  filePath: string;
  scriptType: string;
  content: string;
  pageUrl?: string;
}

interface Step5ScriptsProps {
  agentStates: Partial<AgentState>;
  agentActivity: Record<string, string>;
  agentProgress: Record<string, number>;
  scripts: Script[];
  isGenerating: boolean;
  runId: string | null;
  pattern: string;
  onGenerateScripts: (pattern: 'POM' | 'BDD' | 'both') => void;
  onSaveScript: (id: string, content: string) => Promise<void>;
  onDownloadAll: () => void;
  onContinue: () => void;
}

export function Step5Scripts({
  agentStates,
  agentActivity,
  agentProgress,
  scripts,
  isGenerating,
  runId,
  pattern,
  onGenerateScripts,
  onSaveScript,
  onDownloadAll,
  onContinue,
}: Step5ScriptsProps) {
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const selectedScript = scripts.find(s => s.id === selectedScriptId);

  const handleSelect = (id: string) => {
    if (isDirty) {
      if (!confirm('Discard unsaved changes?')) return;
    }
    setSelectedScriptId(id);
    const script = scripts.find(s => s.id === id);
    if (script) {
      setEditedContent(script.content);
      setIsDirty(false);
    }
  };

  const handleChange = (value: string) => {
    setEditedContent(value);
    setIsDirty(value !== (selectedScript?.content ?? ''));
  };

  const handleSave = async () => {
    if (!selectedScriptId || !isDirty) return;
    setIsSaving(true);
    try {
      await onSaveScript(selectedScriptId, editedContent);
      setIsDirty(false);
      toast({ title: 'Saved', description: 'Script updated successfully' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save script', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    if (selectedScript) {
      setEditedContent(selectedScript.content);
      setIsDirty(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4"
    >
      {/* Left: Agent panel + file tree */}
      <div className="flex flex-col gap-3">
        <AgentPanel
          agentStates={agentStates}
          agentActivity={agentActivity}
          agentProgress={agentProgress}
          visibleAgents={['script_engineer']}
        />

        {/* Generate buttons — only shown before generation starts */}
        {!isGenerating && scripts.length === 0 && (
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              onClick={() => onGenerateScripts('both')}
              className="bg-gradient-to-r from-violet-600 to-primary hover:from-violet-500"
            >
              <Code className="w-3.5 h-3.5 mr-1.5" />
              Generate POM + BDD
            </Button>
            <Button size="sm" variant="outline" onClick={() => onGenerateScripts('POM')}>
              POM Only
            </Button>
            <Button size="sm" variant="outline" onClick={() => onGenerateScripts('BDD')}>
              BDD Only
            </Button>
          </div>
        )}

        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating scripts...
          </div>
        )}

        {scripts.length > 0 && (
          <>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={onDownloadAll} className="flex-1">
                <Download className="w-3.5 h-3.5 mr-1" />
                ZIP
              </Button>
              <Button
                size="sm"
                onClick={onContinue}
                className="flex-1 bg-gradient-to-r from-primary to-violet-600"
              >
                Execute
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>

            <ScriptFileTree
              scripts={scripts}
              selectedId={selectedScriptId ?? undefined}
              onSelect={handleSelect}
            />
          </>
        )}
      </div>

      {/* Right: Monaco editor */}
      <div className="flex flex-col gap-2">
        {selectedScript ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold">{selectedScript.fileName}</span>
                {isDirty && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 text-amber-600 border-amber-400"
                  >
                    modified
                  </Badge>
                )}
              </div>
              <div className="flex gap-1.5">
                {isDirty && (
                  <>
                    <Button size="sm" variant="ghost" onClick={handleDiscard}>
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Discard
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Save className="w-3 h-3 mr-1" />
                      )}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>

            <MonacoEditor
              value={editedContent}
              fileName={selectedScript.fileName}
              onChange={handleChange}
              height="500px"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-xl bg-muted/10 gap-3">
            {isGenerating ? (
              <>
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Script Engineer is writing your automation code...
                </p>
              </>
            ) : scripts.length > 0 ? (
              <>
                <Code className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Select a file from the tree to edit</p>
              </>
            ) : (
              <>
                <Code className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Click "Generate POM + BDD" to create automation scripts
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
