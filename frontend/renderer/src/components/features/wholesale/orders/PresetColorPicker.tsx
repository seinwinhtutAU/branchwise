import { useCallback, useEffect, useRef, useState } from "react";
import { colorMeaning } from "./colorMeaning";
import { cn } from "@renderer/lib/utils";
import { colorDotClass } from "./orderColorUtils";
import {
  CheckIcon,
  CloseIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  PAIRS_PER,
  formatSets,
  unitName,
  type Unit,
  type UnitConversions,
} from "@renderer/components/features/wholesale/shared/units";
import { parseColorQty } from "@renderer/components/features/wholesale/shared/shared";

const PRESET_COLORS = [
  "Black",
  "White",
  "Gray",
  "Brown",
  "Red",
  "Pink",
  "Orange",
  "Yellow",
  "Green",
  "Blue",
  "Purple",
] as const;

export interface PresetColorPickerProps {
  /** The raw breakdown string, e.g. "black10s,white20s" */
  value: string;
  onChange: (nextBreakdown: string) => void;
  unit?: Unit;
  disabled?: boolean;
  /** Wholesale lines are counted in sets, so callers can hide the per-colour unit picker. */
  showUnit?: boolean;
  className?: string;
  /** Limits the choice to colours that are actually there: the most of each colour, in
   *  pairs, keyed by lower-case colour name. Every other standard colour is shown greyed
   *  out and cannot be picked, there is no "Custom" colour, and a quantity stops at the
   *  most available. Left out, any colour and any quantity can be entered. */
  allowed?: Record<string, number>;
  /** How many pairs make a set or a dozen, for capping quantities against `allowed`. */
  conversions?: UnitConversions;
  /** Pairs of each colour still to come, keyed by lower-case colour name. Shown as chips
   *  above the colour choices. A negative number means more than expected was entered. */
  remaining?: Record<string, number>;
  /** What the chips above the choices are called. */
  remainingLabel?: string;
}

/** "Grey" and "Gray" are one colour: compared alike, but each place keeps its own spelling. */
const sameColor = (color: string): string => {
  const key = color.trim().toLowerCase();
  return key === "grey" ? "gray" : key;
};

const UNIT_SUFFIX: Record<Unit, string> = {
  pair: "p",
  set: "s",
  dozen: "d",
};

function serializeEntries(entries: ReturnType<typeof parseColorQty>): string {
  return entries
    .filter((entry) => entry.color.trim())
    .map((entry) => {
      const entryUnit = entry.unit ?? "set";
      return `${entry.color.trim().toLowerCase()}${Math.max(0, Math.floor(entry.qty))}${UNIT_SUFFIX[entryUnit]}`;
    })
    .join(",");
}

