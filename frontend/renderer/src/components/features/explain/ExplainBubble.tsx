import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@renderer/lib/utils";
import ChatMarkdown from "@renderer/components/features/chat/ChatMarkdown";
import { Spinner } from "@renderer/components/ui/Spinner";

// A spinning square's corners swing outside its box. Inside the answer's scroll area that made the
// scroll bar flash on and off for as long as it turned, so the spinner is clipped to its own box.
function ClippedSpinner(): React.JSX.Element {
  return (
    <span className="flex h-4 w-4 shrink-0 overflow-hidden">
      <Spinner className="h-4 w-4" />
    </span>
  );
}
import {
  ArrowRightIcon,
  CloseIcon,
  SparklesIcon,
} from "@renderer/components/ui/icons";
import {
  bubblePosition,
  clampBubble,
  type ExplainAnswer,
  type ExplainLanguage,
  type Rect,
} from "./explainHelpers";

export type BubbleState =
  | { status: "loading"; steps: string[] }
  | { status: "done"; result: ExplainAnswer }
  | { status: "error"; message: string };

const WIDTH = 340;
const MAX_HEIGHT = 420;

const LANGUAGES: { id: ExplainLanguage; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "my", label: "မြန်မာ" },
];

interface Props {
  anchor: Rect;
  /** What is being explained, shown under the title. */
  subject: string;
  state: BubbleState;
  language: ExplainLanguage;
  onLanguageChange: (language: ExplainLanguage) => void;
  onClose: () => void;
  onFollowUp: (question: string) => void;
  onContinue: () => void;
}

export function ExplainBubble({
  anchor,
  subject,
  state,
  language,
  onLanguageChange,
  onClose,
  onFollowUp,
  onContinue,
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(140);

  // The bubble grows as the answer arrives, so it is measured after each change and moved if
  // the new size no longer fits where it was.
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  }, [state]);

  const size = { width: WIDTH, height };
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  // Dragged by its title bar, like the pet. Once moved it stays where it was put (the next card
  // gets a fresh bubble that opens beside that card again).
  const [dragged, setDragged] = useState<{ left: number; top: number } | null>(
    null,
  );
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const { left, top } = dragged
    ? clampBubble(dragged, size, viewport)
    : bubblePosition(anchor, size, viewport);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    // Only the bar itself: the language and close buttons stay clickable.
    if (event.button !== 0 || (event.target as Element).closest("button")) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - left,
      offsetY: event.clientY - top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setDragged(
      clampBubble(
        {
          left: event.clientX - state.offsetX,
          top: event.clientY - state.offsetY,
        },
        size,
        viewport,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={ref}
      data-explain-ui=""
      role="dialog"
      aria-label="Explanation"
      className="explain-pop fixed z-[90] flex flex-col gap-2.5 overflow-hidden rounded-xl border border-border border-t-2 border-t-brand bg-bg-base p-3.5 text-[12.5px] leading-5 shadow-xl"
      style={{
        left,
        top,
        width: WIDTH,
        maxHeight: Math.min(MAX_HEIGHT, window.innerHeight - 24),
      }}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Drag to move"
        className="flex cursor-grab touch-none select-none items-center justify-between gap-2 active:cursor-grabbing"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
            <SparklesIcon className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-xs font-semibold text-brand">Explain</span>
            {subject && (
              <span
                className="truncate text-[11px] text-text-muted"
                title={subject}
              >
                {subject}
              </span>
            )}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="Language"
            className="flex overflow-hidden rounded-md border border-border text-xs"
          >
            {LANGUAGES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={language === option.id}
                onClick={() => onLanguageChange(option.id)}
                className={cn(
                  "px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  language === option.id
                    ? "bg-brand-subtle font-medium text-brand"
                    : "text-text-muted hover:bg-bg-raised hover:text-text-primary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close explanation"
            onClick={onClose}
            className="rounded p-0.5 text-text-muted hover:bg-bg-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* The answer scrolls when it is long; the header and the hand-over link stay in view. */}
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1">
        {state.status === "loading" && (
          <div className="flex flex-col gap-1 text-text-muted" role="status">
            {state.steps.length === 0 ? (
              <div className="flex items-center gap-2">
                <ClippedSpinner />
                Looking at the numbers…
              </div>
            ) : (
              state.steps.map((step, index) => (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-2",
                    index < state.steps.length - 1 && "opacity-60",
                  )}
                >
                  {index === state.steps.length - 1 ? (
                    <ClippedSpinner />
                  ) : (
                    <span className="h-4 w-4 shrink-0 text-center">·</span>
                  )}
                  {step}…
                </div>
              ))
            )}
          </div>
        )}

        {state.status === "error" && (
          <p className="text-error" role="alert">
            {state.message}
          </p>
        )}

        {state.status === "done" && (
          <>
            <ChatMarkdown text={state.result.answer} />
            {state.result.follow_ups.length > 0 && (
              <div className="border-t border-border/70 pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Ask next
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {state.result.follow_ups.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => onFollowUp(question)}
                      className="rounded-full border border-border bg-bg-base px-2.5 py-1 text-left text-xs text-text-secondary hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="-mx-1 flex items-center justify-between gap-2 rounded-md border-t border-border/70 px-1 pt-2 text-xs font-medium text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Continue in the assistant
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
