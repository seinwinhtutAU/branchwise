import { useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Select } from "@renderer/components/ui/Select";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DollarIcon,
  PencilIcon,
  SalesIcon,
  TrendingUpIcon,
  VoucherIcon,
} from "@renderer/components/ui/icons";
import {
  formatCount,
  formatMoney,
  type KpiValue,
} from "./helpers";

export type PerformanceMetric = "revenue" | "quantity" | "transactions";

interface MetricValues {
  revenue: number;
  quantity: number;
  transactions: number;
}

export interface SalesPerformanceData {
  current_year: number;
  previous_year: number;
  kpis: {
    revenue: KpiValue;
    quantity: KpiValue;
    transactions: KpiValue;
    revenue_per_pair: KpiValue;
  };
  monthly: Array<{
    month: number;
    current: MetricValues;
    previous: MetricValues;
  }>;
}

interface Props {
  data: SalesPerformanceData;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const METRIC_LABELS: Record<PerformanceMetric, string> = {
  revenue: "Revenue",
  quantity: "Quantity",
  transactions: "Transactions",
};

const METRICS: PerformanceMetric[] = ["revenue", "quantity", "transactions"];

function PerformanceKpiCard({
  label,
  value,
  kpi,
  icon,
  currentYear,
}: {
  label: string;
  value: string;
  kpi: KpiValue;
  icon: React.JSX.Element;
  currentYear: number;
}): React.JSX.Element {
  const isPositive = kpi.delta_pct === null || kpi.delta_pct >= 0;
  const trendColor = isPositive ? "text-success" : "text-error";
  const trendBackground = isPositive
    ? "bg-success-subtle border-success/20"
    : "bg-error-subtle border-error/20";
  const trendText =
    kpi.delta_pct === null
      ? "No prior data"
      : `${kpi.delta_pct >= 0 ? "+" : "−"}${Math.abs(kpi.delta_pct).toFixed(1)}%`;

  return (
    <Card
      className={`min-h-[7.5rem] border p-4 shadow-xs transition-colors ${trendBackground}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-base ${trendColor}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">{label}</p>
          <p className={`mt-1 flex items-center gap-1.5 text-2xl font-bold tabular-nums ${trendColor}`}>
            <span aria-hidden="true">{kpi.delta_pct === null ? "" : kpi.delta_pct >= 0 ? "▲" : "▼"}</span>
            {trendText}
          </p>
          <p className="mt-1 text-xs font-medium tabular-nums text-text-secondary">
            {currentYear}: {value}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">vs same period last year</p>
        </div>
      </div>
    </Card>
  );
}

function metricValue(metric: PerformanceMetric, value: number): string {
  return metric === "revenue" ? formatMoney(value) : formatCount(value);
}

function YoYPerformanceChart({
  kpis,
}: {
  kpis: SalesPerformanceData["kpis"];
}): React.JSX.Element {
  const items: Array<{ label: string; value: number }> = [
    { label: "Revenue", value: kpis.revenue.delta_pct ?? 0 },
    { label: "Revenue / Pair", value: kpis.revenue_per_pair.delta_pct ?? 0 },
    { label: "Quantity", value: kpis.quantity.delta_pct ?? 0 },
    { label: "Transactions", value: kpis.transactions.delta_pct ?? 0 },
  ];
  const width = 900;
  const height = 220;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAbs = Math.max(10, ...items.map((item) => Math.abs(item.value)));
  const baseline = top + plotHeight / 2;
  const scale = plotHeight / 2 / maxAbs;
  const slot = plotWidth / items.length;
  const barWidth = Math.min(170, slot * 0.66);
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[42rem]"
        role="img"
        aria-label="Year over year sales performance"
      >
        {ticks.map((tick) => {
          const y = baseline - tick * scale;
          return (
            <g key={tick}>
              <line
                x1={left}
                y1={y}
                x2={width - right}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={tick === 0 ? 1.5 : 1}
              />
              <text
                x={left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-text-muted text-[11px]"
              >
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        <text
          x={14}
          y={top + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${top + plotHeight / 2})`}
          className="fill-text-secondary text-[11px]"
        >
          YoY Change (%)
        </text>
        {items.map((item, index) => {
          const x = left + slot * index + (slot - barWidth) / 2;
          const valueHeight = Math.abs(item.value) * scale;
          const y = item.value >= 0 ? baseline - valueHeight : baseline;
          const color = item.value >= 0 ? "var(--color-success)" : "var(--color-error)";
          return (
            <g key={item.label}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(valueHeight, 1)}
                rx={3}
                fill={color}
                opacity={0.85}
              />
              <text
                x={x + barWidth / 2}
                y={item.value >= 0 ? y - 7 : y + valueHeight + 17}
                textAnchor="middle"
                className="fill-text-primary text-[12px] font-semibold"
              >
                {item.value >= 0 ? "+" : "−"}
                {Math.abs(item.value).toFixed(1)}%
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 14}
                textAnchor="middle"
                className="fill-text-secondary text-[11px]"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function axisValue(metric: PerformanceMetric, value: number): string {
  if (metric === "revenue") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  }
  return Math.round(value).toLocaleString();
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) return "—";
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`;
}

function MonthlyComparisonChart({
  data,
  metric,
  currentYear,
  previousYear,
}: {
  data: SalesPerformanceData;
  metric: PerformanceMetric;
  currentYear: number;
  previousYear: number;
}): React.JSX.Element {
  const [hovered, setHovered] = useState<{
    index: number;
    year: number;
    value: number;
  } | null>(null);
  const width = 760;
  const height = 250;
  const left = 54;
  const right = 16;
  const top = 16;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.monthly.flatMap((row) => [row.current[metric], row.previous[metric]]);
  const maxValue = Math.max(1, ...values);
  const slot = plotWidth / data.monthly.length;
  const barWidth = Math.min(18, slot * 0.26);
  const previousColor = "var(--color-border-strong)";
  const readout = hovered
    ? `${MONTH_LABELS[hovered.index]} — ${hovered.year} ${METRIC_LABELS[metric]}: ${metricValue(metric, hovered.value)}${
        hovered.year === currentYear
          ? ` (${percentChange(hovered.value, data.monthly[hovered.index].previous[metric])} vs ${previousYear})`
          : ""
      }`
    : `Hover a bar to see the exact ${METRIC_LABELS[metric].toLowerCase()}.`;

  return (
    <div>
      <div className="mb-1 h-5 text-xs text-text-secondary" aria-live="polite">
        {readout}
      </div>
      <div className="mb-1 flex items-center justify-end gap-3 text-[10px] text-text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: previousColor }} />
          {previousYear}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-success" />
          {currentYear} higher / same
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-error" />
          {currentYear} lower
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[38rem]"
          role="img"
          aria-label={`${METRIC_LABELS[metric]} monthly comparison with a ${currentYear} trend line`}
        >
          {[0, 0.5, 1].map((ratio) => {
            const y = top + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
                <text
                  x={left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-text-muted text-[10px]"
                >
                  {axisValue(metric, maxValue * ratio)}
                </text>
              </g>
            );
          })}
          <line
            x1={left}
            y1={top}
            x2={left}
            y2={top + plotHeight}
            stroke="var(--color-border-strong)"
            strokeWidth={1.2}
          />
          <line
            x1={left}
            y1={top + plotHeight}
            x2={width - right}
            y2={top + plotHeight}
            stroke="var(--color-border-strong)"
            strokeWidth={1.2}
          />
          <text
            x={14}
            y={top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${top + plotHeight / 2})`}
            className="fill-text-secondary text-[11px]"
          >
            {METRIC_LABELS[metric]}
          </text>
          {data.monthly.map((row, index) => {
            const x = left + slot * index + slot / 2;
            const previous = row.previous[metric];
            const current = row.current[metric];
            const previousHeight = (previous / maxValue) * plotHeight;
            const currentHeight = (current / maxValue) * plotHeight;
            const currentColor = current >= previous ? "var(--color-success)" : "var(--color-error)";
            return (
              <g key={row.month}>
                <rect
                  x={x - barWidth - 1}
                  y={top + plotHeight - previousHeight}
                  width={barWidth}
                  height={previousHeight}
                  rx={2}
                  fill={previousColor}
                  opacity={0.7}
                  tabIndex={0}
                  role="img"
                  aria-label={`${previousYear} ${MONTH_LABELS[index]} ${METRIC_LABELS[metric]}: ${metricValue(metric, previous)}`}
                  onMouseEnter={() => setHovered({ index, year: previousYear, value: previous })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ index, year: previousYear, value: previous })}
                  onBlur={() => setHovered(null)}
                />
                <rect
                  x={x + 1}
                  y={top + plotHeight - currentHeight}
                  width={barWidth}
                  height={currentHeight}
                  rx={2}
                  fill={currentColor}
                  tabIndex={0}
                  role="img"
                  aria-label={`${currentYear} ${MONTH_LABELS[index]} ${METRIC_LABELS[metric]}: ${metricValue(metric, current)}`}
                  onMouseEnter={() => setHovered({ index, year: currentYear, value: current })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ index, year: currentYear, value: current })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${currentYear} ${MONTH_LABELS[index]}: ${metricValue(metric, current)}`}</title>
                </rect>
                <text
                  x={x}
                  y={height - 22}
                  textAnchor="middle"
                  className="fill-text-muted text-[10px]"
                >
                  {MONTH_LABELS[index]}
                </text>
              </g>
            );
          })}
          <text
            x={left + plotWidth / 2}
            y={height - 5}
            textAnchor="middle"
            className="fill-text-secondary text-[11px]"
          >
            Month
          </text>
        </svg>
      </div>
    </div>
  );
}

function ComboChart({
  data,
  year,
  barMetric,
  lineMetric,
}: {
  data: SalesPerformanceData;
  year: number;
  barMetric: PerformanceMetric;
  lineMetric: PerformanceMetric;
}): React.JSX.Element {
  const [hovered, setHovered] = useState<{
    index: number;
    kind: "bar" | "line";
    value: number;
    metric: PerformanceMetric;
  } | null>(null);
  const width = 760;
  const height = 250;
  const left = 54;
  const right = 54;
  const top = 18;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const source = (row: SalesPerformanceData["monthly"][number]): MetricValues =>
    year === data.current_year ? row.current : row.previous;
  const barValues = data.monthly.map((row) => source(row)[barMetric]);
  const lineValues = data.monthly.map((row) => source(row)[lineMetric]);
  const barMax = Math.max(1, ...barValues);
  const lineMax = Math.max(1, ...lineValues);
  const slot = plotWidth / data.monthly.length;
  const barWidth = Math.min(24, slot * 0.42);
  const linePoints = lineValues
    .map((value, index) => {
      const x = left + slot * index + slot / 2;
      const y = top + plotHeight - (value / lineMax) * plotHeight;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  const readout = hovered
    ? `${MONTH_LABELS[hovered.index]} — ${year} ${METRIC_LABELS[hovered.metric]}: ${metricValue(hovered.metric, hovered.value)}`
    : `Hover a bar or line point to see the exact ${METRIC_LABELS[barMetric].toLowerCase()} or ${METRIC_LABELS[lineMetric].toLowerCase()}.`;

  return (
    <div>
      <div className="mb-1 h-5 text-xs text-text-secondary" aria-live="polite">
        {readout}
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[38rem]"
          role="img"
          aria-label={`${METRIC_LABELS[barMetric]} vs ${METRIC_LABELS[lineMetric]} for ${year}`}
        >
          {[0, 0.5, 1].map((ratio) => {
            const y = top + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                />
                <text
                  x={left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-text-muted text-[10px]"
                >
                  {axisValue(barMetric, barMax * ratio)}
                </text>
                <text
                  x={width - right + 8}
                  y={y + 4}
                  className="fill-text-muted text-[10px]"
                >
                  {axisValue(lineMetric, lineMax * ratio)}
                </text>
              </g>
            );
          })}
          <text
            x={14}
            y={top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${top + plotHeight / 2})`}
            className="fill-text-secondary text-[11px]"
          >
            {METRIC_LABELS[barMetric]}
          </text>
          <text
            x={width - 14}
            y={top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(90 ${width - 14} ${top + plotHeight / 2})`}
            className="fill-text-secondary text-[11px]"
          >
            {METRIC_LABELS[lineMetric]}
          </text>
          {data.monthly.map((row, index) => {
            const values = source(row);
            const x = left + slot * index + slot / 2;
            const barHeight = (values[barMetric] / barMax) * plotHeight;
            const lineY = top + plotHeight - (values[lineMetric] / lineMax) * plotHeight;
            return (
              <g key={row.month}>
                <rect
                  x={x - barWidth / 2}
                  y={top + plotHeight - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill="var(--color-info)"
                  opacity={0.82}
                  tabIndex={0}
                  role="img"
                  aria-label={`${year} ${MONTH_LABELS[index]} ${METRIC_LABELS[barMetric]}: ${metricValue(barMetric, values[barMetric])}`}
                  onMouseEnter={() => setHovered({ index, kind: "bar", value: values[barMetric], metric: barMetric })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ index, kind: "bar", value: values[barMetric], metric: barMetric })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${MONTH_LABELS[index]} ${METRIC_LABELS[barMetric]}: ${metricValue(barMetric, values[barMetric])}`}</title>
                </rect>
                <circle
                  cx={x}
                  cy={lineY}
                  r={3.5}
                  fill="var(--color-brand)"
                  tabIndex={0}
                  role="img"
                  aria-label={`${year} ${MONTH_LABELS[index]} ${METRIC_LABELS[lineMetric]}: ${metricValue(lineMetric, values[lineMetric])}`}
                  onMouseEnter={() => setHovered({ index, kind: "line", value: values[lineMetric], metric: lineMetric })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ index, kind: "line", value: values[lineMetric], metric: lineMetric })}
                  onBlur={() => setHovered(null)}
                />
                <text
                  x={x}
                  y={height - 22}
                  textAnchor="middle"
                  className="fill-text-muted text-[10px]"
                >
                  {MONTH_LABELS[index]}
                </text>
              </g>
            );
          })}
          <path
            d={linePoints}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
          <text
            x={left + plotWidth / 2}
            y={height - 5}
            textAnchor="middle"
            className="fill-text-secondary text-[11px]"
          >
            Month
          </text>
        </svg>
      </div>
    </div>
  );
}

