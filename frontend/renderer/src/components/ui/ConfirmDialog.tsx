import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "destructive" | "success";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  size?: "sm" | "md";
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  loading = false,
  onConfirm,
  onCancel,
  size = "sm",
}: ConfirmDialogProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <Modal
      title={title}
      size={size}
      loading={loading}
      onClose={onCancel}
      onSubmit={onConfirm}
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={confirmVariant}
            size="md"
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text-secondary leading-relaxed">
        {typeof message === "string" ? <p>{message}</p> : message}
      </div>
    </Modal>
  );
}
