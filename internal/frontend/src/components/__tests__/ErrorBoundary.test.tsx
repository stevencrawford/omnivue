import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

function HappyComponent() {
  return <div>All good</div>;
}

function BrokenComponent(): ReactNode {
  throw new Error("Boom!");
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <HappyComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeDefined();
  });

  it("renders fallback on error", () => {
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("Boom!")).toBeDefined();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error</div>}>
        <BrokenComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Custom error")).toBeDefined();
  });
});
