import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileCode, FileText, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScriptFile {
  id: string;
  fileName: string;
  filePath: string;
  scriptType: string;
  pageUrl?: string;
}

interface ScriptFileTreeProps {
  scripts: ScriptFile[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

const SCRIPT_GROUPS = [
  { key: 'pom_class', label: 'pages/', icon: FileCode, color: 'text-blue-500' },
  { key: 'bdd_feature', label: 'features/', icon: FileText, color: 'text-emerald-500' },
  { key: 'bdd_step_defs', label: 'step-definitions/', icon: FileCode, color: 'text-violet-500' },
  { key: 'playwright_config', label: 'config/', icon: Settings, color: 'text-orange-500' },
  { key: 'cucumber_config', label: 'cucumber/', icon: Settings, color: 'text-yellow-500' },
] as const;

export function ScriptFileTree({ scripts, selectedId, onSelect }: ScriptFileTreeProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['pom_class', 'bdd_feature'])
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-background">
      <div className="px-3 py-2 bg-muted/30 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Project Files
        </span>
      </div>

      <div className="p-1">
        {SCRIPT_GROUPS.map(group => {
          const groupScripts = scripts.filter(s => s.scriptType === group.key);
          if (groupScripts.length === 0) return null;

          const isExpanded = expandedGroups.has(group.key);
          const Icon = group.icon;

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
                <Icon className={cn('w-3.5 h-3.5', group.color)} />
                <span className="text-xs font-mono font-medium text-muted-foreground">
                  {group.label}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {groupScripts.length}
                </span>
              </button>

              {isExpanded && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  className="ml-4"
                >
                  {groupScripts.map(script => (
                    <button
                      key={script.id}
                      onClick={() => onSelect(script.id)}
                      className={cn(
                        'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors',
                        selectedId === script.id
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted/50 text-foreground'
                      )}
                    >
                      <Icon className={cn('w-3 h-3 flex-shrink-0', group.color)} />
                      <span className="text-xs font-mono truncate">{script.fileName}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
