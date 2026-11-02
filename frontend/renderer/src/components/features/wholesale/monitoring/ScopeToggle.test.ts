import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScopeToggle } from "./ScopeToggle";

describe("ScopeToggle", () => {
  it("offers Open now and By period, with the chosen one pressed", () => {
    const html = renderToStaticMarkup(
      createElement(ScopeToggle, { scope: "open", onChange: () => undefined }),
    );
    expect(html.indexOf("Open now")).toBeLessThan(html.indexOf("By period"));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Open now/);
  });
});
