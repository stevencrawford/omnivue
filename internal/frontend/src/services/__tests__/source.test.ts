import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { SourceService } from "../source";

vi.mock("../../hooks/apiClient", () => ({
  fetchSources: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  updateSource: vi.fn(),
}));

const mockSource = {
  id: "src-1",
  path: "/tmp/.opencode",
  agentType: "opencode",
  label: "OpenCode",
  enabled: true,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("SourceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns sources on success", async () => {
      vi.mocked(api.fetchSources).mockResolvedValue([mockSource]);

      const result = await runPromise(SourceService.pipe(Effect.flatMap((svc) => svc.list())));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("src-1");
      expect(api.fetchSources).toHaveBeenCalledOnce();
    });
  });

  describe("add", () => {
    it("adds a source and returns it", async () => {
      vi.mocked(api.addSource).mockResolvedValue(mockSource);

      const result = await runPromise(
        SourceService.pipe(Effect.flatMap((svc) => svc.add("/tmp/.opencode", "opencode"))),
      );

      expect(result.id).toBe("src-1");
      expect(api.addSource).toHaveBeenCalledWith(
        "/tmp/.opencode",
        "opencode",
        undefined,
        undefined,
      );
    });
  });

  describe("remove", () => {
    it("removes a source by id", async () => {
      vi.mocked(api.removeSource).mockResolvedValue(undefined);

      await runPromise(SourceService.pipe(Effect.flatMap((svc) => svc.remove("src-1"))));

      expect(api.removeSource).toHaveBeenCalledWith("src-1");
    });
  });

  describe("update", () => {
    it("updates a source", async () => {
      vi.mocked(api.updateSource).mockResolvedValue(undefined);

      await runPromise(
        SourceService.pipe(Effect.flatMap((svc) => svc.update("src-1", { label: "Updated" }))),
      );

      expect(api.updateSource).toHaveBeenCalledWith("src-1", { label: "Updated" });
    });
  });
});
