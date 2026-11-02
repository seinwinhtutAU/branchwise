import React, { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { CloseIcon, SwapIcon } from "@renderer/components/ui/icons";
import { FloatingLayer } from "./ui";
import { formatSets } from "./units";
import type { OpenRelated, RelatedItem, RelatedResult } from "./relatedLookup";

const SHOWN = 5;

/** A small icon (with a count) beside a product line. Hover for the open orders or vouchers
 *  tied to the line, and for others with the same product that could be tied to it; click to
 *  keep the list open, open a record, or link and unlink. Shows nothing when there is nothing
 *  to list. */
export function RelatedRecordsButton({
  related,
  linkedHeading,
  linkedNote,
  candidateHeading,
  candidateNote,
  onOpen,
  onLink,
  onUnlink,
  busy = false,
}: {
  related: RelatedResult;
  linkedHeading: string;
  /** What a linked row's quantity means, e.g. "for this order". */
  linkedNote: string;
  candidateHeading: string;
  /** What a candidate's quantity means, e.g. "would be covered". */
  candidateNote: string;
  onOpen?: OpenRelated;
  onLink?: (item: RelatedItem) => void;
  onUnlink?: (item: RelatedItem) => void;
  busy?: boolean;
}): React.JSX.Element | null {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = hover || pinned;

  function enter(): void {
    if (timer.current) clearTimeout(timer.current);
    setHover(true);
  }
  function leave(): void {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), 150);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!pinned) return;
    function onPointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        anchorRef.current?.contains(target) ||
        cardRef.current?.contains(target)
      )
        return;
      setPinned(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [pinned]);

  const { linked, candidates } = related;
  if (linked.length === 0 && candidates.length === 0) return null;
  const openLinked = linked.filter((item) => !item.closed).length;
  const count = openLinked || linked.length || candidates.length;

  function row(
    item: RelatedItem,
    note: string,
    mode: "linked" | "candidate",
  ): React.JSX.Element {
    return (
      <div
        key={item.key}
        className={cn(
          "group flex items-center gap-1 rounded-lg hover:bg-bg-raised",
          item.closed && "opacity-60",
        )}
      >
        <button
          type="button"
          disabled={!onOpen}
          onClick={() =>
            onOpen?.({
              kind: item.kind,
              id: item.id,
              referenceNo: item.reference,
            })
          }
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2.5 py-1.5 text-left disabled:cursor-default"
        >
          <span className="min-w-0">
            <span className="block font-mono font-semibold text-brand">
              {item.reference}
            </span>
            <span className="block truncate text-text-secondary">
              {item.party}
            </span>
          </span>
          <span className="shrink-0 text-right text-text-primary">
            {formatSets(item.pairs)}
            <span className="block text-[11px] text-text-muted">
              {item.closed ?? note}
            </span>
          </span>
        </button>
        {mode === "candidate" && onLink && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onLink(item)}
            className="mr-1.5 shrink-0 rounded-md border border-brand/40 px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand-subtle disabled:opacity-50"
          >
            Link
          </button>
        )}
        {mode === "linked" && onUnlink && (
          <button
            type="button"
            disabled={busy}
            title="Unlink"
            aria-label={`Unlink ${item.reference}`}
            onClick={() => onUnlink(item)}
            className="mr-1.5 shrink-0 rounded-md p-1 text-text-muted hover:bg-error-subtle hover:text-error disabled:opacity-50"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`${linked.length ? linkedHeading : candidateHeading} (${count})`}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={() => setPinned((current) => !current)}
        className={cn(
          "relative rounded p-1.5 text-text-muted transition-colors hover:bg-brand-subtle hover:text-brand",
          open && "text-brand",
        )}
      >
        <SwapIcon className="h-4 w-4" />
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none text-white",
            openLinked ? "bg-brand" : "bg-text-muted",
          )}
        >
          {count}
        </span>
      </button>
      {open && (
        <FloatingLayer
          anchorRef={anchorRef}
          align="right"
          className="w-80 rounded-xl border border-border bg-bg-base p-1.5 text-xs shadow-xl"
        >
          <div ref={cardRef} onMouseEnter={enter} onMouseLeave={leave}>
            {linked.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {linkedHeading}
                </p>
                {linked
                  .slice(0, SHOWN)
                  .map((item) => row(item, linkedNote, "linked"))}
                {linked.length > SHOWN && (
                  <p className="px-2.5 py-1 text-text-muted">
                    +{linked.length - SHOWN} more
                  </p>
                )}
              </>
            )}
            {candidates.length > 0 && (
              <>
                <p
                  className={cn(
                    "px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted",
                    linked.length > 0 && "mt-1 border-t border-border pt-2.5",
                  )}
                >
                  {candidateHeading}
                </p>
                {candidates
                  .slice(0, SHOWN)
                  .map((item) => row(item, candidateNote, "candidate"))}
                {candidates.length > SHOWN && (
                  <p className="px-2.5 py-1 text-text-muted">
                    +{candidates.length - SHOWN} more
                  </p>
                )}
              </>
            )}
          </div>
        </FloatingLayer>
      )}
    </>
  );
}
