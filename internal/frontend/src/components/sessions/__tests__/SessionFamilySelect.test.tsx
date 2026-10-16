import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionFamilySelect } from "../SessionFamilySelect";
import type { Session } from "../../../hooks/types";
import type { SessionFamilyMember } from "../../../utils/sessionFamily";

const session = (id: string): Session => ({
  id,
  sourceId: "src-1",
  title: id,
  repository: "",
  branch: "",
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
  messageCount: 0,
  diffFiles: 0,
  diffAdditions: 0,
  diffDeletions: 0,
});

const family: SessionFamilyMember[] = [
  { session: session("root"), label: "Main", isMain: true },
  { session: session("sub-1"), label: "Researcher", isMain: false },
  { session: session("sub-2"), label: "Sub-agent 2", isMain: false },
];

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Sub-agent/ }));

describe("SessionFamilySelect", () => {
  it("renders nothing when there are no sub-agents", () => {
    const { container } = render(
      <SessionFamilySelect family={[family[0]!]} activeId="root" onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the sub-agents without offering the root session", () => {
    render(<SessionFamilySelect family={family} activeId="root" onSelect={() => {}} />);
    openMenu();
    expect(screen.getByRole("option", { name: /Researcher/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sub-agent 2/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Main$/ })).not.toBeInTheDocument();
  });

  it("selects a sub-agent and closes the menu", () => {
    const onSelect = vi.fn();
    render(<SessionFamilySelect family={family} activeId="root" onSelect={onSelect} />);
    openMenu();
    fireEvent.click(screen.getByRole("option", { name: /Researcher/ }));
    expect(onSelect).toHaveBeenCalledWith("sub-1");
    expect(screen.queryByRole("option", { name: /Researcher/ })).not.toBeInTheDocument();
  });

  it("does not re-select the active sub-agent", () => {
    const onSelect = vi.fn();
    render(<SessionFamilySelect family={family} activeId="sub-1" onSelect={onSelect} />);
    openMenu();
    fireEvent.click(screen.getByRole("option", { name: /Researcher/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
