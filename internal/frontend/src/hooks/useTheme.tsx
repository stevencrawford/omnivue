import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { STORAGE_KEYS } from "../utils/storageKeys";

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
export type ThemeContrast = "default" | "high";

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
    const stored = localStorage.getItem(STORAGE_KEYS.THEME);
    if (stored && isThemeName(stored)) return stored;
    if (stored === "light" || stored === "dark") return "github";
  } catch {
    /* localStorage throws SecurityError in restricted contexts */
  }
  return "github";
}

function getInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.MODE);
    if (stored === "light" || stored === "dark") return stored;
    const old = localStorage.getItem(STORAGE_KEYS.THEME);
    if (old === "light" || old === "dark") return old;
  } catch {
    /* localStorage throws SecurityError in restricted contexts */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** High contrast follows the OS `prefers-contrast: more` preference unless the user overrides. */
function getInitialContrast(): ThemeContrast {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CONTRAST);
    if (stored === "default" || stored === "high") return stored;
  } catch {
    /* localStorage throws SecurityError in restricted contexts */
  }
  return window.matchMedia("(prefers-contrast: more)").matches ? "high" : "default";
}

interface ThemeContextValue {
  themeName: ThemeName;
  themeMode: ThemeMode;
  contrast: ThemeContrast;
  setThemeName: (name: ThemeName) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setContrast: (contrast: ThemeContrast) => void;
  toggleTheme: () => void;
  toggleContrast: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(getInitialThemeName);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [contrast, setContrast] = useState<ThemeContrast>(getInitialContrast);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeName);
    document.documentElement.setAttribute("data-mode", themeMode);
    document.documentElement.setAttribute("data-contrast", contrast);
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, themeName);
      localStorage.setItem(STORAGE_KEYS.MODE, themeMode);
      localStorage.setItem(STORAGE_KEYS.CONTRAST, contrast);
    } catch {
      /* localStorage throws SecurityError in restricted contexts */
    }
  }, [themeName, themeMode, contrast]);

  const toggleTheme = () => setThemeMode((t) => (t === "dark" ? "light" : "dark"));
  const toggleContrast = () => setContrast((c) => (c === "high" ? "default" : "high"));

  return (
    <ThemeContext.Provider
      value={{
        themeName,
        themeMode,
        contrast,
        setThemeName,
        setThemeMode,
        setContrast,
        toggleTheme,
        toggleContrast,
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
