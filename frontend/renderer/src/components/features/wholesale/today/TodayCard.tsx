import React from "react";
import { cn } from "@renderer/lib/utils";
import { ArrowRightIcon, CheckIcon } from "@renderer/components/ui/icons";

export type Tone = "brand" | "info" | "warning" | "success";

const TONES: Record<
  Tone,
  {
    card: string;
    head: string;
    badge: string;
    glow: string;
    action: string;
  }
> = {
  brand: {
    card: "border-brand/30 hover:border-brand/60",
    head: "from-brand-subtle via-brand-subtle/80 to-bg-base",
    badge: "bg-brand text-white ring-brand/15",
    glow: "bg-brand/20",
    action:
      "border-brand/20 bg-brand-subtle/80 text-brand hover:border-brand hover:bg-brand hover:text-white",
  },
  info: {
    card: "border-info/30 hover:border-info/60",
    head: "from-info-subtle via-info-subtle/80 to-bg-base",
    badge: "bg-info text-white ring-info/15",
    glow: "bg-info/20",
    action:
      "border-info/20 bg-info-subtle/80 text-info hover:border-info hover:bg-info hover:text-white",
  },
  warning: {
    card: "border-warning/30 hover:border-warning/60",
    head: "from-warning-subtle via-warning-subtle/80 to-bg-base",
    badge: "bg-warning text-bg-base ring-warning/15",
    glow: "bg-warning/20",
    action:
      "border-warning/20 bg-warning-subtle/80 text-warning hover:border-warning hover:bg-warning hover:text-bg-base",
  },
  success: {
    card: "border-success/30 hover:border-success/60",
    head: "from-success-subtle via-success-subtle/80 to-bg-base",
    badge: "bg-success text-white ring-success/15",
    glow: "bg-success/20",
    action:
      "border-success/20 bg-success-subtle/80 text-success hover:border-success hover:bg-success hover:text-white",
  },
};

export function TodayCard({
  tone,
  className,
  icon,
  title,
  total,
  headline,
  headlineNote,
  tabs,
  empty,
  footnote,
  children,
}: {
  tone: Tone;
  className?: string;
  icon: React.ReactNode;
  title: string;
  total: number;
  headline: string;
  headlineNote?: string;
  tabs?: React.ReactNode;
  empty: string;
  footnote?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = TONES[tone];
  return (
    <section
      data-explain=""
      className={cn(
        "relative flex h-[260px] min-h-0 flex-col overflow-hidden rounded-xl border bg-bg-base shadow-sm transition-[box-shadow,border-color] duration-200 hover:shadow-md lg:h-full",
        t.card,
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-3xl",
          t.glow,
        )}
        aria-hidden="true"
      />
      <header
        className={cn(
          "relative flex min-h-[62px] items-center gap-3 bg-gradient-to-r px-4 py-3",
          t.head,
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ring-4",
            t.badge,
          )}
        >
          {icon}
        </span>
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        {tabs && <div className="min-w-0">{tabs}</div>}
        <div className="ml-auto flex items-baseline gap-1.5 rounded-lg border border-bg-base/70 bg-bg-base/70 px-2.5 py-1.5 shadow-xs backdrop-blur-sm">
          <span className="text-sm font-bold tabular-nums text-text-primary">
            {headline}
          </span>
          {headlineNote && (
            <span className="text-xs text-text-muted">{headlineNote}</span>
          )}
        </div>
      </header>
      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center text-xs text-text-muted">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-subtle">
            <CheckIcon className="h-4 w-4 text-success" />
          </span>
          {empty}
        </div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
          {children}
        </div>
      )}
      {footnote && (
        <footer className="border-t border-border px-3.5 py-1.5 text-xs text-text-muted">
          {footnote}
        </footer>
      )}
    </section>
  );
}

export function TodayRow({
  tone,
  title,
  note,
  figure,
  figureNote,
  chip,
  chipWarn,
  actionLabel,
  onClick,
  onAction,
}: {
  tone: Tone;
  title: string;
  note: string;
  figure: string;
  figureNote?: string;
  chip?: string;
  chipWarn?: boolean;
  actionLabel: string;
  onClick: () => void;
  onAction: () => void;
}): React.JSX.Element {
  const t = TONES[tone];
  return (
    <div
      data-explain=""
      onClick={onClick}
      className="group relative flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-bg-subtle/80"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        <div className="truncate text-xs text-text-muted">{note}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold tabular-nums">{figure}</div>
        {chip ? (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
              chipWarn
                ? "bg-warning-subtle text-warning"
                : "bg-success-subtle text-success",
            )}
          >
            {chip}
          </span>
        ) : (
          figureNote && (
            <div className="text-xs text-text-muted">{figureNote}</div>
          )
        )}
      </div>
      <div className="flex w-[130px] shrink-0 justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold leading-tight shadow-xs transition-colors",
            t.action,
          )}
        >
          {actionLabel}
          <ArrowRightIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
