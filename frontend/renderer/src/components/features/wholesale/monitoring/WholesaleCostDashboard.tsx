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
  type CostDashboardData,
  type DashboardWindow,
} from "./dashboardApi";
import { PaceChart, PaceLegend, type PaceView } from "./PaceChart";
import { RankingCard } from "./RankingCard";

interface CostPart {
  label: string;
  value: number;
  share: number;
}

function CostSummary({ data }: { data: CostDashboardData }): React.JSX.Element {
  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border bg-bg-subtle/40 px-4 py-3 text-sm font-medium text-text-primary">
        {data.headline}
      </p>
      <section className="grid grid-cols-1 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Total cost
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatMmk(data.total.value)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {deltaText(data.total) ?? "Bought this period"}
          </div>
        </div>
        <ProfitMetric
          label="Gross profit"
          value={data.profit.gross_profit.value}
        />
        <ProfitMetric
          label="Gross margin"
          value={data.profit.gross_margin_pct.value}
          format={formatShare}
        />
        <ProfitMetric label="Net profit" value={data.profit.net_profit.value} />
      </section>
      {data.profit.reason ? (
        <p className="border-t border-border bg-bg-subtle/40 px-4 py-2 text-xs text-text-muted">
          {data.profit.reason}
        </p>
      ) : null}
    </Card>
  );
}

function ProfitMetric({
  label,
  value,
  format = formatMmk,
}: {
  label: string;
  value: number | null;
  format?: (value: number) => string;
}): React.JSX.Element {
  return (
    <div className="px-4 py-4 sm:py-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-text-primary">
        {value === null ? "—" : format(value)}
      </div>
    </div>
  );
}

function CostBreakdownCard({
  parts,
  className,
}: {
  parts: CostPart[];
  className?: string;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3", className)}>
      <CardHeader
        className="mb-1.5"
        title="Cost breakdown"
        description="Products bought and transportation cost."
      />
      <RankedList
        rows={parts.map((part) => ({
          label: part.label,
          value: part.value,
          sub: formatShare(part.share),
        }))}
        formatValue={formatMmk}
        empty="Nothing was bought this period."
      />
    </Card>
  );
}

export function WholesaleCostDashboard({
  session,
  window,
}: {
  session: Session;
  window: DashboardWindow;
}): React.JSX.Element {
  const [trendView, setTrendView] = useState<PaceView>("bar");
  const { data, isRefreshing, failed, reload } = useUrlQuery<CostDashboardData>(
    dashboardTabUrl("cost", window),
    session,
    "Cost dashboard",
  );
  // A copy saved by an older version of the app lacks the new fields: treat it as not loaded.
  if (
    data === undefined ||
    data.total === undefined ||
    data.profit === undefined
  ) {
    return failed ? (
      <DashboardError title="Cost" reload={reload} />
    ) : (
      <DashboardLoading tiles={3} />
    );
  }

  const parts = [
    {
      label: "Products bought",
      value: data.goods_purchased,
      share: data.goods_share_pct,
    },
    {
      label: "Transportation cost",
      value: data.cost_to_bring_in,
      share: data.cost_share_pct,
    },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <RefreshingHint show={isRefreshing} />

      <CostSummary data={data} />

      <div className="grid grid-cols-1 gap-3 lg:h-[21rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Card className="p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="Profit by day"
            description="Net profit from delivered revenue, product cost and transportation cost."
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
            ariaLabel="Net profit each day this period against the matching day before"
            view={trendView}
            points={data.trend.map((day) => ({
              date: day.date,
              now: day.net_profit,
              before: day.previous_net_profit,
            }))}
          />
        </Card>
        <CostBreakdownCard parts={parts} className="h-full" />
      </div>

      <section className="grid grid-cols-1 gap-3 lg:h-80 lg:grid-cols-2">
        <RankingCard
          title="Top suppliers by purchase value"
          display="list"
          className="flex h-full min-h-0 flex-col"
          listClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          description="Suppliers with the highest purchase value this period."
          empty="No supplier purchases this period."
          rows={data.top_suppliers}
        />
        <RankingCard
          title="Top products by purchase value"
          display="list"
          className="flex h-full min-h-0 flex-col"
          listClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          description="Products with the highest purchase value this period."
          empty="No products purchased this period."
          rows={data.top_products}
        />
      </section>
    </div>
  );
}

export default WholesaleCostDashboard;
