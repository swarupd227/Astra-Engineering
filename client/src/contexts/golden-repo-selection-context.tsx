import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type RepoSelection = {
  repoId: string;
  repoName: string;
  selectedPaths: string[]; // normalized forward-slash paths, e.g. "docs/architecture.md"
};

export type GoldenRepoSelections = {
  [repoId: string]: RepoSelection;
};

type ContextValue = {
  selections: GoldenRepoSelections;
  setSelection: (repoName: string, repoId: string, paths: string[]) => void;
  addPath: (repoName: string, repoId: string, path: string) => void;
  removePath: (repoName: string, repoId: string, path: string) => void;
  clearRepo: (repoId: string) => void;
  getSelectedPaths: (repoId: string) => string[];
  isPathSelected: (repoId: string, path: string) => boolean;
};

const GoldenRepoSelectionContext = createContext<ContextValue | undefined>(undefined);

const STORAGE_KEY = "goldenRepoSelections";
const MAX_REPOS = 5;

/**
 * Normalize a file path to use forward slashes and remove leading slashes
 */
export const normalizePath = (p: string): string => {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
};

/**
 * Check if a path is inside the "Starter Code" folder (case-sensitive)
 */
export const isInStarterCode = (path: string): boolean => {
  const norm = normalizePath(path);
  const parts = norm.split("/");
  // Disable if any ancestor is "Starter Code"
  return parts.includes("Starter Code");
};

export function GoldenRepoSelectionProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<GoldenRepoSelections>({});

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GoldenRepoSelections;
        // Validate structure
        const valid: GoldenRepoSelections = {};
        for (const [repoId, selection] of Object.entries(parsed)) {
          if (
            selection &&
            typeof selection === "object" &&
            typeof selection.repoId === "string" &&
            typeof selection.repoName === "string" &&
            Array.isArray(selection.selectedPaths)
          ) {
            valid[repoId] = {
              repoId: selection.repoId,
              repoName: selection.repoName,
              selectedPaths: selection.selectedPaths.map(normalizePath),
            };
          }
        }
        setSelections(valid);
      }
    } catch (error) {
      console.error("Failed to load golden repo selections from localStorage:", error);
    }
  }, []);

  // Save to localStorage whenever selections change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    } catch (error) {
      console.error("Failed to save golden repo selections to localStorage:", error);
    }
  }, [selections]);

  const setSelection = useCallback(
    (repoName: string, repoId: string, paths: string[]) => {
      setSelections((prev) => {
        const normalized = paths.map(normalizePath);
        const newSelections = { ...prev };
        
        // Limit to MAX_REPOS repos
        const repoIds = Object.keys(newSelections);
        if (!newSelections[repoId] && repoIds.length >= MAX_REPOS) {
          // Remove oldest repo (first in object, though order isn't guaranteed)
          const firstKey = repoIds[0];
          delete newSelections[firstKey];
        }

        newSelections[repoId] = {
          repoId,
          repoName,
          selectedPaths: normalized,
        };
        return newSelections;
      });
    },
    []
  );

  const addPath = useCallback(
    (repoName: string, repoId: string, path: string) => {
      const normalized = normalizePath(path);
      setSelections((prev) => {
        const current = prev[repoId];
        if (current) {
          if (!current.selectedPaths.includes(normalized)) {
            return {
              ...prev,
              [repoId]: {
                ...current,
                selectedPaths: [...current.selectedPaths, normalized],
              },
            };
          }
          return prev;
        }
        // Create new entry if it doesn't exist
        const newSelections = { ...prev };
        const repoIds = Object.keys(newSelections);
        if (repoIds.length >= MAX_REPOS) {
          const firstKey = repoIds[0];
          delete newSelections[firstKey];
        }
        return {
          ...newSelections,
          [repoId]: {
            repoId,
            repoName,
            selectedPaths: [normalized],
          },
        };
      });
    },
    []
  );

  const removePath = useCallback((repoName: string, repoId: string, path: string) => {
    const normalized = normalizePath(path);
    setSelections((prev) => {
      const current = prev[repoId];
      if (!current) return prev;
      return {
        ...prev,
        [repoId]: {
          ...current,
          selectedPaths: current.selectedPaths.filter((p) => p !== normalized),
        },
      };
    });
  }, []);

  const clearRepo = useCallback((repoId: string) => {
    setSelections((prev) => {
      const newSelections = { ...prev };
      delete newSelections[repoId];
      return newSelections;
    });
  }, []);

  const getSelectedPaths = useCallback(
    (repoId: string): string[] => {
      return selections[repoId]?.selectedPaths || [];
    },
    [selections]
  );

  const isPathSelected = useCallback(
    (repoId: string, path: string): boolean => {
      const normalized = normalizePath(path);
      return selections[repoId]?.selectedPaths.includes(normalized) || false;
    },
    [selections]
  );

  return (
    <GoldenRepoSelectionContext.Provider
      value={{
        selections,
        setSelection,
        addPath,
        removePath,
        clearRepo,
        getSelectedPaths,
        isPathSelected,
      }}
    >
      {children}
    </GoldenRepoSelectionContext.Provider>
  );
}

export function useGoldenRepoSelection() {
  const context = useContext(GoldenRepoSelectionContext);
  if (context === undefined) {
    throw new Error(
      "useGoldenRepoSelection must be used within a GoldenRepoSelectionProvider"
    );
  }
  return context;
}

