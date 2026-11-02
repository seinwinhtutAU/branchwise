import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { formatCount } from "@renderer/components/features/dashboard/helpers";
import { Card } from "@renderer/components/ui/Card";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import { deltaText, formatMmk, formatShare } from "./dashboardFormat";
import {
  dashboardTabUrl,
  type CostDashboardData,
  type CustomerDashboardData,
  type DashboardWindow,
  type RevenueDashboardData,
} from "./dashboardApi";

interface PeriodMetric {
  label: string;
  value: string;
  detail?: string;
  emphasis?: "primary" | "warning";
}

function PeriodOverviewCard({
  title,
  description,
  metrics,
  onOpen,
}: {
  title: string;
  description: string;
  metrics: PeriodMetric[];
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-bg-subtle/40 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 text-xs font-medium text-brand hover:underline"
        >
          Details →
        </button>
      </div>
      <dl className="grid flex-1 grid-cols-2">
        {metrics.map((metric, index) => {
          const isPrimary = metric.emphasis === "primary";
          return (
            <div
              key={metric.label}
              className={
                isPrimary
                  ? "col-span-2 px-4 py-4"
                  : metrics.length === 2
                    ? "col-span-2 border-t border-border px-4 py-3"
                    : index % 2 === 0
                      ? "min-w-0 border-l border-t border-border px-4 py-3"
                      : "min-w-0 border-t border-border px-4 py-3"
              }
            >
              <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {metric.label}
              </dt>
              <dd
                className={
                  isPrimary
                    ? "mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary"
                    : metric.emphasis === "warning"
                      ? "mt-1 text-lg font-bold tabular-nums tracking-tight text-warning"
                      : "mt-1 text-lg font-bold tabular-nums tracking-tight text-text-primary"
                }
              >
                {metric.value}
              </dd>
              {metric.detail && (
                <p className="mt-1 text-xs leading-4 text-text-muted">
                  {metric.detail}
                </p>
              )}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/** The Summary's "By period" puts the headline numbers from Revenue, Cost and Customers in
 * matching cards. The fuller analysis remains one click away on its own tab. */
export function PeriodSummary({
  session,
  window,
  onSelectTab,
}: {
  session: Session;
  window: DashboardWindow;
  onSelectTab: (tab: "revenue" | "cost" | "customer") => void;
}): React.JSX.Element {
  const revenue = useUrlQuery<RevenueDashboardData>(
    dashboardTabUrl("revenue", window),
    session,
    "Revenue dashboard",
  );
  const cost = useUrlQuery<CostDashboardData>(
    dashboardTabUrl("cost", window),
    session,
    "Cost dashboard",
  );
  const customer = useUrlQuery<CustomerDashboardData>(
    dashboardTabUrl("customer", window),
    session,
    "Customer dashboard",
  );

  const r = revenue.data;
  const c = cost.data;
  const d = customer.data;
  // A copy saved by an older version of the app lacks the new fields: treat it as not loaded.
  if (
    r === undefined ||
    r.sales === undefined ||
    c === undefined ||
    c.total === undefined ||
    c.profit === undefined ||
    d === undefined ||
    d.headline === undefined
  ) {
    if (revenue.failed || cost.failed || customer.failed) {
      return (
        <DashboardError
          title="Summary"
          reload={async () => {
            await Promise.all([
              revenue.reload(),
              cost.reload(),
              customer.reload(),
            ]);
          }}
        />
      );
    }
    return <DashboardLoading tiles={3} />;
  }

  return (
    <section aria-labelledby="period-performance-heading">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2
            id="period-performance-heading"
            className="text-base font-semibold tracking-tight text-text-primary"
          >
            Period performance
          </h2>
          <p className="text-xs text-text-muted">
            Revenue, cost, and customer activity for the selected period.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <PeriodOverviewCard
          title="Revenue"
          description="Orders and payments in this period."
          onOpen={() => onSelectTab("revenue")}
          metrics={[
            {
              label: "Potential revenue",
              value: formatMmk(r.sales.value),
              detail: deltaText(r.sales) ?? "Orders placed this period",
              emphasis: "primary",
            },
            {
              label: "Received",
              value: formatMmk(r.sales_received),
              detail: "Paid against these orders",
            },
          ]}
        />
        <PeriodOverviewCard
          title="Cost"
          description="Purchases and profit for this period."
          onOpen={() => onSelectTab("cost")}
          metrics={[
            {
              label: "Total cost",
              value: formatMmk(c.total.value),
              detail: deltaText(c.total) ?? "Bought this period",
              emphasis: "primary",
            },
            {
              label: "Paid",
              value: formatMmk(c.paid),
              detail: "Paid against these purchases",
            },
            {
              label: "Gross profit",
              value:
                c.profit.gross_profit.value === null
                  ? "—"
                  : formatMmk(c.profit.gross_profit.value),
            },
          ]}
        />
        <PeriodOverviewCard
          title="Customers"
          description="Who bought from you in this period."
          onOpen={() => onSelectTab("customer")}
          metrics={[
            {
              label: "Customers who ordered",
              value: formatCount(d.active_customers.value),
              detail:
                deltaText(d.active_customers) ?? "Placed an order this period",
              emphasis: "primary",
            },
            {
              label: "New customers",
              value: formatCount(d.new_customers.value),
              detail: deltaText(d.new_customers) ?? "First order this period",
            },
            {
              label: "Repeat customers",
              value: formatCount(d.repeat_customers.value),
              detail: `${formatShare(d.repeat_customers.share_of_active_pct)} of customers who ordered`,
            },
          ]}
        />
      </div>
    </section>
  );
}
