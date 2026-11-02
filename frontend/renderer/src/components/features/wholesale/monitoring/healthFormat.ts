import type { HealthSubMetric } from "./dashboardApi";

/** A health figure the way the page writes it: "+12.3%" for a change, "30.0%" for a level,
 *  "69 days" for a wait. */
export function formatHealthValue(
  unit: HealthSubMetric["unit"],
  value: number | null,
): string {
  if (value === null) return "—";
  if (unit === "days") {
    const days = Math.round(value);
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (unit === "pct_change") {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  }
  return `${value.toFixed(1)}%`;
}

/** The score as a whole number, or a dash when the part could not be scored. */
export function formatScore(score: number | null): string {
  return score === null ? "—" : String(Math.round(score));
}
