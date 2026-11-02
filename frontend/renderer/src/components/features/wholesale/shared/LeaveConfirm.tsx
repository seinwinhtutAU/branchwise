import React from "react";
import { ConfirmDialog } from "@renderer/components/ui/ConfirmDialog";

/** The one "Leave without saving?" question, asked the same way wherever edits could be lost. */
export function LeaveConfirm({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}): React.JSX.Element {
  return (
    <ConfirmDialog
      isOpen={open}
      title="Leave without saving?"
      message="You have changes that are not saved. If you leave now, they will be lost."
      confirmLabel="Leave without saving"
      cancelLabel="Keep editing"
      confirmVariant="destructive"
      onCancel={onStay}
      onConfirm={onLeave}
    />
  );
}
