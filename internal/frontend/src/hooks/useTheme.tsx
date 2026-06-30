import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeName = "default" | "nord" | "catppuccin" | "tokyo-night" | "github";
export type ThemeMode = "light" | "dark";

export const THEMES: { name: ThemeName; label: string; description: string }[] = [
  { name: "default", label: "Ayu", description: "Warm earthy tones" },
  { name: "nord", label: "Nord", description: "Cool arctic blues" },
  { name: "catppuccin", label: "Catppuccin", description: "Warm pastel tones" },
  { name: "tokyo-night", label: "Tokyo Night", description: "Deep blue night" },
  { name: "github", label: "GitHub", description: "GitHub's official palette" },
];

const THEME_NAMES: ThemeName[] = ["default", "nord", "catppuccin", "tokyo-night", "github"];

function getInitialThemeName(): ThemeName {
  const stored = localStorage.getItem("omnivue-theme");
  if (THEME_NAMES.includes(stored as ThemeName)) return stored as ThemeName;
  if (stored === "light" || stored === "dark") return "default";
  return "default";
}

function getInitialThemeMode(): ThemeMode {
  const stored = localStorage.getItem("omnivue-mode");
  if (stored === "light" || stored === "dark") return stored;
  const old = localStorage.getItem("omnivue-theme");
  if (old === "light" || old === "dark") return old;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeContextValue {
  themeName: ThemeName;
  themeMode: ThemeMode;
  setThemeName: (name: ThemeName) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(getInitialThemeName);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeName);
    document.documentElement.setAttribute("data-mode", themeMode);
    localStorage.setItem("omnivue-theme", themeName);
    localStorage.setItem("omnivue-mode", themeMode);
  }, [themeName, themeMode]);

  const toggleTheme = () => setThemeMode((t) => (t === "dark" ? "light" : "dark"));
  const setTheme = (t: ThemeMode) => setThemeMode(t);

  return (
    <ThemeContext.Provider
      value={{
        themeName,
        themeMode,
        setThemeName,
        setThemeMode,
        toggleTheme,
        theme: themeMode,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
