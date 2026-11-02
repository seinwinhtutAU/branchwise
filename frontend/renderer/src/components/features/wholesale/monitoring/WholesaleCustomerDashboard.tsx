import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { RefreshingHint } from "@renderer/components/features/dashboard/shared";
import {
  formatCount,
  formatShortDate,
} from "@renderer/components/features/dashboard/helpers";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";
import { DashboardError, DashboardLoading, RankedList } from "./dashboardParts";
import {
  NEW_REPEAT_SERIES,
  SERIES_COLORS,
  deltaText,
  formatMmk,
  formatShare,
} from "./dashboardFormat";
import {
  dashboardTabUrl,
  type CustomerDashboardData,
  type DashboardWindow,
  OPEN_CUSTOMER_URL,
  type OpenCustomerDashboardData,
} from "./dashboardApi";
import { ColumnChart } from "./ColumnChart";
import { QuietCard } from "./OpenCustomerSection";

const MONTH_ONLY = { month: "short" } as const;

/** "2026-09" as "Sep '26" for the axis, and "September 2026" for the hover. */
function monthLabels(month: string): { label: string; title: string } {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1, 1);
  return {
    label: `${date.toLocaleDateString(undefined, MONTH_ONLY)} '${String(year).slice(2)}`,
    title: date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    }),
  };
}

