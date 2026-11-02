import { Button } from "@renderer/components/ui/Button";
import { cn } from "@renderer/lib/utils";
import type { useHealthWeightEditor } from "./useHealthWeightEditor";

type Editing = ReturnType<typeof useHealthWeightEditor>;

/** The buttons of the Health pages' "Edit weights": one button to start, and while editing,
 *  Reset to default, Cancel and Save. Shared by the retail and the wholesale Health pages. */
export function WeightEditControls({
  editing,
}: {
  editing: Editing;
}): React.JSX.Element {
  if (!editing.draft) {
    return (
      <Button variant="secondary" size="sm" onClick={editing.start}>
        Edit weights
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={editing.fillDefaults}
        disabled={editing.saving}
      >
        Reset to default
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={editing.cancel}
        disabled={editing.saving}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => void editing.submit()}
        loading={editing.saving}
        disabled={editing.problem !== null || editing.unchanged}
      >
        Save weights
      </Button>
    </>
  );
}

/** The line under the title while editing: how it works, or what is wrong with the draft. */
export function WeightEditHint({
  editing,
}: {
  editing: Editing;
}): React.JSX.Element | null {
  if (!editing.draft) return null;
  return (
    <p
      className={cn(
        "-mt-3 text-xs",
        editing.problem ? "text-error" : "text-text-muted",
      )}
    >
      {editing.problem ??
        "Give each part and each measure a weight from 0 to 100. A bigger number counts for more; 0 leaves it out. They do not have to add up to 100 — the shares show what each comes to. Reset to default fills in the original weights; nothing changes until you save."}
    </p>
  );
}
