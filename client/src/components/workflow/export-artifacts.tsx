import { Download, FileSpreadsheet, FileCode, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Epic, Feature, UserStory, Persona } from "@shared/schema";
import toast from "react-hot-toast";

interface ExportArtifactsProps {
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  personas?: Persona[];
  projectName?: string;
  disabled?: boolean;
}

export function ExportArtifacts({
  epics,
  features,
  userStories,
  personas = [],
  projectName = "Project",
  disabled = false,
}: ExportArtifactsProps) {
  const STORY_POINTS_NA_LABEL = "Estimated at User Story level";
  const EPIC_PARENT_LABEL = "Top-level item (no parent)";

  // ── Helpers shared across exports ──────────────────────────────────────
  // Preserve full description (no length cap). Newlines -> spaces so each
  // record stays on a single CSV row; csvEscape handles quoting.
  const sanitizeDescription = (desc: unknown): string => {
    if (desc == null) return '';
    return String(desc).replace(/\r?\n/g, ' ').trim();
  };

  // Serialize an acceptance-criteria array (strings or { title } / { text }
  // objects) into a single CSV cell using "; " between entries.
  const formatAcceptanceCriteria = (acs: unknown): string => {
    if (!Array.isArray(acs) || acs.length === 0) return '';
    const parts: string[] = [];
    for (const ac of acs) {
      if (ac == null) continue;
      if (typeof ac === 'string') {
        const t = ac.trim();
        if (t) parts.push(t);
        continue;
      }
      if (typeof ac === 'object') {
        const a: any = ac;
        const t = String(a.title ?? a.text ?? a.description ?? '').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join('; ');
  };

  // Serialize a subtasks array (strings or objects with description / title)
  // into one cell, "; "-joined.
  const formatSubtasks = (sts: unknown): string => {
    if (!Array.isArray(sts) || sts.length === 0) return '';
    const parts: string[] = [];
    for (const st of sts) {
      if (st == null) continue;
      if (typeof st === 'string') {
        const t = st.trim();
        if (t) parts.push(t);
        continue;
      }
      if (typeof st === 'object') {
        const s: any = st;
        const t = String(s.description ?? s.title ?? s.text ?? '').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join('; ');
  };

  // Sum story points for the descendants of an epic or feature.
  // Returns the placeholder string only when the sum is 0 (truly bottom-up).
  const sumStoryPoints = (predicate: (s: UserStory) => boolean): string => {
    let total = 0;
    for (const s of userStories) {
      if (!predicate(s)) continue;
      const sp = (s as any).storyPoints;
      const n = typeof sp === 'number' ? sp : parseFloat(String(sp ?? ''));
      if (!Number.isNaN(n) && Number.isFinite(n)) total += n;
    }
    return total > 0 ? String(total) : STORY_POINTS_NA_LABEL;
  };

  // Export in ADO-style flat CSV format
  const exportToCSV = () => {
    const rows: string[][] = [];

    // Header matching ADO export format (extended with AC + Subtasks columns
    // so QA / dev hand-off downstream consumers don't need a manual fill-in).
    rows.push([
      'ID',
      'Work Item Type',
      'Title',
      'Description',
      'Acceptance Criteria',
      'Subtasks',
      'Priority',
      'Story Points',
      'Parent',
    ]);

    // Epics - no parent. Story-point rollup = sum of all stories under the epic.
    epics.forEach(epic => {
      rows.push([
        epic.id,
        'Epic',
        epic.title,
        sanitizeDescription(epic.description),
        formatAcceptanceCriteria((epic as any).acceptanceCriteria),
        '', // subtasks: not applicable to epics
        epic.priority,
        sumStoryPoints(s => s.epicId === epic.id || features.some(f => f.id === s.featureId && f.epicId === epic.id)),
        EPIC_PARENT_LABEL,
      ]);
    });

    // Features - parent is Epic. Rollup = sum of stories under the feature.
    features.forEach(feature => {
      rows.push([
        feature.id,
        'Feature',
        feature.title,
        sanitizeDescription(feature.description),
        formatAcceptanceCriteria((feature as any).acceptanceCriteria),
        '', // subtasks: not applicable to features
        feature.priority,
        sumStoryPoints(s => s.featureId === feature.id),
        feature.epicId, // Parent Epic ID
      ]);
    });

    // User Stories - parent is Feature. Full description, full ACs, full subtasks.
    userStories.forEach(story => {
      rows.push([
        story.id,
        'User Story',
        story.title,
        sanitizeDescription(story.description),
        formatAcceptanceCriteria((story as any).acceptanceCriteria),
        formatSubtasks((story as any).subtasks),
        story.priority,
        story.storyPoints?.toString() || '',
        story.featureId, // Parent Feature ID
      ]);
    });
    
    // Convert to CSV with proper escaping
    const csvContent = rows.map(row => 
      row.map(cell => {
        const cellStr = String(cell);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');
    
    // Add BOM for Excel UTF-8 support
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '-')}-WorkItems-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Work items exported successfully');
  };

  // Export hierarchical JSON format
  const exportToJSON = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      projectName,
      summary: {
        totalEpics: epics.length,
        totalFeatures: features.length,
        totalUserStories: userStories.length,
      },
      epics: epics.map(epic => ({
        ...epic,
        features: features.filter(f => f.epicId === epic.id).map(feature => ({
          ...feature,
          userStories: userStories.filter(s => s.featureId === feature.id),
        })),
      })),
      personas,
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Artifacts exported as JSON');
  };
  
  // Export detailed stories with all attributes
  const exportStoriesDetailed = () => {
    const rows: string[][] = [];
    
    // Header with detailed columns
    rows.push([
      'ID',
      'Title',
      'Description',
      'Priority',
      'Story Points',
      'Epic',
      'Epic ID',
      'Feature',
      'Feature ID',
      'Persona',
      'Acceptance Criteria Count',
      'Subtasks Count',
      'Test Cases Count',
    ]);
    
    userStories.forEach(story => {
      const feature = features.find(f => f.id === story.featureId);
      const epic = epics.find(e => e.id === feature?.epicId);
      const persona = personas.find(p => p.id === story.personaId);

      rows.push([
        story.id,
        story.title,
        sanitizeDescription(story.description),
        story.priority,
        story.storyPoints?.toString() || '',
        epic?.title || '',
        epic?.id || '',
        feature?.title || '',
        feature?.id || '',
        persona?.name || (story as any).persona || '',
        story.acceptanceCriteria?.length?.toString() || '0',
        (story as any).subtasks?.length?.toString() || '0',
        (story as any).testCases?.length?.toString() || '0',
      ]);
    });
    
    const csvContent = rows.map(row => 
      row.map(cell => {
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');
    
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '-')}-Stories-Detailed-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Detailed stories exported successfully');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          disabled={disabled}
          aria-disabled={disabled}
          className="disabled:cursor-not-allowed disabled:opacity-50"
          title={disabled ? "Disabled while artifacts are generating" : undefined}
        >
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem 
          onClick={exportToCSV}
          disabled={disabled}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export Work Items (CSV)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={exportStoriesDetailed}
          disabled={disabled}
        >
          <FileText className="h-4 w-4 mr-2" />
          Export Stories (Detailed)
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={exportToJSON}
          disabled={disabled}
        >
          <FileCode className="h-4 w-4 mr-2" />
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