function customers(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "customer" : "customers"}`;
}

/** Trim the fixed 12-month response to the part where customers actually ordered. */
function monthsWithOrders(
  rows: CustomerDashboardData["customers_by_month"],
): CustomerDashboardData["customers_by_month"] {
  const ordered = rows
    .map((row, index) => ({
      index,
      hasOrders: row.new_customers + row.repeat_customers > 0,
    }))
    .filter((row) => row.hasOrders)
    .map((row) => row.index);
  if (ordered.length === 0) return rows.slice(-3);
  return rows.slice(ordered[0], ordered.at(-1)! + 1);
}

function CustomerSummary({
  data,
}: {
  data: CustomerDashboardData;
}): React.JSX.Element {
  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border bg-bg-subtle/40 px-4 py-3 text-sm font-medium text-text-primary">
        {data.headline}
      </p>
      <section className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Customers who ordered
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatCount(data.active_customers.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {deltaText(data.active_customers) ?? "Placed an order this period"}
          </div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            New customers
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatCount(data.new_customers.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {deltaText(data.new_customers) ?? "First order this period"}
          </div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Repeat customers
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatCount(data.repeat_customers.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {formatShare(data.repeat_customers.share_of_active_pct)} of those
            who ordered
          </div>
        </div>
      </section>
    </Card>
  );
}

function NewRepeatCard({
  data,
  totalSales,
  className,
}: {
  data: CustomerDashboardData;
  totalSales: number;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3", className)}>
      <CardHeader
        className="mb-1.5"
        title="New and repeat customers"
        description="What each group ordered this period."
      />
      {totalSales > 0 ? (
        <RankedList
          rows={[
            {
              label: "New customers",
              value: data.sales_from_new,
              sub: formatShare((data.sales_from_new / totalSales) * 100),
            },
            {
              label: "Repeat customers",
              value: data.sales_from_repeat,
              sub: formatShare((data.sales_from_repeat / totalSales) * 100),
            },
          ]}
          formatValue={formatMmk}
          empty="No orders this period."
        />
      ) : (
        <p className="py-4 text-center text-xs text-text-muted">
          No orders this period.
        </p>
      )}
    </Card>
  );
}

function NewCustomersCard({
  rows,
  onOpenCustomer,
  className,
}: {
  rows: CustomerDashboardData["new_customer_list"];
  onOpenCustomer?: (name: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3", className)}>
      <CardHeader
        className="mb-1.5"
        title="New customers"
        description="Who ordered for the first time, biggest first order first."
      />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">
          No new customers this period.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
          {rows.map((row) => (
            <li key={row.name}>
              <button
                type="button"
                disabled={!onOpenCustomer}
                onClick={() => onOpenCustomer?.(row.name)}
                className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left text-sm enabled:cursor-pointer enabled:hover:bg-bg-subtle"
                title={onOpenCustomer ? `Open ${row.name}` : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text-primary">
                    {row.name}
                  </span>
                  <span className="block text-xs text-text-muted">
                    first order {formatShortDate(row.first_order, true)}
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-text-primary">
                  {formatMmk(row.first_order_value)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WholesaleCustomerDashboard({
  session,
  window,
  onOpenCustomer,
}: {
  session: Session;
  window: DashboardWindow;
  onOpenCustomer?: (name: string) => void;
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<CustomerDashboardData>(
      dashboardTabUrl("customer", window),
      session,
      "Customer dashboard",
    );
  const { data: openData } = useUrlQuery<OpenCustomerDashboardData>(
    OPEN_CUSTOMER_URL,
    session,
    "Open customers dashboard",
  );
  // A copy saved by an older version of the app lacks the new fields: treat it as not loaded.
  if (data === undefined || data.headline === undefined) {
    return failed ? (
      <DashboardError title="Customer" reload={reload} />
    ) : (
      <DashboardLoading tiles={3} />
    );
  }

  const totalSales = data.sales_from_new + data.sales_from_repeat;
  const activeMonths = monthsWithOrders(data.customers_by_month);

  return (
    <div className="flex flex-col gap-2.5">
      <RefreshingHint show={isRefreshing} />

      <CustomerSummary data={data} />

      <div className="grid grid-cols-1 gap-3 lg:h-[21rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Card className="p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="Orders by day"
            description="What was ordered each day, from new and repeat customers."
          />
          <ColumnChart
            ariaLabel="Order value by day, from new and repeat customers"
            series={NEW_REPEAT_SERIES}
            points={data.orders_by_day.map((day) => ({
              label: formatShortDate(day.date),
              title: formatShortDate(day.date, true),
              values: [day.new_customers, day.repeat_customers],
            }))}
            formatValue={formatMmk}
            maxLabels={10}
            view="bar"
          />
        </Card>
        <NewRepeatCard data={data} totalSales={totalSales} className="h-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:h-[21rem] lg:grid-cols-2">
        <Card className="rounded-md p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="Customers by month"
            description="How many customers ordered each month, in the months with orders."
          />
          <ColumnChart
            ariaLabel="Customers who ordered each month, new and repeat"
            series={NEW_REPEAT_SERIES}
            points={activeMonths.map((row) => {
              const names = monthLabels(row.month);
              return {
                ...names,
                values: [row.new_customers, row.repeat_customers],
              };
            })}
            formatValue={customers}
            formatTick={formatCount}
            minMax={4}
            view="bar"
          />
        </Card>

        <Card className="rounded-md p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="How often customers buy"
            description={
              data.typical_gap_days === null
                ? "Days between orders, for the customers who ordered this period."
                : `Days between orders, for the customers who ordered this period. Usually every ${data.typical_gap_days} ${data.typical_gap_days === 1 ? "day" : "days"}.`
            }
          />
          {data.frequency.some((band) => band.customer_count > 0) ? (
            <ColumnChart
              ariaLabel="Customers who ordered this period, by how often they usually order"
              series={[{ name: "Customers", color: SERIES_COLORS.primary }]}
              points={data.frequency.map((band) => ({
                label: band.label,
                title: band.label,
                values: [band.customer_count],
              }))}
              formatValue={customers}
              formatTick={formatCount}
              minMax={4}
              maxLabels={4}
              view="bar"
            />
          ) : (
            <p className="py-4 text-center text-xs text-text-muted">
              Not enough orders yet to tell.
            </p>
          )}
          {data.pattern_unknown_count > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              {customers(data.pattern_unknown_count)} have ordered on fewer than
              3 different days, so we cannot tell their usual buying gap yet.
            </p>
          )}
        </Card>
      </div>

      {openData?.waiting !== undefined && (
        <div className="grid grid-cols-1 gap-3 lg:h-80 lg:grid-cols-2">
          <NewCustomersCard
            rows={data.new_customer_list}
            onOpenCustomer={onOpenCustomer}
            className="flex h-full min-h-0 flex-col"
          />
          <QuietCard
            rows={openData.quiet}
            total={openData.quiet_count}
            unknown={openData.pattern_unknown_count}
            anyPattern={openData.pattern_known_count > 0}
            onOpen={onOpenCustomer}
            className="flex h-full min-h-0 flex-col"
            listClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          />
        </div>
      )}
    </div>
  );
}

export default WholesaleCustomerDashboard;
