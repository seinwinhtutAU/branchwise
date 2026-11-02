import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { CheckIcon } from "./icons";

export interface FilterMenuItemProps {
  label: ReactNode;
  selected?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  count?: number | string;
  className?: string;
}

export function FilterMenuItem({
  label,
  selected = false,
  onClick,
  icon,
  count,
  className,
}: FilterMenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
        selected
          ? "bg-brand/10 font-bold text-brand"
          : "hover:bg-bg-subtle text-text-secondary",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 min-w-0 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1 shrink-0 ml-2">
        {count !== undefined && (
          <span className="text-[10px] text-text-muted font-mono">{count}</span>
        )}
        {selected && <CheckIcon className="w-3.5 h-3.5 text-brand shrink-0" />}
      </span>
    </button>
  );
}
