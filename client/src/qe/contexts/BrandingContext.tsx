import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import pgLogoSvg from "@/assets/pg-logo.svg";
import amerisureLogoSvg from "@/assets/amerisure-logo.svg";
import astraLogoPng from "@/assets/astra-logo.png";

export interface BrandProfile {
  id: string;
  label: string;
  platformName: string;
  platformShortName: string;
  subtitle: string;
  commandCenter: string;
  tagline: string;
  loginTitle: string;
  heroTitle: string;
  heroSubtitle: string;
  logoType: "icon" | "image";
  logoSrc?: string;
  logoBackground?: string;
  accentColor: string;
  pdfTitle: string;
}

export const brandProfiles: Record<string, BrandProfile> = {
  devx: {
    id: "devx",
    label: "Astra",
    platformName: "Astra",
    platformShortName: "Astra",
    subtitle: "Agentic Testing",
    commandCenter: "Astra Agentic Testing Command Center",
    tagline: "Astra — Autonomous Testing Platform",
    loginTitle: "Log In to Astra",
    heroTitle: "Astra",
    heroSubtitle: "Agentic Testing Platform",
    logoType: "image",
    logoSrc: astraLogoPng,
    accentColor: "#1B6FE4",
    pdfTitle: "Astra Agentic Testing Platform",
  },
  gold: {
    id: "gold",
    label: "NAT 2.0 (Gold)",
    platformName: "NAT 2.0",
    platformShortName: "NAT 2.0",
    subtitle: "Agentic Testing",
    commandCenter: "NAT 2.0 Command Center",
    tagline: "NOUS Autonomous Testing Platform",
    loginTitle: "Log In to NAT 2.0",
    heroTitle: "NAT 2.0",
    heroSubtitle: "Agentic Testing Platform",
    logoType: "icon",
    accentColor: "#4f46e5",
    pdfTitle: "NAT 2.0 Autonomous Testing Platform",
  },
  envestnet: {
    id: "envestnet",
    label: "Envestnet",
    platformName: "Envestnet QE AI",
    platformShortName: "Envestnet QE",
    subtitle: "Quality Engineering",
    commandCenter: "Envestnet QE AI Command Center",
    tagline: "Envestnet Autonomous Testing Platform",
    loginTitle: "Log In to Envestnet QE AI",
    heroTitle: "Envestnet",
    heroSubtitle: "QE AI Testing Platform",
    logoType: "icon",
    accentColor: "#0074bd",
    pdfTitle: "Envestnet QE AI Testing Platform",
  },
  amerisure: {
    id: "amerisure",
    label: "Amerisure",
    platformName: "Amerisure QE AI",
    platformShortName: "Amerisure QE",
    subtitle: "Quality Engineering",
    commandCenter: "Amerisure QE AI Command Center",
    tagline: "Amerisure Autonomous Testing Platform",
    loginTitle: "Log In to Amerisure QE AI",
    heroTitle: "Amerisure",
    heroSubtitle: "QE AI Testing Platform",
    logoType: "image",
    logoSrc: amerisureLogoSvg,
    logoBackground: "#003087",
    accentColor: "#003087",
    pdfTitle: "Amerisure QE AI Testing Platform",
  },
  pg: {
    id: "pg",
    label: "P&G",
    platformName: "P&G QE AI",
    platformShortName: "P&G QE",
    subtitle: "Quality Engineering",
    commandCenter: "P&G QE AI Command Center",
    tagline: "Procter & Gamble Autonomous Testing Platform",
    loginTitle: "Log In to P&G QE AI",
    heroTitle: "P&G",
    heroSubtitle: "QE AI Testing Platform",
    logoType: "image",
    logoSrc: pgLogoSvg,
    accentColor: "#003DA5",
    pdfTitle: "P&G QE AI Testing Platform",
  },
};

interface BrandingContextType {
  brand: BrandProfile;
  setBrand: (brandId: string) => void;
  brandId: string;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [brandId, setBrandId] = useState<string>("devx");

  const brand = brandProfiles[brandId] || brandProfiles.gold;

  useEffect(() => {
    localStorage.setItem("selectedBrand", brandId);
  }, [brandId]);

  const setBrand = (id: string) => {
    if (brandProfiles[id]) {
      setBrandId(id);
    }
  };

  return (
    <BrandingContext.Provider value={{ brand, setBrand, brandId }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding must be used within BrandingProvider");
  }
  return context;
}
