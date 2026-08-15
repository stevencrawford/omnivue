import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SessionSummary } from "../SessionSummary";
import type { Message, Session } from "../../hooks/types";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Line: () => null,
}));

const message = (overrides: Partial<Message>): Message =>
  ({
    id: "m1",
    role: "user",
    content: "hello",
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  }) as Message;

const session = {
  id: "s1",
  sourceId: "src1",
  title: "Test session",
  repository: "repo",
  branch: "main",
  agent: "opencode",
  model: "gpt-4o",
  cost: 0,
  directory: "/tmp/repo",
  status: "active",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  tokensInput: 0,
  tokensOutput: 0,
  tokensReasoning: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  messageCount: 0,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
} as Session;

describe("SessionSummary", () => {
  it("shows the loading spinner while loading with no messages yet", () => {
    render(<SessionSummary session={session} messages={[]} loading />);
    expect(screen.getByText("Loading session summary...")).toBeDefined();
  });

  it("keeps rendering the summary during a background refresh once messages are loaded", () => {
    render(
      <SessionSummary
        session={session}
        messages={[
          message({ id: "m1", role: "user", content: "hello" }),
          message({ id: "m2", role: "assistant", content: "hi" }),
        ]}
        loading
      />,
    );
    expect(screen.queryByText("Loading session summary...")).toBeNull();
    expect(screen.getByText("Activity Breakdown")).toBeDefined();
    expect(screen.getByText("Token Breakdown")).toBeDefined();
  });

  it("shows the empty state when not loading and there are no messages", () => {
    render(<SessionSummary session={session} messages={[]} loading={false} />);
    expect(screen.getByText("No session data to summarize")).toBeDefined();
  });
});
