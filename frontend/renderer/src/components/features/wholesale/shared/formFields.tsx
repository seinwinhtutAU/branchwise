// The plain data-entry widgets every wholesale form is built from: labelled text/number
// fields, a suggest-as-you-type box, and the group/currency pickers. Pulled out of ui.tsx
// because they are a distinct concern from that file's page-chrome and layout primitives.

import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { useDecimalText } from "@renderer/lib/decimalText";
import { PlusIcon } from "@renderer/components/ui/icons";
import { Input } from "@renderer/components/ui/Input";
import { Spinner } from "@renderer/components/ui/Spinner";
import { Textarea } from "@renderer/components/ui/Textarea";
import { onlyDigits } from "@renderer/components/features/wholesale/shared/shared";
import { CopyButton, EDITABLE, FloatingLayer } from "./ui";

/** A value the reader can see but not change. */
export function ReadOnlyField({
  label,
  value,
  copyable = false,
  wrap = false,
  className,
}: {
  label: string;
  value: string;
  /** Shows a copy button — for the references people pass on to someone else. */
  copyable?: boolean;
  /** Lets long values remain fully visible instead of being truncated. */
  wrap?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <dt className="text-sm font-medium text-text-secondary mb-1.5">
        {label}
      </dt>
      <dd
        className={cn(
          "bg-bg-subtle border border-border rounded-md px-3 text-sm text-text-primary flex justify-between gap-2",
          wrap
            ? "min-h-10 h-auto items-start py-2 whitespace-normal break-words"
            : "h-10 items-center",
        )}
      >
        <span className={wrap ? "whitespace-normal break-words" : "truncate"}>
          {value || "—"}
        </span>
        {copyable && value && (
          <CopyButton value={value} what={label.toLowerCase()} />
        )}
      </dd>
    </div>
  );
}

/** A box typed straight into a table cell. */
export function CellInput({
  label,
  placeholder,
  value,
  numeric = false,
  decimal = false,
  maxDecimals,
  type = "text",
  multiline = false,
  suffix,
  error,
  className,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  /** Whole numbers only. */
  numeric?: boolean;
  /** A number with a decimal point (a price, a rate); the box keeps what is typed. */
  decimal?: boolean;
  /** With `decimal`: the most digits allowed after the point. */
  maxDecimals?: number;
  type?: "text" | "date";
  multiline?: boolean;
  /** A unit (Ks, THB) shown after the number while the cell is not being edited. It
   *  disappears when the cell is focused so only the number is left to change. */
  suffix?: string;
  /** Said plainly under the box when what was typed cannot be read. */
  error?: string;
  className?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const decimalText = useDecimalText(value, onChange, maxDecimals);
  const shown =
    suffix && !focused && value !== "" && Number.isFinite(Number(value))
      ? `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${suffix}`
      : decimal
        ? decimalText.text
        : value;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        {multiline ? (
          <>
            <Textarea
              aria-label={label}
              placeholder={placeholder}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={cn(
                "min-h-9 px-2",
                EDITABLE,
                "placeholder:text-text-muted",
                error && "border-error focus-visible:ring-error",
                className,
              )}
              aria-invalid={error ? true : undefined}
            />
          </>
        ) : (
          <>
            <input
              type={type}
              inputMode={numeric ? "numeric" : decimal ? "decimal" : undefined}
              aria-label={label}
              placeholder={placeholder}
              value={shown}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                if (decimal) decimalText.settle();
              }}
              onChange={(event) => {
                if (decimal) return decimalText.change(event.target.value);
                onChange(
                  numeric ? onlyDigits(event.target.value) : event.target.value,
                );
              }}
              className={cn(
                "w-full h-8 rounded-md border border-border px-2.5 text-[13px] text-text-primary",
                EDITABLE,
                "placeholder:text-text-muted",
                "transition-all duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
                error && "border-error focus-visible:ring-error",
                className,
              )}
              aria-invalid={error ? true : undefined}
            />
          </>
        )}
      </div>
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}

export type SuggestionEntry =
  | string
  | {
      value: string;
      label?: React.ReactNode;
      badge?: React.ReactNode;
      onSelect?: () => void;
    };

/** Type a name, or pick one already used. Our own list rather than a native `<datalist>`,
 *  which the operating system draws and which therefore ignores the app's theme. */
