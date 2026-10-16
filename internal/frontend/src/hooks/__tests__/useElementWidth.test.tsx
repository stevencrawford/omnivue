import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useElementWidth } from "../useElementWidth";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  emit(width: number) {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function Harness() {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return <div ref={ref} data-testid="box" data-width={String(width)} />;
}

describe("useElementWidth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    ResizeObserverStub.instances = [];
  });

  it("reports the observed content width", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const { getByTestId } = render(<Harness />);
    expect(ResizeObserverStub.instances).toHaveLength(1);
    expect(ResizeObserverStub.instances[0].observed).toHaveLength(1);

    act(() => ResizeObserverStub.instances[0].emit(1200));
    expect(getByTestId("box").getAttribute("data-width")).toBe("1200");
  });

  it("disconnects the observer on unmount", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const { unmount } = render(<Harness />);
    const instance = ResizeObserverStub.instances[0];
    unmount();
    expect(instance.disconnected).toBe(true);
  });

  it("seeds a measurement before the first observer callback", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const { getByTestId } = render(<Harness />);
    expect(getByTestId("box").getAttribute("data-width")).not.toBe("null");
  });

  it("does not throw when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(() => render(<Harness />)).not.toThrow();
  });
});
