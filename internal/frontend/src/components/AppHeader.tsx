import { X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";

interface AppHeaderProps {
  showOverview: boolean;
  searchHighlightQuery: string | null;
  onGoHome: () => void;
  onOpenSearch: () => void;
  onClearSearchHighlight: () => void;
}

export function AppHeader({
  showOverview,
  searchHighlightQuery,
  onGoHome,
  onOpenSearch,
  onClearSearchHighlight,
}: AppHeaderProps) {
  const isMac = typeof navigator !== "undefined" && navigator.platform?.includes("Mac");

  return (
    <header className="sess-glass h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 border-b border-ov-header-border">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant={showOverview ? "secondary" : "ghost"}
          size="sm"
          onClick={onGoHome}
          className={`-ml-1.5 ${showOverview ? "" : "hover:bg-ov-bg-hover text-ov-text"}`}
          title="Overview"
        >
          <svg
            className="size-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6,18 Q9,14 12,10" opacity="0.4" />
            <path d="M9,19 Q10.5,15 12,10" opacity="0.7" />
            <path d="M15,19 Q13.5,15 12,10" opacity="0.7" />
            <path d="M18,18 Q15,14 12,10" opacity="0.4" />
            <path d="M7,12 Q8.5,4 12,4 Q15.5,4 17,12 L16,12 Q12,8 8,12 Z" />
            <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          <h1 className="text-sm font-semibold tracking-tight">Omnivue</h1>
        </Button>
      </div>

      <button
        type="button"
        className={`sess-search-trigger ${searchHighlightQuery ? "sess-search-active" : ""}`}
        onClick={onOpenSearch}
      >
        <svg className="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
        </svg>
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
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation();
              onClearSearchHighlight();
            }}
            className="text-ov-text-secondary hover:text-ov-text shrink-0"
          >
            <X />
          </Button>
        )}
        <span className="sess-kbd">{isMac ? "⌘" : "Ctrl"}F</span>
      </button>

      <div className="flex items-center justify-end gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
