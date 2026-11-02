/** A set of health weights, as numbers from 0 to 100 (the scale the boxes on the Health pages
 *  use): one per part of the score and one per measure inside a part. */
export interface HealthWeightSet {
  dimensions: Record<string, number>;
  sub_metrics: Record<string, number>;
}

/** What the weight rules need to know about a part: its key, name and its measures' keys. */
export interface WeightedDimension {
  key: string;
  label: string;
  sub_metrics: { key: string }[];
}

/** A weight as a share of its group, e.g. "25%"; a dash when the group adds up to nothing. */
export function shareText(value: number, total: number): string {
  if (total <= 0 || !Number.isFinite(value)) return "—";
  return `${Math.round((value / total) * 100)}%`;
}

export function total(weights: Record<string, number>, keys: string[]): number {
  return keys.reduce((sum, key) => sum + (weights[key] || 0), 0);
}

/** What is wrong with a draft, in a sentence, or null when it can be saved. These are the rules
 *  the server checks again (health.validate_weights). */
export function weightsProblem(
  draft: HealthWeightSet,
  dimensions: WeightedDimension[],
): string | null {
  for (const group of [draft.dimensions, draft.sub_metrics]) {
    for (const value of Object.values(group)) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return "Weights go from 0 to 100.";
      }
    }
  }
  if (
    total(
      draft.dimensions,
      dimensions.map((d) => d.key),
    ) <= 0
  ) {
    return "At least one part needs a weight above 0.";
  }
  for (const dimension of dimensions) {
    const keys = dimension.sub_metrics.map((sub) => sub.key);
    if (total(draft.sub_metrics, keys) <= 0) {
      return `${dimension.label} needs at least one measure with a weight above 0.`;
    }
  }
  return null;
}

export function sameWeights(a: HealthWeightSet, b: HealthWeightSet): boolean {
  const same = (
    x: Record<string, number>,
    y: Record<string, number>,
  ): boolean =>
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((key) => x[key] === y[key]);
  return same(a.dimensions, b.dimensions) && same(a.sub_metrics, b.sub_metrics);
}
