import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, Bookmark } from "../hooks/useApi";
import { IconChannel } from "./IconChannel";
import type { Section } from "./IconChannel";
import { SessionPanel } from "./SessionPanel";
import { ProjectPanel } from "./ProjectPanel";
import { BookmarkPanel } from "./BookmarkPanel";
import { Toast } from "./Toast";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  onSettingsOpen: () => void;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  bookmarks: Bookmark[];
  onBookmarkSelect: (sessionId: string, messageIndex: number, toolCallId?: string) => void;
  onBookmarkDelete: (id: string) => void;
}

const SIDEBAR_WIDTH_KEY = "omnivue-sidebar-width";

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) return Math.max(220, Math.min(600, Number(stored)));
  } catch {
    /* noop */
  }
  return 280;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  activeSection,
  onSectionChange,
  onSettingsOpen,
  sidebarOpen,
  onSidebarToggle,
  bookmarks,
  onBookmarkSelect,
  onBookmarkDelete,
}: SidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    setToastVisible(true);
    setToastKey((k) => k + 1);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      resizeListeners.current = [];
      const finalWidth = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)));
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
      } catch {
        /* noop */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  };

  const renderedWidth = sidebarOpen ? width : 48;
  const panelWidth = sidebarOpen ? Math.max(172, width - 48) : 0;

  return (
    <aside className="flex shrink-0 relative" style={{ width: `${renderedWidth}px` }}>
      <IconChannel
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        onSettingsOpen={onSettingsOpen}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
      />
      <div
        className={`flex-1 flex flex-col overflow-hidden bg-gh-bg-sidebar ${sidebarOpen ? "" : "hidden"}`}
        style={{ width: `${panelWidth}px` }}
      >
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "sessions" ? "hidden" : ""}`}
        >
          <SessionPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSessionSelect={onSessionSelect}
            showToast={showToast}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "projects" ? "hidden" : ""}`}
        >
          <ProjectPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSessionSelect={onSessionSelect}
            showToast={showToast}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "bookmarks" ? "hidden" : ""}`}
        >
          <BookmarkPanel
            bookmarks={bookmarks}
            sessions={sessions}
            onBookmarkSelect={onBookmarkSelect}
            onBookmarkDelete={onBookmarkDelete}
          />
        </div>
      </div>
      <Toast key={toastKey} message={toastMsg} visible={toastVisible} onHide={hideToast} />
      {sidebarOpen && (
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors z-10 ${isResizing ? "bg-accent/50" : ""}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </aside>
  );
}
