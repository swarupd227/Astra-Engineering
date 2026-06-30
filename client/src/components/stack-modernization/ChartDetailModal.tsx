import { ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Info, ChevronDown, ChevronRight } from "lucide-react";

export interface ChartDataRow {
  label: string;
  value: string | number;
}

export interface DetailItem {
  title: string;
  subtitle?: string;
  badge?: { text: string; variant?: "default" | "secondary" | "destructive" | "outline" };
  extra?: string;
}

export interface DetailSection {
  heading: string;
  emptyMessage?: string;
  items: DetailItem[];
}

export interface ChartDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  methodology: string;
  dataTable: ChartDataRow[];
  detailSections?: DetailSection[];
  children?: ReactNode;
  onDownloadPdf?: () => void;
}

const SEVERITY_BADGE: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  major: "destructive",
  medium: "default",
  minor: "secondary",
  low: "outline",
};

function CollapsibleSection({ section }: { section: DetailSection }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(section.items.length <= 10);

  if (section.items.length === 0) {
    return (
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-1">{section.heading}</h4>
        <p className="text-xs text-muted-foreground italic">{section.emptyMessage || "No items found."}</p>
      </div>
    );
  }

  const displayItems = showAll ? section.items : section.items.slice(0, 5);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-2 hover:text-primary transition-colors w-full text-left"
        onClick={() => setOpen(prev => !prev)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
        {section.heading}
        <span className="text-xs font-normal text-muted-foreground ml-1">({section.items.length})</span>
      </button>
      {open && (
        <div className="space-y-1.5 ml-5">
          {displayItems.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm py-1 border-b border-border/10 last:border-0">
              <span className="text-muted-foreground font-mono text-[10px] mt-0.5 min-w-[1.25rem] text-right">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{item.title}</span>
                  {item.badge && (
                    <Badge
                      variant={item.badge.variant || SEVERITY_BADGE[item.badge.text.toLowerCase()] || "outline"}
                      className="text-[10px] py-0 h-4"
                    >
                      {item.badge.text}
                    </Badge>
                  )}
                </div>
                {item.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
                )}
                {item.extra && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono">{item.extra}</p>
                )}
              </div>
            </div>
          ))}
          {!showAll && section.items.length > 5 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline mt-1"
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              Show all {section.items.length} items...
            </button>
          )}
          {showAll && section.items.length > 10 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline mt-1"
              onClick={(e) => { e.stopPropagation(); setShowAll(false); }}
            >
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ChartDetailModal({
  open,
  onOpenChange,
  title,
  description,
  methodology,
  dataTable,
  detailSections,
  children,
  onDownloadPdf,
}: ChartDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {title}
          </DialogTitle>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {children && (
            <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
              {children}
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-blue-500" />
              Methodology
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {methodology}
            </p>
          </div>

          {dataTable.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Summary</h4>
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-muted-foreground bg-muted/30 px-3 py-2">
                  <span>Metric</span>
                  <span className="text-right">Value</span>
                </div>
                {dataTable.map((row, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-2 gap-2 text-sm py-1.5 border-t border-border/10 px-3"
                  >
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="text-right font-medium text-foreground">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detailSections && detailSections.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-foreground">Detailed Breakdown</h4>
              {detailSections.map((section, i) => (
                <CollapsibleSection key={i} section={section} />
              ))}
            </div>
          )}

          {onDownloadPdf && (
            <div className="flex justify-end pt-2 border-t border-border/20">
              <Button variant="outline" size="sm" onClick={onDownloadPdf}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download as PDF
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const CHART_METHODOLOGIES: Record<string, string> = {
  stackDetection:
    "Stack detection analyzes project manifests (package.json, .csproj, pom.xml, requirements.txt), file extensions, and framework-specific configuration files to identify the technology stack. Languages are weighted by file count and lines of code.",
  dependencies:
    "Dependency analysis parses package manifests to enumerate direct and transitive dependencies. Peer conflicts are detected by comparing version constraints across the dependency tree. Depth analysis measures the maximum nesting level of transitive dependencies.",
  versionIntelligence:
    "Version intelligence queries official package registries to determine the latest stable, LTS, and security-patched versions. Risk levels are assigned based on the number of major versions behind and end-of-life status of the current version.",
  security:
    "Security score is derived from static analysis of dependencies against known CVE databases. Score = 100 minus weighted vulnerability count (Critical x4, High x3, Medium x2, Low x1). A score of 100 indicates no known vulnerabilities.",
  codeQuality:
    "Code quality score is based on cyclomatic complexity, maintainability index, and technical debt items. The score ranges from 0 to 100, where higher values indicate better maintainability and lower technical debt.",
  breakingChanges:
    "Breaking changes are identified by comparing API signatures between current and target versions using official migration guides and changelog analysis. Severity is classified as Critical (removal of core APIs), Major (signature changes), or Minor (deprecations).",
  database:
    "Database analysis scans configuration files, connection strings, and ORM configurations to identify database engines, versions, and migration files. This helps assess the impact of framework upgrades on data access layers.",
  requirements:
    "Requirements analysis identifies runtime prerequisites, build tools, CI/CD configurations, and environment constraints. This determines the infrastructure changes needed to support the target versions.",
  tasksByPhase:
    "Tasks are grouped by upgrade phase (e.g., dependency updates, code modifications, configuration changes). Each task is assigned to the phase where its changes have the most impact, based on the dependency graph.",
  riskAndAutomation:
    "Risk levels are determined by analyzing the complexity of required changes, the number of affected files, and the availability of automated migration paths. Auto-fixable tasks are those with deterministic transformations that can be applied without manual review.",
  executionResults:
    "Execution metrics track the success rate of automated code transformations. Each task is executed independently and verified against compilation and test results. Failed tasks indicate areas requiring manual intervention.",
  testFrameworks:
    "Test coverage analysis groups generated tests by framework (xUnit, NUnit, Jest, pytest, etc.) and maps them to the source files they cover. Coverage percentage represents the ratio of tested source files to total modified files.",
  perStackScores:
    "Per-stack compatibility scores are calculated by analyzing breaking changes, API compatibility, and migration complexity for each technology component. Risk scores factor in community support, documentation quality, and known migration issues.",
  overallHealth:
    "The health radar aggregates five dimensions: Security (CVE analysis), Compatibility (API match between versions), Effort (estimated developer-hours), Risk (likelihood and impact of issues), and Test Coverage (existing test suite adequacy).",
  effortDistribution:
    "Effort estimation uses historical upgrade data and complexity analysis to classify tasks as Trivial (<1h), Low (1-4h), Medium (4-8h), High (8-16h), or Very High (>16h). Distribution shows the breakdown across all planned tasks.",
  severityDistribution:
    "Severity distribution classifies all identified changes by their impact level. Critical changes block compilation, High changes affect runtime behavior, Medium changes cause deprecation warnings, and Low changes are cosmetic or informational.",
};
