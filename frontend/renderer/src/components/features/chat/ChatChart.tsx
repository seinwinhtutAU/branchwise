import {
  SERIES_COLORS,
  axisDomain,
  donutArcs,
  formatAxis,
  formatValue,
  pickLabelIndices,
  shortDateLabel,
  shortenLabel,
  type ChartSpec,
} from "./chartLayout";

// A chart under an answer, drawn from a saved spec (see chat/chart_spec.py on the server): the
// numbers are the rows the assistant's query returned, never typed by the model. Hand-drawn SVG
// like the Dashboard's charts, in the app's own colours. Every mark carries its exact value in a
// <title> (hover) and the whole chart is repeated as a table for screen readers.

const WIDTH = 560;

function colorOf(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

function Legend({ spec }: { spec: ChartSpec }): React.JSX.Element | null {
  if (spec.series.length < 2) return null;
  return (
    <ul className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
      {spec.series.map((series, index) => (
        <li key={series.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: colorOf(index) }}
          />
          {series.name}
        </li>
      ))}
    </ul>
  );
}

// Vertical bars and lines share a frame: left axis with gridlines, labels along the bottom.
function Plot({ spec }: { spec: ChartSpec }): React.JSX.Element {
  const left = 46;
  const right = 10;
  const top = 18;
  const plotH = 170;
  const bottom = 28;
  const plotW = WIDTH - left - right;
  const count = spec.labels.length;
  const all = spec.series.flatMap((series) => series.values);
  const { lo, hi, ticks } = axisDomain(all);
  const y = (value: number): number =>
    top + ((hi - value) / (hi - lo || 1)) * plotH;
  const zeroY = y(0);
  const slot = plotW / count;
  const centerX = (i: number): number => left + slot * i + slot / 2;
  const isLine = spec.kind === "line";
  const labelAt = pickLabelIndices(count, isLine ? 6 : 8);
  const groupW = Math.min(slot * 0.72, 56 * spec.series.length);
  const barW = groupW / spec.series.length;
  const showValues = !isLine && spec.series.length === 1 && count <= 8;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${top + plotH + bottom}`}
      className="w-full"
      role="img"
      aria-label={spec.title}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={WIDTH - right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--color-border)"
            strokeWidth={tick === 0 ? 1 : 0.5}
          />
          <text
            x={left - 6}
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-text-muted text-[10px]"
          >
            {formatAxis(spec.unit, tick)}
          </text>
        </g>
      ))}
      {isLine
        ? spec.series.map((series, s) => (
            <g key={series.name}>
              <path
                d={series.values
                  .map(
                    (value, i) =>
                      `${i === 0 ? "M" : "L"}${centerX(i)},${y(value)}`,
                  )
                  .join(" ")}
                fill="none"
                stroke={colorOf(s)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {series.values.map((value, i) => (
                <circle
                  key={i}
                  cx={centerX(i)}
                  cy={y(value)}
                  r={count <= 16 ? 3 : 2}
                  fill={colorOf(s)}
                >
                  <title>{`${spec.labels[i]}: ${formatValue(spec.unit, value)}`}</title>
                </circle>
              ))}
            </g>
          ))
        : spec.labels.map((label, i) =>
            spec.series.map((series, s) => {
              const value = series.values[i];
              const x = centerX(i) - groupW / 2 + s * barW;
              const barTop = Math.min(y(value), zeroY);
              const height = Math.max(
                Math.abs(y(value) - zeroY),
                value === 0 ? 0 : 1,
              );
              return (
                <g key={`${label}-${series.name}`}>
                  <rect
                    x={x + 1}
                    y={barTop}
                    width={Math.max(barW - 2, 1)}
                    height={height}
                    rx={2}
                    fill={colorOf(s)}
                  >
                    <title>{`${label} · ${series.name}: ${formatValue(spec.unit, value)}`}</title>
                  </rect>
                  {showValues && (
                    <text
                      x={x + barW / 2}
                      y={value >= 0 ? barTop - 4 : barTop + height + 10}
                      textAnchor="middle"
                      className="fill-text-secondary text-[10px] font-medium"
                    >
                      {formatAxis(spec.unit, value)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
      {spec.labels.map(
        (label, i) =>
          labelAt.has(i) && (
            <text
              key={label + i}
              x={centerX(i)}
              y={top + plotH + 16}
              textAnchor="middle"
              className="fill-text-muted text-[10px]"
            >
              {isLine ? shortDateLabel(label) : shortenLabel(label, 12)}
            </text>
          ),
      )}
    </svg>
  );
}

// Horizontal bars: the label sits on the left, so long names are never squeezed.
function HorizontalBars({ spec }: { spec: ChartSpec }): React.JSX.Element {
  const labelW = 124;
  const valueW = 88;
  const barArea = WIDTH - labelW - valueW;
  const perBar = 16;
  const rowH = spec.series.length === 1 ? 26 : perBar * spec.series.length + 10;
  const all = spec.series.flatMap((series) => series.values);
  const { lo, hi } = axisDomain(all);
  const span = hi - lo || 1;
  const x = (value: number): number => labelW + ((value - lo) / span) * barArea;
  const zeroX = x(0);
  const height = spec.labels.length * rowH + 6;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label={spec.title}
    >
      <line
        x1={zeroX}
        x2={zeroX}
        y1={0}
        y2={height}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {spec.labels.map((label, i) => {
        const rowTop = i * rowH + 3;
        return (
          <g key={label + i}>
            <text
              x={labelW - 8}
              y={rowTop + rowH / 2 + 3}
              textAnchor="end"
              className="fill-text-secondary text-[11px]"
            >
              {shortenLabel(label, 18)}
            </text>
            {spec.series.map((series, s) => {
              const value = series.values[i];
              const barH = spec.series.length === 1 ? 16 : perBar - 3;
              const barY =
                spec.series.length === 1
                  ? rowTop + (rowH - barH) / 2
                  : rowTop + 4 + s * perBar;
              const start = Math.min(x(value), zeroX);
              const barW = Math.max(
                Math.abs(x(value) - zeroX),
                value === 0 ? 0 : 1,
              );
              return (
                <g key={series.name}>
                  <rect
                    x={start}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={2}
                    fill={colorOf(s)}
                  >
                    <title>{`${label} · ${series.name}: ${formatValue(spec.unit, value)}`}</title>
                  </rect>
                  <text
                    x={
                      (value >= 0 ? start + barW : start) +
                      (value >= 0 ? 6 : -6)
                    }
                    y={barY + barH / 2 + 3}
                    textAnchor={value >= 0 ? "start" : "end"}
                    className="fill-text-primary text-[10.5px] font-medium"
                  >
                    {formatValue(spec.unit, value)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// Parts of a whole: a donut and a legend that gives each part's value and share.
function Share({ spec }: { spec: ChartSpec }): React.JSX.Element {
  const values = spec.series[0].values;
  const arcs = donutArcs(values, 80, 80, 74, 44);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <svg
        viewBox="0 0 160 160"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={spec.title}
      >
        {arcs.map(
          (arc, i) =>
            arc.path && (
              <path key={spec.labels[i]} d={arc.path} fill={colorOf(i)}>
                <title>{`${spec.labels[i]}: ${formatValue(spec.unit, values[i])}`}</title>
              </path>
            ),
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-[12px]">
        {spec.labels.map((label, i) => (
          <li key={label + i} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorOf(i) }}
            />
            <span className="min-w-0 flex-1 truncate text-text-secondary">
              {label}
            </span>
            <span className="tabular-nums font-medium text-text-primary">
              {spec.unit === "percent"
                ? formatValue("percent", values[i])
                : `${formatValue(spec.unit, values[i])} · ${formatValue("percent", (arcs[i]?.fraction ?? 0) * 100)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The same data as a table, for screen readers.
function DataTable({ spec }: { spec: ChartSpec }): React.JSX.Element {
  return (
    <table className="sr-only">
      <caption>{spec.title}</caption>
      <thead>
        <tr>
          <th scope="col" />
          {spec.series.map((series) => (
            <th key={series.name} scope="col">
              {series.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.labels.map((label, i) => (
          <tr key={label + i}>
            <th scope="row">{label}</th>
            {spec.series.map((series) => (
              <td key={series.name}>
                {formatValue(spec.unit, series.values[i])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChatChart({ spec }: { spec: ChartSpec }): React.JSX.Element {
  return (
    // `relative` holds the hidden table (absolutely positioned by sr-only) inside the chart: without
    // it the table's box belonged to the whole chat panel, and a long conversation let the panel itself
    // scroll, pushing its header out of sight.
    // Capped near the drawing's own width (WIDTH): the labels are drawn inside it, so on a full-screen
    // chat a wider chart only made everything, text included, grow with it.
    <figure className="relative my-3 max-w-[32rem] rounded-lg border border-border bg-bg-base px-3 py-2.5">
      {spec.title && (
        <figcaption className="mb-1.5 text-[13px] font-semibold text-text-primary">
          {spec.title}
        </figcaption>
      )}
      <Legend spec={spec} />
      {spec.kind === "hbar" && <HorizontalBars spec={spec} />}
      {spec.kind === "share" && <Share spec={spec} />}
      {(spec.kind === "bar" || spec.kind === "line") && <Plot spec={spec} />}
      {spec.caption && (
        <p className="mt-1 text-[11px] text-text-muted">{spec.caption}</p>
      )}
      <DataTable spec={spec} />
    </figure>
  );
}

export default ChatChart;