export function SuggestInput({
  label,
  placeholder,
  suggestions,
  value,
  onChange,
  /** Inside a table cell there is no room for a label above the box. */
  bare = false,
  size,
  className,
  labelClassName,
  required,
  error,
  onBlur,
  onAddNew,
  addLabel = "Add",
  footer,
  onPopupClose,
  popupClassName,
  popupListClassName,
  matchPopupWidth = true,
  disabled = false,
}: {
  label: React.ReactNode;
  placeholder: string;
  suggestions: readonly SuggestionEntry[];
  value: string;
  onChange: (value: string) => void;
  bare?: boolean;
  size?: "sm" | "md";
  className?: string;
  labelClassName?: string;
  required?: boolean;
  error?: string;
  onBlur?: () => void;
  /** When the typed text is not in the list, offer to add it; called with the typed name. */
  onAddNew?: (name: string) => void | Promise<unknown>;
  /** What the add row says before the name, e.g. "Add new place". */
  addLabel?: string;
  /** Extra actions shown at the bottom of the suggestion popup. */
  footer?: React.ReactNode;
  /** Called when this menu is dismissed, including a click outside it. */
  onPopupClose?: () => void;
  /** Extra sizing or layout classes for the suggestion popup. */
  popupClassName?: string;
  /** Extra sizing or layout classes for the scrollable popup contents. */
  popupListClassName?: string;
  /** Keeps the menu aligned to the input width unless this picker needs more room. */
  matchPopupWidth?: boolean;
  /** Makes the text field and suggestion list read-only. */
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  const query = value.trim().toLowerCase();
  const matches = suggestions.filter((entry) => {
    const val = typeof entry === "string" ? entry : entry.value;
    return query === "" ? true : val.toLowerCase().includes(query);
  });
  const canAdd =
    !!onAddNew &&
    query !== "" &&
    !suggestions.some((entry) => {
      const val = typeof entry === "string" ? entry : entry.value;
      return val.toLowerCase() === query;
    });

  function closePopup(): void {
    setOpen(false);
    onPopupClose?.();
  }

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        containerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      closePopup();
    }
    document.addEventListener("pointerdown", handlePointer, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointer, true);
  }, [open, onPopupClose]);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        ref={inputRef}
        size={size}
        label={bare ? undefined : label}
        labelClassName={labelClassName}
        aria-label={bare && typeof label === "string" ? label : undefined}
        required={required}
        className={cn(EDITABLE, className)}
        placeholder={addingNew ? `Adding “${value.trim()}”...` : placeholder}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        error={error}
        disabled={disabled || addingNew}
        endIcon={
          addingNew ? <Spinner className="h-3.5 w-3.5 text-brand" /> : undefined
        }
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Escape") closePopup();
        }}
      />
      {open && (matches.length > 0 || canAdd || footer) && (
        <FloatingLayer
          anchorRef={inputRef}
          matchAnchorWidth={matchPopupWidth}
          className={cn(
            "bg-bg-base border border-border rounded-md shadow-lg animate-fade-in",
            popupClassName,
          )}
        >
          <ul
            ref={dropdownRef}
            role="listbox"
            className={cn("max-h-44 overflow-y-auto py-1", popupListClassName)}
          >
            {matches.map((entry) => {
              const name = typeof entry === "string" ? entry : entry.value;
              const badge = typeof entry === "string" ? null : entry.badge;
              const label =
                typeof entry === "string" ? name : (entry.label ?? name);
              const onSelect =
                typeof entry === "string" ? undefined : entry.onSelect;
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={name === value}
                    onClick={() => {
                      if (onSelect) {
                        onSelect();
                      } else {
                        onChange(name);
                      }
                      closePopup();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{label}</span>
                    {badge && (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-brand-subtle text-brand shrink-0">
                        {badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {canAdd && (
              <li>
                <button
                  type="button"
                  disabled={addingNew}
                  onClick={async () => {
                    if (addingNew) return;
                    setAddingNew(true);
                    try {
                      await onAddNew?.(value.trim());
                      closePopup();
                    } catch {
                      // Handled by caller's toast
                    } finally {
                      setAddingNew(false);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary",
                    matches.length > 0 && "border-t border-border",
                    addingNew &&
                      "opacity-75 cursor-wait bg-brand-subtle/30 text-brand",
                  )}
                >
                  {addingNew ? (
                    <Spinner className="h-3.5 w-3.5 shrink-0 text-brand" />
                  ) : (
                    <PlusIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                  )}
                  <span>
                    {addingNew ? "Adding" : addLabel}{" "}
                    <span className="font-semibold text-text-primary">
                      “{value.trim()}”
                    </span>
                    {addingNew ? "..." : ""}
                  </span>
                </button>
              </li>
            )}
            {footer && (
              <li
                className={cn(
                  (matches.length > 0 || canAdd) && "border-t border-border",
                )}
              >
                {footer}
              </li>
            )}
          </ul>
        </FloatingLayer>
      )}
    </div>
  );
}
