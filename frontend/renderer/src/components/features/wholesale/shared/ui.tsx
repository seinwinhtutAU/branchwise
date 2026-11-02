/* eslint-disable react-refresh/only-export-components -- barrel re-exports below pull in
   non-component values (types, constants) from the files this one split into. */
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { copyText } from "@renderer/lib/clipboard";
import { useToast } from "@renderer/lib/useToast";
import { InfoLabel } from "@renderer/components/ui/InfoTooltip";
import { CheckIcon, CopyIcon, PencilIcon } from "@renderer/components/ui/icons";

// The pieces every wholesale screen is built from. They lived in four copies, one per
// page, which is exactly how the four screens kept drifting apart: a fix to one never
// reached the others. One copy now, so a change to a panel, a figure card or a step bar
// lands on Customer Orders, Supplier Vouchers, Delivery and Receiving at once. Form-entry
// widgets, the journey visualisation and the batch/inspector drawers moved
// out to their own files as this one grew past 1700 lines; they're re-exported below so
// every existing "from .../wholesale/ui" import keeps working unchanged.

export const PAGE_SIZE = 10;

/** Every box a person is meant to fill in — the same plain surface `Input` already uses
 *  elsewhere, since the border alone already says "type here" next to a `ReadOnlyField`'s
 *  bare text. An earlier version tinted these amber to call out "editable"; composited
 *  over a dark background that tint read as a muddy brown rather than a colour choice. */
export const EDITABLE =
  "bg-bg-base border-border hover:border-border-strong focus-visible:ring-brand";

type Tone = "brand" | "neutral" | "warning" | "success" | "error";

/** A field name with the red star that marks it as one that has to be filled in. */
export function Required({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {children} <span className="text-error">*</span>
    </>
  );
}

/** The small copy button beside a reference number or a stock code. These are the strings
 *  people carry to a phone call, a chat message or the supplier's own paperwork, and
 *  retyping "RCV-260912-0001" by eye is where a wrong digit gets in. It stays visible
 *  rather than appearing on hover: an icon that only shows up when the pointer is already
 *  on it is an icon nobody finds. */
