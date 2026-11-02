import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/** Patterns forbidden by the Wholesale UI contract */
export const FORBIDDEN_PATTERNS = {
  rawButton: /<button\b/g,
  rawInput: /<input\b/g,
  rawSelect: /<select\b/g,
  windowConfirm: /window\.confirm\s*\(/g,
  hexColor: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
  paletteColorClasses:
    /\b(?:bg|text|border|ring|from|to|via)-(?:sky|emerald|slate|rose|amber)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g,
  textGlyphsAndEmoji: /[\p{Extended_Pictographic}✕×→←↑↓▲▼✓✔★☆]/gu,
};

export interface FileViolations {
  filePath: string;
  rawButtonCount: number;
  rawInputCount: number;
  rawSelectCount: number;
  windowConfirmCount: number;
  hexColorCount: number;
  paletteClassCount: number;
  glyphEmojiCount: number;
  total: number;
}

export function auditWholesaleContent(content: string, filePath: string): FileViolations {
  // Strip out comments to avoid false alarms in documentation comments
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const rawButtonCount = (cleanContent.match(FORBIDDEN_PATTERNS.rawButton) || []).length;
  const rawInputCount = (cleanContent.match(FORBIDDEN_PATTERNS.rawInput) || []).length;
  const rawSelectCount = (cleanContent.match(FORBIDDEN_PATTERNS.rawSelect) || []).length;
  const windowConfirmCount = (cleanContent.match(FORBIDDEN_PATTERNS.windowConfirm) || []).length;
  const hexColorCount = (cleanContent.match(FORBIDDEN_PATTERNS.hexColor) || []).length;
  const paletteClassCount = (cleanContent.match(FORBIDDEN_PATTERNS.paletteColorClasses) || []).length;
  const glyphEmojiCount = (cleanContent.match(FORBIDDEN_PATTERNS.textGlyphsAndEmoji) || []).length;

  const total =
    rawButtonCount +
    rawInputCount +
    rawSelectCount +
    windowConfirmCount +
    hexColorCount +
    paletteClassCount +
    glyphEmojiCount;

  return {
    filePath,
    rawButtonCount,
    rawInputCount,
    rawSelectCount,
    windowConfirmCount,
    hexColorCount,
    paletteClassCount,
    glyphEmojiCount,
    total,
  };
}

describe("Wholesale UI Contract Lint", () => {
  it("detects forbidden raw buttons, inputs, selects, window.confirm, hex colors, palette classes, and glyphs", () => {
    const badSample = `
      export function BadWidget() {
        const handleClick = () => {
          if (window.confirm("Sure?")) console.log("ok");
        };
        return (
          <div className="bg-sky-500 text-[#123456]">
            <button onClick={handleClick}>Submit 💡</button>
            <input type="text" />
            <select><option>1</option></select>
            <span>Close ✕</span>
          </div>
        );
      }
    `;

    const result = auditWholesaleContent(badSample, "BadWidget.tsx");
    expect(result.windowConfirmCount).toBe(1);
    expect(result.rawButtonCount).toBe(1);
    expect(result.rawInputCount).toBe(1);
    expect(result.rawSelectCount).toBe(1);
    expect(result.hexColorCount).toBe(1);
    expect(result.paletteClassCount).toBe(1);
    expect(result.glyphEmojiCount).toBe(2); // 💡 and ✕
    expect(result.total).toBe(8);
  });

  it("passes clean for compliant code using design tokens and shared UI primitives", () => {
    const cleanSample = `
      import { Button } from "@renderer/components/ui/Button";
      import { Input } from "@renderer/components/ui/Input";
      import { Select } from "@renderer/components/ui/Select";
      import { CloseIcon } from "@renderer/components/ui/icons";

      export function CleanWidget() {
        return (
          <div className="bg-bg-base text-text-primary border border-border">
            <Button variant="primary">Submit</Button>
            <Input label="Name" />
            <Select label="Option"><option>1</option></Select>
            <CloseIcon className="w-4 h-4 text-text-muted" />
          </div>
        );
      }
    `;

    const result = auditWholesaleContent(cleanSample, "CleanWidget.tsx");
    expect(result.total).toBe(0);
  });

  it("verifies new UI foundation components are compliant", () => {
    const uiDir = path.resolve(__dirname, "../../ui");
    const componentsToCheck = [
      "Modal.tsx",
      "ConfirmDialog.tsx",
      "IconButton.tsx",
      "Field.tsx",
      "MoneyInput.tsx",
      "Pill.tsx",
      "PageHeader.tsx",
      "StatTile.tsx",
    ];

    for (const file of componentsToCheck) {
      const fullPath = path.join(uiDir, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const audit = auditWholesaleContent(content, file);
        // Foundation components must not use forbidden palette classes, hex colors, window.confirm, or text glyphs
        expect(audit.windowConfirmCount, `${file} has window.confirm`).toBe(0);
        expect(audit.hexColorCount, `${file} has hex colors`).toBe(0);
        expect(audit.paletteClassCount, `${file} has palette classes`).toBe(0);
        expect(audit.glyphEmojiCount, `${file} has glyph/emoji icons`).toBe(0);
      }
    }
  });

  it("audits wholesale features directory and tracks violation budget", () => {
    const wholesaleDir = path.resolve(__dirname, ".");
    const files: string[] = [];

    function findTsxFiles(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findTsxFiles(fullPath);
        } else if (
          (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
          !entry.name.endsWith(".test.ts") &&
          !entry.name.endsWith(".test.tsx")
        ) {
          files.push(fullPath);
        }
      }
    }

    findTsxFiles(wholesaleDir);

    let totalViolations = 0;
    const violationsByFile: FileViolations[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const res = auditWholesaleContent(content, path.relative(wholesaleDir, file));
      if (res.total > 0) {
        violationsByFile.push(res);
        totalViolations += res.total;
      }
    }

    // Baseline violation cap: must never exceed the pre-migration baseline (550),
    // and will ratchet down towards 0 as screens are migrated.
    expect(totalViolations).toBeLessThanOrEqual(550);
  });
});
