import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  File,
  FilePlus,
  FileText,
  ListTodo,
  Lock,
  Plus,
  Terminal,
  X,
} from "lucide-react";
import type { Session } from "../hooks/types";
import { deleteScratchFile } from "../hooks/apiClient";
import { useToast } from "../hooks/useToast";
import { Modal } from "./Modal";
import { ResumeButton } from "./ResumeButton";
import type { Tab } from "./SessionViewer";

const MAIN_TABS: {
  tab: "session" | "diff" | "plan" | "summary" | "todos";
  label: string;
  icon: ReactNode;
}[] = [
  { tab: "session", label: "Session", icon: <Bot size={14} /> },
  { tab: "diff", label: "Diff", icon: <FileText size={14} /> },
  { tab: "plan", label: "Plan", icon: <ListTodo size={14} /> },
  { tab: "summary", label: "Summary", icon: <BarChart3 size={14} /> },
  { tab: "todos", label: "TODOs", icon: <BarChart3 size={14} /> },
];

interface SessionTabBarProps {
  session: Session;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  openScratchTabs: string[];
  scratchFileMap: Record<string, { title: string; mode: string; sessionId: string }>;
  onCloseScratchTab: (fileId: string) => void;
  onNewScratchFile?: () => void;
  onRenameScratchFile?: (fileId: string, newTitle: string) => void;
  messageCount: { user: number; assistant: number; total: number };
}

export function SessionTabBar({
  session,
  activeTab,
  onTabChange,
  openScratchTabs,
  scratchFileMap,
  onCloseScratchTab,
  onNewScratchFile,
  onRenameScratchFile,
  messageCount,
}: SessionTabBarProps) {
  const { showErrorToast } = useToast();
  const [createFileOpen, setCreateFileOpen] = useState(false);
  const [deleteConfirmFileId, setDeleteConfirmFileId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const tabIcon = (tab: Tab): ReactNode => {
    if (tab === "session") return <Bot size={14} />;
    if (tab === "diff") return <FileText size={14} />;
    if (tab === "plan") return <ListTodo size={14} />;
    if (tab === "summary") return <BarChart3 size={14} />;
    if (tab === "terminal") return <Terminal size={14} />;
    if (tab.startsWith("scratch:")) return <File size={14} />;
    return null;
  };

  const scratchTabLabel = (fileId: string): string => {
    const info = scratchFileMap[fileId];
    return info?.title || "Untitled";
  };

  return (
    <>
      <div className="flex items-center gap-1 px-4 py-2 border-b border-ov-border shrink-0 overflow-x-auto">
        {MAIN_TABS.map(
          (meta) =>
            (meta.tab !== "diff" || !session.parentId) &&
            (meta.tab !== "todos" || (session.todos && session.todos.length > 0)) && (
              <button
                key={meta.tab}
                type="button"
                className={`sess-tab-pill shrink-0 ${activeTab === meta.tab ? "sess-tab-pill--active" : ""}`}
                onClick={() => onTabChange(meta.tab)}
              >
                {meta.icon}
                {meta.label}
                {meta.tab === "session" && messageCount.total > 0 && (
                  <span className="text-[11px] opacity-70 tabular-nums">{messageCount.total}</span>
                )}
                {meta.tab === "diff" && session.diffFiles > 0 && (
                  <span className="text-[11px] opacity-70 tabular-nums">
                    {session.diffFiles}f
                    {session.diffAdditions > 0 && (
                      <span className="text-green-500 ml-0.5">+{session.diffAdditions}</span>
                    )}
                    {session.diffDeletions > 0 && (
                      <span className="text-red-500 ml-0.5">-{session.diffDeletions}</span>
                    )}
                  </span>
                )}
              </button>
            ),
        )}
        {(openScratchTabs.length > 0 || !session.parentId) && (
          <div className="w-px h-4 bg-ov-border mx-1 shrink-0" />
        )}
        {openScratchTabs.map((fid) => {
          const tab: Tab = `scratch:${fid}`;
          const info = scratchFileMap[fid];
          const isReadOnly = info?.mode === "readonly";
          const isRenaming = renamingFileId === fid;
          return (
            <button
              key={fid}
              type="button"
              className={`sess-tab-pill shrink-0 ${activeTab === tab ? "sess-tab-pill--active" : ""}`}
              onClick={() => {
                if (!isRenaming) onTabChange(tab);
              }}
            >
              {isReadOnly ? <Lock size={12} /> : tabIcon(tab)}
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = renameValue.trim();
                    if (trimmed && trimmed !== scratchTabLabel(fid)) {
                      onRenameScratchFile?.(fid, trimmed);
                    }
                    setRenamingFileId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === "Escape") {
                      setRenamingFileId(null);
                    }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 text-[11px] bg-ov-bg-hover border border-accent-border rounded px-1 outline-none"
                />
              ) : (
                <span
                  className="truncate max-w-28"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenameValue(scratchTabLabel(fid));
                    setRenamingFileId(fid);
                  }}
                >
                  {scratchTabLabel(fid)}
                </span>
              )}
              <span
                role="button"
                className="ml-1 text-ov-text-secondary hover:text-ov-text cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmFileId(fid);
                }}
              >
                <X size={12} />
              </span>
            </button>
          );
        })}
        {!session.parentId && (
          <button
            type="button"
            onClick={() => setCreateFileOpen(true)}
            className="sess-tab-pill text-ov-text-secondary hover:text-ov-text shrink-0"
            title="New scratch file"
          >
            <Plus size={14} />
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ResumeButton sessionId={session.id} />
          {!session.parentId && (
            <button
              type="button"
              className={`size-7 flex items-center justify-center rounded shrink-0 cursor-pointer transition-colors ${
                activeTab === "terminal"
                  ? "sess-tab-pill--active"
                  : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
              }`}
              onClick={() => onTabChange("terminal")}
              title="Terminal"
            >
              <Terminal size={14} />
            </button>
          )}
        </div>
      </div>

      <Modal
        isOpen={createFileOpen}
        onClose={() => setCreateFileOpen(false)}
        title="Create new scratch file"
        size="md"
      >
        <div className="p-3 space-y-1">
          <button
            type="button"
            onClick={() => {
              setCreateFileOpen(false);
              onNewScratchFile?.();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-ov-text hover:bg-ov-bg-hover transition-colors cursor-pointer text-left border border-transparent hover:border-accent-border"
          >
            <FilePlus size={20} className="shrink-0 text-accent" />
            <div className="flex flex-col">
              <span className="font-medium">Scratch file</span>
              <span className="text-[11px] text-ov-text-secondary">
                Markdown (.md) — Rich text editor
              </span>
            </div>
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={deleteConfirmFileId !== null}
        onClose={() => setDeleteConfirmFileId(null)}
        title="Delete scratch file"
        size="md"
      >
        <div className="p-3 space-y-3">
          <p className="text-sm text-ov-text-secondary">
            Are you sure you want to delete this scratch file? This action cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmFileId(null)}
              className="px-3 py-1.5 text-xs rounded-md text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!deleteConfirmFileId) return;
                try {
                  await deleteScratchFile(session.id, deleteConfirmFileId);
                } catch (err) {
                  showErrorToast(err, "Failed to delete scratch note");
                }
                onCloseScratchTab(deleteConfirmFileId);
                setDeleteConfirmFileId(null);
              }}
              className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-500 cursor-pointer transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
