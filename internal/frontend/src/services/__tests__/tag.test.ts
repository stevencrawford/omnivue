import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { TagService } from "../tag";

vi.mock("../../hooks/apiClient", () => ({
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  fetchTagSessions: vi.fn(),
  assignTagToSession: vi.fn(),
  unassignTagFromSession: vi.fn(),
  fetchSessionTags: vi.fn(),
}));

const mockTag = {
  id: "tag-1",
  name: "frontend",
  color: "#3178c6",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("TagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns tags on success", async () => {
      vi.mocked(api.fetchTags).mockResolvedValue([mockTag]);

      const result = await runPromise(TagService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("frontend");
      expect(api.fetchTags).toHaveBeenCalledOnce();
    });
  });

  describe("create", () => {
    it("creates and returns a tag", async () => {
      vi.mocked(api.createTag).mockResolvedValue(mockTag);

      const result = await runPromise(
        TagService.pipe(Effect.flatMap((svc) => svc.create("frontend", "#3178c6"))),
      );

      expect(result.name).toBe("frontend");
      expect(api.createTag).toHaveBeenCalledWith("frontend", "#3178c6");
    });
  });

  describe("remove", () => {
    it("deletes a tag by id", async () => {
      vi.mocked(api.deleteTag).mockResolvedValue(undefined);

      await runPromise(TagService.pipe(Effect.flatMap((svc) => svc.remove("tag-1"))));

      expect(api.deleteTag).toHaveBeenCalledWith("tag-1");
    });
  });

  describe("assignTag", () => {
    it("applies a tag to a session", async () => {
      vi.mocked(api.assignTagToSession).mockResolvedValue(undefined);

      await runPromise(TagService.pipe(Effect.flatMap((svc) => svc.assignTag("tag-1", "ses-1"))));

      expect(api.assignTagToSession).toHaveBeenCalledWith("tag-1", "ses-1");
    });
  });

  describe("listSessionTags", () => {
    it("returns tags for a session", async () => {
      vi.mocked(api.fetchSessionTags).mockResolvedValue([mockTag]);

      const result = await runPromise(
        TagService.pipe(Effect.flatMap((svc) => svc.listSessionTags("ses-1"))),
      );

      expect(result).toHaveLength(1);
      expect(api.fetchSessionTags).toHaveBeenCalledWith("ses-1");
    });
  });
});
