import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsAuthenticated } from "@azure/msal-react";
import { useAdoAllowed } from "@/hooks/use-hosting-config";

interface GoldenRepoOrganization {
  id: string;
  name: string;
  organizationUrl: string;
  projectName: string;
  repositoryName: string;
  apiVersion: string;
  patConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ArtifactOrganization {
  id: string;
  organizationUrl: string;
  projectName: string;
  patConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SettingsContextType {
  goldenRepoOrganizations: GoldenRepoOrganization[];
  artifactOrganizations: ArtifactOrganization[];
  jiraConnections: any[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const adoAllowed = useAdoAllowed();
  const [goldenRepoOrganizations, setGoldenRepoOrganizations] = useState<GoldenRepoOrganization[]>([]);
  const [artifactOrganizations, setArtifactOrganizations] = useState<ArtifactOrganization[]>([]);
  const [jiraConnections, setJiraConnections] = useState<any[]>([]);

  const { data: goldenRepoData, isLoading: goldenRepoLoading, isError: goldenRepoError, refetch: refetchGoldenRepo } = useQuery<{ organizations: GoldenRepoOrganization[] }>({
    queryKey: ['/api/golden-repo-organizations'],
    enabled: isAuthenticated && adoAllowed,
  });

  const { data: artifactData, isLoading: artifactLoading, isError: artifactError, refetch: refetchArtifact } = useQuery<{ organizations: ArtifactOrganization[] }>({
    queryKey: ['/api/artifact-organizations'],
    enabled: isAuthenticated && adoAllowed,
  });

  const { data: jiraData, isLoading: jiraLoading, isError: jiraError, refetch: refetchJira } = useQuery<{ connections: any[] }>({
    queryKey: ['/api/jira/connections'],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (goldenRepoData?.organizations) setGoldenRepoOrganizations(goldenRepoData.organizations);
  }, [goldenRepoData]);

  useEffect(() => {
    if (artifactData?.organizations) setArtifactOrganizations(artifactData.organizations);
  }, [artifactData]);

  useEffect(() => {
    if (jiraData?.connections) setJiraConnections(jiraData.connections);
  }, [jiraData]);

  const isLoading = goldenRepoLoading || artifactLoading || jiraLoading;
  const isError = goldenRepoError || artifactError || jiraError;

  const refetch = () => {
    if (adoAllowed) {
      refetchGoldenRepo();
      refetchArtifact();
    }
    refetchJira();
  };

  const value: SettingsContextType = {
    goldenRepoOrganizations,
    artifactOrganizations,
    jiraConnections,
    isLoading,
    isError,
    refetch,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
