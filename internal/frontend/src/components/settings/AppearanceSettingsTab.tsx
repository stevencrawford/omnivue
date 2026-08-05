import { useTheme, THEME_OPTIONS } from "../../hooks/useTheme";
import type { ThemeName, ThemeMode, ThemeContrast } from "../../hooks/useTheme";
import { setConfig } from "../../hooks/apiClient";

const THEME_PREVIEWS: Record<ThemeName, { light: string[]; dark: string[] }> = {
  default: {
    light: ["#fafafa", "#ffffff", "#ff9940", "#399ee6"],
    dark: ["#0b0e14", "#131721", "#ffad66", "#39bae6"],
  },
  nord: {
    light: ["#f2f4f8", "#ffffff", "#5e81ac", "#88c0d0"],
    dark: ["#2e3440", "#3b4252", "#81a1c1", "#88c0d0"],
  },
  catppuccin: {
    light: ["#eff1f5", "#ffffff", "#8839ef", "#ea76cb"],
    dark: ["#1e1e2e", "#313244", "#cba6f7", "#f5c2e7"],
  },
  "tokyo-night": {
    light: ["#d5d6db", "#ffffff", "#2e7de9", "#41a6b5"],
    dark: ["#24283b", "#2f3346", "#7aa2f7", "#73daca"],
  },
  github: {
    light: ["#ffffff", "#f6f8fa", "#0969da", "#1f883d"],
    dark: ["#0d1117", "#151b23", "#58a6ff", "#3fb950"],
  },
  "one-monokai": {
    light: ["#f8f9fa", "#ffffff", "#e53b50", "#78dce8"],
    dark: ["#2d2d2d", "#363636", "#ff6188", "#a9dc76"],
  },
  "atom-one": {
    light: ["#fafafa", "#ffffff", "#4078f2", "#50a14f"],
    dark: ["#282c34", "#21252b", "#61afef", "#98c379"],
  },
  dracula: {
    light: ["#f8f8f2", "#ffffff", "#ff79c6", "#8be9fd"],
    dark: ["#282a36", "#21222c", "#ff79c6", "#8be9fd"],
  },
  "night-owl": {
    light: ["#fbfbfb", "#ffffff", "#0c6e9d", "#4f7e65"],
    dark: ["#011627", "#0b1e2e", "#82aaff", "#7fdbca"],
  },
};

export function AppearanceSettingsTab() {
  const { themeName, setThemeName, themeMode, setThemeMode, contrast, setContrast } = useTheme();

  const handleThemeNameChange = async (name: ThemeName) => {
    setThemeName(name);
    try {
      await setConfig("theme-name", name);
    } catch {
      /* ignore */
    }
  };

  const handleThemeModeChange = async (mode: ThemeMode) => {
    setThemeMode(mode);
    try {
      await setConfig("theme-mode", mode);
    } catch {
      /* ignore */
    }
  };

  const handleContrastChange = async (value: ThemeContrast) => {
    setContrast(value);
    try {
      await setConfig("theme-contrast", value);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Appearance
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Customize the look and feel of your Omnivue interface.
      </p>

      <p className="text-[11px] font-medium text-ov-text-secondary mb-2">Theme</p>
      <div className="grid grid-cols-2 gap-2">
        {THEME_OPTIONS.map((t) => {
          const isActive = themeName === t.value;
          const cols = THEME_PREVIEWS[t.value][themeMode];
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => handleThemeNameChange(t.value)}
              className={`rounded-lg border overflow-hidden cursor-pointer transition-colors ${
                isActive
                  ? "border-accent-border"
                  : "border-ov-border hover:border-ov-text-secondary"
              }`}
            >
              <div className="flex flex-col">
                {cols.map((c, i) => (
                  <div
                    key={i}
                    className="w-full"
                    style={{
                      backgroundColor: c,
                      height: i < 2 ? 12 : 8,
                    }}
                  />
                ))}
              </div>
              <div
                className={`px-2.5 py-1.5 text-xs text-left ${
                  isActive
                    ? "bg-accent-muted text-ov-text font-medium"
                    : "bg-ov-bg-secondary text-ov-text-secondary"
                }`}
              >
                {t.label}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] font-medium text-ov-text-secondary mt-3 mb-2">Mode</p>
      <div className="flex items-center gap-3">
        {(["light", "dark"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleThemeModeChange(m)}
            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer capitalize transition-colors ${
              themeMode === m
                ? "border-accent-border bg-accent-muted text-accent"
                : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-ov-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ov-text">High contrast</p>
          <p className="text-[11px] text-ov-text-secondary">
            Stronger colors for reduced-vision accessibility. Defaults to your system preference.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={contrast === "high"}
          onClick={() => handleContrastChange(contrast === "high" ? "default" : "high")}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${
            contrast === "high" ? "bg-accent" : "bg-ov-bg-active"
          }`}
        >
          <span
            className={`absolute top-0.5 size-4 rounded-full bg-ov-bg-secondary shadow transition-all ${
              contrast === "high" ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
