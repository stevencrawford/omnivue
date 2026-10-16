// Layout math for the cinematic session row (file tree | diff viewer | activity
// drawer). The diff viewer flexes to fill whatever the fixed panels leave, so
// once the row is too narrow it is the pane that gets starved. These constants
// let the row decide when the activity drawer must auto-collapse to protect it.

/** Minimum width the diff viewer needs to stay readable. */
export const DIFF_MIN_WIDTH = 420;

/** Layout width of the two 1px resize handles flanking the tree and drawer. */
export const RESIZE_HANDLE_WIDTH = 2;

/** Default file-tree width. */
export const TREE_DEFAULT_WIDTH = 280;

/** Default activity-drawer width. */
export const DRAWER_DEFAULT_WIDTH = 360;

/**
 * Minimum row width at which the activity drawer can stay open without starving
 * the diff pane. Derived from the panel *defaults*, not their live (user-dragged)
 * widths, so dragging a panel never trips the auto-collapse mid-drag.
 */
export const AUTO_COLLAPSE_ROW_WIDTH =
  TREE_DEFAULT_WIDTH + DRAWER_DEFAULT_WIDTH + DIFF_MIN_WIDTH + RESIZE_HANDLE_WIDTH;

/** Whether the activity drawer should auto-collapse at the given row width. */
export function shouldAutoCollapseDrawer(rowWidth: number): boolean {
  return rowWidth < AUTO_COLLAPSE_ROW_WIDTH;
}
