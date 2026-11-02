import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatMarkdown from "./ChatMarkdown";
import { pageRouteFor } from "./pageRoutes";

const html = (text: string, onNavigate?: (section: string) => void): string =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text, onNavigate }));

describe("ChatMarkdown", () => {
  it("turns numbered steps and bold figures into real elements", () => {
    const out = html("1. Open **Orders**\n2. Press Save");
    expect(out).toContain("<ol");
    expect(out).toContain("<li");
    expect(out).toContain("<strong");
  });

  it("renders a table with gridlines", () => {
    const out = html("| Branch | Sales |\n|---|---|\n| Alpha | Ks 1,000 |");
    expect(out).toContain("<table");
    expect(out).toContain("border-border");
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("min-w-full");
    expect(out).toContain("[&amp;&gt;tr:last-child&gt;td]:border-b-0");
    expect(out).not.toContain("last:border-b-0");
    expect(out).toContain("Ks 1,000");
  });

  it("does not turn raw HTML into elements", () => {
    const out = html('<img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
  });

  it("shows a link as plain words, never as a link", () => {
    const out = html("See [the report](https://example.com/x)");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
    expect(out).toContain("the report");
  });

  it("leaves plain text and Myanmar or Chinese text alone", () => {
    const out = html("\u6628\u5929\u5356\u4e86 Ks 12,500 \u1006\u102d\u102f\u1004\u103a");
    expect(out).toContain("\u6628\u5929\u5356\u4e86 Ks 12,500 \u1006\u102d\u102f\u1004\u103a");
  });

  it("turns a bold page name into a button that opens it, and nothing else", () => {
    const out = html(
      "Press **Customers**, then **Save order**.",
      () => undefined,
    );
    expect(out).toContain("<button");
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain("Save order");
  });

  it("shows page names as plain bold where the chat cannot open pages", () => {
    expect(html("Press **Customers**.")).not.toContain("<button");
  });

  it("only knows the fixed list of pages", () => {
    expect(pageRouteFor("Customers")).toBe("customers");
    expect(pageRouteFor(" Today ")).toBe("today");
    expect(pageRouteFor("Suppliers")).toBe("suppliers");
    expect(pageRouteFor("Products")).toBe("products");
    expect(pageRouteFor("settings")).toBeNull();
    expect(pageRouteFor("Dashboard")).toBeNull();
    expect(pageRouteFor("https://example.com")).toBeNull();
  });
});
