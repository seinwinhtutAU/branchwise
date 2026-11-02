import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";
import { SERIES_COLORS, formatMmk, formatShare } from "./dashboardFormat";

/** One row of a ranking: how much, its share of the whole, and (products) how many sets. */
interface RankRow {
  name: string;
  amount: number;
  share_pct: number;
  quantity_sets?: number;
}

/** The biggest few of one thing in the period, biggest first, each with its amount and share. */
export function RankingCard({
  title,
  description,
  empty,
  rows,
  display = "bars",
  className,
  listClassName,
}: {
  title: string;
  description: string;
  empty: string;
  rows: RankRow[];
  display?: "bars" | "list";
  className?: string;
  listClassName?: string;
}): React.JSX.Element {
  const biggest = Math.max(...rows.map((row) => row.amount), 1);

  return (
    <Card className={cn("p-3", className)}>
      <CardHeader className="mb-1.5" title={title} description={description} />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">{empty}</p>
      ) : (
        <ul
          className={
            display === "bars"
              ? cn("flex flex-col gap-1.5", listClassName)
              : cn("divide-y divide-border/70", listClassName)
          }
        >
          {rows.map((row, index) => (
            <li
              key={row.name}
              className={cn(
                "text-sm",
                display === "bars"
                  ? "flex items-center gap-3"
                  : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 first:pt-0 last:pb-0",
              )}
            >
              <div
                className={
                  display === "bars" ? "w-32 shrink-0 sm:w-40" : "min-w-0"
                }
              >
                <div
                  className="truncate font-medium text-text-primary"
                  title={row.name}
                >
                  {row.name}
                </div>
                {row.quantity_sets !== undefined && (
                  <div className="text-xs text-text-muted">
                    {row.quantity_sets.toLocaleString()} sets
                  </div>
                )}
              </div>
              {display === "bars" && (
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-raised">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max((row.amount / biggest) * 100, 3)}%`,
                      background: SERIES_COLORS.primary,
                      opacity: Math.max(0.35, 1 - index * 0.1),
                    }}
                  />
                </div>
              )}
              <div className="w-24 shrink-0 text-right">
                <div className="font-semibold tabular-nums text-text-primary">
                  {formatMmk(row.amount)}
                </div>
                <div className="text-[11px] tabular-nums text-text-muted">
                  {formatShare(row.share_pct)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
