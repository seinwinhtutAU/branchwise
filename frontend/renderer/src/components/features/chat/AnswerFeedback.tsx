import { useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  CheckIcon,
  CopyIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@renderer/components/ui/icons";

export interface MessageFeedback {
  rating: "up" | "down";
  reason: string | null;
}

interface Props {
  feedback: MessageFeedback | null | undefined;
  onRate: (rating: "up" | "down", reason?: string) => void;
  onClear: () => void;
  // The answer's text, for the copy button; no button when absent.
  copyText?: string;
}

// "Right" saves at once; "wrong" asks for an optional reason first, because a reason is what
// turns a wrong answer into something the assistant can be tested on later. Pressing the
// active button again takes the rating back.
export function AnswerFeedback({
  feedback,
  onRate,
  onClear,
  copyText,
}: Props): React.JSX.Element {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);

  const isUp = feedback?.rating === "up";
  const isDown = feedback?.rating === "down";

  function pressUp(): void {
    setAsking(false);
    if (isUp) onClear();
    else onRate("up");
  }

  function pressDown(): void {
    if (isDown && !asking) {
      onClear();
      return;
    }
    setReason(feedback?.reason ?? "");
    setAsking(true);
  }

  function send(): void {
    onRate("down", reason);
    setAsking(false);
  }

  function copy(): void {
    if (!copyText) return;
    void navigator.clipboard
      .writeText(copyText)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  const buttonClass = (active: boolean, activeColor: string): string =>
    cn(
      "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      active
        ? activeColor
        : "text-text-muted hover:bg-bg-raised hover:text-text-primary",
    );

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={pressUp}
          aria-pressed={isUp}
          aria-label="This answer was right"
          title="Right"
          className={buttonClass(isUp, "text-brand")}
        >
          <ThumbsUpIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={pressDown}
          aria-pressed={isDown}
          aria-label="This answer was wrong"
          title="Wrong"
          className={buttonClass(isDown, "text-error")}
        >
          <ThumbsDownIcon className="w-3.5 h-3.5" />
        </button>
        {copyText && (
          <button
            type="button"
            onClick={copy}
            aria-label="Copy this answer"
            title={copied ? "Copied" : "Copy"}
            className={buttonClass(copied, "text-brand")}
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
      {asking && (
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder="What was wrong? (optional)"
            maxLength={500}
            size="sm"
            className="flex-1"
            autoFocus
          />
          <Button size="sm" onClick={send}>
            Send
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAsking(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
