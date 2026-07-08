import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { BookmarkService } from "../bookmark";

vi.mock("../../hooks/apiClient", () => ({
  fetchBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
}));

const mockBookmark = {
  id: "bm-1",
  sessionId: "ses-1",
  messageIndex: 0,
  toolCallId: undefined,
  label: "Important",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("BookmarkService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns bookmarks on success", async () => {
      vi.mocked(api.fetchBookmarks).mockResolvedValue([mockBookmark]);

      const result = await runPromise(BookmarkService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("Important");
      expect(api.fetchBookmarks).toHaveBeenCalledOnce();
    });
  });

  describe("create", () => {
    it("creates a bookmark and returns action", async () => {
      const response = { action: "created" as const, bookmark: mockBookmark };
      vi.mocked(api.createBookmark).mockResolvedValue(response);

      const result = await runPromise(
        BookmarkService.pipe(
          Effect.flatMap((svc) =>
            svc.create({ sessionId: "ses-1", messageIndex: 0, label: "Important" }),
          ),
        ),
      );

      expect(result.action).toBe("created");
      expect(api.createBookmark).toHaveBeenCalledWith({
        sessionId: "ses-1",
        messageIndex: 0,
        label: "Important",
      });
    });
  });

  describe("remove", () => {
    it("deletes a bookmark by id", async () => {
      vi.mocked(api.deleteBookmark).mockResolvedValue(undefined);

      await runPromise(BookmarkService.pipe(Effect.flatMap((svc) => svc.remove("bm-1"))));

      expect(api.deleteBookmark).toHaveBeenCalledWith("bm-1");
    });
  });
});