function ChartEditor({
  data,
  draftYear,
  draftBarMetric,
  draftLineMetric,
  setDraftYear,
  setDraftBarMetric,
  setDraftLineMetric,
  onApply,
  onReset,
}: {
  data: SalesPerformanceData;
  draftYear: number;
  draftBarMetric: PerformanceMetric;
  draftLineMetric: PerformanceMetric;
  setDraftYear: (year: number) => void;
  setDraftBarMetric: (metric: PerformanceMetric) => void;
  setDraftLineMetric: (metric: PerformanceMetric) => void;
  onApply: () => void;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <div className="absolute right-3 top-12 z-10 w-64 rounded-lg border border-border bg-bg-base p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">Edit chart</h4>
        <span className="text-xs text-text-muted">Customise</span>
      </div>
      <div className="flex flex-col gap-2.5">
        <Select
          size="sm"
          label="Compare year"
          value={draftYear}
          onChange={(event) => setDraftYear(Number(event.target.value))}
        >
          <option value={data.current_year}>{data.current_year}</option>
          <option value={data.previous_year}>{data.previous_year}</option>
        </Select>
        <Select
          size="sm"
          label="Bar metric"
          value={draftBarMetric}
          onChange={(event) => setDraftBarMetric(event.target.value as PerformanceMetric)}
        >
          {METRICS.map((metric) => (
            <option key={metric} value={metric}>
              {METRIC_LABELS[metric]}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          label="Line metric"
          value={draftLineMetric}
          onChange={(event) => setDraftLineMetric(event.target.value as PerformanceMetric)}
        >
          {METRICS.map((metric) => (
            <option key={metric} value={metric}>
              {METRIC_LABELS[metric]}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-2 text-[11px] text-text-muted">
        Choose the metrics shown in the bars and line.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onReset}>
          Reset
        </Button>
        <Button size="sm" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function insightFor(label: string, delta: number | null): string {
  if (delta === null) return `${label} has no prior-period comparison.`;
  return `${label} ${delta >= 0 ? "increased" : "decreased"} compared with the same period last year.`;
}

export function SalesPerformanceTab({ data }: Props): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [chartYear, setChartYear] = useState(data.current_year);
  const [barMetric, setBarMetric] = useState<PerformanceMetric>("revenue");
  const [lineMetric, setLineMetric] = useState<PerformanceMetric>("quantity");
  const [draftYear, setDraftYear] = useState(data.current_year);
  const [draftBarMetric, setDraftBarMetric] = useState<PerformanceMetric>("revenue");
  const [draftLineMetric, setDraftLineMetric] = useState<PerformanceMetric>("quantity");
  const { kpis } = data;

  const resetEditor = (): void => {
    setDraftYear(data.current_year);
    setDraftBarMetric("revenue");
    setDraftLineMetric("quantity");
  };

  const applyEditor = (): void => {
    setChartYear(draftYear);
    setBarMetric(draftBarMetric);
    setLineMetric(draftLineMetric);
    setEditorOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
        <PerformanceKpiCard
          label="Revenue"
          value={formatMoney(kpis.revenue.value)}
          kpi={kpis.revenue}
          currentYear={data.current_year}
          icon={<TrendingUpIcon className="h-5 w-5" />}
        />
        <PerformanceKpiCard
          label="Quantity Sold"
          value={formatCount(kpis.quantity.value)}
          kpi={kpis.quantity}
          currentYear={data.current_year}
          icon={<SalesIcon className="h-5 w-5" />}
        />
        <PerformanceKpiCard
          label="Transactions"
          value={formatCount(kpis.transactions.value)}
          kpi={kpis.transactions}
          currentYear={data.current_year}
          icon={<VoucherIcon className="h-5 w-5" />}
        />
        <PerformanceKpiCard
          label="Revenue / Pair"
          value={formatMoney(kpis.revenue_per_pair.value)}
          kpi={kpis.revenue_per_pair}
          currentYear={data.current_year}
          icon={<DollarIcon className="h-5 w-5" />}
        />
      </div>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title={`${data.current_year} YoY Performance`}
          description="Selected-period change compared with the same period last year."
        />
        <YoYPerformanceChart kpis={kpis} />
      </Card>

      <div className="-mt-2 ml-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          className="rounded-full px-4 font-semibold"
        >
          Detail
          {detailsOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
        </Button>
      </div>

      {detailsOpen && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="p-3.5 sm:p-4">
            <CardHeader title="Monthly Revenue Comparison" />
            <MonthlyComparisonChart
              data={data}
              metric="revenue"
              currentYear={data.current_year}
              previousYear={data.previous_year}
            />
          </Card>

          <Card className="relative p-3.5 sm:p-4">
            <CardHeader
              title={`${METRIC_LABELS[barMetric]} vs ${METRIC_LABELS[lineMetric]} — ${chartYear}`}
              action={
                <button
                  type="button"
                  aria-label="Edit comparison chart"
                  aria-expanded={editorOpen}
                  onClick={() => setEditorOpen((open) => !open)}
                  className="rounded-md p-1.5 text-text-muted hover:bg-bg-raised hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
              }
            />
            {editorOpen && (
              <ChartEditor
                data={data}
                draftYear={draftYear}
                draftBarMetric={draftBarMetric}
                draftLineMetric={draftLineMetric}
                setDraftYear={setDraftYear}
                setDraftBarMetric={setDraftBarMetric}
                setDraftLineMetric={setDraftLineMetric}
                onApply={applyEditor}
                onReset={resetEditor}
              />
            )}
            <div className="mb-2 flex items-center justify-end gap-3 text-[10px] text-text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-info" />
                {METRIC_LABELS[barMetric]}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3 bg-brand" />
                {METRIC_LABELS[lineMetric]}
              </span>
            </div>
            <ComboChart
              data={data}
              year={chartYear}
              barMetric={barMetric}
              lineMetric={lineMetric}
            />
          </Card>

          <Card className="p-3.5 sm:p-4">
            <CardHeader title="Monthly Quantity Comparison" />
            <MonthlyComparisonChart
              data={data}
              metric="quantity"
              currentYear={data.current_year}
              previousYear={data.previous_year}
            />
          </Card>

          <Card className="p-3.5 sm:p-4">
            <CardHeader title="Monthly Transaction Comparison" />
            <MonthlyComparisonChart
              data={data}
              metric="transactions"
              currentYear={data.current_year}
              previousYear={data.previous_year}
            />
          </Card>
        </div>
      )}

      <Card className="border-brand/10 bg-brand-subtle/60 p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-xl text-brand" aria-hidden="true">
            ◉
          </span>
          <div>
            <h3 className="text-sm font-semibold text-brand">Business Insight</h3>
            <p className="mt-0.5 text-sm text-text-secondary">
              {insightFor("Revenue", kpis.revenue.delta_pct)} {insightFor("Sales quantity", kpis.quantity.delta_pct)} {insightFor("Transaction activity", kpis.transactions.delta_pct)} {insightFor("Average revenue per pair", kpis.revenue_per_pair.delta_pct)}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Comparison: selected period vs the same period in {data.previous_year}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default SalesPerformanceTab;
