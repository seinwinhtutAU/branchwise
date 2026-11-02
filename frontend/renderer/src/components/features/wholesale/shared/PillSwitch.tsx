import { cn } from "@renderer/lib/utils";

/** A row of rounded buttons for switching between two or three views of one page
 *  ("To move" / "Moved"). The chosen one is tinted and outlined; an optional note (a count
 *  or a quantity) follows its name. */
export function PillSwitch<Id extends string>({
  views,
  active,
  onChange,
  trailing,
}: {
  views: { id: Id; label: string; note?: string | null }[];
  active: Id;
  onChange: (id: Id) => void;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="bg-bg-base">
      <div
        role="tablist"
        className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3 sm:px-6"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((view) => {
            const isActive = view.id === active;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(view.id)}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
                  isActive
                    ? "border-brand bg-brand-subtle text-brand"
                    : "border-border bg-bg-subtle text-text-secondary hover:bg-bg-raised",
                )}
              >
                {view.label}
                {view.note && (
                  <span
                    className={cn(
                      "font-mono text-[11px] font-normal",
                      isActive ? "text-brand" : "text-text-muted",
                    )}
                  >
                    {view.note}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {trailing}
      </div>
      {/* Inset, so the line does not run edge to edge. */}
      <div className="mx-4 border-b border-border sm:mx-6" />
    </div>
  );
}
