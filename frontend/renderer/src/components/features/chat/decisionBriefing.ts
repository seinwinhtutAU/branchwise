/** What the server remembers about decisions (see GET /api/chat/decisions/briefing). */
export interface DecisionBriefing {
  open: { ref: number; title: string; days_open: number; where: string }[];
  cleared: { ref: number; title: string; resolved_on: string }[];
}

export interface BriefingNote {
  waiting: { ref: number; text: string }[];
  waitingMore: number;
  cleared: string[];
  clearedMore: number;
}

const LISTED = 3;

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** The note the chat opens with, or null when there is nothing worth saying: decisions that have waited a day or
 *  more, and ones that cleared lately. A decision that only appeared today is not mentioned yet. */
export function briefingNote(
  briefing: DecisionBriefing | null,
): BriefingNote | null {
  if (briefing === null) return null;
  const old = briefing.open
    .filter((item) => item.days_open >= 1)
    .sort((a, b) => b.days_open - a.days_open);
  if (old.length === 0 && briefing.cleared.length === 0) return null;
  return {
    waiting: old.slice(0, LISTED).map((item) => ({
      ref: item.ref,
      text: `${item.title} (${days(item.days_open)})`,
    })),
    waitingMore: Math.max(0, old.length - LISTED),
    cleared: briefing.cleared.slice(0, LISTED).map((item) => item.title),
    clearedMore: Math.max(0, briefing.cleared.length - LISTED),
  };
}

const HIDDEN_KEY = "branchwise-decision-note-hidden";

/** The note is hidden for the rest of the day once it has been closed. */
export function noteHiddenToday(today: string): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === today;
  } catch {
    return false;
  }
}

export function hideNoteToday(today: string): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, today);
  } catch {
    // Without storage the note simply comes back next time.
  }
}
