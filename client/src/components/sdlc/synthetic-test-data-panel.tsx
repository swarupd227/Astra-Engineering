import { useEffect, useRef, type ReactNode } from "react";
import { Database } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";
import { GenericTestDataGenerator } from "./generic-test-data-generator";
import { DomainProvider, useDomain, type Domain } from "../../contexts/domain-context";

const DOMAIN_FROM_URL: Domain = "all";

/** Mirrors SDLC test-data-generation domain sync when wrapped in DomainProvider. */
function QeDomainInitializer() {
  const { selectedDomain, setSelectedDomain } = useDomain();
  const hasAppliedDomain = useRef(false);
  useEffect(() => {
    if (hasAppliedDomain.current) return;
    if (DOMAIN_FROM_URL && DOMAIN_FROM_URL !== selectedDomain) {
      setSelectedDomain(DOMAIN_FROM_URL);
    }
    hasAppliedDomain.current = true;
  }, [selectedDomain, setSelectedDomain]);
  return null;
}

export interface SyntheticTestDataPanelCoreProps {
  /** Shown on the right of the title row (e.g. SDLC “Back to SDLC”). */
  headerActions?: ReactNode;
  projectName?: string | null;
  organization?: string | null;
  className?: string;
}

/**
 * Same content as the SDLC Synthetic Test Data page (header + card + generator).
 * Use under the main app’s DomainProvider; do not nest {@link SyntheticTestDataPanelQe}.
 */
export function SyntheticTestDataPanelCore({
  headerActions,
  projectName,
  organization,
  className,
}: SyntheticTestDataPanelCoreProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Synthetic Test Data
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate domain-specific synthetic datasets for QA and testing.
          </p>
          {(projectName || organization) && (
            <p className="text-xs text-muted-foreground">
              {projectName ? `Project: ${projectName}` : "Project selected"}
              {organization ? ` · Org: ${organization}` : ""}
            </p>
          )}
        </div>
        {headerActions}
      </div>
      <Card>
        <CardContent>
          <GenericTestDataGenerator initialDomainFromUrl={DOMAIN_FROM_URL} />
        </CardContent>
      </Card>
    </div>
  );
}

/** SDLC-equivalent panel with its own DomainProvider (QE app has no global DomainProvider). */
export function SyntheticTestDataPanelQe(props: SyntheticTestDataPanelCoreProps) {
  return (
    <DomainProvider>
      <QeDomainInitializer />
      <SyntheticTestDataPanelCore {...props} />
    </DomainProvider>
  );
}
