import React from "react";
import { cn } from "@renderer/lib/utils";

/** One entry in a directory list: name, what is owed, address and a count. */
export function DirectoryRow({
  name,
  selected,
  inactive,
  onSelect,
  trailing,
  address,
  countLabel,
  highlight,
}: {
  name: string;
  selected: boolean;
  inactive: boolean;
  onSelect: () => void;
  /** What is owed, or "Paid", on the right of the name. */
  trailing: React.ReactNode;
  address: string;
  countLabel: string;
  /** A short line in the brand colour under the row, when something needs doing. */
  highlight?: string | null;
}): React.JSX.Element {
  return (
    <div
      data-explain=""
      onClick={onSelect}
      className={cn(
        "group relative cursor-pointer space-y-1 px-3.5 py-4 text-xs transition-colors",
        selected ? "bg-brand-subtle" : "hover:bg-brand-subtle",
        inactive && "opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1 bg-brand transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "font-bold truncate text-sm",
              selected ? "text-brand" : "text-text-primary",
              inactive && "line-through text-text-muted",
            )}
          >
            {name}
          </span>
          {inactive && (
            <span className="rounded bg-bg-raised px-1 py-0.2 text-[10px] text-text-muted">
              Inactive
            </span>
          )}
        </div>
        {trailing}
      </div>
      <div className="flex items-center justify-between text-text-muted text-[11px]">
        <span className="min-w-0 truncate pr-2" title={address}>
          {address}
        </span>
        <span>{countLabel}</span>
      </div>
      {highlight && (
        <div className="pt-0.5 text-[11px] font-semibold text-brand">
          {highlight}
        </div>
      )}
    </div>
  );
}
