import type { ReactNode } from "react";
import type { Session } from "../../hooks/useApi";
import { formatCost, formatTokens, shortModel } from "../../utils/sessionUtils";

function hideCosts(): boolean {
  try {
    return localStorage.getItem("omnivue-hide-costs") === "true";
  } catch {
    return false;
  }
}

export function VerboseStats({ session }: { session: Session }) {
  const totalTokens =
    session.tokensInput + session.tokensOutput + session.tokensCacheRead + session.tokensCacheWrite;
  const parts: ReactNode[] = [];
  const costsVisible = !hideCosts();

  const model = shortModel(session.model);
  if (model) {
    parts.push(
      <span key="model" title="Model">
        {model}
      </span>,
    );
  }

  if (totalTokens > 0) {
    parts.push(
      <span
        key="tokens"
        title={`${session.tokensInput.toLocaleString()} in / ${session.tokensCacheRead.toLocaleString()} cached / ${session.tokensOutput.toLocaleString()} out`}
      >
        {formatTokens(totalTokens)}
      </span>,
    );
  }
  if (session.cost > 0 && costsVisible) {
    parts.push(
      <span key="cost" title="Cost">
        {formatCost(session.cost)}
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <p className="sess-parent-session-meta truncate mt-0.5">
      {parts.flatMap((part, i) =>
        i === 0
          ? [part]
          : [
              <span key={`dot-${i}`} className="mx-1">
                ·
              </span>,
              part,
            ],
      )}
    </p>
  );
}
