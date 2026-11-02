import React, { useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { ChevronDownIcon, FilterIcon } from "@renderer/components/ui/icons";
import { FilterChip } from "./FilterChip";
import { cn } from "@renderer/lib/utils";

export interface FilterOption {
  id: string;
  label: string;
}

export interface FilterBarCategory {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export interface FilterBarProps {
  category1: FilterBarCategory;
  category2: FilterBarCategory;
  onClearAll: () => void;
  resultCountText?: string;
}

export function FilterBar({
  category1,
  category2,
  onClearAll,
  resultCountText,
}: FilterBarProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const toggleOption = (category: FilterBarCategory, id: string): void => {
    if (category.selected.includes(id)) {
      category.onChange(category.selected.filter((item) => item !== id));
    } else {
      category.onChange([...category.selected, id]);
    }
  };

  const totalActiveCount =
    category1.selected.length + category2.selected.length;
  const hasActiveFilters = totalActiveCount > 0;

  // Build active chips
  const activeChips: { id: string; label: string; onRemove: () => void }[] = [];

  category1.selected.forEach((id) => {
    const opt = category1.options.find((o) => o.id === id);
    if (opt) {
      activeChips.push({
        id: `cat1-${id}`,
        label: opt.label,
        onRemove: () =>
          category1.onChange(category1.selected.filter((item) => item !== id)),
      });
    }
  });

  category2.selected.forEach((id) => {
    const opt = category2.options.find((o) => o.id === id);
    if (opt) {
      activeChips.push({
        id: `cat2-${id}`,
        label: opt.label,
        onRemove: () =>
          category2.onChange(category2.selected.filter((item) => item !== id)),
      });
    }
  });

  return (
    <div className="space-y-2 pt-1 text-xs">
      {/* Controls row: [Filter ▾ (count)] [Clear all] ... result count */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            ref={refs.setReference}
            {...getReferenceProps()}
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors select-none",
              hasActiveFilters
                ? "border-brand bg-brand-subtle text-brand"
                : "border-border bg-bg-base text-text-secondary hover:border-text-muted/40 hover:text-text-primary",
            )}
            aria-expanded={isOpen}
          >
            <FilterIcon className="h-3.5 w-3.5" />
            <span>Filter</span>
            {hasActiveFilters && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                {totalActiveCount}
              </span>
            )}
            <ChevronDownIcon
              className={cn(
                "h-3 w-3 opacity-60 transition-transform",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-text-muted hover:text-brand transition-colors focus:outline-none"
            >
              Clear all
            </button>
          )}
        </div>

        {resultCountText && (
          <span className="text-[11px] text-text-muted select-none tabular-nums truncate">
            {resultCountText}
          </span>
        )}
      </div>

      {/* Floating Popover mounted outside parent overflow containers */}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-64 rounded-xl border border-border bg-bg-base p-3 shadow-xl focus:outline-none"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-1.5">
                <FilterIcon className="h-3.5 w-3.5 text-brand" />
                <span className="text-xs font-bold text-text-primary">
                  Filters
                </span>
                {hasActiveFilters && (
                  <span className="rounded-full bg-brand/10 px-1.5 py-0.2 text-[10px] font-semibold text-brand">
                    {totalActiveCount}
                  </span>
                )}
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-[11px] font-medium text-text-muted hover:text-brand transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Category 1 */}
            <div className="pt-2.5 pb-2">
              <div className="mb-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                {category1.label}
              </div>
              <div className="space-y-0.5">
                {category1.options.map((opt) => {
                  const isChecked = category1.selected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-text-primary hover:bg-bg-subtle cursor-pointer select-none transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOption(category1, opt.id)}
                        className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="my-1 border-t border-border/60" />

            {/* Category 2 */}
            <div className="pt-2 pb-1">
              <div className="mb-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                {category2.label}
              </div>
              <div className="space-y-0.5">
                {category2.options.map((opt) => {
                  const isChecked = category2.selected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-text-primary hover:bg-bg-subtle cursor-pointer select-none transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOption(category2, opt.id)}
                        className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}

      {/* Active chips row */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {activeChips.map((chip) => (
            <FilterChip
              key={chip.id}
              label={chip.label}
              onRemove={chip.onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
