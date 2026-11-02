import { useEffect, useState } from "react";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { cn } from "@renderer/lib/utils";
import type { AppSettings } from "@renderer/lib/appSettings";

type Rule = AppSettings["wholesale_profit"];

/** The profit the wholesale order form adds when it suggests a selling price. */
export function WholesaleProfitSettings({
  rule,
  disabled,
  onSave,
}: {
  rule: Rule | undefined;
  disabled: boolean;
  onSave: (next: Rule) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<Rule["kind"]>(rule?.kind ?? "percent");
  const [text, setText] = useState(rule ? String(rule.value) : "");
  useEffect(() => {
    if (!rule) return;
    setKind(rule.kind);
    setText(String(rule.value));
  }, [rule]);

  function commit(nextKind: Rule["kind"], nextText: string): void {
    const value = Number(nextText);
    const valid =
      nextText.trim() !== "" &&
      Number.isFinite(value) &&
      value >= 0 &&
      (nextKind === "amount" || value < 100);
    if (!valid) {
      if (rule) {
        setKind(rule.kind);
        setText(String(rule.value));
      }
      return;
    }
    if (rule && rule.kind === nextKind && rule.value === value) return;
    onSave({ kind: nextKind, value });
  }

  return (
    <Card>
      <CardHeader
        title="Selling price profit"
        description="The profit added to a product's cost when the order form suggests a selling price. A percentage is a share of the selling price; an amount is Ks on every set."
      />
      {!rule ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="flex items-center gap-2">
          <div className="w-36">
            <Input
              type="text"
              inputMode="decimal"
              value={text}
              disabled={disabled}
              placeholder="0"
              onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => commit(kind, text)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(kind, text);
              }}
            />
          </div>
          <div
            role="group"
            aria-label="Profit type"
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            {(
              [
                ["percent", "%"],
                ["amount", "Ks a set"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={kind === id}
                onClick={() => {
                  setKind(id);
                  commit(id, text);
                }}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium",
                  kind === id
                    ? "bg-brand text-white"
                    : "bg-bg-base text-text-secondary hover:bg-bg-subtle",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
