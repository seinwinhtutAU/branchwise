// The small pieces the wholesale Revenue, Customer and Inventory dashboard tabs share:
// money and set formatting, ranked bars, a donut, a card with a header link, and the
// footer line. They are drawn with plain SVG/CSS like the retail dashboard's charts.
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { DashboardIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { SERIES_COLORS } from "./dashboardFormat";

export function DashboardLoading({
  tiles,
}: {
  tiles: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: tiles }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export function DashboardError({
  title,
  reload,
}: {
  title: string;
  reload: () => Promise<void>;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<DashboardIcon />}
      title={`Could not load the ${title} dashboard`}
      description="Could not connect to the system. Please check your internet connection and try again."
      action={
        <Button variant="secondary" size="sm" onClick={reload}>
          Retry
        </Button>
      }
    />
  );
}

/** Rows drawn as horizontal bars, longest first, each a shade lighter than the one above
 *  — the "who is biggest" picture used for factories, customers and locations. */
export function RankedBars({
  rows,
  formatValue,
  empty,
  colors,
}: {
  /** `sub` is a second right-aligned column after the figure (a share, for instance). */
  rows: { label: string; value: number; sub?: string }[];
  formatValue: (value: number) => string;
  empty: string;
  /** One colour per row, when the rows are categories rather than a ranking. */
  colors?: string[];
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-text-muted">{empty}</p>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  const hasSub = rows.some((row) => row.sub);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={row.label} className="flex items-center gap-3 text-sm">
          <span
            className="w-28 shrink-0 truncate text-text-secondary sm:w-32"
            title={row.label}
          >
            {row.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, row.value > 0 ? 3 : 0)}%`,
                background: colors?.[index] ?? SERIES_COLORS.primary,
                opacity: colors ? 1 : Math.max(0.35, 1 - index * 0.2),
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-text-primary">
            {formatValue(row.value)}
          </span>
          {hasSub && (
            <span className="w-14 shrink-0 text-right tabular-nums text-text-muted">
              {row.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A quieter ranking for pages that already have a primary chart. It keeps the same values
 * without making every row compete for attention with a second chart. */
export function RankedList({
  rows,
  formatValue,
  empty,
  className,
}: {
  rows: { label: string; value: number; sub?: string }[];
  formatValue: (value: number) => string;
  empty: string;
  className?: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-text-muted">{empty}</p>;
  }

  return (
    <ul className={cn("divide-y divide-border/70", className)}>
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2 text-sm first:pt-0 last:pb-0"
        >
          <span className="truncate text-text-secondary" title={row.label}>
            {row.label}
          </span>
          <span className="font-semibold tabular-nums text-text-primary">
            {formatValue(row.value)}
          </span>
          {row.sub && (
            <span className="min-w-12 text-right tabular-nums text-text-muted">
              {row.sub}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
