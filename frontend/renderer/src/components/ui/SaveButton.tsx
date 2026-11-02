import React, { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { CheckIcon } from "./icons";
import { cn } from "@renderer/lib/utils";

export interface SaveButtonProps {
  dirty: boolean;
  saving: boolean;
  canSave?: boolean;
  onSave: () => void | Promise<unknown>;
  title?: string;
  size?: "sm" | "md";
  className?: string;
  label?: string;
  savedDurationMs?: number;
}

/**
 * High-visibility 4-state Save button for wholesale and core workflows:
 * 1. Clean/Idle: subtle disabled state with "No unsaved changes" tooltip
 * 2. Dirty/Unsaved: prominent active button with pulsating indicator
 * 3. Saving: loading spinner + "Saving changes..."
 * 4. Just Saved: vibrant success state "✓ Saved!" for 2 seconds
 */
export function SaveButton({
  dirty,
  saving,
  canSave = true,
  onSave,
  title,
  size = "sm",
  className,
  label = "Save changes",
  savedDurationMs = 2200,
}: SaveButtonProps): React.JSX.Element {
  const [justSaved, setJustSaved] = useState(false);
  const wasSaving = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (wasSaving.current && !saving && !dirty) {
      // Finished saving successfully
      setJustSaved(true);
      timer = setTimeout(() => {
        setJustSaved(false);
      }, savedDurationMs);
    }
    wasSaving.current = saving;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [saving, dirty, savedDurationMs]);

  if (justSaved) {
    return (
      <Button
        type="button"
        size={size}
        variant="success"
        className={cn(
          "gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-600 text-white transition-all shadow-sm",
          size === "sm" ? "text-xs" : "text-sm",
          className,
        )}
      >
        <CheckIcon className="h-3.5 w-3.5 text-white" />
        <span>Saved!</span>
      </Button>
    );
  }

  if (saving) {
    return (
      <Button
        type="button"
        size={size}
        loading
        disabled
        className={cn(
          "gap-1.5 font-semibold cursor-wait",
          size === "sm" ? "text-xs" : "text-sm",
          className,
        )}
      >
        <span>Saving changes...</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      onClick={() => void onSave()}
      disabled={!dirty || canSave === false}
      title={
        canSave === false
          ? title || "Complete all required fields before saving."
          : !dirty
            ? "No unsaved changes"
            : title
      }
      className={cn(
        "gap-1.5 font-semibold transition-all",
        dirty && "ring-2 ring-brand/30 shadow-md",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      {dirty ? (
        <span className="relative flex h-2 w-2 mr-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
        </span>
      ) : (
        <CheckIcon className="h-3.5 w-3.5 opacity-60" />
      )}
      <span>{label}</span>
    </Button>
  );
}
