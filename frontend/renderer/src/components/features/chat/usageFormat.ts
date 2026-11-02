export interface UsageRow {
  key: string;
  label: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Part of the input the provider served from its cache (cheaper). */
  cached_input_tokens: number;
  total_tokens: number;
  cost: number | null;
}

export interface UsageReport {
  days: number;
  scope: "me" | "everyone";
  total: UsageRow;
  by_kind: UsageRow[];
  by_business: UsageRow[];
  by_day: UsageRow[];
  by_user: UsageRow[];
  /** True when token prices are set on the server, so a cost is shown too. */
  priced: boolean;
}

/** 1,234 tokens as "1.2K", 2,500,000 as "2.5M"; small numbers stay whole. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

/** How wide a row's bar is against the biggest row, as a whole percent (at least 2 so a
 *  small but real row is still visible). */
export function barWidth(row: UsageRow, rows: UsageRow[]): number {
  const biggest = Math.max(...rows.map((r) => r.total_tokens), 0);
  if (biggest === 0 || row.total_tokens === 0) return 0;
  return Math.max(2, Math.round((row.total_tokens / biggest) * 100));
}

export function formatCost(cost: number | null): string | null {
  if (cost === null) return null;
  return cost < 0.01 && cost > 0 ? "< $0.01" : `$${cost.toFixed(2)}`;
}
