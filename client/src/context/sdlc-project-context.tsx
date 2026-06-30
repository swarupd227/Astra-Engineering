import { createContext, useContext, useState, ReactNode } from "react";

export interface SDLCProjectConfig {
  // Repository Information
  repositoryId: string;
  repositoryName: string;
  
  // Azure DevOps Configuration
  azureOrganizationUrl: string;
  azureProjectName: string;
  azureApiVersion: string;
  isPatConfigured: boolean; // Whether PAT token is set on server (never exposes actual token)
  
  // SDLC Project Information
  sdlcProjectId?: number;
  sdlcProjectName?: string;
  
  // Additional metadata
  createdAt?: string;
}

interface SDLCProjectContextType {
  projectConfig: SDLCProjectConfig | null;
  setProjectConfig: (config: SDLCProjectConfig | null) => void;
  clearProjectConfig: () => void;
  isConfigured: boolean;
}

const SDLCProjectContext = createContext<SDLCProjectContextType | undefined>(undefined);

export function SDLCProjectProvider({ children }: { children: ReactNode }) {
  const [projectConfig, setProjectConfigState] = useState<SDLCProjectConfig | null>(() => {
    // Try to load from localStorage on init
    const stored = localStorage.getItem('sdlc_project_config');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });

  const setProjectConfig = (config: SDLCProjectConfig | null) => {
    setProjectConfigState(config);
    // Persist to localStorage
    if (config) {
      localStorage.setItem('sdlc_project_config', JSON.stringify(config));
    } else {
      localStorage.removeItem('sdlc_project_config');
    }
  };

  const clearProjectConfig = () => {
    setProjectConfigState(null);
    localStorage.removeItem('sdlc_project_config');
  };

  const isConfigured = projectConfig !== null;

  return (
    <SDLCProjectContext.Provider
      value={{
        projectConfig,
        setProjectConfig,
        clearProjectConfig,
        isConfigured,
      }}
    >
      {children}
    </SDLCProjectContext.Provider>
  );
}

export function useSDLCProject() {
  const context = useContext(SDLCProjectContext);
  if (!context) {
    throw new Error("useSDLCProject must be used within a SDLCProjectProvider");
  }
  return context;
}
