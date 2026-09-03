import { Search, X, Sparkles } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useCinematicMode } from "../hooks/useCinematicMode";

interface AppHeaderProps {
  showOverview: boolean;
  searchHighlightQuery: string | null;
  connected: boolean;
  version?: string;
  onGoHome: () => void;
  onOpenSearch: () => void;
  onClearSearchHighlight: () => void;
}

export function AppHeader({
  showOverview,
  searchHighlightQuery,
  connected,
  version,
  onGoHome,
  onOpenSearch,
  onClearSearchHighlight,
}: AppHeaderProps) {
  const isMac = typeof navigator !== "undefined" && navigator.platform?.includes("Mac");
  let cinematicEnabled = false;
  let setCinematicEnabled: (v: boolean) => void = () => {};
  try {
    const cinematic = useCinematicMode();
    cinematicEnabled = cinematic.enabled;
    setCinematicEnabled = cinematic.setEnabled;
  } catch {
    // Outside CinematicModeProvider (e.g. isolated header test) — fallback to disabled
  }

  return (
    <header className="sess-glass h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 border-b border-ov-header-border">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onGoHome}
          className={`flex items-center gap-1.5 min-w-0 rounded-md px-1.5 py-1 -ml-1.5 transition-colors cursor-pointer ${
            showOverview ? "text-accent bg-accent-muted" : "hover:bg-ov-bg-hover text-ov-text"
          }`}
          title="Overview"
        >
          <svg className="size-5 shrink-0" viewBox="120 80 272 390" aria-hidden="true">
            <defs>
              <mask id="lens">
                <rect x="0" y="0" width="512" height="512" fill="white" />
                <circle cx="262" cy="238" r="6" fill="black" />
              </mask>
            </defs>
            <g
              transform="translate(0, 15)"
              fill="none"
              stroke="currentColor"
              strokeWidth="20"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M140,410 Q210,320 256,230" opacity="0.4" />
              <path d="M215,430 Q240,340 256,230" opacity="0.7" />
              <path d="M297,430 Q272,340 256,230" opacity="0.7" />
              <path d="M372,410 Q302,320 256,230" opacity="0.4" />
              <path d="M170,255 Q195,100 256,100 Q317,100 342,255 L322,255 Q256,190 190,255 Z" />
            </g>
            <circle cx="256" cy="245" r="22" fill="currentColor" mask="url(#lens)" />
          </svg>
          <h1 className="text-sm font-semibold tracking-tight">Omnivue</h1>
          {version && (
            <span
              className="text-[11px] leading-none whitespace-nowrap text-ov-text-secondary/80 select-none"
              title="Running version"
            >
              v{version}
            </span>
          )}
        </button>
      </div>

      <button
        type="button"
        className={`sess-search-trigger ${searchHighlightQuery ? "sess-search-active" : ""}`}
        onClick={onOpenSearch}
      >
        <Search size={14} className="shrink-0 opacity-60" />
        <span className="flex-1 text-left truncate">
          {searchHighlightQuery ? (
            <span className="text-accent font-medium">
              Search: &ldquo;{searchHighlightQuery}&rdquo;
            </span>
          ) : (
            "Search sessions, tool calls, plans, and scratch files..."
          )}
        </span>
        {searchHighlightQuery && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearSearchHighlight();
            }}
            className="size-4 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer shrink-0"
          >
            <X size={12} />
          </span>
        )}
        <span className="sess-kbd">{isMac ? "⌘" : "Ctrl"}K</span>
      </button>

      <div className="flex items-center justify-end gap-2">
        <div className="hidden sm:flex items-center gap-2 pl-2 pr-1 py-1 rounded-full border border-ov-border bg-ov-bg-secondary">
          <Sparkles
            size={14}
            className={cinematicEnabled ? "text-accent" : "text-ov-text-secondary"}
          />
          <span className="text-xs font-medium whitespace-nowrap">Studio</span>
          <button
            type="button"
            role="switch"
            aria-checked={cinematicEnabled}
            aria-label="Toggle Studio view"
            title={
              cinematicEnabled
                ? "Studio view enabled — click to switch to tabs"
                : "Try Studio view (Preview)"
            }
            onClick={() => setCinematicEnabled(!cinematicEnabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${cinematicEnabled ? "bg-accent" : "bg-ov-bg-active"} cursor-pointer`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${cinematicEnabled ? "left-[18px]" : "left-0.5"}`}
            />
          </button>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cinematicEnabled}
          aria-label="Toggle Studio view"
          onClick={() => setCinematicEnabled(!cinematicEnabled)}
          className="sm:hidden flex items-center gap-1.5 px-2 py-1.5 rounded-full border border-ov-border bg-ov-bg-secondary cursor-pointer"
          title={cinematicEnabled ? "Studio view enabled" : "Try Studio view (Preview)"}
        >
          <Sparkles
            size={14}
            className={cinematicEnabled ? "text-accent" : "text-ov-text-secondary"}
          />
          <span
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${cinematicEnabled ? "bg-accent" : "bg-ov-bg-active"}`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${cinematicEnabled ? "left-[14px]" : "left-0.5"}`}
            />
          </span>
        </button>
        <span
          aria-hidden="true"
          title={connected ? "Connected to omnivue server" : "Server unreachable - reconnecting"}
          className={`sess-conn-dot ${connected ? "sess-conn-dot--on" : "sess-conn-dot--off"}`}
        />
        <ThemeToggle />
      </div>
    </header>
  );
}
