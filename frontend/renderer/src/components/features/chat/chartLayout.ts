// The numbers and text behind a chat chart, kept apart from the drawing so they can be tested
// without a browser: reading the saved spec, formatting values, choosing axis ticks and labels,
// and the arcs of a share chart.

type ChartKind = "bar" | "hbar" | "line" | "share";
export type ChartUnit = "ks" | "count" | "percent" | "sets";

interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  unit: ChartUnit;
  labels: string[];
  series: ChartSeries[];
  caption: string | null;
}

const KINDS: readonly string[] = ["bar", "hbar", "line", "share"];
const UNITS: readonly string[] = ["ks", "count", "percent", "sets"];

// Chart colours from the app's own tokens; the sixth is neutral ("the rest").
export const SERIES_COLORS = [
  "var(--color-chart-indigo)",
  "var(--color-chart-emerald)",
  "var(--color-chart-amber)",
  "var(--color-chart-blue)",
  "var(--color-chart-purple)",
  "var(--color-text-muted)",
];

/** The saved spec, or null when it isn't a chart we can draw: a bad or old record must show
 *  nothing rather than break the message. */
export function parseChartSpec(text: string | undefined): ChartSpec | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const spec = raw as Record<string, unknown>;
  if (typeof spec.kind !== "string" || !KINDS.includes(spec.kind)) return null;
  if (typeof spec.unit !== "string" || !UNITS.includes(spec.unit)) return null;
  if (!Array.isArray(spec.labels) || !Array.isArray(spec.series)) return null;
  const labels = spec.labels.map(String);
  const series: ChartSeries[] = [];
  for (const entry of spec.series as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { name, values } = entry as { name?: unknown; values?: unknown };
    if (typeof name !== "string" || !Array.isArray(values)) return null;
    if (values.length !== labels.length) return null;
    if (!values.every((v) => typeof v === "number" && Number.isFinite(v)))
      return null;
    series.push({ name, values: values as number[] });
  }
  if (labels.length === 0 || series.length === 0) return null;
  return {
    kind: spec.kind as ChartKind,
    title: typeof spec.title === "string" ? spec.title : "",
    unit: spec.unit as ChartUnit,
    labels,
    series,
    caption: typeof spec.caption === "string" ? spec.caption : null,
  };
}

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TWO = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const ONE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A value as the answer would write it: "Ks 12,500", "33.5%", "12.5 sets", "1,200". */
export function formatValue(unit: ChartUnit, value: number): string {
  switch (unit) {
    case "ks":
      return `Ks ${WHOLE.format(value)}`;
    case "percent":
      return `${ONE.format(value)}%`;
    case "sets":
      return `${ONE.format(value)} ${value === 1 ? "set" : "sets"}`;
    default:
      return TWO.format(value);
  }
}

/** A short form for an axis: 1.2M, 450K, 33%. */
export function formatAxis(unit: ChartUnit, value: number): string {
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000) text = `${trim(value / 1_000_000)}M`;
  else if (abs >= 10_000) text = `${trim(value / 1_000)}K`;
  else text = TWO.format(value);
  return unit === "percent" ? `${text}%` : text;
}

function trim(value: number): string {
  return ONE.format(value);
}

/** Round the top of an axis up to a tidy number and list the tick values from 0. */
export function niceTicks(
  max: number,
  target = 4,
): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step =
    (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) *
    magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return { top, ticks };
}

/** The vertical range of a chart: always includes zero, with room below it for negative values
 *  (a change in %, a shortfall), and tidy tick marks across it. */
export function axisDomain(values: number[]): {
  lo: number;
  hi: number;
  ticks: number[];
} {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const up = niceTicks(max, 4);
  if (min >= 0) return { lo: 0, hi: up.top, ticks: up.ticks };
  const down = niceTicks(-min, 2);
  const ticks = [
    ...down.ticks
      .slice(1)
      .map((t) => -t)
      .reverse(),
    ...(max > 0 ? up.ticks : [0]),
  ];
  return { lo: -down.top, hi: max > 0 ? up.top : 0, ticks };
}

export function shortenLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
}

/** "2026-10-05" -> "10-05"; a month ("2026-10") stays as it is. */
export function shortDateLabel(label: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label;
}

/** Which of `count` positions get a text label so they don't collide: the first, the last,
 *  and evenly spaced ones between, at most `max`. */
export function pickLabelIndices(count: number, max = 6): Set<number> {
  if (count <= max) return new Set(Array.from({ length: count }, (_, i) => i));
  const picked = new Set<number>();
  for (let n = 0; n < max; n++)
    picked.add(Math.round((n * (count - 1)) / (max - 1)));
  return picked;
}

export interface Arc {
  path: string;
  fraction: number;
}

/** The slices of a donut, clockwise from the top. A slice that is the whole is drawn as two
 *  halves because a single arc cannot start and end at the same point. */
export function donutArcs(
  values: number[],
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): Arc[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return [];
  let angle = -Math.PI / 2;
  return values.map((raw) => {
    const value = Math.max(0, raw);
    const fraction = value / total;
    const sweep = Math.min(fraction, 0.9999) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const point = (radius: number, theta: number): string =>
      `${(cx + radius * Math.cos(theta)).toFixed(2)},${(cy + radius * Math.sin(theta)).toFixed(2)}`;
    const path =
      fraction === 0
        ? ""
        : `M${point(outer, angle)} A${outer},${outer} 0 ${large} 1 ${point(outer, end)} ` +
          `L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, angle)} Z`;
    angle += fraction * Math.PI * 2;
    return { path, fraction };
  });
}
