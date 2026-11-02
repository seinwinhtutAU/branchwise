// Non-component helpers for the wholesale Revenue, Customer and Inventory dashboard tabs,
// kept apart from dashboardParts.tsx so that file only exports components (Fast Refresh).

/** "103.8M" — the compact money the dashboard tiles use. Just the number: each dashboard
 *  says once, in its footer, that values are in Ks. */
export function formatMmk(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const trim = (value: number): string => {
    const text = value.toFixed(1);
    return text.endsWith(".0") ? text.slice(0, -2) : text;
  };
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

/** A share, one decimal: "41.0%". */
export function formatShare(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** "Up 12% on the period before"; nothing when there is no period to compare with. */
export function deltaText(kpi: {
  delta_pct: number | null;
}): string | undefined {
  if (kpi.delta_pct === null) return undefined;
  const rounded = Math.round(Math.abs(kpi.delta_pct) * 10) / 10;
  if (rounded === 0) return "Same as the period before";
  return `${kpi.delta_pct > 0 ? "Up" : "Down"} ${rounded}% on the period before`;
}

// The series colours: the brand colour, then a purple and the warning amber, matching the
// stock-composition and flow visuals.
export const SERIES_COLORS = {
  primary: "var(--color-brand)",
  purple: "#9b6de0",
  amber: "#e09f3e",
  green: "#52b788",
} as const;

/** The two colors "new" and "repeat" customers have everywhere on the Customer tab. */
export const NEW_REPEAT_SERIES = [
  { name: "New customers", color: SERIES_COLORS.green },
  { name: "Repeat customers", color: SERIES_COLORS.primary },
];
