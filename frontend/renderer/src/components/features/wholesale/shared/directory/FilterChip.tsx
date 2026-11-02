import React from "react";
import { CloseIcon } from "@renderer/components/ui/icons";

export interface FilterChipProps {
  label: string;
  onRemove: () => void;
  className?: string;
}

export function FilterChip({
  label,
  onRemove,
  className = "",
}: FilterChipProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-subtle/40 px-2 py-0.5 text-xs font-medium text-brand-strong transition-colors hover:border-brand/50 ${className}`}
    >
      <span className="truncate max-w-[180px]">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="rounded-full p-0.5 text-brand/70 hover:bg-brand/15 hover:text-brand focus:outline-none focus:ring-1 focus:ring-brand"
        aria-label={`Remove filter: ${label}`}
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </span>
  );
}
