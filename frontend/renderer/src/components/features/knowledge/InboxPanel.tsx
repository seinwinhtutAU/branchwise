import { useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Card } from "@renderer/components/ui/Card";
import { Pill } from "@renderer/components/ui/Pill";
import type {
  DismissedItem,
  InboxItem,
} from "@renderer/components/features/knowledge/knowledgeApi";
import {
  askedLabel,
  reasonLine,
  TAG_LABELS,
} from "@renderer/components/features/knowledge/inboxHelpers";

interface Props {
  items: InboxItem[];
  dismissed: DismissedItem[];
  busyKey: string | null;
  onWrite: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
  onBringBack: (item: DismissedItem) => void;
}

// The questions the assistant couldn't answer (or answered wrongly), so the knowledge base can grow
// from real use: write an answer and the question closes; if the assistant fails on it again later it
// comes back. Dismissing is reversible, nothing is deleted.
export function InboxPanel({
  items,
  dismissed,
  busyKey,
  onWrite,
  onDismiss,
  onBringBack,
}: Props): React.JSX.Element | null {
  const [showDismissed, setShowDismissed] = useState(false);
  if (items.length === 0 && dismissed.length === 0) return null;

  return (
    <Card className="overflow-hidden border-brand/15 bg-gradient-to-r from-brand-subtle/70 via-bg-base to-bg-base p-0">
      <div className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
              {items.length}
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
              Your input is needed
            </p>
          </div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-text-primary">
            Things your assistant needs you to explain
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            If someone asks something it cannot answer well, add the answer here once and it will be better prepared next time.
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-xs text-text-muted">
            From real team questions
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="border-t border-brand/10 bg-bg-base/70 px-5 py-4 text-sm text-text-muted">
          Nothing is waiting right now. If the assistant needs help answering a question, it will show it here.
        </div>
      ) : (
        <div className="divide-y divide-border border-t border-brand/10 bg-bg-base/70">
            {items.map((item) => {
              const reason = reasonLine(item);
              return (
                <div
                  key={item.key}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      {item.question}
                    </p>
                    {reason && (
                      <p className="mt-1 text-xs leading-5 text-text-muted">{reason}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.tags.map((tag) => (
                        <Pill
                          key={tag}
                          size="sm"
                          tone={tag === "wrong" ? "error" : "warning"}
                        >
                          {TAG_LABELS[tag]}
                        </Pill>
                      ))}
                      <span className="text-xs text-text-muted">
                        {askedLabel(item.count)} · {new Date(item.last_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 sm:pt-0.5">
                    <Button
                      size="sm"
                      onClick={() => onWrite(item)}
                      disabled={busyKey === item.key}
                    >
                      Add an answer
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyKey === item.key}
                      onClick={() => onDismiss(item)}
                      title="This does not need an answer right now. You can bring it back later."
                    >
                      Not now
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="border-t border-border bg-bg-base px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setShowDismissed((open) => !open)}
            aria-expanded={showDismissed}
            className="text-xs font-medium text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {showDismissed ? "Hide" : "Show"} saved for later ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {dismissed.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="text-[13px] text-text-secondary">
                    {item.question}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onBringBack(item)}
                  >
                    Work on this
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
