import { ListRestart, Check } from "lucide-react";
import { useCopy } from "../hooks/useCopy";
import { fetchResumeCommand } from "../hooks/useApi";

export function ResumeButton({ sessionId }: { sessionId: string }) {
  const { copied, copy } = useCopy(2000);

  const handleResume = async () => {
    try {
      const cmd = await fetchResumeCommand(sessionId);
      copy(cmd);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleResume();
      }}
      className="size-7 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
      title="Copy resume command"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <ListRestart size={12} />}
    </button>
  );
}
