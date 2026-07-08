import { describe, expect, it } from "vitest";
import { ApiError } from "../common";

describe("ApiError", () => {
  it("stores message, status, and endpoint", () => {
    const err = new ApiError("Not found", 404, "/_/api/sessions");
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
    expect(err.endpoint).toBe("/_/api/sessions");
    expect(err._tag).toBe("ApiError");
  });

  it("handles zero status for network errors", () => {
    const err = new ApiError("Network error", 0, "/_/api/search");
    expect(err.status).toBe(0);
    expect(err.message).toBe("Network error");
  });

  it("handles empty endpoint", () => {
    const err = new ApiError("unknown", 500, "");
    expect(err.endpoint).toBe("");
    expect(err.status).toBe(500);
  });
});
