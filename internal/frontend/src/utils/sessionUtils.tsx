import type { Session } from "../hooks/useApi";
import { relativeTime } from "./buildTree";

export function sessionTitle(session: Session): string {
  const t = session.title?.trim();
  if (t) return t;
  return session.id.slice(0, 10);
}

export function shortDir(directory: string): string {
  if (!directory) return "";
  const parts = directory.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : directory;
}

function shortModel(model: string): string {
  if (!model) return "";
  return model
    .replace("anthropic/", "")
    .replace("openai/", "")
    .replace("github-copilot/", "")
    .replace("claude-", "")
    .replace("gpt-", "");
}

function agentLabel(agent: string): string {
  if (agent === "opencode") return "OpenCode";
  if (agent === "copilot") return "Copilot";
  if (agent === "cursor") return "Cursor";
  if (agent === "codex") return "Codex";
  return agent;
}

export function sessionMetaParts(session: Session): string[] {
  const parts: string[] = [];
  if (session.agent) parts.push(agentLabel(session.agent));
  const dir = shortDir(session.directory);
  if (dir) parts.push(dir);
  if (session.branch) parts.push(session.branch);
  const model = shortModel(session.model);
  if (model) parts.push(model);
  return parts;
}

export function formatCost(cost: number): string {
  if (cost === 0) return "";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}k tok`;
  return `${tokens} tok`;
}

export function formatTokenBreakdown(session: Session): string {
  const parts: string[] = [];
  if (session.tokensInput > 0) parts.push(`${formatTokens(session.tokensInput)} in`);
  if (session.tokensCacheRead > 0) parts.push(`${formatTokens(session.tokensCacheRead)} cached`);
  if (session.tokensOutput > 0) parts.push(`${formatTokens(session.tokensOutput)} out`);
  return parts.join(" / ");
}

export { relativeTime };