export function PresetColorPicker({
  value,
  onChange,
  unit = "set",
  disabled = false,
  showUnit = true,
  className,
  allowed,
  conversions = PAIRS_PER,
  remaining,
  remainingLabel = "Left to count:",
}: PresetColorPickerProps): React.JSX.Element {
  type Entry = ReturnType<typeof parseColorQty>[number] & { unit: Unit };
  const toEntries = useCallback(
    (text: string): Entry[] =>
      parseColorQty(text).map((entry) => ({
        ...entry,
        unit: entry.unit ?? unit,
      })),
    [unit],
  );
  // The rows live here, not only in `value`: a color whose number was just deleted is no longer
  // part of the text but its row has to stay so the number can be typed again. `value` only
  // replaces the rows when it changes from outside (All, Clear, another cell).
  const [entries, setEntries] = useState<Entry[]>(() => toEntries(value));
  const meaning = useCallback(
    (text: string): string => colorMeaning(text, unit, conversions),
    [unit, conversions],
  );
  const sent = useRef(meaning(value));
  useEffect(() => {
    if (meaning(value) === sent.current) return;
    sent.current = meaning(value);
    setEntries(toEntries(value));
  }, [value, meaning, toEntries]);
  const [customColor, setCustomColor] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const selectedColors = new Set(
    entries.map((entry) => sameColor(entry.color)),
  );
  // The spelling `allowed` uses for a colour, so a pick matches what is actually there.
  const spelled = (color: string): string =>
    (allowed &&
      Object.keys(allowed).find(
        (key) => sameColor(key) === sameColor(color),
      )) ||
    color.toLowerCase();

  function updateEntries(nextEntries: Entry[]): void {
    setEntries(nextEntries);
    const text = serializeEntries(nextEntries.filter((entry) => entry.qty > 0));
    sent.current = meaning(text);
    onChange(text);
  }

  const canPick = (color: string): boolean =>
    !allowed || (allowed[spelled(color)] ?? 0) > 0;
  // The most of a colour that can be typed in the given unit (no limit when unrestricted).
  function capFor(color: string, entryUnit: Unit): number {
    if (!allowed) return Number.POSITIVE_INFINITY;
    return Math.floor((allowed[spelled(color)] ?? 0) / conversions[entryUnit]);
  }
  // Colours that can be chosen but are not in the standard list (a colour like Beige).
  const extraColors = allowed
    ? Object.keys(allowed).filter(
        (color) =>
          allowed[color] > 0 &&
          !PRESET_COLORS.some(
            (preset) => sameColor(preset) === sameColor(color),
          ),
      )
    : [];

  function addColor(colorName: string): void {
    const clean = spelled(colorName.trim());
    if (!clean || selectedColors.has(sameColor(clean)) || !canPick(clean))
      return;
    // A colour with less than one whole set available starts out counted in pairs.
    const startUnit = capFor(clean, unit) >= 1 ? unit : "pair";
    updateEntries([
      ...entries,
      {
        color: clean,
        qty: Math.min(1, capFor(clean, startUnit)) || 1,
        unit: startUnit,
      },
    ]);
  }

  function handleAddCustom(): void {
    if (!customColor.trim()) return;
    addColor(customColor);
    setCustomColor("");
    setShowCustomInput(false);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-bg-base/60 p-3",
        className,
      )}
    >
      {remaining && Object.keys(remaining).length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            {remainingLabel}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(remaining).map(([color, pairs]) => (
              <span
                key={color}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border border-border bg-bg-subtle/80 px-2 py-1 text-xs font-medium text-text-secondary",
                  pairs === 0 && "opacity-50",
                  pairs < 0 && "border-error/50 bg-error/10 text-error",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full border",
                    colorDotClass(color),
                  )}
                />
                <span className="capitalize">{color}</span>
                <span className="font-mono font-semibold tabular-nums text-text-primary">
                  {pairs < 0
                    ? `${formatSets(-pairs, conversions)} over`
                    : formatSets(pairs, conversions)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-muted">
          Choose standard colors:
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {[...PRESET_COLORS, ...extraColors].map((color) => {
            const isSelected = selectedColors.has(sameColor(color));
            const pickable = canPick(color);
            return (
              <button
                key={color}
                type="button"
                disabled={disabled || !pickable}
                title={pickable ? undefined : "Not available"}
                onClick={() => addColor(color)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  isSelected
                    ? "border-brand/40 bg-brand-subtle font-semibold text-brand shadow-2xs"
                    : "border-border bg-bg-subtle/80 text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
                  (disabled || !pickable) && "cursor-not-allowed opacity-40",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full border",
                    colorDotClass(color),
                  )}
                />
                <span className="capitalize">{color}</span>
                {isSelected && (
                  <CheckIcon className="ml-0.5 h-3 w-3 text-brand" />
                )}
              </button>
            );
          })}

          {allowed ? null : !showCustomInput ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setShowCustomInput(true)}
              className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-text-muted hover:text-text-primary"
            >
              <PlusIcon className="h-3 w-3" />
              <span>Custom...</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                autoFocus
                placeholder="e.g. Olive"
                value={customColor}
                onChange={(event) => setCustomColor(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddCustom();
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    setShowCustomInput(false);
                  }
                }}
                className="h-6 w-24 rounded border border-border bg-bg-base px-1.5 text-xs text-text-primary focus:border-brand focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustom}
                className="px-1 text-xs font-medium text-brand hover:underline"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowCustomInput(false)}
                className="px-1 text-xs text-text-muted hover:text-text-primary"
                aria-label="Cancel custom color"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
          <label className="text-xs font-medium text-text-muted">
            Quantity per color:
          </label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2">
            {entries.map((entry, index) => (
              <div
                key={`${entry.color}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-bg-subtle/50 p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full border",
                      colorDotClass(entry.color),
                    )}
                  />
                  <span className="truncate text-xs font-semibold capitalize text-text-primary">
                    {entry.color}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={disabled}
                    value={entry.qty > 0 ? entry.qty : ""}
                    placeholder="0"
                    aria-label={`${entry.color} quantity`}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      const nextEntries = entries.map(
                        (current, currentIndex) =>
                          currentIndex === index
                            ? {
                                ...current,
                                qty: Math.min(
                                  digits ? Number(digits) : 0,
                                  capFor(current.color, current.unit),
                                ),
                              }
                            : current,
                      );
                      updateEntries(nextEntries);
                    }}
                    className="h-7 w-14 rounded border border-border bg-bg-base px-2 text-right text-xs font-medium tabular-nums text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  {showUnit && (
                    <select
                      value={entry.unit}
                      disabled={disabled}
                      aria-label={`${entry.color} quantity unit`}
                      onChange={(event) => {
                        const nextEntries = entries.map(
                          (current, currentIndex) =>
                            currentIndex === index
                              ? {
                                  ...current,
                                  unit: event.target.value as Unit,
                                  qty: Math.min(
                                    current.qty,
                                    capFor(
                                      current.color,
                                      event.target.value as Unit,
                                    ),
                                  ),
                                }
                              : current,
                        );
                        updateEntries(nextEntries);
                      }}
                      className="h-7 w-20 rounded border border-border bg-bg-base px-1.5 text-xs text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="set">{unitName("set", 2)}</option>
                      <option value="pair">{unitName("pair", 2)}</option>
                      <option value="dozen">{unitName("dozen", 2)}</option>
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      updateEntries(
                        entries.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                    title={`Remove ${entry.color}`}
                    aria-label={`Remove ${entry.color}`}
                    className="ml-0.5 rounded p-1 text-text-muted transition-colors hover:text-error"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
