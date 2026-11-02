import { useState } from "react";
import { formatShortDate } from "@renderer/components/features/dashboard/helpers";
import { cn } from "@renderer/lib/utils";
import { SERIES_COLORS, formatMmk } from "./dashboardFormat";

const WIDTH = 720;
const HEIGHT = 130;
const PLOT = { left: 44, right: 8 };
const BAR_MAX_WIDTH = 24;
const BAR_GAP = 3;

export type PaceView = "bar" | "line";

/** One day of the pace chart: a value and the matching day in the window before. */
export interface PaceDay {
  date: string;
  now: number | null;
  before: number | null;
}

function labelIndices(count: number): Set<number> {
  if (count <= 8) return new Set(Array.from({ length: count }, (_, i) => i));
  const last = count - 1;
  return new Set([
    0,
    Math.round(last * 0.25),
    Math.round(last * 0.5),
    Math.round(last * 0.75),
    last,
  ]);
}

/** Draws a rounded bar from the zero baseline, in either direction. */
function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
}

function chartLabel(point: PaceDay): string {
  return `${formatShortDate(point.date, true)} · This period: ${
    point.now === null ? "not yet" : formatMmk(point.now)
  } · Period before: ${
    point.before === null ? "no figure" : formatMmk(point.before)
  }`;
}

/** A Retail-style daily chart with a Wholesale comparison. In line view, zero-value days are
 * skipped so the line joins only actual order days. */
export function PaceChart({
  points,
  ariaLabel,
  view = "bar",
}: {
  points: PaceDay[];
  ariaLabel: string;
  view?: PaceView;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-sm text-text-muted">No data for this period.</p>;
  }
  const hasFigure = points.some(
    (point) => (point.now ?? 0) !== 0 || (point.before ?? 0) !== 0,
  );
  if (!hasFigure) {
    return (
      <p className="py-4 text-center text-xs text-text-muted">
        No orders in these periods.
      </p>
    );
  }

  const hovered = hoverIndex === null ? null : points[hoverIndex];
  return (
    <div className="relative">
      <PaceDailyChart
        points={points}
        ariaLabel={ariaLabel}
        view={view}
        hoverIndex={hoverIndex}
        onHover={setHoverIndex}
      />
      {hovered && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{ left: `${((hoverIndex + 0.5) / points.length) * 100}%` }}
        >
          <div className="font-medium text-text-primary">
            {formatShortDate(hovered.date, true)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-text-secondary">
            <span className="h-2 w-2 rounded-sm bg-brand" />
            This period:{" "}
            {hovered.now === null ? "not yet" : formatMmk(hovered.now)}
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span className="h-2 w-2 rounded-sm bg-text-muted" />
            Period before:{" "}
            {hovered.before === null ? "no figure" : formatMmk(hovered.before)}
          </div>
        </div>
      )}
    </div>
  );
}

