import { useCallback, useState } from "react";
import type { Message, ScratchFile, Session } from "../../hooks/types";
import { useResizable } from "../../hooks/useResizable";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../../utils/storageKeys";
import type { FileAccess } from "../../utils/fileAccess";
import type { MergedFileDiff } from "../../utils/diffTree";
import { FileAccessTree } from "./FileAccessTree";
import { FileDetail } from "./FileDetail";
import { ConsolePane } from "./ConsolePane";
import { ScratchEditor } from "../ScratchEditor";

const TREE_DEFAULT_WIDTH = 280;
const CONSOLE_DEFAULT_HEIGHT = 260;

interface DiffsPanelProps {
  session: Session;
  messages: Message[];
  cursor: number;
  maxIndex: number;
  selectedSpan: { start: number; end: number; trailing: boolean } | null;
  treeAccesses: FileAccess[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
  scratchFiles: ScratchFile[];
  selectedScratchId: string | null;
  onSelectScratch: (id: string) => void;
  onNewScratch?: () => void;
  onRenameScratch: (id: string, title: string) => void;
  onDeleteScratch: (id: string) => void;
  selectedAccess: FileAccess | null;
  selectedMergedDiff: MergedFileDiff | null;
  onJump: (messageIndex: number, messageId?: string) => void;
  onOpenMarkdown: () => void;
}

/**
 * The old centre column as a single tab: file-access tree, selected file/diff
 * (or scratch editor), and the timeline-synced console.
 */
export function DiffsPanel({
  session,
  messages,
  cursor,
  maxIndex,
  selectedSpan,
  treeAccesses,
  selectedPath,
  onSelectFile,
  scratchFiles,
  selectedScratchId,
  onSelectScratch,
  onNewScratch,
  onRenameScratch,
  onDeleteScratch,
  selectedAccess,
  selectedMergedDiff,
  onJump,
  onOpenMarkdown,
}: DiffsPanelProps) {
  const { value: treeWidth, startResize: startTreeResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_TREE_WIDTH,
    axis: "horizontal",
    min: 180,
    max: 700,
    defaultValue: TREE_DEFAULT_WIDTH,
  });
  const { value: consoleHeight, startResize: startConsoleResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_CONSOLE_HEIGHT,
    axis: "vertical",
    min: 140,
    max: 650,
    defaultValue: CONSOLE_DEFAULT_HEIGHT,
  });
  const [consoleCollapsed, setConsoleCollapsed] = useState(
    () => getStorageItem(STORAGE_KEYS.CINEMATIC_CONSOLE_COLLAPSED) === "true",
  );

  const toggleConsole = useCallback(() => {
    setConsoleCollapsed((v) => {
      const next = !v;
      setStorageItem(STORAGE_KEYS.CINEMATIC_CONSOLE_COLLAPSED, String(next));
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden min-w-0">
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div
          className="shrink-0 overflow-hidden flex flex-col border-r border-ov-border"
          style={{ width: treeWidth }}
        >
          <FileAccessTree
            accesses={treeAccesses}
            selectedPath={selectedPath}
            onSelect={onSelectFile}
            scratchFiles={scratchFiles}
            selectedScratchId={selectedScratchId}
            onSelectScratch={onSelectScratch}
            onNewScratch={onNewScratch}
            onRenameScratch={onRenameScratch}
            onDeleteScratch={onDeleteScratch}
          />
        </div>
        <div
          className="w-1 shrink-0 bg-ov-border hover:bg-accent cursor-col-resize transition-colors relative"
          onMouseDown={startTreeResize}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
        {selectedScratchId ? (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <ScratchEditor
              key={selectedScratchId}
              sessionId={session.id}
              fileId={selectedScratchId}
            />
          </div>
        ) : (
          <FileDetail
            access={selectedAccess}
            fileName={selectedPath.split("/").pop() || selectedPath}
            mergedDiff={selectedMergedDiff}
            sessionDirectory={session.directory}
            onJump={onJump}
            onOpenMarkdown={onOpenMarkdown}
          />
        )}
      </div>

      {!consoleCollapsed && (
        <div
          className="h-1 shrink-0 bg-ov-border hover:bg-accent cursor-row-resize transition-colors relative"
          onMouseDown={startConsoleResize}
          title="Drag to resize console"
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
        </div>
      )}
      <div
        className="shrink-0 overflow-hidden flex flex-col"
        style={{ height: consoleCollapsed ? 36 : consoleHeight }}
      >
        <ConsolePane
          session={session}
          messages={messages}
          cursor={cursor}
          maxIndex={maxIndex}
          selectedSpan={selectedSpan ?? undefined}
          collapsed={consoleCollapsed}
          onToggleCollapse={toggleConsole}
        />
      </div>
    </div>
  );
}
