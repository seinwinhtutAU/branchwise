import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@renderer/lib/utils";
import { Button, type ButtonVariant } from "./Button";
import { CloseIcon } from "./icons";

type ModalSize = "sm" | "md" | "lg" | "xl";

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

interface ModalAction {
  label: string;
  onClick?: (e?: React.MouseEvent | FormEvent) => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
}

export interface ModalProps {
  /** Optional open flag (defaults to true) */
  open?: boolean;
  /** Title of the modal in sentence case */
  title: ReactNode;
  /** Optional descriptive subtitle below the title */
  subtitle?: ReactNode;
  /** Optional badge next to the title */
  badge?: ReactNode;
  /** Optional icon chip beside the title */
  icon?: ReactNode;
  /** Standard size tier: sm (max-w-md), md (max-w-lg), lg (max-w-2xl), xl (max-w-3xl) */
  size?: ModalSize;
  /** Width override if an explicit max-w is needed */
  width?: string;
  /** Optional className for the modal panel */
  className?: string;
  /** Optional layout overrides for compact or specialized dialogs */
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  /** Title className override */
  titleClassName?: string;
  /** Left side of footer — total, summary, or calculation status */
  summary?: ReactNode;
  /** Right side of footer — Cancel + primary button */
  actions?: ReactNode;
  /** Convenience prop for primary action button */
  primaryAction?: ModalAction;
  /** Convenience prop for secondary/cancel action button */
  secondaryAction?: ModalAction;
  /** Inline error message displayed inside the modal body */
  error?: string | null;
  /** Disables close via Esc, backdrop click, or X when a save is in progress */
  busy?: boolean;
  loading?: boolean;
  onClose: () => void;
  /** If provided, wraps dialog content in a <form> so Enter submits */
  onSubmit?: () => void | Promise<void>;
  children: ReactNode;
}

export function Modal({
  open = true,
  title,
  subtitle,
  badge,
  icon,
  size = "md",
  width,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  titleClassName,
  summary,
  actions,
  primaryAction,
  secondaryAction,
  error,
  busy = false,
  loading = false,
  onClose,
  onSubmit,
  children,
}: ModalProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | HTMLFormElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isSaving = busy || loading || Boolean(primaryAction?.loading);

  const titleId = useId();
  const subtitleId = useId();

  // Save previously active element on mount and restore on unmount
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Focus the first focusable control inside the modal
    const timer = setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
      if (first) {
        first.focus();
        if (first instanceof HTMLInputElement && first.type === "text") {
          first.select();
        }
      }
    }, 20);

    return () => {
      clearTimeout(timer);
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  // Close on Escape unless busy/saving
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape" && !isSaving) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, isSaving]);

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget && !isSaving) {
      onClose();
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!isSaving && onSubmit) {
      onSubmit();
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  const resolvedWidth = width ?? sizeClasses[size];

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 sm:p-6 animate-fade-in"
      onMouseDown={handleBackdropMouseDown}
    >
      {onSubmit ? (
        <form
          ref={panelRef as React.RefObject<HTMLFormElement>}
          onSubmit={handleSubmit}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "relative flex w-full max-h-[90vh] flex-col rounded-xl bg-bg-base border border-border shadow-2xl overflow-hidden",
            resolvedWidth,
            className,
          )}
        >
          {renderHeader()}
          {renderBody()}
          {renderFooter()}
        </form>
      ) : (
        <div
          ref={panelRef as React.RefObject<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "relative flex w-full max-h-[90vh] flex-col rounded-xl bg-bg-base border border-border shadow-2xl overflow-hidden",
            resolvedWidth,
            className,
          )}
        >
          {renderHeader()}
          {renderBody()}
          {renderFooter()}
        </div>
      )}
    </div>
  );

  function renderHeader(): React.JSX.Element {
    return (
      <header
        className={cn(
          "flex items-start justify-between gap-4 border-b border-border px-6 py-4 bg-bg-raised/70",
          headerClassName,
        )}
      >
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={titleId}
                className={cn(
                  "text-lg font-bold tracking-tight text-text-primary",
                  titleClassName,
                )}
              >
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-sm text-text-muted">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          aria-label="Close"
          className="-mr-2 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>
    );
  }

  function renderBody(): React.JSX.Element {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-6 overflow-y-auto bg-bg-base p-6",
          bodyClassName,
        )}
      >
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-error-pill bg-error-subtle p-3 text-xs font-medium text-error"
          >
            <span>{error}</span>
          </div>
        )}
        {children}
      </div>
    );
  }

  function renderFooter(): React.JSX.Element | null {
    const resolvedActions =
      actions ??
      (primaryAction || secondaryAction ? (
        <>
          {secondaryAction && (
            <Button
              type="button"
              variant={secondaryAction.variant ?? "secondary"}
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled || isSaving}
            >
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button
              type={onSubmit ? "submit" : "button"}
              variant={primaryAction.variant ?? "primary"}
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled || isSaving}
            >
              {primaryAction.label}
            </Button>
          )}
        </>
      ) : null);

    if (!summary && !resolvedActions) return null;
    return (
      <footer
        className={cn(
          "flex items-center justify-between gap-4 border-t border-border px-6 py-4 bg-bg-raised/70",
          footerClassName,
        )}
      >
        <div className="min-w-0 text-sm">{summary}</div>
        <div className="flex shrink-0 items-center gap-2">
          {resolvedActions}
        </div>
      </footer>
    );
  }

  return createPortal(content, document.body);
}

/** FormSection in dialogs for labelled field groupings */
export function ModalSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-3.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted/70">
          {title}
        </h3>
        {hint && (
          <p className="mt-1 text-[12.5px] font-medium text-text-muted">
            {hint}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}
