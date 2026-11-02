// Small pure rules the Knowledge page shows. They mirror the backend's (services/knowledge.py) so
// the page can warn before a save is refused, never instead of the backend's own check.

export type Kind = "rule" | "term" | "howto" | "note";
export type Status = "draft" | "published";

export const PIN_LIMIT_FALLBACK = 3000;
const STALE_AFTER_DAYS = 180;

export const KIND_OPTIONS: { value: Kind; label: string; hint: string }[] = [
  { value: "rule", label: "Rule", hint: "How this business does things" },
  { value: "term", label: "Term", hint: "What a word means" },
  { value: "howto", label: "How-to", hint: "Steps to get something done" },
  { value: "note", label: "Note", hint: "Anything else worth knowing" },
];

export const kindLabel = (kind: Kind): string =>
  KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;

// What a pinned note costs in the assistant's instructions: "- title: body" with the body's
// whitespace collapsed, plus the line break.
export function pinCost(title: string, body: string): number {
  return (
    `- ${title}: ${body.split(/\s+/).filter(Boolean).join(" ")}`.length + 1
  );
}

export interface PinMeter {
  used: number;
  limit: number;
  over: boolean;
  percent: number;
}

// `usedByOthers` is the budget the other pinned notes take; this note's own cost is added only when
// it would be published and pinned.
export function pinMeter(
  usedByOthers: number,
  limit: number,
  thisNote: { title: string; body: string; pinned: boolean; status: Status },
): PinMeter {
  const own =
    thisNote.pinned && thisNote.status === "published"
      ? pinCost(thisNote.title, thisNote.body)
      : 0;
  const used = usedByOthers + own;
  return {
    used,
    limit,
    over: used > limit,
    percent: Math.min(100, Math.round((used / limit) * 100)),
  };
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, now: Date): number {
  const start = new Date(from.length === 10 ? `${from}T00:00:00` : from);
  return Math.floor((now.getTime() - start.getTime()) / DAY_MS);
}

export function daysAgoLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

// "Reviewed 3 days ago" — or, when nobody has checked a note for a long time, a warning to look at
// it again. A copy of a written guide has no reviewer, so its label says when it last changed.
export function reviewLabel(
  reviewedAt: string | null,
  updatedAt: string,
  now: Date = new Date(),
): { text: string; stale: boolean } {
  const checked = reviewedAt ?? updatedAt;
  const days = daysBetween(checked, now);
  return {
    text: `${reviewedAt ? "Reviewed" : "Updated"} ${daysAgoLabel(days)}`,
    stale: days > STALE_AFTER_DAYS,
  };
}
