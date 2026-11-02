import React from "react";
import { Button } from "@renderer/components/ui/Button";
import { PlusIcon, SearchIcon } from "@renderer/components/ui/icons";

/** Title, New button, search box and "Show inactive" at the top of a directory list. */
export function DirectoryHeader({
  icon,
  title,
  searchPlaceholder,
  searchQuery,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  onNew,
  inactiveLabel = "Show inactive",
  context,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  searchPlaceholder: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showInactive: boolean;
  onShowInactiveChange: (value: boolean) => void;
  onNew: () => void;
  /** The checkbox wording, when "Show inactive" is too long for the space. */
  inactiveLabel?: string;
  /** A filter applied by another page, with an explicit way to return to the full directory. */
  context?: { label: string; onClear: () => void };
  /** Extra controls under the search row, such as a place filter. */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-3 border-b border-border/60 bg-bg-base p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-bold text-text-primary">{title}</h2>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onNew}
          className="h-7 text-xs gap-1"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          New
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-border bg-bg-subtle h-8 pl-9 pr-3 text-[13px] text-text-primary placeholder:text-text-muted focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
        </div>
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onShowInactiveChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
          />
          <span>{inactiveLabel}</span>
        </label>
      </div>
      {context && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand/20 bg-brand-subtle/50 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 truncate font-medium text-brand">
            Dashboard filter · {context.label}
          </span>
          <button
            type="button"
            onClick={context.onClear}
            className="shrink-0 font-medium text-text-secondary hover:text-brand"
          >
            Clear
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
