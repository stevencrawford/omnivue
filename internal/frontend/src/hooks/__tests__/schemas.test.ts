import { describe, expect, it } from "vitest";
import { BookmarkSchema, BookmarksSchema } from "../schemas";

describe("BookmarkSchema", () => {
  it("parses a message bookmark with a messageId", () => {
    const parsed = BookmarkSchema.parse({
      id: "b1",
      sessionId: "s1",
      messageIndex: 4,
      messageId: "msg-xyz",
      label: "Step 4",
      kind: "message",
      createdAt: "2024-01-01T00:00:00Z",
    });
    expect(parsed.messageId).toBe("msg-xyz");
  });

  it("tolerates a missing messageId", () => {
    const parsed = BookmarkSchema.parse({
      id: "b1",
      sessionId: "s1",
      messageIndex: 4,
      label: "Step 4",
      kind: "message",
      createdAt: "2024-01-01T00:00:00Z",
    });
    expect(parsed.messageId).toBeUndefined();
  });

  it("parses messageId over a list", () => {
    const parsed = BookmarksSchema.parse([
      {
        id: "b1",
        sessionId: "s1",
        messageIndex: 4,
        messageId: "msg-xyz",
        label: "Step 4",
        kind: "message",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]);
    expect(parsed[0]?.messageId).toBe("msg-xyz");
  });
});
