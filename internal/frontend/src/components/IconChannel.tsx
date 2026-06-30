import React from "react";
import { Folder, Bookmark, Settings, type LucideProps } from "lucide-react";

export type Section = "sessions" | "projects" | "bookmarks";

interface IconChannelProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  onSettingsOpen: () => void;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
}

export function SessionsIcon(props: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

const sections: {
  id: Section;
  label: string;
  Icon: React.ComponentType<LucideProps>;
}[] = [
  { id: "sessions", label: "Sessions", Icon: SessionsIcon },
  { id: "projects", label: "Projects", Icon: Folder },
  { id: "bookmarks", label: "Bookmarks", Icon: Bookmark },
];

export function IconChannel({
  activeSection,
  onSectionChange,
  onSettingsOpen,
  sidebarOpen,
  onSidebarToggle,
}: IconChannelProps) {
  return (
    <div className="flex flex-col items-center w-12 shrink-0 border-r border-ov-border bg-ov-bg-sidebar py-1.5">
      {sections.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            if (id === activeSection) {
              onSidebarToggle();
            } else {
              onSectionChange(id);
              if (!sidebarOpen) onSidebarToggle();
            }
          }}
          title={label}
          className={`relative flex items-center justify-center w-full h-10 transition-colors ${
            activeSection === id
              ? "text-accent cursor-pointer"
              : "text-ov-text-secondary hover:text-ov-text cursor-pointer"
          }`}
        >
          {activeSection === id && (
            <div className="absolute left-0 w-0.5 h-5 rounded-r-full bg-accent" />
          )}
          <Icon className="size-5" strokeWidth={1.5} />
        </button>
      ))}

      <div className="flex-1" />

      <button
        type="button"
        onClick={onSettingsOpen}
        title="Settings"
        className="flex items-center justify-center w-full h-10 text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors"
      >
        <Settings className="size-5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
