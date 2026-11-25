import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCard } from "../../src/ui/claude-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function render(onOpen: (path: string) => void) {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ClaudeCard onOpen={onOpen} />));
  return host;
}

const button = (el: HTMLElement, name: RegExp) =>
  [...el.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""))!;

describe("ClaudeCard", () => {
  it("opens the connector setup steps and the docs on GetCareer", () => {
    const onOpen = vi.fn();
    const el = render(onOpen);
    expect(el.querySelector("h2")?.textContent).toBe("Connect with Claude");

    act(() => button(el, /Connect to Claude/).click());
    expect(onOpen).toHaveBeenLastCalledWith("/mcp-server#claude");

    act(() => button(el, /Learn more/).click());
    expect(onOpen).toHaveBeenLastCalledWith("/mcp-server#tools");
  });
});
