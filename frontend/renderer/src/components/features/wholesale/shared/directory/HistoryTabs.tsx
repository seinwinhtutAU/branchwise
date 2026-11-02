import React from "react";
import { cn } from "@renderer/lib/utils";

/** The tab strip above a directory page's lists, each tab with a count. */
export function HistoryTabs<T extends string>({
  ariaLabel,
  idPrefix,
  panelId,
  tabs,
  active,
  onChange,
}: {
  ariaLabel: string;
  /** Tabs get the id `${idPrefix}-${tab.id}`; the panel they control is `panelId`. */
  idPrefix: string;
  panelId: string;
  tabs: { id: T; label: string; count: number }[];
  active: T;
  onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-5 border-b border-border"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={panelId}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-1 py-2 text-xs font-semibold transition-colors",
              isActive
                ? "border-brand text-brand"
                : "border-transparent text-text-muted hover:border-brand hover:text-brand",
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                "tabular-nums",
                isActive ? "text-brand" : "text-text-muted",
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
