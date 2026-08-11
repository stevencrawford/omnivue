import { describe, expect, it } from "vitest";
import { ApiError } from "../../hooks/apiClient";
import { describeApiError, getErrorMessage, isAbortError } from "../errors";

describe("errors helpers", () => {
  it("isAbortError detects DOMException AbortError only", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("network"))).toBe(false);
    expect(isAbortError("x")).toBe(false);
  });

  it("getErrorMessage prefers Error.message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("raw")).toBe("raw");
  });

  it("describeApiError annotates ApiError with endpoint", () => {
    const err = new ApiError("Request failed: 500 Internal Server Error", 500, "/_/api/sessions");
    expect(describeApiError(err)).toBe(
      "/_/api/sessions failed: Request failed: 500 Internal Server Error",
    );
  });

  it("describeApiError falls back for unknown errors", () => {
    expect(describeApiError(new DOMException("aborted", "AbortError"))).toBe("Request cancelled");
    expect(describeApiError(new Error("boom"))).toBe("boom");
    expect(describeApiError(undefined, "Fallback")).toBe("Fallback");
  });
});
