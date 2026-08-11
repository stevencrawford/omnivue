import { useState } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HOME_ROUTE,
  pathToRoute,
  searchRoute,
  sectionRoute,
  sessionRoute,
  sessionRouteWithSection,
  useRouteSync,
} from "../useRouteSync";
import type { Session } from "../types";
import type { Section } from "../../components/IconChannel";

// pathToRoute now reads a route object. This shim keeps call sites terse and
// splits any query string out of the path argument.
const r = (route: string): ReturnType<typeof pathToRoute> => {
  const q = route.indexOf("?");
  return q === -1
    ? pathToRoute({ pathname: route, search: "" })
    : pathToRoute({ pathname: route.slice(0, q), search: route.slice(q) });
};

const sessions = [
  { id: "sess-1", title: "One" },
  { id: "sess-2", title: "Two" },
] as unknown as Session[];

describe("pathToRoute", () => {
  it("maps home and sessions page to the overview state", () => {
    expect(r("/")).toEqual({
      sessionId: null,
      step: undefined,
      showOverview: true,
      section: "sessions",
    });
    expect(r("/sessions")).toEqual({
      sessionId: null,
      step: undefined,
      showOverview: true,
      section: "sessions",
    });
  });

  it("maps each icon-channel section to its own route", () => {
    expect(r("/queue").section).toBe("queue");
    expect(r("/tags").section).toBe("tags");
    expect(r("/bookmarks").section).toBe("bookmarks");
    expect(r("/notifications").section).toBe("notifications");
  });

  it("maps a session path to its id with overview off", () => {
    expect(r("/session/sess-1")).toEqual({
      sessionId: "sess-1",
      step: undefined,
      showOverview: false,
      section: "sessions",
    });
  });

  it("keeps an open session when a section rides on the session route", () => {
    expect(r("/session/sess-1?section=queue")).toEqual({
      sessionId: "sess-1",
      step: undefined,
      showOverview: false,
      section: "queue",
    });
  });

  it("keeps the overview when a section rides on the home route", () => {
    expect(r("/?section=queue")).toEqual({
      sessionId: null,
      step: undefined,
      showOverview: true,
      section: "queue",
    });
  });

  it("maps a session step deep link to its step focus", () => {
    expect(r("/session/sess-1/step/3").step).toBe(3);
  });

  it("falls back to overview for unknown paths", () => {
    expect(r("/nonsense").showOverview).toBe(true);
  });

  it("round-trips route helpers", () => {
    expect(r(sessionRoute("sess 1")).sessionId).toBe("sess 1");
    expect(r(sectionRoute("tags")).section).toBe("tags");
    expect(r(sessionRouteWithSection("sess 1", "queue")).sessionId).toBe("sess 1");
    expect(r(sessionRouteWithSection("sess 1", "queue")).section).toBe("queue");
  });

  it("maps the search deep link to the overview with the query preserved", () => {
    const url = searchRoute("omnivue status");
    expect(r(url).showOverview).toBe(true);
    expect(new URLSearchParams(url.slice(url.indexOf("?"))).get("q")).toBe("omnivue status");
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
      <button onClick={() => navigateTo(sessionRouteWithSection("sess-1", "queue"))}>queue</button>
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

  it("preserves the open session when switching to a section", () => {
    renderHarness(["/session/sess-1"]);
    expect(screen.getByTestId("session").textContent).toBe("sess-1");

    fireEvent.click(screen.getByText("queue"));
    // RHS keeps the session, section flips, and the URL carries both.
    expect(screen.getByTestId("session").textContent).toBe("sess-1");
    expect(screen.getByTestId("overview").textContent).toBe("false");
    expect(screen.getByTestId("section").textContent).toBe("queue");

    // Back returns to the original session view with the sessions section.
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("session").textContent).toBe("sess-1");
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
