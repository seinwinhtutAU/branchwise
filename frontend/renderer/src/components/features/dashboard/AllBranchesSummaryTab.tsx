import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  DashboardIcon,
  DollarIcon,
  InventoryIcon,
  TrendingUpIcon,
  UsersIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { RefreshingHint } from "./shared";
import {
  activeMonthRange,
  dashboardUrl,
  formatCompactMmk,
  formatExecutivePeriod,
  type AllBranchMonthlyTrend,
  type AllBranchSummaryRow,
  type AllSummaryDashboardData,
  type PeriodKey,
} from "./helpers";

interface Props {
  session: Session;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
  onViewInventoryList?: () => void;
}

const CHART_COLORS = ["#2563eb", "#22a06b", "#f59e0b", "#7c3aed", "#e45b75", "#0891b2"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(value: number): string {
  return `Ks ${formatCompactMmk(value)}`;
}

function percent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}%`;
}

function SummaryKpi({
  label,
  value,
  detail,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      data-explain=""
      className={cn(
        "flex min-h-[126px] flex-col justify-between rounded-xl border border-border bg-bg-base p-4 shadow-xs",
        onClick && "cursor-pointer transition-colors hover:border-border-strong hover:bg-bg-subtle/40",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", tone)}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-text-secondary">{label}</span>
      </div>
      <div>
        <div className="text-xl font-extrabold tracking-tight text-text-primary sm:text-2xl">
          {value}
        </div>
        <div className="mt-1 text-xs text-text-muted">{detail}</div>
      </div>
    </div>
  );
}

function BranchPerformanceTable({ rows }: { rows: AllBranchSummaryRow[] }): React.JSX.Element {
  return (
    <section data-explain="" className="rounded-xl border border-border bg-bg-base p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <UsersIcon className="h-5 w-5 text-brand" />
        <h2 className="text-base font-bold text-text-primary">Branch Performance</h2>
      </div>
      <TableContainer>
        <Thead>
          <Tr>
            <Th>Branch</Th>
            <Th className="text-right">Sales</Th>
            <Th className="text-right">Growth</Th>
            <Th className="text-right">Gross Profit</Th>
            <Th className="text-right">Gross Margin</Th>
            <Th className="text-right">Pairs Sold</Th>
            <Th className="text-right">Avg Transaction</Th>
            <Th className="text-right">Inventory Value</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => (
            <Tr key={row.branch_id}>
              <Td className="font-semibold text-brand whitespace-nowrap">{row.branch_name}</Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{money(row.sales)}</Td>
              <Td className={cn("text-right tabular-nums whitespace-nowrap font-semibold", row.growth_pct !== null && row.growth_pct >= 0 ? "text-success" : "text-error")}>
                {percent(row.growth_pct)}
              </Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{money(row.profit)}</Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{row.margin_pct.toFixed(1)}%</Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{Math.round(row.pairs_sold).toLocaleString()}</Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{money(row.avg_transaction)}</Td>
              <Td className="text-right tabular-nums whitespace-nowrap">{money(row.inventory_value)}</Td>
            </Tr>
          ))}
        </Tbody>
      </TableContainer>
    </section>
  );
}

function SalesTrendChart({ branches }: { branches: AllBranchMonthlyTrend[] }): React.JSX.Element {
  const range = activeMonthRange(branches);
  if (!range) {
    return <p className="py-10 text-center text-xs text-text-muted">No sales in this period yet.</p>;
  }
  const [firstMonth, lastMonth] = range;
  const months = MONTH_LABELS.slice(firstMonth, lastMonth + 1);
  const single = months.length === 1;
  const width = 720;
  const height = 250;
  const left = 48;
  const right = 16;
  const top = 16;
  const bottom = 36;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const series = branches.map((branch) => branch.monthly.slice(firstMonth, lastMonth + 1));
  const maxValue = Math.max(1, ...series.flat());
  // One month has no line to draw: its points sit in the middle and the numbers are in the legend.
  const x = (index: number): number =>
    single ? left + plotWidth / 2 : left + (index / (months.length - 1)) * plotWidth;
  const y = (value: number): number => top + plotHeight - (value / maxValue) * plotHeight;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Sales trend by branch">
        {[0, 0.5, 1].map((tick) => {
          const tickY = top + plotHeight - tick * plotHeight;
          return (
            <g key={tick}>
              <line x1={left} y1={tickY} x2={width - right} y2={tickY} stroke="var(--color-border)" />
              <text x={left - 8} y={tickY + 4} textAnchor="end" className="fill-text-muted text-[10px]">
                {formatCompactMmk(maxValue * tick)}
              </text>
            </g>
          );
        })}
        {months.map((month, index) => (
          <text key={month} x={x(index)} y={height - 12} textAnchor="middle" className="fill-text-muted text-[10px]">
            {month}
          </text>
        ))}
        {series.map((values, branchIndex) => {
          const color = CHART_COLORS[branchIndex % CHART_COLORS.length];
          return (
            <g key={branches[branchIndex].branch_id}>
              {!single && (
                <polyline
                  points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {values.map((value, index) => (
                <circle key={index} cx={x(index)} cy={y(value)} r={single ? 6 : 3} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        {branches.map((branch, index) => (
          <span key={branch.branch_id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
            {branch.branch_name}
            {single && (
              <span className="font-semibold text-text-primary">{formatCompactMmk(series[index][0] ?? 0)}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContributionChart({ rows }: { rows: AllBranchSummaryRow[] }): React.JSX.Element {
  const total = rows.reduce((sum, row) => sum + row.sales, 0);
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center justify-center gap-5 py-2">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 144 144" className="h-full w-full -rotate-90">
          <circle cx="72" cy="72" r={radius} fill="none" stroke="var(--color-bg-raised)" strokeWidth="24" />
          {rows.map((row, index) => {
            const length = total > 0 ? (row.sales / total) * circumference : 0;
            const circle = (
              <circle
                key={row.branch_id}
                cx="72"
                cy="72"
                r={radius}
                fill="none"
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth="24"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] text-text-muted">Total Sales</span>
          <span className="text-sm font-extrabold leading-tight text-text-primary">{formatCompactMmk(total)}</span>
        </div>
      </div>
      <div className="flex min-w-[10rem] flex-col gap-2 text-xs">
        {rows.map((row, index) => (
          <div key={row.branch_id} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2 text-text-secondary">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
              {row.branch_name}
            </span>
            <span className="font-semibold tabular-nums text-text-primary">{total ? ((row.sales / total) * 100).toFixed(1) : "0.0"}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueProfitChart({ rows }: { rows: AllBranchSummaryRow[] }): React.JSX.Element {
  // Plain rows with real text instead of a drawing scaled down to fit: in a narrow card the old SVG shrank its
  // labels until nothing could be read (and used to scroll the last branch out of sight).
  const max = Math.max(1, ...rows.flatMap((row) => [row.sales, row.profit]));
  const bar = (value: number): string => `${Math.max(0, (value / max) * 100)}%`;
  return (
    <div role="img" aria-label="Revenue versus gross profit by branch" className="flex flex-col gap-3 pt-1">
      {rows.map((row) => (
        <div key={row.branch_id} className="flex flex-col gap-1">
          <div className="text-xs font-semibold text-text-secondary">{row.branch_name}</div>
          {[
            { label: "Revenue", value: row.sales, color: "bg-[#2563eb]" },
            { label: "Gross profit", value: row.profit, color: "bg-[#22a06b]" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2" title={`${item.label}: ${money(item.value)}`}>
              <div className="h-3 flex-1 overflow-hidden rounded-sm bg-bg-raised">
                <div className={cn("h-full rounded-sm", item.color)} style={{ width: bar(item.value) }} />
              </div>
              <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
                {formatCompactMmk(item.value)}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="flex justify-center gap-4 pt-1 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#2563eb]" />Revenue</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#22a06b]" />Gross profit</span>
      </div>
    </div>
  );
}

export function AllBranchesSummaryTab({
  session,
  period,
  dateFrom,
  dateTo,
  month,
  onViewInventoryList,
}: Props): React.JSX.Element {
  const url = dashboardUrl("all-summary", "", { period, dateFrom, dateTo, month });
  const { data, isRefreshing, failed, reload } = useUrlQuery<AllSummaryDashboardData>(url, session, "All branches summary");

  if (!data) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the all-branches summary"
          description="Something went wrong reaching the dashboard data."
          action={<Button variant="secondary" size="sm" onClick={reload}>Try again</Button>}
        />
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}</div>
        <Skeleton className="h-72 w-full rounded-xl" />
        <div className="grid gap-3 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-72 rounded-xl" />)}</div>
      </div>
    );
  }

  const { kpis, branches } = data;
  return (
    <div className="flex flex-col gap-4">
      <RefreshingHint show={isRefreshing} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">All Branches Summary</h1>
          <p className="mt-1 text-sm text-text-secondary">Overall performance of all branches</p>
        </div>
        <div className="text-right text-xs text-text-muted">
          <div>Period: <span className="font-semibold text-text-primary">{formatExecutivePeriod(data.date_from, data.date_to)}</span></div>
          {data.as_of && <div className="mt-1">Inventory snapshot: <span className="font-semibold text-text-primary">{formatExecutivePeriod(data.as_of, data.as_of)}</span></div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <SummaryKpi label="Net Revenue" value={money(kpis.net_revenue)} detail="All branches" tone="bg-blue-100 text-blue-700" icon={<DollarIcon className="h-5 w-5" />} />
        <SummaryKpi label="Gross Profit" value={money(kpis.gross_profit)} detail="Revenue − cost of goods" tone="bg-emerald-100 text-emerald-700" icon={<DollarIcon className="h-5 w-5" />} />
        <SummaryKpi label="Gross Margin" value={`${kpis.profit_margin_pct.toFixed(1)}%`} detail="Gross profit ÷ net revenue" tone="bg-violet-100 text-violet-700" icon={<span className="text-lg font-bold">%</span>} />
        <SummaryKpi label="Transactions" value={kpis.transaction_count.toLocaleString()} detail="Completed sales slips" tone="bg-cyan-100 text-cyan-700" icon={<UsersIcon className="h-5 w-5" />} />
        <SummaryKpi label="Quantity Sold" value={Math.round(kpis.quantity_sold).toLocaleString()} detail="Pairs across branches" tone="bg-amber-100 text-amber-700" icon={<TrendingUpIcon className="h-5 w-5" />} />
        <SummaryKpi label="Dead Stock" value={`${kpis.dead_stock_count.toLocaleString()} pairs`} detail={`${kpis.dead_stock_pct.toFixed(1)}% of ${kpis.total_products_count.toLocaleString()} items`} tone="bg-rose-100 text-rose-700" icon={<WarningIcon className="h-5 w-5" />} onClick={onViewInventoryList} />
      </div>

      <BranchPerformanceTable rows={branches} />

      {/* The trend gets twice the room of the two small charts beside it. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div data-explain="" className="rounded-xl border border-border bg-bg-base p-4 shadow-xs">
          <h2 className="mb-1 text-base font-bold text-text-primary">Sales Trend by Branch</h2>
          <p className="mb-2 text-xs text-text-muted">Monthly sales across the selected period</p>
          <SalesTrendChart branches={data.monthly_trend} />
        </div>
        <div data-explain="" className="rounded-xl border border-border bg-bg-base p-4 shadow-xs">
          <h2 className="mb-1 text-base font-bold text-text-primary">Sales Contribution by Branch</h2>
          <p className="mb-2 text-xs text-text-muted">Share of total net revenue</p>
          <ContributionChart rows={branches} />
        </div>
        <div data-explain="" className="rounded-xl border border-border bg-bg-base p-4 shadow-xs">
          <h2 className="mb-1 text-base font-bold text-text-primary">Revenue vs Gross Profit by Branch</h2>
          <p className="mb-2 text-xs text-text-muted">Compare branch revenue and gross profit</p>
          <RevenueProfitChart rows={branches} />
        </div>
      </div>

      {branches.length === 0 && (
        <EmptyState icon={<InventoryIcon />} title="No retail branches yet" description="Add a branch and import sales data to populate this summary." />
      )}
    </div>
  );
}
