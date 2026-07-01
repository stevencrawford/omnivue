import { describe, expect, it } from "vitest";
import { agentLabel, shortModel, formatTokens, sessionMetaParts, shortDir } from "../sessionUtils";
import type { Session } from "../../hooks/useApi";

describe("agentLabel", () => {
  it("returns OpenCode for opencode", () => {
    expect(agentLabel("opencode")).toBe("OpenCode");
  });

  it("returns Copilot for copilot", () => {
    expect(agentLabel("copilot")).toBe("Copilot");
  });

  it("returns Cursor for cursor", () => {
    expect(agentLabel("cursor")).toBe("Cursor");
  });

  it("returns Codex for codex", () => {
    expect(agentLabel("codex")).toBe("Codex");
  });

  it("returns Pi for pi", () => {
    expect(agentLabel("pi")).toBe("Pi");
  });

  it("returns Claude Code for claude-code", () => {
    expect(agentLabel("claude-code")).toBe("Claude Code");
  });

  it("returns the input unchanged for unknown agents", () => {
    expect(agentLabel("unknown-agent")).toBe("unknown-agent");
  });
});

describe("shortModel", () => {
  it("strips anthropic/ and claude- prefixes", () => {
    expect(shortModel("anthropic/claude-sonnet-4-20250514")).toBe("sonnet-4-20250514");
  });

  it("strips openai/ and gpt- prefixes", () => {
    expect(shortModel("openai/gpt-4o")).toBe("4o");
  });

  it("returns empty string for empty input", () => {
    expect(shortModel("")).toBe("");
  });
});

describe("formatTokens", () => {
  it("returns empty string for zero", () => {
    expect(formatTokens(0)).toBe("");
  });

  it("formats hundreds", () => {
    expect(formatTokens(500)).toBe("500 tok");
  });

  it("formats thousands with rounding", () => {
    expect(formatTokens(2_500)).toBe("3k tok");
  });

  it("formats exact thousands", () => {
    expect(formatTokens(2_000)).toBe("2k tok");
  });

  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M tok");
  });

  it("formats billions", () => {
    expect(formatTokens(2_500_000_000)).toBe("2.50B tok");
  });

  it("formats trillions", () => {
    expect(formatTokens(3_500_000_000_000)).toBe("3.50T tok");
  });
});

describe("shortDir", () => {
  it("returns the last path segment", () => {
    expect(shortDir("/home/user/projects/my-app")).toBe("my-app");
  });

  it("returns empty string for empty input", () => {
    expect(shortDir("")).toBe("");
  });

  it("strips trailing slash", () => {
    expect(shortDir("/home/user/projects/my-app/")).toBe("my-app");
  });
});

describe("sessionMetaParts", () => {
  const baseSession: Session = {
    id: "s1",
    sourceId: "src1",
    title: "Test",
    repository: "org/repo",
    branch: "main",
    agent: "opencode",
    model: "claude-sonnet",
    cost: 0,
    directory: "/home/user/projects/my-app",
    status: "completed",
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
  };

  it("includes agent label, branch, and directory", () => {
    const parts = sessionMetaParts(baseSession);
    expect(parts).toEqual(["OpenCode", "main", "my-app"]);
  });

  it("skips branch if empty", () => {
    const s = { ...baseSession, branch: "" };
    const parts = sessionMetaParts(s);
    expect(parts).toEqual(["OpenCode", "my-app"]);
  });
});
