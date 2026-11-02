import { cn } from "@renderer/lib/utils";
/** What the Revenue and Cost tabs are showing: everything still open, or one period. */
export type DashboardScope = "open" | "period";

const OPTIONS: { id: DashboardScope; label: string }[] = [
  { id: "open", label: "Open now" },
  { id: "period", label: "By period" },
];

/** Open now (everything not finished yet) or By period. */
export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: DashboardScope;
  onChange: (scope: DashboardScope) => void;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="What to show"
      className="inline-flex rounded-md border border-border p-0.5 text-xs font-semibold"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={scope === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded px-2.5 py-1 transition-colors",
            scope === option.id
              ? "bg-brand-subtle text-brand"
              : "text-text-muted hover:text-text-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
