import { Building2, ShoppingCart, Heart, Factory, TrendingUp, Grid3x3, GraduationCap } from "lucide-react";
import { useDomain, DOMAINS, DOMAIN_CONFIG, type Domain } from "@/contexts/domain-context";
import { cn } from "@/lib/utils";

const DOMAIN_ICONS = {
  all: Grid3x3,
  insurance: Building2,
  retail: ShoppingCart,
  healthcare: Heart,
  manufacturing: Factory,
  finance: TrendingUp,
  education: GraduationCap,
} as const;

export function DomainNav() {
  const { selectedDomain, setSelectedDomain } = useDomain();
 
  return (
    <div className="border-b bg-card">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-center gap-1 px-6 overflow-x-auto scrollbar-hide">
          {DOMAINS.map((domain) => {
            const Icon = DOMAIN_ICONS[domain];
            const config = DOMAIN_CONFIG[domain];
            const isSelected = selectedDomain === domain;
 
            return (
              <button
                key={domain}
                data-testid={`domain-tab-${domain}`}
                onClick={() => setSelectedDomain(domain)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
                  "hover-elevate active-elevate-2 border-b-2",
                  isSelected
                    ? "border-b-primary text-primary"
                    : "border-b-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
