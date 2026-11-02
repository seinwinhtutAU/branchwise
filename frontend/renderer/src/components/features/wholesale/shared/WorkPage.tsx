import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { PageHeader } from "@renderer/components/ui/PageHeader";

export interface WorkPageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  onBack: () => void;
  children: ReactNode;
  summary?: ReactNode;
  headerActions?: ReactNode;
  result?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  onEnter?: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  className?: string;
}

/** Shared full-page layout for wholesale tasks that create or change documents. */
export function WorkPage({
  title,
  subtitle,
  badge,
  onBack,
  children,
  summary,
  headerActions,
  result,
  primaryLabel,
  onPrimary,
  primaryLoading,
  primaryDisabled,
  onEnter,
  onCancel,
  cancelLabel = "Cancel",
  cancelDisabled,
  className,
}: WorkPageProps): React.JSX.Element {
  return (
    <div
      className={cn("min-h-full bg-bg-subtle", className)}
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.key === "Enter" &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          target instanceof HTMLElement &&
          !target.closest('[role="dialog"]') &&
          (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
        ) {
          event.preventDefault();
          onEnter?.();
        }
      }}
    >
      <header className="border-b border-border bg-bg-base/80">
        <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <PageHeader title={title} subtitle={subtitle} badge={badge} onBack={onBack} actions={headerActions} className="mb-0" />
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl px-4 py-4 pb-24 sm:px-6 lg:px-8">
        <div className={cn("grid grid-cols-1 items-start", summary ? "gap-6 lg:grid-cols-12 lg:gap-8" : "gap-4")}>
          <main className={cn("min-w-0 space-y-4", summary ? "lg:col-span-8" : "col-span-1")}>{children}</main>
          {summary && (
            <aside className="lg:sticky lg:top-5 lg:col-span-4">
              <section className="rounded-xl border border-border bg-bg-base p-5 shadow-sm sm:p-6">
                {summary}
              </section>
            </aside>
          )}
        </div>
      </div>
      <footer className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-30 border-t border-border bg-bg-base/95 shadow-[0_-4px_8px_-2px_rgba(0,0,0,0.08)] backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="min-w-0 text-sm text-text-secondary">{result}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={cancelDisabled}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              onClick={onPrimary}
              loading={primaryLoading}
              disabled={primaryDisabled}
            >
              {primaryLabel}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
