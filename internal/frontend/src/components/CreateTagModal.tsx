import { useEffect, useRef, useState } from "react";
import { Check, Slash } from "lucide-react";
import { Modal } from "./ui/Modal";
import { TAG_COLORS, TAG_NO_COLOR, hasTagColor, tagColor } from "../utils/tagColors";

interface CreateTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, color?: string) => void | Promise<void>;
  initialName?: string;
}

export function CreateTagModal({ isOpen, onClose, onCreate, initialName }: CreateTagModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_NO_COLOR);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName || "");
      setColor(TAG_NO_COLOR);
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialName]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    await onCreate(trimmed, color || undefined);
    setSaving(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Tag" size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-ov-text-secondary mb-1">Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") onClose();
            }}
            placeholder="Tag name"
            className="w-full text-xs bg-ov-bg border border-ov-border rounded-md px-2.5 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)]"
          />
        </div>

        <div>
          <label className="block text-xs text-ov-text-secondary mb-1.5">Color</label>
          <div className="flex flex-wrap gap-1.5 items-center">
            <button
              type="button"
              onClick={() => setColor(TAG_NO_COLOR)}
              className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center border border-ov-border bg-ov-bg ${
                color === TAG_NO_COLOR
                  ? "ring-2 ring-accent/60 ring-offset-1 ring-offset-surface"
                  : ""
              }`}
              title="No colour"
            >
              <Slash size={12} className="text-ov-text-secondary" />
            </button>
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                style={{ backgroundColor: c }}
                title={c}
              >
                {color === c && <Check size={12} className="text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1.5 text-xs text-ov-text-secondary">
            Preview:
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-ov-border bg-surface"
              style={
                hasTagColor(color)
                  ? {
                      backgroundColor: tagColor(color) + "22",
                      borderColor: tagColor(color) + "44",
                      color: tagColor(color),
                    }
                  : undefined
              }
            >
              {hasTagColor(color) && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tagColor(color) }}
                />
              )}
              {name.trim() || "tag"}
            </span>
          </span>
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={handleCreate}
            className="text-xs px-3 py-1.5 rounded-md border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent-border bg-accent-muted text-accent hover:bg-accent/20"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
