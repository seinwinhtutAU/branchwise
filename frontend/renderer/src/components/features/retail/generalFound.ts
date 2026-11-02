// What the check step found in a General file, in words for the review, and what the confirm step
// saved, in words for the message afterwards.
import { formatRetailDate } from "@renderer/lib/retailDateTime";

export interface GeneralFound {
  kind: "daily_usage" | "salary" | "zero_selling";
  label: string;
  rows: number;
  dates: string[];
  branches: string[];
}

export interface GeneralSummary {
  salary_records_created?: number;
  zero_selling_records_created?: number;
  daily_cost_records_created?: number;
}

const UNITS: Record<GeneralFound["kind"], [string, string]> = {
  daily_usage: ["day", "days"],
  salary: ["person", "people"],
  zero_selling: ["visit", "visits"],
};

const MAX_BRANCHES_SHOWN = 3;

function count(n: number, [one, many]: [string, string]): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "Daily usage: 26 days, 1 Aug to 26 Aug, the branch you choose". */
export function describeFound(found: GeneralFound): string {
  const parts = [count(found.rows, UNITS[found.kind])];
  if (found.dates.length === 1) parts.push(formatRetailDate(found.dates[0]));
  if (found.dates.length > 1) {
    parts.push(
      `${formatRetailDate(found.dates[0])} to ${formatRetailDate(found.dates[found.dates.length - 1])}`,
    );
  }
  const shown = found.branches.slice(0, MAX_BRANCHES_SHOWN);
  const more = found.branches.length - shown.length;
  if (shown.length > 0) {
    parts.push(
      more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", "),
    );
  }
  return `${found.label}: ${parts.join(", ")}`;
}

/** What a confirmed General file created, or "" when the reply carries no counts. */
export function describeGeneralResult(summary: GeneralSummary | null): string {
  if (!summary) return "";
  const lines: string[] = [];
  const daily = summary.daily_cost_records_created ?? 0;
  const salary = summary.salary_records_created ?? 0;
  const zero = summary.zero_selling_records_created ?? 0;
  if (daily > 0) lines.push(`daily usage ${count(daily, UNITS.daily_usage)}`);
  if (salary > 0) lines.push(`salary ${count(salary, UNITS.salary)}`);
  if (zero > 0) lines.push(`zero selling ${count(zero, UNITS.zero_selling)}`);
  return lines.join(", ");
}
