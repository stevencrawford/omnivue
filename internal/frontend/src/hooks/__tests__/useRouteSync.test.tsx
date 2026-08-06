import { useState } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HOME_ROUTE, pathToRoute, sectionRoute, sessionRoute, useRouteSync } from "../useRouteSync";
import type { Session } from "../types";
import type { Section } from "../../components/IconChannel";

const sessions = [
  { id: "sess-1", title: "One" },
  { id: "sess-2", title: "Two" },
] as unknown as Session[];

describe("pathToRoute", () => {
  it("maps home and sessions page to the overview state", () => {
    expect(pathToRoute("/")).toEqual({
      sessionId: null,
      step: undefined,
      showOverview: true,
      section: "sessions",
    });
    expect(pathToRoute("/sessions")).toEqual({
      sessionId: null,
      step: undefined,
      showOverview: true,
      section: "sessions",
    });
  });

  it("maps each icon-channel section to its own route", () => {
    expect(pathToRoute("/queue").section).toBe("queue");
    expect(pathToRoute("/tags").section).toBe("tags");
    expect(pathToRoute("/bookmarks").section).toBe("bookmarks");
    expect(pathToRoute("/notifications").section).toBe("notifications");
  });

  it("maps a session path to its id with overview off", () => {
    expect(pathToRoute("/session/sess-1")).toEqual({
      sessionId: "sess-1",
      step: undefined,
      showOverview: false,
      section: "sessions",
    });
  });

  it("maps a session step deep link to its step focus", () => {
    expect(pathToRoute("/session/sess-1/step/3").step).toBe(3);
  });

  it("falls back to overview for unknown paths", () => {
    expect(pathToRoute("/nonsense").showOverview).toBe(true);
  });

  it("round-trips route helpers", () => {
    expect(pathToRoute(sessionRoute("sess 1")).sessionId).toBe("sess 1");
    expect(pathToRoute(sectionRoute("tags")).section).toBe("tags");
  });
});

function Harness() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showOverview, setShowOverview] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>("sessions");
  const [focusStep, setFocusStep] = useState<number | undefined>(undefined);
  const navigate = useNavigate();

  const { navigateTo, currentPath } = useRouteSync({
    sessions,
    setActiveSessionId,
    setShowOverview,
    setActiveSection,
    setFocusStepIndex: setFocusStep,
  });

  return (
    <div>
      <span data-testid="path">{currentPath}</span>
      <span data-testid="session">{activeSessionId}</span>
      <span data-testid="overview">{String(showOverview)}</span>
      <span data-testid="section">{activeSection}</span>
      <span data-testid="step">{String(focusStep)}</span>
      <button onClick={() => navigateTo(sessionRoute("sess-1"))}>sess1</button>
      <button onClick={() => navigateTo(sessionRoute("sess-2"))}>sess2</button>
      <button onClick={() => navigateTo(sectionRoute("tags"))}>tags</button>
      <button onClick={() => navigateTo(HOME_ROUTE)}>home</button>
      <button onClick={() => navigate(-1)}>back</button>
    </div>
  );
}

function renderHarness(initial: string[]) {
  return render(
    <MemoryRouter initialEntries={initial}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("useRouteSync", () => {
  it("applies the initial route on load", () => {
    renderHarness(["/session/sess-1/step/3"]);
    expect(screen.getByTestId("session").textContent).toBe("sess-1");
    expect(screen.getByTestId("overview").textContent).toBe("false");
    expect(screen.getByTestId("step").textContent).toBe("3");
  });

  it("pushes a history entry per navigation and undoes with back", () => {
    renderHarness(["/"]);
    expect(screen.getByTestId("overview").textContent).toBe("true");

    fireEvent.click(screen.getByText("sess1"));
    expect(screen.getByTestId("session").textContent).toBe("sess-1");
    expect(screen.getByTestId("overview").textContent).toBe("false");

    fireEvent.click(screen.getByText("sess2"));
    expect(screen.getByTestId("session").textContent).toBe("sess-2");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("session").textContent).toBe("sess-1");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("overview").textContent).toBe("true");
  });

  it("tracks icon-channel section changes", () => {
    renderHarness(["/"]);
    fireEvent.click(screen.getByText("tags"));
    expect(screen.getByTestId("section").textContent).toBe("tags");
    expect(screen.getByTestId("path").textContent).toBe("/tags");

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("section").textContent).toBe("sessions");
  });

  it("does not push duplicate entries for the current destination", () => {
    renderHarness(["/"]);
    fireEvent.click(screen.getByText("sess1"));
    fireEvent.click(screen.getByText("sess1"));
    // One back press returns to overview, proving only a single entry was pushed.
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("overview").textContent).toBe("true");
  });

  it("redirects an unknown deep-linked session to overview", () => {
    renderHarness(["/session/ghost"]);
    expect(screen.getByTestId("path").textContent).toBe("/");
  });
});
