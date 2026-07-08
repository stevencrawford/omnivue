import { Modal } from "./Modal";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "j / ↓", desc: "Next session" },
      { keys: "k / ↑", desc: "Previous session" },
      { keys: "⌘1", desc: "Session tab" },
      { keys: "⌘2", desc: "Diff tab" },
    ],
  },
  {
    title: "Search",
    shortcuts: [
      { keys: "⌘K", desc: "Open search palette" },
      { keys: "↑↓", desc: "Navigate results" },
      { keys: "↵", desc: "Open result" },
      { keys: "⌘↵", desc: "Open results drawer" },
      { keys: "Esc", desc: "Close search / drawer" },
    ],
  },
  {
    title: "Sidebar",
    shortcuts: [
      { keys: "⌘B", desc: "Toggle sidebar" },
      { keys: "?", desc: "Open shortcuts" },
    ],
  },
  {
    title: "General",
    shortcuts: [{ keys: "Esc", desc: "Close modal / clear search highlight" }],
  },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" size="md">
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.shortcuts.map((s) => (
                <div key={s.keys} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-ov-text-secondary">{s.desc}</span>
                  <span className="text-[11px] font-mono text-ov-text ml-4">{s.keys}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
