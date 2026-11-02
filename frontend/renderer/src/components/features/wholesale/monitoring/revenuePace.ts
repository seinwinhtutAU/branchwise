// Geometry for the Revenue tab's pace chart: this window's running total against the one
// before, by day. Pure, so it can be tested without drawing anything.

export interface PacePoint {
  current: number | null;
  previous: number | null;
}

export interface PaceGeometry {
  max: number;
  x: (index: number) => number;
  y: (value: number) => number;
  currentPath: string;
  previousPath: string;
}

/** Joins the values into SVG path segments, starting a new segment after a gap (null). */
function pathOf(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

export function paceGeometry(
  points: PacePoint[],
  width: number,
  height: number,
  pad: { left: number; right: number; top: number; bottom: number },
): PaceGeometry {
  const values = points.flatMap((p) => [p.current ?? 0, p.previous ?? 0]);
  const max = Math.max(...values, 0);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index: number): number =>
    points.length <= 1
      ? pad.left + plotW / 2
      : pad.left + (index / (points.length - 1)) * plotW;
  const y = (value: number): number =>
    max > 0 ? pad.top + plotH - (value / max) * plotH : pad.top + plotH;
  return {
    max,
    x,
    y,
    currentPath: pathOf(
      points.map((p) => p.current),
      x,
      y,
    ),
    previousPath: pathOf(
      points.map((p) => p.previous),
      x,
      y,
    ),
  };
}
