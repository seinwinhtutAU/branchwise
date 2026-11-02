import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import {
  ChartViewToggle,
  RefreshingHint,
} from "@renderer/components/features/dashboard/shared";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";
import { DashboardError, DashboardLoading, RankedList } from "./dashboardParts";
import { deltaText, formatMmk, formatShare } from "./dashboardFormat";
import {
  dashboardTabUrl,
  type DashboardWindow,
  type RevenueDashboardData,
  type RevenueShare,
} from "./dashboardApi";
import { PaceChart, PaceLegend, type PaceView } from "./PaceChart";
import { RankingCard } from "./RankingCard";

function ShareCard({
  title,
  description,
  rows,
  empty,
  className,
}: {
  title: string;
  description: string;
  rows: RevenueShare[];
  empty: string;
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3", className)}>
      <CardHeader className="mb-1.5" title={title} description={description} />
      {rows.length > 0 ? (
        <RankedList
          rows={rows.map((row) => ({ label: row.name, value: row.share_pct }))}
          formatValue={formatShare}
          empty={empty}
        />
      ) : (
        <p className="py-4 text-center text-xs text-text-muted">{empty}</p>
      )}
    </Card>
  );
}

function RevenueSummary({
  data,
}: {
  data: RevenueDashboardData;
}): React.JSX.Element {
  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border bg-bg-subtle/40 px-4 py-3 text-sm font-medium text-text-primary">
        {data.headline}
      </p>
      <section className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Potential revenue
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatMmk(data.sales.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {deltaText(data.sales) ?? "Orders placed this period"}
          </div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Received revenue
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatMmk(data.collected.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {deltaText(data.collected) ??
              "Customer payments received this period"}
          </div>
        </div>
      </section>
    </Card>
  );
}

/** The wholesale Dashboard's Revenue tab. It answers three questions: are we selling more or
 *  less than before, who is behind it, and is the money coming in. A sentence at the top says
 *  it in words (built on the server from the same figures), four read-only numbers follow,
 *  then what changed, the pace against the period before, and who the revenue depends on. */
export function WholesaleRevenueDashboard({
  session,
  window,
}: {
  session: Session;
  window: DashboardWindow;
}): React.JSX.Element {
  const [trendView, setTrendView] = useState<PaceView>("bar");
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<RevenueDashboardData>(
      dashboardTabUrl("revenue", window),
      session,
      "Revenue dashboard",
    );
  // A copy saved by an older version of the app has none of the new fields: treat it as not
  // loaded yet, and the fresh answer replaces it.
  if (data === undefined || data.sales === undefined) {
    return failed ? (
      <DashboardError title="Revenue" reload={reload} />
    ) : (
      <DashboardLoading tiles={4} />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <RefreshingHint show={isRefreshing} />

      <RevenueSummary data={data} />

      <div className="grid grid-cols-1 gap-3 lg:h-[21rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Card className="p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="Potential revenue by day"
            description="Orders placed each day, against the period before."
            action={
              <ChartViewToggle view={trendView} onChange={setTrendView} />
            }
          />
          <PaceLegend
            dateFrom={data.date_from}
            dateTo={data.date_to}
            previousFrom={data.previous_date_from}
            previousTo={data.previous_date_to}
            view={trendView}
          />
          <PaceChart
            ariaLabel="Potential revenue from orders placed each day against the matching day before"
            view={trendView}
            points={data.trend.map((day) => ({
              date: day.date,
              now: day.sales,
              before: day.previous_sales,
            }))}
          />
        </Card>
        <ShareCard
          className="h-full"
          title="Product groups"
          description="Share of this period's orders."
          rows={data.top_groups}
          empty="No orders this period."
        />
      </div>

      <section className="grid grid-cols-1 gap-3 lg:h-80 lg:grid-cols-2">
        <RankingCard
          title="Top customers by order value"
          display="list"
          className="flex h-full min-h-0 flex-col"
          listClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          description="Customers with the highest order value this period."
          empty="No customer orders this period."
          rows={data.top_customers.map((row) => ({
            ...row,
            amount: row.revenue,
          }))}
        />
        <RankingCard
          title="Top products by order value"
          display="list"
          className="flex h-full min-h-0 flex-col"
          listClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          description="Products with the highest order value this period."
          empty="No products ordered this period."
          rows={data.top_selling_products.map((row) => ({
            ...row,
            amount: row.revenue,
          }))}
        />
      </section>
    </div>
  );
}

export default WholesaleRevenueDashboard;
