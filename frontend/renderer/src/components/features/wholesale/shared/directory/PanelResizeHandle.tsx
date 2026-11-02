import React from "react";

const MIN_WIDTH = 240;
const MAX_WIDTH = 480;
const KEY_STEP = 16;

const clamp = (width: number): number =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));

/** The draggable bar between a directory list and the page beside it. Arrow keys nudge it. */
export function PanelResizeHandle({
  label,
  width,
  onWidthChange,
}: {
  label: string;
  width: number;
  onWidthChange: (width: number | ((current: number) => number)) => void;
}): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const containerLeft =
          event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        onWidthChange(clamp(event.clientX - containerLeft));
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const change = event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP;
        onWidthChange((current) => clamp(current + change));
      }}
      className="z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors hover:bg-brand/50 focus-visible:bg-brand focus-visible:outline-none"
    />
  );
}
