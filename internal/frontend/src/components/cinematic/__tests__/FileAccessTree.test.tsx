import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TREE_VISIBILITY, FileAccessTree, isAccessVisible } from "../FileAccessTree";
import { STORAGE_KEYS } from "../../../utils/storageKeys";
import type { FileAccess } from "../../../utils/fileAccess";
import type { ScratchFile } from "../../../hooks/types";

function makeAccess(filePath: string, kind: FileAccess["kind"], id?: string): FileAccess {
  const accessId = id ?? `${kind}:${filePath}`;
  return {
    id: accessId,
    filePath,
    kind,
    tool: {
      id: accessId,
      name: kind,
      input: JSON.stringify({ filePath }),
      output: "",
      status: "completed",
    },
    messageId: "m1",
    messageIndex: 0,
    timestamp: "",
  } as FileAccess;
}

function makeAccesses(): FileAccess[] {
  return [
    makeAccess("src/read-only.ts", "read"),
    makeAccess("src/edited.ts", "edit"),
    makeAccess("src/written.ts", "write"),
    makeAccess("src/removed.ts", "delete"),
  ];
}

describe("isAccessVisible", () => {
  it("shows everything by default", () => {
    for (const kind of ["read", "edit", "write", "delete"] as const) {
      expect(isAccessVisible(makeAccess("a.ts", kind), DEFAULT_TREE_VISIBILITY)).toBe(true);
    }
  });

  it("groups edit and write under showEdits", () => {
    const visibility = { showReads: true, showEdits: false, showDeletes: true };
    expect(isAccessVisible(makeAccess("a.ts", "edit"), visibility)).toBe(false);
    expect(isAccessVisible(makeAccess("a.ts", "write"), visibility)).toBe(false);
    expect(isAccessVisible(makeAccess("a.ts", "read"), visibility)).toBe(true);
    expect(isAccessVisible(makeAccess("a.ts", "delete"), visibility)).toBe(true);
  });
});

describe("FileAccessTree kind toggles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderTree(selectedPath = "") {
    const onSelect = vi.fn();
    render(
      <FileAccessTree accesses={makeAccesses()} selectedPath={selectedPath} onSelect={onSelect} />,
    );
    return { onSelect };
  }

  it("renders three kind toggles active by default with full colour", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "Hide reads" })).toHaveClass("text-cyan-400");
    expect(screen.getByRole("button", { name: "Hide edits and writes" })).toHaveClass(
      "text-yellow-400",
    );
    expect(screen.getByRole("button", { name: "Hide deletes" })).toHaveClass("text-red-400");
    expect(screen.getByText("read-only.ts")).toBeDefined();
    expect(screen.getByText("edited.ts")).toBeDefined();
  });

  it("hiding reads removes read-only files and mutes the icon", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide reads" }));
    expect(screen.queryByText("read-only.ts")).toBeNull();
    expect(screen.getByText("edited.ts")).toBeDefined();
    expect(screen.getByRole("button", { name: "Show reads" })).toHaveClass("opacity-40");
  });

  it("hiding edits removes both edit and write files but keeps deletes", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide edits and writes" }));
    expect(screen.queryByText("edited.ts")).toBeNull();
    expect(screen.queryByText("written.ts")).toBeNull();
    expect(screen.getByText("removed.ts")).toBeDefined();
    expect(screen.getByText("read-only.ts")).toBeDefined();
  });

  it("hiding deletes removes delete files", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide deletes" }));
    expect(screen.queryByText("removed.ts")).toBeNull();
    expect(screen.getByText("read-only.ts")).toBeDefined();
  });

  it("shows empty-filter state with Show all reset", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide reads" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide edits and writes" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide deletes" }));
    expect(screen.getByText("Files hidden by filters")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("read-only.ts")).toBeDefined();
    expect(screen.getByText("edited.ts")).toBeDefined();
  });

  it("persists visibility to localStorage and restores on mount", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Hide reads" }));
    const stored = localStorage.getItem(STORAGE_KEYS.CINEMATIC_TREE_FILTERS);
    expect(stored).toContain('"showReads":false');
  });

  it("selects first visible file when the selected file is filtered out", () => {
    const onSelect = vi.fn();
    render(
      <FileAccessTree
        accesses={makeAccesses()}
        selectedPath="src/read-only.ts"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide reads" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onSelect.mock.calls[0][0]).not.toBe("src/read-only.ts");
  });
});

describe("FileAccessTree scratch section", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function makeScratch(id: string, title: string): ScratchFile {
    return { id, sessionId: "ses-1", title } as ScratchFile;
  }

  function renderWithScratch(scratchFiles: ScratchFile[]) {
    render(
      <FileAccessTree
        accesses={makeAccesses()}
        selectedPath=""
        onSelect={vi.fn()}
        scratchFiles={scratchFiles}
      />,
    );
  }

  it("shows the Scratch header with a zero count and no empty-state noise", () => {
    renderWithScratch([]);
    expect(screen.getByText("Scratch")).toBeDefined();
    expect(screen.getByText("0")).toBeDefined();
    expect(screen.queryByText("No scratch files")).toBeNull();
  });

  it("pins the capped-height scratch list below the file tree", () => {
    renderWithScratch([makeScratch("s1", "notes.md")]);
    expect(screen.getByText("notes.md")).toBeDefined();
    const list = screen.getByText("notes.md").closest(".max-h-48");
    expect(list).not.toBeNull();
    expect(list?.closest(".shrink-0")).not.toBeNull();
  });

  it("hides the scratch list when the section is collapsed", () => {
    renderWithScratch([makeScratch("s1", "notes.md")]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Scratch" }));
    expect(screen.queryByText("notes.md")).toBeNull();
  });
});
