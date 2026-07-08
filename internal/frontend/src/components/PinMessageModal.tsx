import { Modal } from "./Modal";

interface PinMessageModalProps {
  pinningContent: string | null;
  pinTitle: string;
  onTitleChange: (t: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PinMessageModal({
  pinningContent,
  pinTitle,
  onTitleChange,
  onCancel,
  onConfirm,
}: PinMessageModalProps) {
  return (
    <Modal isOpen={pinningContent !== null} onClose={onCancel} title="Pin Message" size="md">
      {pinningContent && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
          className="p-3 space-y-3"
        >
          <div>
            <label className="text-xs font-medium text-ov-text-secondary block mb-1">Title</label>
            <input
              type="text"
              value={pinTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm rounded border border-ov-border bg-ov-bg text-ov-text focus:outline-none focus:border-accent-border"
              placeholder="Pinned message"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ov-text-secondary block mb-1">Preview</label>
            <div className="max-h-32 overflow-y-auto p-2 rounded border border-ov-border bg-ov-bg-secondary/50 text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
              {pinningContent.slice(0, 500)}
              {pinningContent.length > 500 && (
                <span className="text-ov-text-secondary/50">...</span>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded border border-ov-border text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-secondary cursor-pointer transition-colors"
            >
              Pin
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
