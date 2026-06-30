import { createContext, useContext, useState, useEffect, ReactNode } from "react";
 
export type Domain = "all" | "insurance" | "retail" | "healthcare" | "manufacturing" | "finance" | "education";
 
export const DOMAINS: Domain[] = ["all", "insurance", "retail", "healthcare", "manufacturing", "finance", "education"];
 
export const DOMAIN_CONFIG = {
  all: {
    label: "All Domains",
    color: "from-gray-500 to-gray-600",
    borderColor: "border-gray-500",
    bgColor: "bg-gray-500/10",
    textColor: "text-gray-600",
  },
  insurance: {
    label: "Insurance",
    color: "from-blue-500 to-blue-600",
    borderColor: "border-blue-500",
    bgColor: "bg-blue-500/10",
    textColor: "text-blue-600",
  },
  retail: {
    label: "Retail",
    color: "from-purple-500 to-purple-600",
    borderColor: "border-purple-500",
    bgColor: "bg-purple-500/10",
    textColor: "text-purple-600",
  },
  healthcare: {
    label: "Healthcare",
    color: "from-green-500 to-green-600",
    borderColor: "border-green-500",
    bgColor: "bg-green-500/10",
    textColor: "text-green-600",
  },
  manufacturing: {
    label: "Manufacturing",
    color: "from-orange-500 to-orange-600",
    borderColor: "border-orange-500",
    bgColor: "bg-orange-500/10",
    textColor: "text-orange-600",
  },
  finance: {
    label: "Finance",
    color: "from-emerald-500 to-emerald-600",
    borderColor: "border-emerald-500",
    bgColor: "bg-emerald-500/10",
    textColor: "text-emerald-600",
  },
  education: {
    label: "Education",
    color: "from-indigo-500 to-indigo-600",
    borderColor: "border-indigo-500",
    bgColor: "bg-indigo-500/10",
    textColor: "text-indigo-600",
  },
} as const;
 
interface DomainContextValue {
  selectedDomain: Domain;
  setSelectedDomain: (domain: Domain) => void;
}
 
const DomainContext = createContext<DomainContextValue | undefined>(undefined);
 
const STORAGE_KEY = "devplatform-selected-domain";
 
interface DomainProviderProps {
  children: ReactNode;
}
 
export function DomainProvider({ children }: DomainProviderProps) {
  const [selectedDomain, setSelectedDomainState] = useState<Domain>(() => {
    // Try to load from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DOMAINS.includes(stored as Domain)) {
      return stored as Domain;
    }
    return "all"; // Default domain - show all repositories
  });
 
  const setSelectedDomain = (domain: Domain) => {
    setSelectedDomainState(domain);
    localStorage.setItem(STORAGE_KEY, domain);
  };
 
  useEffect(() => {
    // Sync with localStorage on mount
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DOMAINS.includes(stored as Domain) && stored !== selectedDomain) {
      setSelectedDomainState(stored as Domain);
    }
  }, []);
 
  return (
    <DomainContext.Provider value={{ selectedDomain, setSelectedDomain }}>
      {children}
    </DomainContext.Provider>
  );
}
 
export function useDomain() {
  const context = useContext(DomainContext);
  if (context === undefined) {
    throw new Error("useDomain must be used within a DomainProvider");
  }
  return context;
}