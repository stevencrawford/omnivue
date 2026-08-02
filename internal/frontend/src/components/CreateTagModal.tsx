import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
import { TAG_COLORS, tagColor } from "../utils/tagColors";

interface CreateTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, color?: string) => void | Promise<void>;
  initialName?: string;
}

export function CreateTagModal({ isOpen, onClose, onCreate, initialName }: CreateTagModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName || "");
      setColor(TAG_COLORS[0]);
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialName]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    await onCreate(trimmed, color);
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
          <div className="flex flex-wrap gap-1.5">
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
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border"
              style={{
                backgroundColor: tagColor(color) + "22",
                borderColor: tagColor(color) + "44",
                color: tagColor(color),
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: tagColor(color) }}
              />
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
