import { useMemo, useState } from "react";
import type { Session } from "../hooks/useApi";
import { buildTree, relativeTime, formatCost } from "../utils/buildTree";
import type { TreeNode } from "../utils/buildTree";
import { SearchPanel } from "./SearchPanel";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

const SIDEBAR_WIDTH_KEY = "sess-sidebar-width";
const COLLAPSED_KEY = "sess-sidebar-collapsed";

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) return Math.max(200, Math.min(600, Number(stored)));
  } catch {
    /* ignore */
  }
  return 300;
}

function getInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    /* ignore */
  }
  return new Set();
}

export function Sidebar({ sessions, activeSessionId, onSessionSelect }: SidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [collapsed, setCollapsed] = useState<Set<string>>(getInitialCollapsed);
  const [isResizing, setIsResizing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const tree = useMemo(() => buildTree(sessions), [sessions]);

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch {
        /* ignore */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <aside
      className="flex flex-col border-r border-gh-border bg-gh-bg-sidebar overflow-hidden shrink-0"
      style={{ width: `${width}px` }}
    >
      {/* Search toggle bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gh-border">
        <button
          type="button"
          className={`flex items-center gap-1.5 flex-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
            searchOpen
              ? "bg-gh-bg-active text-gh-text"
              : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
          }`}
          onClick={() => setSearchOpen((v) => !v)}
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
          </svg>
          <span>Search</span>
        </button>
      </div>
      {searchOpen ? (
        <SearchPanel
          onSelectSession={(id) => {
            onSessionSelect(id);
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {tree.length === 0 ? (
            <div className="text-xs text-gh-text-secondary p-2">No sessions</div>
          ) : (
            tree.map((node) => (
              <RepoNode
                key={node.fullPath}
                node={node}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
                activeSessionId={activeSessionId}
                onSessionSelect={onSessionSelect}
              />
            ))
          )}
        </div>
      )}
      {/* Resize handle */}
      <div
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400/50 transition-colors ${isResizing ? "bg-blue-400/50" : ""}`}
        style={{ left: `${width - 2}px`, position: "fixed", height: "100vh", top: 0 }}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}

interface RepoNodeProps {
  node: TreeNode;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

function RepoNode({
  node,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onSessionSelect,
}: RepoNodeProps) {
  const isCollapsed = collapsed.has(node.fullPath);

  return (
    <div className="mb-1">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs font-medium text-gh-text-secondary hover:bg-gh-bg-hover cursor-pointer"
        onClick={() => onToggleCollapse(node.fullPath)}
      >
        <svg
          className={`size-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[10px] text-gh-text-secondary">
          {node.children.length}
        </span>
      </button>
      {!isCollapsed && (
        <div className="ml-2 border-l border-gh-border">
          {node.children.map((child) => (
            <SessionNode
              key={child.session!.id}
              session={child.session!}
              isActive={child.session!.id === activeSessionId}
              onSelect={() => onSessionSelect(child.session!.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SessionNodeProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
}

function SessionNode({ session, isActive, onSelect }: SessionNodeProps) {
  return (
    <button
      type="button"
      className={`flex flex-col gap-0.5 w-full px-3 py-1.5 text-left rounded-sm cursor-pointer transition-colors ${
        isActive
          ? "bg-gh-bg-active text-gh-text"
          : "text-gh-text-secondary hover:bg-gh-bg-hover hover:text-gh-text"
      }`}
      onClick={onSelect}
      title={session.directory}
    >
      <div className="flex items-center gap-1.5 w-full">
        <AgentBadge agent={session.agent} />
        <span className="text-xs truncate flex-1">
          {session.title || session.id.slice(0, 12)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-gh-text-secondary pl-5">
        <span>{relativeTime(session.updatedAt)}</span>
        {session.model && (
          <span className="truncate max-w-[80px]">{shortModel(session.model)}</span>
        )}
        {session.cost > 0 && <span>{formatCost(session.cost)}</span>}
      </div>
    </button>
  );
}

function AgentBadge({ agent }: { agent: string }) {
  const colors: Record<string, string> = {
    opencode: "bg-purple-500/20 text-purple-400",
    copilot: "bg-blue-500/20 text-blue-400",
  };
  const cls = colors[agent] || "bg-gray-500/20 text-gray-400";
  return (
    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${cls}`}>
      {agent === "opencode" ? "OC" : agent === "copilot" ? "CP" : agent.slice(0, 2)}
    </span>
  );
}

function shortModel(model: string): string {
  // "claude-opus-4.6" -> "opus-4.6"
  // "gpt-4o" -> "gpt-4o"
  return model.replace("claude-", "").replace("openai/", "");
}
