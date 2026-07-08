import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { FolderService } from "../folder";

vi.mock("../../hooks/apiClient", () => ({
  fetchFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  fetchFolderSessions: vi.fn(),
  assignSessionToFolder: vi.fn(),
  unassignSessionFromFolder: vi.fn(),
}));

const mockFolder = {
  id: "fld-1",
  name: "Test Folder",
  color: "blue",
  icon: "folder",
  sortOrder: 0,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("FolderService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns folders on success", async () => {
      vi.mocked(api.fetchFolders).mockResolvedValue([mockFolder]);

      const result = await runPromise(FolderService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Folder");
      expect(api.fetchFolders).toHaveBeenCalledOnce();
    });
  });

  describe("create", () => {
    it("creates and returns a folder", async () => {
      vi.mocked(api.createFolder).mockResolvedValue(mockFolder);

      const result = await runPromise(
        FolderService.pipe(Effect.flatMap((svc) => svc.create("Test Folder", "blue"))),
      );

      expect(result.name).toBe("Test Folder");
      expect(api.createFolder).toHaveBeenCalledWith("Test Folder", "blue", undefined);
    });
  });

  describe("remove", () => {
    it("deletes a folder by id", async () => {
      vi.mocked(api.deleteFolder).mockResolvedValue(undefined);

      await runPromise(FolderService.pipe(Effect.flatMap((svc) => svc.remove("fld-1"))));

      expect(api.deleteFolder).toHaveBeenCalledWith("fld-1");
    });
  });

  describe("assignSession", () => {
    it("assigns a session to a folder", async () => {
      vi.mocked(api.assignSessionToFolder).mockResolvedValue(undefined);

      await runPromise(
        FolderService.pipe(Effect.flatMap((svc) => svc.assignSession("fld-1", "ses-1"))),
      );

      expect(api.assignSessionToFolder).toHaveBeenCalledWith("fld-1", "ses-1");
    });
  });
});
