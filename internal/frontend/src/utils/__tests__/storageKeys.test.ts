import { describe, expect, it, beforeEach } from "vitest";
import {
  getStorageItem,
  setStorageItem,
  getStorageJSON,
  setStorageJSON,
  STORAGE_KEYS,
} from "../storageKeys";

// jsdom provides localStorage

describe("storageKeys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getStorageItem", () => {
    it("returns null when key does not exist", () => {
      expect(getStorageItem("nonexistent")).toBeNull();
    });

    it("returns the stored value", () => {
      localStorage.setItem("test-key", "hello");
      expect(getStorageItem("test-key")).toBe("hello");
    });
  });

  describe("setStorageItem", () => {
    it("stores a value", () => {
      setStorageItem("test-key", "world");
      expect(localStorage.getItem("test-key")).toBe("world");
    });
  });

  describe("getStorageJSON", () => {
    it("returns null for missing key", () => {
      expect(getStorageJSON("nonexistent")).toBeNull();
    });

    it("parses stored JSON", () => {
      localStorage.setItem("data", JSON.stringify({ a: 1 }));
      expect(getStorageJSON<{ a: number }>("data")).toEqual({ a: 1 });
    });

    it("returns null for invalid JSON", () => {
      localStorage.setItem("bad", "not json");
      expect(getStorageJSON("bad")).toBeNull();
    });
  });

  describe("setStorageJSON", () => {
    it("stringifies and stores a value", () => {
      setStorageJSON("data", { b: 2 });
      expect(localStorage.getItem("data")).toBe(JSON.stringify({ b: 2 }));
    });
  });

  describe("STORAGE_KEYS", () => {
    it("has expected keys", () => {
      expect(STORAGE_KEYS.THEME).toBe("omnivue-theme");
      expect(STORAGE_KEYS.SIDEBAR_WIDTH).toBe("omnivue-sidebar-width");
    });
  });
});
