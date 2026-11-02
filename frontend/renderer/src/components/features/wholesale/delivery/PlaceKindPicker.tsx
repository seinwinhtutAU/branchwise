import React from "react";

/** Two cards for what a place on the route is: a stop on the way, or the receiving gate where
 *  the goods end up. Drawn with the same pin and warehouse as the map. */
export function PlaceKindPicker({
  isGate,
  onChange,
  gateBlocked,
  stopBlocked,
  small = false,
}: {
  isGate: boolean;
  onChange: (isGate: boolean) => void;
  /** Why it cannot be a receiving gate, when it cannot. */
  gateBlocked?: string;
  /** Why it cannot be a stop, when it cannot. */
  stopBlocked?: string;
  /** As tall as a small input (32px) instead of a normal one (36px). */
  small?: boolean;
}): React.JSX.Element {
  const options = [
    { gate: false, label: "In transit", blocked: stopBlocked },
    { gate: true, label: "Receiving", blocked: gateBlocked },
  ];
  return (
    <div className="flex gap-2">
      {options.map((option) => {
        const chosen = isGate === option.gate;
        const color = option.gate
          ? "var(--color-journey-final)"
          : "var(--color-journey-stop)";
        const off = !chosen && !!option.blocked;
        return (
          <button
            key={option.label}
            type="button"
            disabled={off}
            title={off ? option.blocked : undefined}
            onClick={() => onChange(option.gate)}
            className={`flex ${small ? "h-8" : "h-9"} items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-45`}
            style={
              chosen
                ? { borderColor: color, color, backgroundColor: "transparent" }
                : undefined
            }
          >
            <svg width="16" height="16" viewBox="-14 -14 28 28" aria-hidden>
              {option.gate ? (
                <g fill="currentColor">
                  <path d="M-14 12 V-3 L0 -10 L14 -3 V12 Z" />
                </g>
              ) : (
                <g fill="currentColor">
                  <path d="M0 -12 a9 9 0 0 1 9 9 c0 7 -9 15 -9 15 c0 0 -9 -8 -9 -15 a9 9 0 0 1 9 -9 z" />
                </g>
              )}
            </svg>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
