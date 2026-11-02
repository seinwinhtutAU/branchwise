import { describe, expect, it } from "vitest";
import { keptGroupFor } from "./keptGroups";

describe("keptGroupFor", () => {
  it("puts the sections that share one component in one group", () => {
    expect(keptGroupFor("import")).toBe("importHub");
    expect(keptGroupFor("history")).toBe("importHub");
    expect(keptGroupFor("importOverview")).toBe("importHub");
    for (const section of ["overview", "sales", "inventory", "purchase"]) {
      expect(keptGroupFor(section)).toBe("dataOverview");
    }
  });

  it("covers every retail and wholesale page that keeps its state", () => {
    for (const section of [
      "dashboard",
      "businessAlerts",
      "purchasing",
      "warnings",
      "customers",
      "suppliers",
      "products",
      "monitoring",
    ]) {
      expect(keptGroupFor(section), section).toBe(section);
    }
  });

  it("leaves the rebuilt-each-time pages out", () => {
    for (const section of [
      "settings",
      "knowledge",
      "userManagement",
      "today",
      "nope",
    ]) {
      expect(keptGroupFor(section), section).toBeNull();
    }
  });
});
