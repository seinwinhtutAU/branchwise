import React from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { CheckIcon } from "@renderer/components/ui/icons";

export type StageState = "done" | "current" | "todo";

/** What a voucher tab shows before anything has been recorded on it: where the voucher is
 *  in its journey, what this tab is for, and one clear button for the next step, so an
 *  empty tab reads as "not yet" rather than "broken". */
export function EmptyStage({
  steps,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  loading = false,
  note,
}: {
  steps: { label: string; state: StageState }[];
  title: string;
  description: string;
  actionLabel: string;
  actionIcon?: React.ReactNode;
  onAction: () => void;
  loading?: boolean;
  /** A small line under the button, e.g. what will be filled in for the person. */
  note?: string;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-10 text-center">
      <ol className="flex items-center gap-2 text-xs font-medium">
        {steps.map((step, index) => (
          <React.Fragment key={step.label}>
            {index > 0 && <li aria-hidden className="h-px w-8 bg-border" />}
            <li
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                step.state === "done" &&
                  "border-success/30 bg-success-subtle text-success",
                step.state === "current" &&
                  "border-brand/40 bg-brand-subtle text-brand",
                step.state === "todo" &&
                  "border-border bg-bg-base text-text-muted",
              )}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {step.state === "done" ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <span className="font-mono">{index + 1}</span>
              )}
              {step.label}
            </li>
          </React.Fragment>
        ))}
      </ol>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-bold text-text-primary">{title}</h3>
        <p className="text-[13px] text-text-secondary">{description}</p>
      </div>
      <Button onClick={onAction} loading={loading} className="gap-1.5">
        {actionIcon}
        {actionLabel}
      </Button>
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </div>
  );
}
