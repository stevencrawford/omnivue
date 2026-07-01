import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
    <Dialog
      open={pinningContent !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pin Message</DialogTitle>
        </DialogHeader>
        {pinningContent && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-ov-text-secondary block mb-1">Title</label>
              <Input
                type="text"
                value={pinTitle}
                onChange={(e) => onTitleChange(e.target.value)}
                className="w-full h-auto text-sm px-2.5 py-1.5"
                placeholder="Pinned message"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ov-text-secondary block mb-1">
                Preview
              </label>
              <div className="max-h-32 overflow-y-auto p-2 rounded border border-ov-border bg-ov-bg-secondary/50 text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
                {pinningContent.slice(0, 500)}
                {pinningContent.length > 500 && (
                  <span className="text-ov-text-secondary/50">...</span>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={onConfirm}>
                Pin
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
