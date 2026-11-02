import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import { SERIES_COLORS, formatMmk } from "./dashboardFormat";
import {
  OPEN_COST_URL,
  OPEN_CUSTOMER_URL,
  OPEN_REVENUE_URL,
  type OpenCostDashboardData,
  type OpenCustomerDashboardData,
  type OpenRevenueDashboardData,
} from "./dashboardApi";
import { OrderFulfillmentCard } from "./OrderFulfillmentCard";
import { Board, type BoardColumn } from "./SummaryBoard";
import { type WholesaleDashboardDrilldown } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";

const FULFILLMENT_DRILLDOWN_FILTER = {
  waiting_for_stock: "waiting-for-stock",
  ready_to_deliver: "ready-to-deliver",
  partly_delivered: "partly-delivered",
  fulfilled: "delivered",
} as const;

function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** The Summary's "Open now": two money KPIs — what customers still owe and what is still owed
 *  to suppliers — followed by where open orders are in fulfillment. It reuses the Revenue, Cost
 *  and Customer tabs' own Open now figures, so every number here matches those pages. */
export function OpenSummary({
  session,
  onOpenDrilldown,
}: {
  session: Session;
  /** Opens the operational directory with the exact Dashboard context preserved. */
  onOpenDrilldown: (target: WholesaleDashboardDrilldown) => void;
}): React.JSX.Element {
  const revenue = useUrlQuery<OpenRevenueDashboardData>(
    OPEN_REVENUE_URL,
    session,
    "Open orders dashboard",
  );
  const cost = useUrlQuery<OpenCostDashboardData>(
    OPEN_COST_URL,
    session,
    "Open vouchers dashboard",
  );
  const customer = useUrlQuery<OpenCustomerDashboardData>(
    OPEN_CUSTOMER_URL,
    session,
    "Open customers dashboard",
  );

  const r = revenue.data;
  const c = cost.data;
  const d = customer.data;
  // A copy saved by an older version of the app lacks the new fields: treat it as not loaded.
  if (
    r === undefined ||
    r.debtors === undefined ||
    c === undefined ||
    c.suppliers === undefined ||
    d === undefined ||
    d.fulfillment === undefined
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

  const columns: BoardColumn[] = [
    {
      big: {
        label: "Left to collect",
        value: formatMmk(r.left),
        warn: r.left > 0,
      },
      bar: {
        fraction: r.open_total > 0 ? r.received / r.open_total : 0,
        caption: `${percent(r.open_total > 0 ? r.received / r.open_total : 0)} received`,
        color: SERIES_COLORS.green,
      },
      facts: [
        { label: "Open orders total", value: formatMmk(r.open_total) },
        { label: "Received", value: formatMmk(r.received) },
      ],
      action: {
        label: "View unpaid orders",
        onClick: () =>
          onOpenDrilldown({ section: "customers", filter: "unpaid" }),
      },
    },
    {
      big: {
        label: "Left to pay",
        value: formatMmk(c.left),
        warn: c.left > 0,
      },
      bar: {
        fraction: c.open_total > 0 ? c.paid / c.open_total : 0,
        caption: `${percent(c.open_total > 0 ? c.paid / c.open_total : 0)} paid`,
        color: SERIES_COLORS.green,
      },
      facts: [
        { label: "Open vouchers total", value: formatMmk(c.open_total) },
        { label: "Paid", value: formatMmk(c.paid) },
      ],
      action: {
        label: "View unpaid vouchers",
        onClick: () =>
          onOpenDrilldown({ section: "suppliers", filter: "unpaid" }),
      },
    },
  ];

  return (
    <>
      <Board columns={columns} separateCards />
      <OrderFulfillmentCard
        stages={d.fulfillment}
        onOpenStage={(stage) =>
          onOpenDrilldown({
            section: "customers",
            filter: FULFILLMENT_DRILLDOWN_FILTER[stage],
          })
        }
      />
    </>
  );
}
