import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationDrawer } from "../NotificationDrawer";
import { STORAGE_KEYS } from "../../../utils/storageKeys";
import type { Message, Session, ToolCall } from "../../../hooks/types";

vi.mock("../../../hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToSession: () => {} }),
}));

const grepTool: ToolCall = {
  id: "grep-1",
  name: "grep",
  input: JSON.stringify({ pattern: "TODO" }),
  output: "src/a.ts:1: // TODO fix",
  status: "success",
};

const messages: Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    toolCalls: [grepTool],
  },
];

const session: Session = {
  id: "s1",
  sourceId: "src-1",
  title: "test",
  repository: "repo",
  branch: "main",
  agent: "opencode",
  model: "m",
  cost: 0,
  directory: "/tmp",
  status: "idle",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  tokensInput: 0,
  tokensOutput: 0,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  messageCount: 1,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
};

function renderDrawer() {
  return render(
    <NotificationDrawer session={session} messages={messages} cursor={0} maxIndex={0} />,
  );
}

describe("NotificationDrawer raw fallback", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS);
  });

  it("renders the custom grep renderer by default", () => {
    renderDrawer();
    expect(screen.getByText("Results")).toBeDefined();
    expect(screen.queryByText("Input")).toBeNull();
  });

  it("renders the raw input/output view when custom renderers are disabled", () => {
    localStorage.setItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS, "true");
    renderDrawer();
    expect(screen.getByText("Input")).toBeDefined();
    expect(screen.getByText("Output")).toBeDefined();
    expect(screen.queryByText("Results")).toBeNull();
  });
});
