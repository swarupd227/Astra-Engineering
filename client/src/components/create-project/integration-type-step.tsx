import { Cloud, Kanban } from "lucide-react";
import { cn } from "@/lib/utils";
import { getIntegrationLabels } from "@/lib/integration-config";

export interface IntegrationTypeStepProps {
  integrationType: "ado" | "jira";
  onIntegrationTypeChange: (value: "ado" | "jira") => void;
}

export function CreateProjectIntegrationTypeStep({
  integrationType,
  onIntegrationTypeChange,
}: IntegrationTypeStepProps) {
  const ado = getIntegrationLabels("ado");
  const jira = getIntegrationLabels("jira");

  const options: {
    id: "ado" | "jira";
    title: string;
    subtitle: string;
    bullets: string[];
    icon: typeof Cloud;
    accent: "blue" | "violet";
  }[] = [
    {
      id: "ado",
      title: ado.longName,
      subtitle: "Boards, repos, pipelines, and test plans in one place.",
      bullets: ["Creates the project in Azure DevOps", "Syncs work items and wiki to Astra", "Best for Microsoft-centric delivery"],
      icon: Cloud,
      accent: "blue",
    },
    {
      id: "jira",
      title: jira.longName,
      subtitle: "Issues, backlogs, and delivery workflows in Jira.",
      bullets: ["Creates the project in your Jira site", "Links epics, stories, and tests in Astra", "Best when Jira is the system of record"],
      icon: Kanban,
      accent: "violet",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
          Where should this SDLC project live?
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Pick the system Astra will use to create the project and keep backlog, code, and tooling in sync.
          You can fine-tune golden repos and integrations in the next steps.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((opt) => {
          const selected = integrationType === opt.id;
          const Icon = opt.icon;
          const isBlue = opt.accent === "blue";

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onIntegrationTypeChange(opt.id)}
              className={cn(
                "group text-left transition-all duration-200",
                "rounded-2xl border border-border/40 bg-card p-5 shadow-sm",
                "hover:border-border hover:shadow-md",
                isBlue && "border-l-[3px] border-l-blue-500",
                !isBlue && "border-l-[3px] border-l-violet-500",
                selected &&
                  cn(
                    "ring-2 ring-offset-2 ring-offset-background shadow-md",
                    isBlue ? "ring-blue-500/60" : "ring-violet-500/60",
                    "bg-accent/25"
                  )
              )}
            >
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                    isBlue && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                    !isBlue && "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  )}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-base font-semibold">{opt.title}</span>
                    {selected && (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          isBlue && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
                          !isBlue && "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                        )}
                      >
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm leading-snug">{opt.subtitle}</p>
                  <ul className="text-muted-foreground space-y-1.5 border-t border-border/40 pt-3 text-xs leading-relaxed">
                    {opt.bullets.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span
                          className={cn(
                            "mt-1.5 h-1 w-1 shrink-0 rounded-full",
                            isBlue ? "bg-blue-500" : "bg-violet-500"
                          )}
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
