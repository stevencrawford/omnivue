import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { themeMode, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className="sess-icon-btn"
      onClick={toggleTheme}
      aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={themeMode === "dark"}
      title="Toggle theme"
    >
      {themeMode === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
