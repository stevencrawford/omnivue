import { Copy, Check } from "lucide-react";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const { copied, copy } = useCopy(1500);
  return (
    <Button
      variant="outline"
      size="icon-xs"
      className={`opacity-0 group-hover:opacity-100 transition-opacity border-ov-border bg-surface-elevated shrink-0 ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        copy(text);
      }}
      title="Copy"
    >
      {copied ? <Check className="text-emerald-400" /> : <Copy />}
    </Button>
  );
}
