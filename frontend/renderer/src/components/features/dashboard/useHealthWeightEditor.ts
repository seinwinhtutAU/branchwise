import { useState } from "react";
import type { WeightEditor } from "./HealthDimensionCard";
import {
  sameWeights,
  shareText,
  total,
  weightsProblem,
  type HealthWeightSet,
  type WeightedDimension,
} from "./healthWeights";

/** The "Edit weights" state both Health pages share: a draft of the weights while they are being
 *  edited, what is wrong with it, how to save it, and the editor each part's card is given.
 *  Weights here are numbers from 0 to 100; a page that stores another scale converts at its edge. */
export function useHealthWeightEditor({
  saved,
  defaults,
  dimensions,
  save,
}: {
  saved: HealthWeightSet;
  defaults: HealthWeightSet;
  dimensions: WeightedDimension[];
  /** Saves a draft; resolves true when it was saved. */
  save: (draft: HealthWeightSet) => Promise<boolean>;
}): {
  draft: HealthWeightSet | null;
  saving: boolean;
  problem: string | null;
  unchanged: boolean;
  start: () => void;
  cancel: () => void;
  /** Fills the draft with the original weights; nothing is saved until `submit`. */
  fillDefaults: () => void;
  submit: () => Promise<void>;
  editorFor: (dimension: WeightedDimension) => WeightEditor | undefined;
} {
  // The weights being edited; null while the page is only being read.
  const [draft, setDraft] = useState<HealthWeightSet | null>(null);
  const [saving, setSaving] = useState(false);
  const problem = draft ? weightsProblem(draft, dimensions) : null;
  const dimensionKeys = dimensions.map((dimension) => dimension.key);

  const copy = (set: HealthWeightSet): HealthWeightSet => ({
    dimensions: { ...set.dimensions },
    sub_metrics: { ...set.sub_metrics },
  });

  async function submit(): Promise<void> {
    if (!draft || problem) return;
    setSaving(true);
    try {
      if (await save(draft)) setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  // One editor per part, wired to the draft; the shares shown beside each box follow it as it is
  // typed, so what a weight comes to is never a surprise.
  function editorFor(dimension: WeightedDimension): WeightEditor | undefined {
    if (!draft) return undefined;
    const subKeys = dimension.sub_metrics.map((sub) => sub.key);
    return {
      dimensionWeight: draft.dimensions[dimension.key],
      dimensionShare: shareText(
        draft.dimensions[dimension.key],
        total(draft.dimensions, dimensionKeys),
      ),
      onDimensionWeight: (value) =>
        setDraft({
          ...draft,
          dimensions: { ...draft.dimensions, [dimension.key]: value },
        }),
      subWeight: (key) => draft.sub_metrics[key],
      subShare: (key) =>
        shareText(draft.sub_metrics[key], total(draft.sub_metrics, subKeys)),
      onSubWeight: (key, value) =>
        setDraft({
          ...draft,
          sub_metrics: { ...draft.sub_metrics, [key]: value },
        }),
    };
  }

  return {
    draft,
    saving,
    problem,
    unchanged: draft ? sameWeights(draft, saved) : true,
    start: () => setDraft(copy(saved)),
    cancel: () => setDraft(null),
    fillDefaults: () => setDraft(copy(defaults)),
    submit,
    editorFor,
  };
}
