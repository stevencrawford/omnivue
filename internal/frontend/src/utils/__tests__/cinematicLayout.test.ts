import { describe, expect, it } from "vitest";
import {
  AUTO_COLLAPSE_ROW_WIDTH,
  DIFF_MIN_WIDTH,
  DRAWER_DEFAULT_WIDTH,
  TREE_DEFAULT_WIDTH,
  shouldAutoCollapseDrawer,
} from "../cinematicLayout";

describe("shouldAutoCollapseDrawer", () => {
  it("keeps the drawer open when the row fits tree + drawer + a usable diff", () => {
    expect(shouldAutoCollapseDrawer(AUTO_COLLAPSE_ROW_WIDTH)).toBe(false);
    expect(shouldAutoCollapseDrawer(AUTO_COLLAPSE_ROW_WIDTH + 200)).toBe(false);
  });

  it("collapses the drawer once the diff pane would be squeezed", () => {
    expect(shouldAutoCollapseDrawer(AUTO_COLLAPSE_ROW_WIDTH - 1)).toBe(true);
    expect(shouldAutoCollapseDrawer(DIFF_MIN_WIDTH)).toBe(true);
  });

  it("derives the threshold from the panel defaults", () => {
    expect(AUTO_COLLAPSE_ROW_WIDTH).toBeGreaterThan(
      TREE_DEFAULT_WIDTH + DRAWER_DEFAULT_WIDTH + DIFF_MIN_WIDTH,
    );
  });
});
