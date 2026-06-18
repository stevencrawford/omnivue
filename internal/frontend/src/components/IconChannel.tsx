import { MessageSquareText, Folder, Bookmark, Settings } from "lucide-react";

export type Section = "sessions" | "projects" | "bookmarks";

interface IconChannelProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  onSettingsOpen: () => void;
}

const sections: {
  id: Section;
  label: string;
  Icon: typeof MessageSquareText;
  disabled?: boolean;
}[] = [
  { id: "sessions", label: "Sessions", Icon: MessageSquareText },
  { id: "projects", label: "Projects", Icon: Folder },
  { id: "bookmarks", label: "Bookmarks", Icon: Bookmark, disabled: true },
];

export function IconChannel({ activeSection, onSectionChange, onSettingsOpen }: IconChannelProps) {
  return (
    <div className="flex flex-col items-center w-12 shrink-0 border-r border-gh-border bg-gh-bg-sidebar py-1.5">
      {sections.map(({ id, label, Icon, disabled }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          onClick={() => onSectionChange(id)}
          title={disabled ? `${label} — coming soon` : label}
          className={`relative flex items-center justify-center w-full h-10 transition-colors ${
            disabled
              ? "opacity-25 cursor-not-allowed"
              : activeSection === id
                ? "text-accent cursor-pointer"
                : "text-gh-text-secondary hover:text-gh-text cursor-pointer"
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
        className="flex items-center justify-center w-full h-10 text-gh-text-secondary hover:text-gh-text cursor-pointer transition-colors"
      >
        <Settings className="size-5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
