import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import {
  formatCount,
  formatShortDate,
} from "@renderer/components/features/dashboard/helpers";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";
import {
  OPEN_CUSTOMER_URL,
  type OpenCustomerDashboardData,
  type QuietCustomer,
} from "./dashboardApi";
import { StillOpenHeading } from "./OpenLeftSection";

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** A row that opens the customer on the Customers page. */
function CustomerRow({
  name,
  onOpen,
  children,
}: {
  name: string;
  onOpen?: (name: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        disabled={!onOpen}
        onClick={() => onOpen?.(name)}
        className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left text-sm enabled:cursor-pointer enabled:hover:bg-bg-subtle"
        title={onOpen ? `Open ${name}` : undefined}
      >
        {children}
      </button>
    </li>
  );
}

export function QuietCard({
  rows,
  total,
  unknown,
  anyPattern,
  onOpen,
  className,
  listClassName,
}: {
  rows: QuietCustomer[];
  total: number;
  /** Customers with too few orders to know their usual gap. */
  unknown: number;
  /** Whether any customer has a usual gap at all. */
  anyPattern: boolean;
  onOpen?: (name: string) => void;
  className?: string;
  listClassName?: string;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3", className)}>
      <CardHeader
        className="mb-1.5"
        title="Who has not ordered for a while"
        description="Customers who have not ordered for longer than usual."
      />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">
          {!anyPattern
            ? "Not enough orders yet to tell."
            : unknown > 0
              ? `Everyone is ordering as usual. ${formatCount(unknown)} ${unknown === 1 ? "customer has" : "customers have"} too few orders to check.`
              : "Everyone is ordering as usual."}
        </p>
      ) : (
        <ul className={cn("flex flex-col", listClassName)}>
          {rows.map((row) => (
            <CustomerRow key={row.name} name={row.name} onOpen={onOpen}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text-primary">
                  {row.name}
                </span>
                <span className="block text-xs text-text-muted">
                  usually every {days(row.usual_gap_days)} · {row.order_count}{" "}
                  orders
                </span>
              </span>
              <span className="w-36 shrink-0 text-right">
                <span className="block font-semibold tabular-nums text-text-primary">
                  {days(row.days_since)} ago
                </span>
                <span className="block text-[11px] text-text-muted">
                  last order {formatShortDate(row.last_order, true)}
                </span>
              </span>
            </CustomerRow>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <p className="mt-2 text-xs text-text-muted">
          Showing the {rows.length} most overdue of {total} customers.
        </p>
      )}
    </Card>
  );
}

/** Under the Customer tab's period figures: who has not ordered for longer than their own usual
 *  gap. It looks at every customer's whole history, whatever the period, so the heading says so.
 *  Shows nothing until it has loaded. */
export function OpenCustomerSection({
  session,
  onOpenCustomer,
}: {
  session: Session;
  onOpenCustomer?: (name: string) => void;
}): React.JSX.Element | null {
  const { data } = useUrlQuery<OpenCustomerDashboardData>(
    OPEN_CUSTOMER_URL,
    session,
    "Open customers dashboard",
  );
  // A copy saved by an older version of the app lacks the new fields: treat it as not loaded.
  if (data === undefined || data.waiting === undefined) return null;
  return (
    <section className="flex flex-col gap-2">
      <StillOpenHeading />
      <QuietCard
        rows={data.quiet}
        total={data.quiet_count}
        unknown={data.pattern_unknown_count}
        anyPattern={data.pattern_known_count > 0}
        onOpen={onOpenCustomer}
      />
    </section>
  );
}
