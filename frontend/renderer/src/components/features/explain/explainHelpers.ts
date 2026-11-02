// The pure parts of the explain bubble: what is sent to the server, where the bubble sits, and
// the question handed to the full assistant. The DOM parts live in ExplainProvider.tsx.

export const MAX_FOCUS = 300;
export const MAX_FOCUS_TITLE = 200;
export const MAX_VISIBLE_TEXT = 4000;

export interface ExplainScreen {
  tab: string | null;
  branchId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export const NO_SCREEN: ExplainScreen = {
  tab: null,
  branchId: null,
  dateFrom: null,
  dateTo: null,
};

export type ExplainLanguage = "en" | "my";

export const LANGUAGE_KEY = "branchwise-explain-language";

/** The language the person chose last time (English when nothing valid is stored). */
export function readLanguage(stored: string | null): ExplainLanguage {
  return stored === "my" ? "my" : "en";
}

export interface ExplainSource {
  source_name: string;
  label: string;
  details: Record<string, string>;
}

export interface ExplainAnswer {
  answer: string;
  follow_ups: string[];
  sources: ExplainSource[];
  cached: boolean;
}

/** Collapses whitespace and cuts to `max` characters (with an ellipsis), so a big card or a whole
 *  page of text cannot make the request too large. */
export function tidyText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface ExplainClick {
  focus: string;
  focusTitle: string;
  visibleText: string;
}

export function buildExplainBody(
  page: string,
  screen: ExplainScreen,
  click: ExplainClick,
  language: ExplainLanguage,
): Record<string, unknown> {
  return {
    context: {
      page,
      branch_id: screen.branchId || null,
      date_from: screen.dateFrom || null,
      date_to: screen.dateTo || null,
    },
    tab: screen.tab,
    focus: tidyText(click.focus, MAX_FOCUS),
    focus_title: tidyText(click.focusTitle, MAX_FOCUS_TITLE),
    visible_text: tidyText(click.visibleText, MAX_VISIBLE_TEXT),
    language,
  };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const GAP = 8;
const EDGE = 12;

/** Where the bubble goes: below the clicked element when it fits, else above, else pinned to the
 *  bottom edge; always inside the window, aligned to the element's left side. */
export function bubblePosition(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: Viewport,
): { left: number; top: number } {
  const maxLeft = Math.max(EDGE, viewport.width - size.width - EDGE);
  const left = Math.min(Math.max(anchor.left, EDGE), maxLeft);
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  let top: number;
  if (below + size.height <= viewport.height - EDGE) top = below;
  else if (above >= EDGE) top = above;
  else top = Math.max(EDGE, viewport.height - size.height - EDGE);
  return { left, top };
}

/** Keeps a bubble the person has dragged fully inside the window. */
export function clampBubble(
  position: { left: number; top: number },
  size: { width: number; height: number },
  viewport: Viewport,
): { left: number; top: number } {
  return {
    left: Math.min(
      Math.max(position.left, 0),
      Math.max(0, viewport.width - size.width),
    ),
    top: Math.min(
      Math.max(position.top, 0),
      Math.max(0, viewport.height - size.height),
    ),
  };
}

/** What the full assistant is asked when the bubble hands over: the follow-up question (or a plain
 *  "explain") about the thing that was clicked, so the assistant is not asked out of nowhere. */
export function assistantPrompt(
  question: string | null,
  click: Pick<ExplainClick, "focus" | "focusTitle">,
): string {
  const about = tidyText(click.focus, 120);
  const where = click.focusTitle
    ? ` (in ${tidyText(click.focusTitle, 60)})`
    : "";
  if (question) return `${question} — about: ${about}${where}`;
  return `Explain this in more detail: ${about}${where}`;
}

/** "Header: value" for each cell of one table row (empty headers and cells are left out). */
export function describeRow(headers: string[], cells: string[]): string {
  return cells
    .map((cell, index) => {
      const value = tidyText(cell, 120);
      const header = tidyText(headers[index] ?? "", 60);
      if (!value) return "";
      return header ? `${header}: ${value}` : value;
    })
    .filter(Boolean)
    .join(" | ");
}

/** What a click on a table column header or one row sends: only that column or that row plus the
 *  column names, never the rest of the table (a table can be thousands of rows). */
export function tableClick(
  kind: "column" | "row",
  headers: string[],
  cells: string[],
  clickedIndex: number,
  title: string,
): ExplainClick {
  const columns = `Columns: ${headers.filter(Boolean).join(" | ")}`;
  if (kind === "column") {
    const example = cells[clickedIndex]?.trim();
    return {
      focus: `Column "${tidyText(headers[clickedIndex] ?? "", 60)}"`,
      focusTitle: title,
      visibleText: example
        ? `${columns}\nExample value: ${tidyText(example, 120)}`
        : columns,
    };
  }
  return {
    focus: `Row: ${describeRow(headers, cells)}`,
    focusTitle: title,
    visibleText: columns,
  };
}

const MAX_STEPS_SHOWN = 3;

/** The steps shown while the assistant works: the newest few, a repeated line only once. */
export function nextSteps(steps: string[], text: string): string[] {
  if (steps[steps.length - 1] === text) return steps;
  return [...steps, text].slice(-MAX_STEPS_SHOWN);
}

/** What the bubble says it is about: the block's title when it has one, else the clicked text. */
export function explainSubject(click: ExplainClick): string {
  const title = tidyText(click.focusTitle, 48);
  if (title) return title;
  return tidyText(click.focus.split("\n")[0] ?? "", 48);
}
