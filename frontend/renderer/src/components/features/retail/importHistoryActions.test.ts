import { describe, expect, it } from "vitest";
import { canManageImport } from "./importHistoryActions";

describe("canManageImport", () => {
  it.each(["sales", "inventory", "purchase", "general"])(
    "lets an active %s import be reimported or removed",
    (import_type) => {
      expect(canManageImport({ import_type, status: "completed" }, false)).toBe(
        true,
      );
    },
  );

  it("offers nothing on a removed or replaced import", () => {
    expect(
      canManageImport({ import_type: "general", status: "reverted" }, false),
    ).toBe(false);
    expect(
      canManageImport({ import_type: "general", status: "reimported" }, false),
    ).toBe(false);
  });

  it("offers nothing once a retail account is locked out", () => {
    expect(
      canManageImport({ import_type: "general", status: "completed" }, true),
    ).toBe(false);
  });
});
