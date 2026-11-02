import { useState } from "react";
import { cn } from "@renderer/lib/utils";
import {
  columnGeometry,
  labelIndices,
  type ColumnSeries,
} from "./stackedColumns";

const WIDTH = 720;
const PAD = { left: 40, right: 8, top: 10, bottom: 24 };

function roundedTopBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`;
}

/** One column: its label on the axis, its full name for the hover, one value per series. */
export interface ColumnPoint {
  label: string;
  title: string;
  values: number[];
}

export type ColumnView = "bar" | "line";

/** Columns of stacked segments, one segment per series. Every segment carries its exact figure in
 *  a hover title. Used for the Customer tab's orders by day, customers by month and how often
 *  customers buy. */
export function ColumnChart({
  points,
  series,
  formatValue,
  formatTick,
  ariaLabel,
  height = 150,
  minMax = 1,
  maxLabels = 12,
  grouped = false,
  view,
}: {
  points: ColumnPoint[];
  series: ColumnSeries[];
  formatValue: (value: number) => string;
  /** The axis figures, which can be shorter than the hover ones ("1.2M" against "1,200,000"). */
  formatTick?: (value: number) => string;
  ariaLabel: string;
  height?: number;
  minMax?: number;
  maxLabels?: number;
  /** The series side by side in each column, instead of stacked. */
  grouped?: boolean;
  /** When supplied, makes this chart switchable and shows an accessible hover readout. */
  view?: ColumnView;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const g = columnGeometry(
    points.map((point) => point.values),
    WIDTH,
    height,
    PAD,
    { minMax, grouped },
  );
  const shown = labelIndices(points.length, maxLabels);
  const tick = formatTick ?? formatValue;
  const activeView = view ?? "bar";
  const isInteractive = view !== undefined;
  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const centerX = (column: number): number => segment0X(g.segments[column]);
  const linePath = (seriesIndex: number): string =>
    points
      .map((point, column) => ({
        value: point.values[seriesIndex] ?? 0,
        column,
      }))
      .filter(({ value }) => value > 0)
      .map(
        ({ value, column }, index) =>
          `${index === 0 ? "M" : "L"}${centerX(column)},${g.y(value)}`,
      )
      .join(" ");
  const hitBox = (column: number): { x: number; width: number } => {
    const segments = g.segments[column];
    const x = Math.min(...segments.map((segment) => segment.x));
    return {
      x,
      width:
        Math.max(...segments.map((segment) => segment.x + segment.width)) - x,
    };
  };

  return (
    <div className="relative">
      {series.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
          {series.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </li>
          ))}
        </ul>
      )}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {isInteractive
          ? [g.max, g.max / 2, 0].map((value) => (
              <g key={value}>
                {value === 0 && (
                  <line
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={g.y(value)}
                    y2={g.y(value)}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                  />
                )}
                <text
                  x={PAD.left - 6}
                  y={g.y(value) + 3}
                  textAnchor="end"
                  className="fill-text-muted text-[10px]"
                >
                  {tick(value)}
                </text>
              </g>
            ))
          : g.ticks.map((value) => (
              <g key={value}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={g.y(value)}
                  y2={g.y(value)}
                  stroke="var(--color-border)"
                  strokeWidth={value === 0 ? 1 : 0.5}
                />
                <text
                  x={PAD.left - 6}
                  y={g.y(value) + 3}
                  textAnchor="end"
                  className="fill-text-muted text-[10px]"
                >
                  {tick(value)}
                </text>
              </g>
            ))}
        {activeView === "line" ? (
          <>
            {series.map((item, index) => (
              <path
                key={item.name}
                d={linePath(index)}
                fill="none"
                stroke={item.color}
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {hoverIndex !== null &&
              series.map((item, index) => {
                const value = points[hoverIndex].values[index] ?? 0;
                return value > 0 ? (
                  <circle
                    key={item.name}
                    cx={centerX(hoverIndex)}
                    cy={g.y(value)}
                    r={4}
                    fill={item.color}
                    stroke="var(--color-bg-base)"
                    strokeWidth={2}
                  />
                ) : null;
              })}
          </>
        ) : (
          points.map((point, column) => (
            <g key={point.title}>
              {g.segments[column].map((segment, index) =>
                segment.height > 0 ? (
                  isInteractive &&
                  !g.segments[column]
                    .slice(index + 1)
                    .some((next) => next.height > 0) ? (
                    <path
                      key={series[index].name}
                      d={roundedTopBarPath(
                        segment.x,
                        segment.y,
                        segment.width,
                        segment.height,
                      )}
                      fill={series[index].color}
                      opacity={hoverIndex === column ? 1 : 0.85}
                    />
                  ) : (
                    <rect
                      key={series[index].name}
                      x={segment.x}
                      y={segment.y}
                      width={segment.width}
                      height={segment.height}
                      fill={series[index].color}
                      opacity={hoverIndex === column ? 1 : 0.85}
                    >
                      {!isInteractive && (
                        <title>
                          {`${point.title}${series.length > 1 ? ` · ${series[index].name}` : ""}: ${formatValue(point.values[index])}`}
                        </title>
                      )}
                    </rect>
                  )
                ) : null,
              )}
            </g>
          ))
        )}
        {points.map((point, column) => (
          <g key={`${point.title}-axis`}>
            {shown.has(column) && (
              <text
                x={segment0X(g.segments[column])}
                y={height - 8}
                textAnchor="middle"
                className="fill-text-muted text-[10px]"
              >
                {point.label}
              </text>
            )}
            {isInteractive && (
              <rect
                x={hitBox(column).x}
                y={PAD.top}
                width={hitBox(column).width}
                height={height - PAD.top - PAD.bottom}
                fill="transparent"
                className={cn(
                  "outline-none",
                  hoverIndex === column && "ring-2 ring-brand",
                )}
                tabIndex={0}
                role="button"
                aria-label={`${point.title}: ${series
                  .map(
                    (item, index) =>
                      `${item.name} ${formatValue(point.values[index] ?? 0)}`,
                  )
                  .join(", ")}`}
                onMouseEnter={() => setHoverIndex(column)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(column)}
                onBlur={() => setHoverIndex(null)}
              />
            )}
          </g>
        ))}
      </svg>
      {hovered && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-5 z-10 -translate-x-1/2 rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{ left: `${((hoverIndex + 0.5) / points.length) * 100}%` }}
        >
          <div className="font-medium text-text-primary">{hovered.title}</div>
          {series.map((item, index) => (
            <div
              key={item.name}
              className="flex items-center gap-1.5 text-text-muted"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              {item.name}: {formatValue(hovered.values[index] ?? 0)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The middle of a column, for its axis label. */
function segment0X(segments: { x: number; width: number }[]): number {
  const first = segments[0];
  return first ? first.x + first.width / 2 : 0;
}
