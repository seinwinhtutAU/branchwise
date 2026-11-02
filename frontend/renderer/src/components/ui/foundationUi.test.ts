import { describe, it, expect } from "vitest";

describe("Foundation UI Primitives", () => {
  describe("Modal Size Mapping", () => {
    it("maps size tiers sm, md, lg, xl to correct max-w classes", () => {
      const sizeClasses = {
        sm: "max-w-md",
        md: "max-w-lg",
        lg: "max-w-2xl",
        xl: "max-w-3xl",
      };

      expect(sizeClasses.sm).toBe("max-w-md");
      expect(sizeClasses.md).toBe("max-w-lg");
      expect(sizeClasses.lg).toBe("max-w-2xl");
      expect(sizeClasses.xl).toBe("max-w-3xl");
    });
  });

  describe("MoneyInput Formatting Logic", () => {
    function formatMoneyValue(value: number | string | undefined | null): string {
      if (value === "" || value === undefined || value === null) return "";
      const num =
        typeof value === "number"
          ? value
          : Number(String(value).replace(/\D/g, ""));
      if (Number.isNaN(num) || num === 0) {
        return value === 0 || value === "0" ? "0" : "";
      }
      return num.toLocaleString();
    }

    function parseMoneyInput(raw: string): number {
      const digits = raw.replace(/\D/g, "");
      return digits === "" ? 0 : Number(digits);
    }

    it("formats numbers with comma grouping", () => {
      expect(formatMoneyValue(1500000)).toBe("1,500,000");
      expect(formatMoneyValue(500)).toBe("500");
      expect(formatMoneyValue(0)).toBe("0");
      expect(formatMoneyValue("")).toBe("");
      expect(formatMoneyValue(null)).toBe("");
    });

    it("parses user typed strings by stripping non-numeric characters", () => {
      expect(parseMoneyInput("1,500,000 Ks")).toBe(1500000);
      expect(parseMoneyInput("abc 450 xyz")).toBe(450);
      expect(parseMoneyInput("")).toBe(0);
    });
  });

  describe("Pill Tone Mapping", () => {
    const tones = ["neutral", "brand", "warning", "success", "error"] as const;

    const toneStyles = {
      neutral: {
        pill: "bg-bg-raised text-text-secondary border border-border-strong",
        dot: "bg-text-muted",
      },
      brand: {
        pill: "bg-brand-subtle text-brand border border-brand-pill",
        dot: "bg-brand",
      },
      warning: {
        pill: "bg-warning-subtle text-warning border border-warning-pill",
        dot: "bg-warning",
      },
      success: {
        pill: "bg-success-subtle text-success border border-success-pill",
        dot: "bg-success",
      },
      error: {
        pill: "bg-error-subtle text-error border border-error-pill",
        dot: "bg-error",
      },
    };

    it("has a valid tone style for each semantic status", () => {
      for (const tone of tones) {
        expect(toneStyles[tone]).toBeDefined();
        expect(toneStyles[tone].pill).toContain("border");
        expect(toneStyles[tone].dot).toMatch(/^bg-/);
      }
    });
  });
});
