import { describe, expect, it } from "vitest";
import { extractJSONField } from "../jsonField";

describe("extractJSONField", () => {
  it("returns null for empty string", () => {
    expect(extractJSONField("", "key")).toBeNull();
  });

  it("extracts a string field", () => {
    expect(extractJSONField('{"name":"hello"}', "name")).toBe("hello");
  });

  it("converts a number field to string", () => {
    expect(extractJSONField('{"count":42}', "count")).toBe("42");
  });

  it("returns null for missing field", () => {
    expect(extractJSONField('{"name":"hello"}', "missing")).toBeNull();
  });

  it("returns null for null field value", () => {
    expect(extractJSONField('{"name":null}', "name")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(extractJSONField('"just a string"', "key")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractJSONField("not json at all", "key")).toBeNull();
  });

  it("handles nested objects (returns null — only top-level)", () => {
    expect(extractJSONField('{"outer":{"inner":"val"}}', "inner")).toBeNull();
  });
});