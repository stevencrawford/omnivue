import type { Session } from "../hooks/useApi";
import { relativeTime } from "./buildTree";

export function sessionTitle(session: Session): string {
  const t = session.title?.trim();
  if (t) return t;
  return session.id.slice(0, 10);
}

function shortDir(directory: string): string {
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

export { relativeTime };
