// Words and starting values for the inbox of questions the assistant couldn't answer.

import type { InboxItem } from "@renderer/components/features/knowledge/knowledgeApi";

export const TITLE_MAX = 200;

export const TAG_LABELS: Record<"gap" | "wrong", string> = {
  gap: "Couldn't answer",
  wrong: "Marked wrong",
};

export function askedLabel(count: number): string {
  return count === 1 ? "Asked once" : `Asked ${count} times`;
}

// What the editor starts with when someone presses "Write an answer": the question as the title
// (a note's title is what it is found by), published because they are here to fix a gap, and the
// context the writer needs next to the empty text box.
export interface InboxPrefill {
  inboxKey: string;
  title: string;
  question: string;
  count: number;
  missing: string[];
  wrongAnswer: string | null;
  wrongReasons: string[];
}

export function prefillFromItem(item: InboxItem): InboxPrefill {
  return {
    inboxKey: item.key,
    title: item.question.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX),
    question: item.question,
    count: item.count,
    missing: item.missing,
    wrongAnswer: item.wrong_answer,
    wrongReasons: item.wrong_reasons,
  };
}

// The one line under a question: what was missing, or why an answer was marked wrong.
export function reasonLine(item: InboxItem): string {
  const parts: string[] = [];
  if (item.missing.length > 0)
    parts.push(`Missing: ${item.missing.join("; ")}`);
  if (item.wrong_reasons.length > 0) {
    parts.push(`Marked wrong: ${item.wrong_reasons.join("; ")}`);
  }
  return parts.join(" · ");
}
