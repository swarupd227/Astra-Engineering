import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface ColorScheme {
  id: string;
  name: string;
  background: string;
  accent: string;
}

export const colorSchemes: ColorScheme[] = [
  {
    id: "devx-blue",
    name: "Astra Blue",
    background: "#ffffff",
    accent: "#4f46e5",
  },
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    background: "#ffffff",
    accent: "#3b82f6",
  },
  {
    id: "deep-pink",
    name: "Deep Pink",
    background: "#ffffff",
    accent: "#ec4899",
  },
  {
    id: "forest-green",
    name: "Forest Green",
    background: "#ffffff",
    accent: "#10b981",
  },
  {
    id: "sunset-orange",
    name: "Sunset Orange",
    background: "#ffffff",
    accent: "#f97316",
  },
];

interface ThemeContextType {
  currentTheme: ColorScheme;
  setTheme: (themeId: string) => void;
  isDark: boolean;
  toggleDarkMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0 0% 0%";
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);
  
  return `${h} ${s}% ${l}%`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<ColorScheme>(() => {
    const saved = localStorage.getItem("selectedTheme");
    return colorSchemes.find((t) => t.id === saved) || colorSchemes[0];
  });

  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("isDarkMode");
    return saved === null ? false : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("selectedTheme", currentTheme.id);
    
    const accentHSL = hexToHSL(currentTheme.accent);
    document.documentElement.style.setProperty("--theme-accent", accentHSL);
    
    document.documentElement.style.transition = "background-color 0.3s ease, color 0.3s ease";
  }, [currentTheme]);

  useEffect(() => {
    localStorage.setItem("isDarkMode", String(isDark));
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const setTheme = (themeId: string) => {
    const theme = colorSchemes.find((t) => t.id === themeId);
    if (theme) {
      setCurrentTheme(theme);
    }
  };

  const toggleDarkMode = () => {
    setIsDark((prev) => !prev);
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, isDark, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
