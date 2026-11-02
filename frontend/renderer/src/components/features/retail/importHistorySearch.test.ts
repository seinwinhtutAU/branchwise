import { describe, expect, it } from "vitest";
import { matchesSearch, type SearchableImport } from "./importHistorySearch";

const row: SearchableImport = {
  filename: "GeneralUsageWestMall2392026.xlsx",
  typeLabel: "General File",
  branchName: "WestMall",
  uploadedBy: "Sein Win Htut",
  statusLabel: "Completed",
  date: "2026-09-23",
};

describe("matchesSearch", () => {
  it("matches everything when nothing is typed", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  it("finds a row by file name, type, branch, uploader, status or date, in any case", () => {
    for (const query of [
      "usagewestmall",
      "GENERAL",
      "westmall",
      "sein",
      "completed",
      "2026-09-23",
      "2026-09",
    ]) {
      expect(matchesSearch(row, query), query).toBe(true);
    }
  });

  it("needs every word, in any order", () => {
    expect(matchesSearch(row, "westmall general")).toBe(true);
    expect(matchesSearch(row, "general westmall")).toBe(true);
    expect(matchesSearch(row, "westmall sales")).toBe(false);
  });

  it("copes with a row that has no file name, branch or uploader", () => {
    const bare: SearchableImport = {
      filename: null,
      typeLabel: "Sales",
      branchName: null,
      uploadedBy: null,
      statusLabel: "Removed",
      date: "2026-09-01",
    };
    expect(matchesSearch(bare, "sales removed")).toBe(true);
    expect(matchesSearch(bare, "westmall")).toBe(false);
  });
});
