import { beforeEach, describe, expect, it } from "vitest";
import { forgetScroll, recallScroll, rememberScroll } from "./scrollMemory";

describe("scrollMemory", () => {
  beforeEach(() => {
    forgetScroll("a");
    forgetScroll("b");
  });

  it("returns the top for a page it has never seen", () => {
    expect(recallScroll("a")).toBe(0);
  });

  it("remembers each page separately and the latest offset", () => {
    rememberScroll("a", 120);
    rememberScroll("b", 40);
    rememberScroll("a", 300);
    expect(recallScroll("a")).toBe(300);
    expect(recallScroll("b")).toBe(40);
  });

  it("never stores a negative offset (an elastic scroll past the top)", () => {
    rememberScroll("a", -25);
    expect(recallScroll("a")).toBe(0);
  });

  it("forgets a page", () => {
    rememberScroll("a", 50);
    forgetScroll("a");
    expect(recallScroll("a")).toBe(0);
  });
});
