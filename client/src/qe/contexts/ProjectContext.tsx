import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface DevXContext {
  sdlcProjectId?: string;
  sdlcProjectName?: string;
  organization?: string;
  adoProjectName?: string;
  goldenRepoId?: string;
  goldenRepoName?: string;
}

interface ProjectContextType {
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  isFromDevx: boolean;
  devxContext: DevXContext;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const STORAGE_KEY = "qe_devx_context";
const PROJECT_KEY = "selectedProjectId";

function readDevXFromUrl(): DevXContext & { isDevx: boolean } {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source");
  const fromDevX = params.get("fromDevX");
  const isDevx = source === "devx" || fromDevX === "true";

  return {
    isDevx,
    sdlcProjectId: params.get("sdlcProjectId") || undefined,
    sdlcProjectName: params.get("sdlcProjectName") || undefined,
    organization: params.get("organization") || undefined,
    adoProjectName: params.get("adoProjectName") || undefined,
    goldenRepoId: params.get("goldenRepoId") || undefined,
    goldenRepoName: params.get("goldenRepoName") || undefined,
  };
}

function readDevXFromStorage(): DevXContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const urlCtx = readDevXFromUrl();
  const storedCtx = readDevXFromStorage();

  const [isFromDevx] = useState(() => urlCtx.isDevx || !!storedCtx);
  const [devxContext, setDevxContext] = useState<DevXContext>(() => {
    if (urlCtx.isDevx) {
      const ctx: DevXContext = {
        sdlcProjectId: urlCtx.sdlcProjectId,
        sdlcProjectName: urlCtx.sdlcProjectName,
        organization: urlCtx.organization,
        adoProjectName: urlCtx.adoProjectName,
        goldenRepoId: urlCtx.goldenRepoId,
        goldenRepoName: urlCtx.goldenRepoName,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
      return ctx;
    }
    return storedCtx || {};
  });

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    return localStorage.getItem(PROJECT_KEY);
  });

  useEffect(() => {
    if (isFromDevx) {
      localStorage.setItem("isAuthenticated", "true");
    }
  }, [isFromDevx]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(PROJECT_KEY, selectedProjectId);
    } else {
      localStorage.removeItem(PROJECT_KEY);
    }
  }, [selectedProjectId]);

  // Resolve golden repo from DevX API if not already in context
  useEffect(() => {
    if (!isFromDevx || devxContext.goldenRepoName || !devxContext.sdlcProjectId) return;

    const originalFetch = (window as any).__devxOriginalFetch || window.fetch;
    originalFetch(`/api/sdlc/projects/${devxContext.sdlcProjectId}`)
      .then((res: Response) => (res.ok ? res.json() : null))
      .then((data: any) => {
        const project = data?.project;
        const ref = project?.goldenRepoReference ?? project?.golden_repo_reference;
        const repoName = project?.linkedGoldenRepoName || project?.linked_golden_repo_name || ref?.repoName;
        const repoId = ref?.repoId;
        if (repoName || repoId) {
          setDevxContext((prev) => {
            const updated = { ...prev, goldenRepoId: repoId || prev.goldenRepoId, goldenRepoName: repoName || prev.goldenRepoName };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            return updated;
          });
        }
      })
      .catch(() => {});
  }, [isFromDevx, devxContext.sdlcProjectId, devxContext.goldenRepoName]);

  const syncUrlParams = useCallback(() => {
    if (!isFromDevx) return;
    const url = new URL(window.location.href);
    url.searchParams.set("source", "devx");
    if (devxContext.sdlcProjectId) url.searchParams.set("sdlcProjectId", devxContext.sdlcProjectId);
    if (devxContext.sdlcProjectName) url.searchParams.set("sdlcProjectName", devxContext.sdlcProjectName);
    if (devxContext.organization) url.searchParams.set("organization", devxContext.organization);
    if (devxContext.adoProjectName) url.searchParams.set("adoProjectName", devxContext.adoProjectName);
    if (devxContext.goldenRepoId) url.searchParams.set("goldenRepoId", devxContext.goldenRepoId);
    if (devxContext.goldenRepoName) url.searchParams.set("goldenRepoName", devxContext.goldenRepoName);
    window.history.replaceState(null, "", url.toString());
  }, [isFromDevx, devxContext]);

  useEffect(() => {
    syncUrlParams();
  }, [syncUrlParams]);

  useEffect(() => {
    if (!isFromDevx || !devxContext.sdlcProjectName) return;

    const payload = {
      name: devxContext.sdlcProjectName,
      type: "web",
      domain: "general",
      adoProjectName: devxContext.adoProjectName,
      adoOrganization: devxContext.organization,
      sdlcProjectId: devxContext.sdlcProjectId,
      sdlcProjectName: devxContext.sdlcProjectName,
      goldenRepoId: devxContext.goldenRepoId,
      goldenRepoName: devxContext.goldenRepoName,
    };

    fetch("/api/qe/projects/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (res.ok) return res.json();
    }).then((data) => {
      if (data?.project?.id) {
        setSelectedProjectId(data.project.id);
      }
    }).catch(() => {});
  }, [isFromDevx, devxContext]);

  return (
    <ProjectContext.Provider value={{ selectedProjectId, setSelectedProjectId, isFromDevx, devxContext }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}
