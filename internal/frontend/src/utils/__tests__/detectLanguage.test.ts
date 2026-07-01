import { describe, expect, it } from "vitest";
import { detectLanguage } from "../detectLanguage";

describe("detectLanguage", () => {
  it("returns typescript for .ts", () => {
    expect(detectLanguage("file.ts")).toBe("typescript");
  });

  it("returns tsx for .tsx", () => {
    expect(detectLanguage("component.tsx")).toBe("tsx");
  });

  it("returns javascript for .js", () => {
    expect(detectLanguage("script.js")).toBe("javascript");
  });

  it("returns json for .json", () => {
    expect(detectLanguage("data.json")).toBe("json");
  });

  it("returns python for .py", () => {
    expect(detectLanguage("main.py")).toBe("python");
  });

  it("returns go for .go", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("returns yaml for .yml", () => {
    expect(detectLanguage("config.yml")).toBe("yaml");
  });

  it("returns empty string for unknown extension", () => {
    expect(detectLanguage("file.xyz")).toBe("");
  });

  it("returns empty string for no extension", () => {
    expect(detectLanguage("Makefile")).toBe("");
  });

  it("is case-insensitive", () => {
    expect(detectLanguage("FILE.TS")).toBe("typescript");
  });
});
