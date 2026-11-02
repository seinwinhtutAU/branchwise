import React, { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { FloatingLayer } from "@renderer/components/features/wholesale/shared/ui";

/** A table cell that shows its value and, when clicked, opens a small popup just under
 *  it for filling in the details. The cell gets the same outline as a typed-in cell. */
export function PopupCell({
  label,
  display,
  problem,
  className,
  popupClassName,
  children,
}: {
  label: string;
  display: React.ReactNode;
  problem?: string;
  className?: string;
  popupClassName?: string;
  /** The popup's content; a function gets a `close` for content that should dismiss it. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cellRef.current?.contains(target) || popRef.current?.contains(target))
        return;
      // A dropdown opened from inside the popup lives in its own layer.
      if (target instanceof Element && target.closest("[data-floating-layer]"))
        return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <td
      ref={cellRef}
      className={cn(
        "h-px border-b border-r border-border p-0 align-top text-[13px] text-text-primary",
        "focus-within:[outline:2px_solid_var(--color-brand)] focus-within:[outline-offset:-2px]",
        open && "[outline:2px_solid_var(--color-brand)] [outline-offset:-2px]",
        problem &&
          !open &&
          "[outline:2px_solid_var(--color-error)] [outline-offset:-2px]",
        className,
      )}
      title={problem}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full min-h-7 w-full items-center px-2.5 py-1 text-left focus:outline-none"
      >
        {display}
      </button>
      {open && (
        <FloatingLayer
          anchorRef={cellRef}
          className={cn(
            "w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-bg-base p-3 shadow-xl animate-fade-in",
            popupClassName,
          )}
        >
          <div ref={popRef}>
            {typeof children === "function"
              ? children(() => setOpen(false))
              : children}
          </div>
        </FloatingLayer>
      )}
    </td>
  );
}
