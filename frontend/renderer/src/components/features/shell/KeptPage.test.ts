import { createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageActiveContext } from "@renderer/lib/pageActive";
import KeptPage from "./KeptPage";

function Probe(): React.JSX.Element {
  return createElement(
    "span",
    null,
    `active=${String(useContext(PageActiveContext))}`,
  );
}

const render = (props: { visited: boolean; active: boolean }): string =>
  renderToStaticMarkup(
    createElement(KeptPage, {
      ...props,
      scrollKey: "test",
      children: createElement(Probe),
    }),
  );

describe("KeptPage", () => {
  it("builds nothing for a page that has never been visited", () => {
    expect(render({ visited: false, active: false })).toBe("");
  });

  it("shows the page when it is on screen, and says it is active", () => {
    const html = render({ visited: false, active: true });
    expect(html).toContain('class="contents"');
    expect(html).toContain("active=true");
  });

  it("keeps a visited page built but hidden, and says it is not active", () => {
    const html = render({ visited: true, active: false });
    expect(html).toContain('class="hidden"');
    expect(html).toContain("active=false");
  });
});