function PaceDailyChart({
  points,
  ariaLabel,
  view,
  hoverIndex,
  onHover,
}: {
  points: PaceDay[];
  ariaLabel: string;
  view: PaceView;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}): React.JSX.Element {
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const slotWidth = plotWidth / points.length;
  const groupWidth = Math.max(
    4,
    Math.min(BAR_MAX_WIDTH * 2 + BAR_GAP, slotWidth - BAR_GAP),
  );
  const barWidth = Math.max(2, (groupWidth - BAR_GAP) / 2);
  const maxValue = Math.max(
    ...points.flatMap((point) => [point.now ?? 0, point.before ?? 0]),
    0,
  );
  const minValue = Math.min(
    ...points.flatMap((point) => [point.now ?? 0, point.before ?? 0]),
    0,
  );
  const valueRange = maxValue - minValue || 1;
  const shownLabels = labelIndices(points.length);
  const yFor = (value: number): number =>
    HEIGHT - ((value - minValue) / valueRange) * (HEIGHT - 8);
  const baselineY = yFor(0);
  const centerX = (index: number): number =>
    PLOT.left + index * slotWidth + slotWidth / 2;
  const linePath = (key: "now" | "before"): string => {
    const active = points
      .map((point, index) => ({ value: point[key], index }))
      .filter(({ value }) => value !== null);
    return active
      .map(
        ({ value, index }, activeIndex) =>
          `${activeIndex === 0 ? "M" : "L"}${centerX(index)},${yFor(value ?? 0)}`,
      )
      .join(" ");
  };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT + 22}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={PLOT.left}
        x2={WIDTH - PLOT.right}
        y1={baselineY}
        y2={baselineY}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {[maxValue, 0, minValue]
        .filter((value, index, values) => values.indexOf(value) === index)
        .map((value) => (
          <text
            key={value}
            x={PLOT.left - 6}
            y={yFor(value) + 3}
            textAnchor="end"
            className="fill-text-muted text-[10px]"
          >
            {formatMmk(value)}
          </text>
        ))}
      {view === "line" ? (
        <>
          <path
            d={linePath("before")}
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth={1.75}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
          <path
            d={linePath("now")}
            fill="none"
            stroke={SERIES_COLORS.primary}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        points.map((point, index) => {
          const current = point.now ?? 0;
          const previous = point.before ?? 0;
          const groupX =
            PLOT.left + index * slotWidth + (slotWidth - groupWidth) / 2;
          return (
            <g key={point.date}>
              {previous !== 0 && (
                <path
                  d={roundedBarPath(
                    groupX,
                    Math.min(yFor(previous), baselineY),
                    barWidth,
                    Math.abs(baselineY - yFor(previous)),
                  )}
                  fill="var(--color-text-muted)"
                  opacity={hoverIndex === index ? 1 : 0.75}
                />
              )}
              {current !== 0 && (
                <path
                  d={roundedBarPath(
                    groupX + barWidth + BAR_GAP,
                    Math.min(yFor(current), baselineY),
                    barWidth,
                    Math.abs(baselineY - yFor(current)),
                  )}
                  fill={SERIES_COLORS.primary}
                  opacity={hoverIndex === index ? 1 : 0.85}
                />
              )}
            </g>
          );
        })
      )}
      {view === "line" &&
        points.map((point, index) => {
          const current = point.now ?? 0;
          const previous = point.before ?? 0;
          const isHovered = hoverIndex === index;
          return (
            <g key={point.date}>
              {previous !== 0 && (isHovered || index === points.length - 1) && (
                <circle
                  cx={centerX(index)}
                  cy={yFor(previous)}
                  r={isHovered ? 4 : 3}
                  fill="var(--color-text-muted)"
                  stroke="var(--color-bg-base)"
                  strokeWidth={2}
                />
              )}
              {current !== 0 && (isHovered || index === points.length - 1) && (
                <circle
                  cx={centerX(index)}
                  cy={yFor(current)}
                  r={isHovered ? 4 : 3}
                  fill={SERIES_COLORS.primary}
                  stroke="var(--color-bg-base)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
      {points.map((point, index) => (
        <g key={point.date}>
          {shownLabels.has(index) && (
            <text
              x={centerX(index)}
              y={HEIGHT + 15}
              textAnchor={
                index === 0
                  ? "start"
                  : index === points.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-text-muted text-[10px]"
            >
              {formatShortDate(point.date)}
            </text>
          )}
          <rect
            x={PLOT.left + index * slotWidth}
            y={0}
            width={slotWidth}
            height={HEIGHT}
            fill="transparent"
            className={cn(
              "outline-none",
              hoverIndex === index && "ring-2 ring-brand",
            )}
            tabIndex={0}
            role="button"
            aria-label={chartLabel(point)}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(index)}
            onBlur={() => onHover(null)}
          />
        </g>
      ))}
    </svg>
  );
}

export function PaceLegend({
  dateFrom,
  dateTo,
  previousFrom,
  previousTo,
  view,
}: {
  dateFrom: string;
  dateTo: string;
  previousFrom: string;
  previousTo: string;
  view: PaceView;
}): React.JSX.Element {
  return (
    <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
      <li className="flex items-center gap-1.5">
        <span
          className={
            view === "bar"
              ? "inline-block h-2.5 w-2.5 rounded-sm"
              : "inline-block h-0.5 w-5 rounded"
          }
          style={{ backgroundColor: SERIES_COLORS.primary }}
        />
        This period ({formatShortDate(dateFrom)} – {formatShortDate(dateTo)})
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className={
            view === "bar"
              ? "inline-block h-2.5 w-2.5 rounded-sm bg-text-muted"
              : "inline-block w-5 border-t-2 border-dashed border-text-muted"
          }
        />
        Period before ({formatShortDate(previousFrom)} –{" "}
        {formatShortDate(previousTo)})
      </li>
    </ul>
  );
}
