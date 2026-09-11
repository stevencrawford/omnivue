import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppHeader } from "../AppHeader";
import { ThemeProvider } from "../../hooks/useTheme";

function renderHeader(overrides: { version?: string } = {}) {
  return render(
    <ThemeProvider>
      <AppHeader
        showOverview={false}
        searchHighlightQuery={null}
        connected={true}
        version={overrides.version}
        onGoHome={() => {}}
        onOpenSearch={() => {}}
        onClearSearchHighlight={() => {}}
      />
    </ThemeProvider>,
  );
}

describe("AppHeader", () => {
  it("renders the running version next to the title", () => {
    renderHeader({ version: "0.2.3" });
    expect(screen.getByText("Omnivue")).toBeDefined();
    expect(screen.getByText("v0.2.3")).toBeDefined();
  });

  it("omits the version when unknown", () => {
    renderHeader({ version: undefined });
    expect(screen.getByText("Omnivue")).toBeDefined();
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });
});