export function CopyButton({
  value,
  what,
}: {
  value: string;
  /** What is being copied, for the screen reader — "shipment no.", "stock code". */
  what: string;
}): React.JSX.Element {
  const showToast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      title={copied ? "Copied" : `Copy ${what}`}
      aria-label={`Copy ${what} ${value}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value).then(() => {
          setCopied(true);
          showToast("success", `Copied ${what} to clipboard.`);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "shrink-0 rounded-sm p-0.5 transition-colors duration-150",
        copied
          ? "text-success"
          : "text-text-muted hover:text-brand hover:bg-brand-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      )}
    >
      {copied ? (
        <CheckIcon className="w-3.5 h-3.5" />
      ) : (
        <CopyIcon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/** A reference on two lines — SHP-260827 over -0001 — so a column of them stays narrow
 *  while the whole reference is still readable, with a copy button beside it. */
export function Reference({
  value,
  what = "reference",
  onClick,
  singleLine = false,
}: {
  value: string;
  /** What this reference is, for the copy button's screen-reader label. */
  what?: string;
  onClick?: () => void;
  singleLine?: boolean;
}): React.JSX.Element {
  const cut = value.lastIndexOf("-");
  const head = cut > 0 ? value.slice(0, cut) : value;
  const tail = cut > 0 ? value.slice(cut) : "";
  // Each half stays on its own line — never broken again by a narrow column, which is
  // how "SHP-260827" became three lines once the copy button took part of the width.
  const body = singleLine ? (
    <span className="whitespace-nowrap">{value}</span>
  ) : (
    <>
      <span className="block whitespace-nowrap">{head}</span>
      {tail && <span className="block whitespace-nowrap">{tail}</span>}
    </>
  );

  return (
    <span
      className={cn(
        "inline-flex gap-1",
        singleLine ? "items-center" : "items-start",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "text-left font-semibold text-brand tabular-nums rounded-sm",
            "hover:underline underline-offset-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          )}
        >
          {body}
        </button>
      ) : (
        <span className="font-semibold tabular-nums">{body}</span>
      )}
      <CopyButton value={value} what={what} />
    </span>
  );
}

function toneText(tone: Tone): string {
  return tone === "warning"
    ? "text-warning"
    : tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "neutral"
          ? "text-text-secondary"
          : "text-brand";
}

/** The white panel every wholesale screen is built out of. */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      // Explain mode points at a panel only on a page that has opted in (see features/explain).
      data-explain=""
      className={cn(
        "bg-bg-base border border-border rounded-md overflow-hidden shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

function toneBorder(tone: Tone): string {
  return tone === "warning"
    ? "border-t-warning"
    : tone === "success"
      ? "border-t-success"
      : tone === "error"
        ? "border-t-error"
        : tone === "neutral"
          ? "border-t-border-strong"
          : "border-t-brand";
}

/** A figure to read, not a control: no hover response and nothing to click, so it never
 *  suggests an action it does not have. */
export function FigureCard({
  label,
  description,
  value,
  sub,
  tone = "brand",
  compact = false,
  className,
}: {
  label: React.ReactNode;
  description?: string;
  value: string;
  sub?: string;
  tone?: Tone;
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      data-explain=""
      className={cn(
        "bg-bg-base border border-border border-t-2 rounded-md shadow-sm transition-shadow duration-150",
        toneBorder(tone),
        compact ? "px-2 py-1.5" : "px-3 py-2 sm:px-3.5 sm:py-2.5",
        className,
      )}
    >
      <span
        className={cn(
          "block text-[11px] font-semibold uppercase tracking-wider text-text-muted select-none truncate",
          compact ? "mb-0.5" : "mb-0.5",
        )}
      >
        {description ? (
          <InfoLabel description={description}>{label}</InfoLabel>
        ) : (
          label
        )}
      </span>
      <span
        className={cn(
          "block font-bold tabular-nums tracking-tight font-mono leading-tight",
          compact
            ? "text-base sm:text-lg mb-0.5"
            : "text-base sm:text-lg mb-0.5",
          toneText(tone),
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="block text-[10px] sm:text-[11px] text-text-muted/80 leading-tight truncate select-none">
          {sub}
        </span>
      )}
    </div>
  );
}

/** The same pill as StatusPill, with a leading colour dot — the shape every order/
 *  voucher status and payment badge across the wholesale screens actually uses. The
 *  words, background and dot colour still belong to each screen. */
export function DotPill({
  label,
  className,
  dotClassName,
}: {
  label: string;
  className: string;
  dotClassName: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap select-none",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClassName)} />
      {label}
    </span>
  );
}

/** A fact on a review step. */
export function ReviewFact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs text-text-muted mb-1">{label}</dt>
      <dd className="text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}

/** Numbered circles joined by rules, ticked green as each step is passed. */
export function StepBar({
  steps,
  step,
  presentation = "default",
}: {
  steps: readonly string[];
  step: number;
  presentation?: "default" | "bar";
}): React.JSX.Element {
  return (
    <ol
      className={cn(
        "flex items-center flex-wrap gap-y-2",
        presentation === "bar" &&
          "w-full rounded-lg bg-bg-subtle px-4 py-3 sm:px-5",
      )}
    >
      {steps.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={label} className="flex items-center">
            <span
              className={cn(
                "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-semibold",
                "transition-colors duration-150 motion-reduce:transition-none",
                done && "bg-success border-success text-white",
                active && "bg-brand border-brand text-white",
                !done && !active && "bg-bg-base border-border text-text-muted",
              )}
            >
              {done ? <CheckIcon className="w-4 h-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "ml-3 text-sm font-semibold",
                active && "text-brand",
                done && "text-success",
                !done && !active && "text-text-muted",
              )}
            >
              {label}
            </span>
            {index < steps.length - 1 && (
              <span
                className={cn(
                  "w-8 sm:w-12 md:w-16 h-0.5 mx-2 sm:mx-3",
                  done ? "bg-success" : "bg-border-strong",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One row of a dropdown menu. */
export function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      className={cn(
        "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:bg-bg-subtle",
        danger
          ? "text-error hover:bg-error-subtle"
          : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
      )}
    >
      {icon ?? <span className="w-4" />}
      {label}
    </button>
  );
}

/**
 * Render a floating layer outside panels and table scrollports. Dropdowns and row
 * action menus must be able to extend past rounded cards; an absolutely positioned
 * child cannot do that when one of its ancestors has overflow clipping.
 */
export function FloatingLayer({
  anchorRef,
  children,
  className,
  align = "left",
  matchAnchorWidth = false,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className: string;
  align?: "left" | "right";
  matchAnchorWidth?: boolean;
}): React.JSX.Element {
  const { refs, floatingStyles } = useFloating({
    placement: align === "right" ? "bottom-end" : "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements, rects }) {
          if (matchAnchorWidth) {
            elements.floating.style.width = `${rects.reference.width}px`;
          }
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
  });

  useEffect(() => {
    refs.setReference(anchorRef.current);
  }, [anchorRef, refs]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        data-floating-layer=""
        style={{
          ...floatingStyles,
          visibility: refs.reference.current ? "visible" : "hidden",
          zIndex: 100,
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className={className}
      >
        {children}
      </div>
    </FloatingPortal>
  );
}

export * from "./formFields";
export * from "./journeyVisuals";

/** A small pencil after a column heading: the cells in this column can be typed in. Columns
 *  without it are worked out by the app, or only for reading. */
export function EditMark(): React.JSX.Element {
  return (
    <span aria-hidden className="ml-1 inline-flex align-[-1px] text-text-muted">
      <PencilIcon className="h-3 w-3" />
    </span>
  );
}

/** The hover hint that goes with {@link EditMark}. */
export const EDITABLE_COLUMN_HINT = "You can type in this column";
