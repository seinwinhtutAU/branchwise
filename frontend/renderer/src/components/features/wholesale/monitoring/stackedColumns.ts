// Geometry for the dashboard's column charts: one column per label, each either a stack of
// segments (one per series) or the series side by side. Pure, so it can be tested without
// drawing anything.

/** One series of a column chart: its name and its color. */
export interface ColumnSeries {
  name: string;
  color: string;
}

interface Segment {
  x: number;
  width: number;
  y: number;
  height: number;
}

export interface ColumnGeometry {
  /** The top of the scale: the biggest column, rounded up to a round number. */
  max: number;
  ticks: number[];
  y: (value: number) => number;
  /** Per column, per series. */
  segments: Segment[][];
  slot: number;
}

/** 1, 2 or 5 times a power of ten, at or above the value (never below `min`). */
export function niceCeil(value: number, min = 1): number {
  if (value <= min) return min;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.max(nice * power, min);
}

/** Which labels to show so they do not run into each other: evenly spaced, first included. */
export function labelIndices(count: number, maxLabels: number): Set<number> {
  if (count <= maxLabels)
    return new Set(Array.from({ length: count }, (_, i) => i));
  const step = Math.ceil(count / maxLabels);
  const shown = new Set<number>();
  for (let i = 0; i < count; i += step) shown.add(i);
  return shown;
}

export function columnGeometry(
  columns: number[][],
  width: number,
  height: number,
  pad: { left: number; right: number; top: number; bottom: number },
  options: { minMax?: number; maxBarWidth?: number; grouped?: boolean } = {},
): ColumnGeometry {
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const grouped = options.grouped ?? false;
  const tallest = Math.max(
    ...columns.map((stack) =>
      grouped ? Math.max(...stack, 0) : stack.reduce((a, b) => a + b, 0),
    ),
    0,
  );
  const max = niceCeil(tallest, options.minMax ?? 1);
  const y = (value: number): number => pad.top + plotH - (value / max) * plotH;
  const slot = columns.length > 0 ? plotW / columns.length : plotW;
  const barWidth = Math.min(options.maxBarWidth ?? 44, Math.max(2, slot * 0.7));
  const segments = columns.map((stack, index) => {
    if (grouped) {
      const each = barWidth / Math.max(stack.length, 1);
      const left = pad.left + slot * index + (slot - barWidth) / 2;
      return stack.map((value, series) => {
        const top = y(value);
        return {
          x: left + each * series,
          width: Math.max(1, each - 1),
          y: top,
          height: Math.max(0, y(0) - top),
        };
      });
    }
    const x = pad.left + slot * index + (slot - barWidth) / 2;
    let running = 0;
    return stack.map((value) => {
      const top = y(running + value);
      const bottom = y(running);
      running += value;
      return { x, width: barWidth, y: top, height: Math.max(0, bottom - top) };
    });
  });
  return { max, ticks: [0, max / 2, max], y, segments, slot };
}
