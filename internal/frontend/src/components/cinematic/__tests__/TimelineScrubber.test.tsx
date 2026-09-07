import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineScrubber } from "../TimelineScrubber";
import type { TimelineEvent } from "../../../hooks/useTimeline";

function makeEvents(): TimelineEvent[] {
  return [
    {
      index: 0,
      messageIndex: 0,
      messageId: "u1",
      label: "first",
      color: "#58a6ff",
      kind: "user-request",
    },
    { index: 1, messageIndex: 1, messageId: "a1", label: "tool", color: "#8b949e", kind: "bash" },
    {
      index: 2,
      messageIndex: 2,
      messageId: "u2",
      label: "second",
      color: "#58a6ff",
      kind: "user-request",
    },
    { index: 3, messageIndex: 3, messageId: "a2", label: "tool", color: "#8b949e", kind: "bash" },
    {
      index: 4,
      messageIndex: 4,
      messageId: "u3",
      label: "third",
      color: "#58a6ff",
      kind: "user-request",
    },
    { index: 5, messageIndex: 5, messageId: "a3", label: "tool", color: "#8b949e", kind: "bash" },
  ];
}

const baseProps = {
  cursor: 5,
  maxIndex: 5,
  playing: false,
  onCursorChange: () => {},
  onEndScrub: () => {},
  onTogglePlay: () => {},
  onStep: () => {},
  onGoLive: () => {},
  atLive: true,
  behind: 0,
  isActive: false,
};

describe("TimelineScrubber range selection", () => {
  it("forwards shiftKey as extend on span click", () => {
    const onSpanSelect = vi.fn();
    render(<TimelineScrubber events={makeEvents()} {...baseProps} onSpanSelect={onSpanSelect} />);

    const turn1 = screen.getByRole("button", { name: /turn 1 between user messages/i });
    fireEvent.click(turn1, { shiftKey: true });
    expect(onSpanSelect).toHaveBeenCalledWith(0, 2, true);
  });

  it("marks every turn in a range as pressed and labels the range", () => {
    render(
      <TimelineScrubber
        events={makeEvents()}
        {...baseProps}
        selectedSpan={{ start: 0, end: 4, trailing: false }}
      />,
    );

    expect(screen.getByText("Turns 1–2/3")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: /turn 1 between user messages/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /turn 2 between user messages/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /turn 3 from last prompt to end/i })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
