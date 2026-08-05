import { Sun, Moon, Contrast } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { themeMode, contrast, toggleTheme, toggleContrast } = useTheme();

  return (
    <>
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
      <button
        type="button"
        className={`sess-icon-btn ${contrast === "high" ? "sess-icon-btn--active" : ""}`}
        onClick={toggleContrast}
        aria-label={
          contrast === "high" ? "Disable high contrast mode" : "Enable high contrast mode"
        }
        aria-pressed={contrast === "high"}
        title="Toggle high contrast mode"
      >
        <Contrast size={20} />
      </button>
    </>
  );
}
