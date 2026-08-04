import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeName =
  | "default"
  | "nord"
  | "catppuccin"
  | "tokyo-night"
  | "github"
  | "one-monokai"
  | "atom-one"
  | "dracula"
  | "night-owl";
export type ThemeMode = "light" | "dark";

export const THEME_OPTIONS: { value: ThemeName; label: string; description: string }[] = [
  { value: "default", label: "Ayu", description: "Warm earthy tones" },
  { value: "nord", label: "Nord", description: "Cool arctic blues" },
  { value: "catppuccin", label: "Catppuccin", description: "Warm pastel tones" },
  { value: "tokyo-night", label: "Tokyo Night", description: "Deep blue night" },
  { value: "github", label: "GitHub", description: "GitHub's official palette" },
  { value: "one-monokai", label: "One Monokai", description: "Vibrant warm contrast" },
  { value: "atom-one", label: "Atom One", description: "Clean classic palette" },
  { value: "dracula", label: "Dracula", description: "Deep purple darkness" },
  { value: "night-owl", label: "Night Owl", description: "Soft nocturnal tones" },
];

const THEME_NAMES: readonly ThemeName[] = THEME_OPTIONS.map((t) => t.value);

/** Type predicate — narrows string to ThemeName at runtime. */
function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value);
}

function getInitialThemeName(): ThemeName {
  try {
    const stored = localStorage.getItem("omnivue-theme");
    if (stored && isThemeName(stored)) return stored;
    if (stored === "light" || stored === "dark") return "github";
  } catch {
    /* localStorage throws SecurityError in restricted contexts */
  }
  return "github";
}

function getInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem("omnivue-mode");
    if (stored === "light" || stored === "dark") return stored;
    const old = localStorage.getItem("omnivue-theme");
    if (old === "light" || old === "dark") return old;
  } catch {
    /* localStorage throws SecurityError in restricted contexts */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeContextValue {
  themeName: ThemeName;
  themeMode: ThemeMode;
  setThemeName: (name: ThemeName) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(getInitialThemeName);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeName);
    document.documentElement.setAttribute("data-mode", themeMode);
    try {
      localStorage.setItem("omnivue-theme", themeName);
      localStorage.setItem("omnivue-mode", themeMode);
    } catch {
      /* localStorage throws SecurityError in restricted contexts */
    }
  }, [themeName, themeMode]);

  const toggleTheme = () => setThemeMode((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider
      value={{
        themeName,
        themeMode,
        setThemeName,
        setThemeMode,
        toggleTheme,
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
