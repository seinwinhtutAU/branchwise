import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";
import { RankedBars, RankedList } from "./dashboardParts";
import { SERIES_COLORS, formatMmk, formatShare } from "./dashboardFormat";

/** A customer with money left to collect, or a supplier with money left to pay, on what is open. */
interface OpenParty {
  name: string;
  left: number;
  share_pct: number;
  /** How many open orders / vouchers make it up. */
  count: number;
  oldest_days: number;
}

export interface OpenPartiesProps {
  title: string;
  description: string;
  empty: string;
  /** "order" or "voucher". */
  noun: string;
  /** "customers" or "suppliers", for the "showing the top N of M" line. */
  plural: string;
  rows: OpenParty[];
  total: number;
}

export interface OpenAgeingProps {
  title: string;
  description: string;
  empty: string;
  rows: { label: string; value: number }[];
}

function ageText(days: number): string {
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

export function OpenPartiesCard({
  parties,
  display,
  className,
  onOpenParty,
}: {
  parties: OpenPartiesProps;
  display: "bars" | "list";
  className?: string;
  /** Opens this named customer or supplier in its operational directory. */
  onOpenParty?: (name: string) => void;
}): React.JSX.Element {
  const { rows } = parties;
  const biggest = Math.max(...rows.map((row) => row.left), 1);
  return (
    <Card
      className={cn(
        "p-3",
        display === "list" && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <CardHeader
        className="mb-1.5"
        title={parties.title}
        description={parties.description}
      />
      <div
        className={cn(
          display === "list" && "min-h-0 flex-1 overflow-y-auto pr-1",
        )}
      >
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">
            {parties.empty}
          </p>
        ) : (
          <ul
            className={
              display === "bars"
                ? "flex flex-col gap-1.5"
                : "divide-y divide-border/70"
            }
          >
            {rows.map((row, index) => (
              <li
                key={row.name}
                className={
                  display === "bars" ? undefined : "py-2 first:pt-0 last:pb-0"
                }
              >
                <button
                  type="button"
                  onClick={() => onOpenParty?.(row.name)}
                  disabled={!onOpenParty}
                  className={cn(
                    "group w-full text-left",
                    display === "bars"
                      ? "flex items-center gap-3 text-sm"
                      : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm",
                    onOpenParty &&
                      "cursor-pointer rounded outline-none hover:bg-bg-subtle/70 focus-visible:ring-2 focus-visible:ring-brand/60",
                  )}
                  aria-label={
                    onOpenParty
                      ? `Open ${row.name}'s outstanding ${parties.noun}s`
                      : undefined
                  }
                >
                  <div
                    className={
                      display === "bars" ? "w-36 shrink-0 sm:w-44" : "min-w-0"
                    }
                  >
                    <div
                      className={cn(
                        "truncate font-medium text-text-primary",
                        onOpenParty && "hover:text-brand",
                      )}
                      title={row.name}
                    >
                      {row.name}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {row.count} {parties.noun}
                      {row.count === 1 ? "" : "s"} · oldest{" "}
                      {ageText(row.oldest_days)}
                    </div>
                  </div>
                  {display === "bars" && (
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-raised">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max((row.left / biggest) * 100, 3)}%`,
                          background: SERIES_COLORS.amber,
                          opacity: Math.max(0.4, 1 - index * 0.1),
                        }}
                      />
                    </div>
                  )}
                  <div className="w-24 shrink-0 text-right">
                    <div
                      className={cn(
                        "font-semibold tabular-nums text-text-primary",
                        onOpenParty && "group-hover:text-brand",
                      )}
                    >
                      {formatMmk(row.left)}
                    </div>
                    <div className="text-[11px] tabular-nums text-text-muted">
                      {formatShare(row.share_pct)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {parties.total > rows.length && (
        <p className="mt-2 text-xs text-text-muted">
          Showing the top {rows.length} of {parties.total} {parties.plural}.
        </p>
      )}
    </Card>
  );
}

export function OpenAgeingCard({
  ageing,
  display,
  className,
}: {
  ageing: OpenAgeingProps;
  display: "bars" | "list";
  className?: string;
}): React.JSX.Element {
  const owed = ageing.rows.some((row) => row.value > 0);
  return (
    <Card
      className={cn(
        "p-3",
        display === "list" && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <CardHeader
        className="mb-1.5"
        title={ageing.title}
        description={ageing.description}
      />
      <div
        className={cn(
          display === "list" && "min-h-0 flex-1 overflow-y-auto pr-1",
        )}
      >
        {owed ? (
          display === "bars" ? (
            <RankedBars
              rows={ageing.rows}
              formatValue={formatMmk}
              empty={ageing.empty}
              colors={[
                SERIES_COLORS.green,
                SERIES_COLORS.amber,
                "var(--color-error)",
              ]}
            />
          ) : (
            <RankedList
              rows={ageing.rows}
              formatValue={formatMmk}
              empty={ageing.empty}
            />
          )
        ) : (
          <p className="py-4 text-center text-xs text-text-muted">
            {ageing.empty}
          </p>
        )}
      </div>
    </Card>
  );
}

/** What is still open, shown under a period's own figures: who has the most left, and how old
 *  what is left is. It is every open order or voucher, whatever the period, so the heading says
 *  so. */
export function OpenLeftSection({
  parties,
  ageing,
  display = "bars",
}: {
  parties: OpenPartiesProps;
  ageing: OpenAgeingProps;
  display?: "bars" | "list";
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <StillOpenHeading />
      <div
        className={cn(
          "grid grid-cols-1 gap-3 lg:grid-cols-2",
          display === "bars" && "items-start",
          display === "list" && "lg:h-80",
        )}
      >
        <OpenPartiesCard parties={parties} display={display} />
        <OpenAgeingCard ageing={ageing} display={display} />
      </div>
    </section>
  );
}

/** The line that tells the reader the section below ignores the period chosen above. */
export function StillOpenHeading(): React.JSX.Element {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
      Still open · not affected by the period
    </h2>
  );
}
