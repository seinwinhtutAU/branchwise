import { Field } from "@renderer/components/ui/Field";
import { Input } from "@renderer/components/ui/Input";
import { cleanDecimal } from "@renderer/lib/decimalText";
import { cn } from "@renderer/lib/utils";
import { formatKyat } from "../shared/shared";
import { discountAmount, type DiscountKind } from "./supplierVouchers";

/** What was typed, as text, so a half-typed "5." is not rewritten under the cursor. */
export interface DiscountDraft {
  kind: DiscountKind;
  value: string;
  /** The rate a Baht discount is converted at. */
  rate: string;
}

/** The supplier's discount on the whole voucher, typed as a Kyat amount or a Baht amount (with
 *  its rate). The worked-out Kyat figure is shown next to it so nothing is a
 *  guess. */
export function DiscountInput({
  kind,
  value,
  rate,
  todayRate,
  subtotal,
  onChange,
  className,
}: {
  kind: DiscountKind;
  value: string;
  rate: string;
  /** Today's Baht rate from Settings, offered when Baht is first chosen. */
  todayRate: number;
  subtotal: number;
  onChange: (next: DiscountDraft) => void;
  className?: string;
}): React.JSX.Element {
  const unit: "amount" | "baht" = kind === "baht" ? "baht" : "amount";
  const typed = Number(value) || 0;
  const typedRate = Number(rate) || 0;
  const worked = discountAmount(unit, typed, subtotal, typedRate);
  return (
    <Field
      label="Supplier discount (optional)"
      htmlFor="voucher-discount"
      labelClassName="text-sm"
      className={className}
    >
      <div className="flex items-center gap-2">
        <Input
          id="voucher-discount"
          inputMode="decimal"
          placeholder="0"
          value={value}
          className="bg-bg-subtle focus:bg-bg-base"
          onChange={(e) =>
            onChange({ kind: unit, value: cleanDecimal(e.target.value), rate })
          }
        />
        <div
          role="group"
          aria-label="Discount type"
          className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
        >
          {(
            [
              ["amount", "Ks"],
              ["baht", "฿"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={unit === id}
              onClick={() =>
                onChange({
                  kind: id,
                  value,
                  rate: id === "baht" && !rate ? String(todayRate || "") : rate,
                })
              }
              className={cn(
                "px-3 py-1.5 text-sm font-medium",
                unit === id
                  ? "bg-brand text-white"
                  : "bg-bg-base text-text-secondary hover:bg-bg-subtle",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {unit === "baht" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="whitespace-nowrap text-xs font-semibold text-text-secondary">
            Rate
          </span>
          <Input
            aria-label="Discount exchange rate"
            inputMode="decimal"
            placeholder="Rate"
            value={rate}
            className="bg-bg-subtle focus:bg-bg-base"
            onChange={(e) =>
              onChange({
                kind: unit,
                value,
                rate: cleanDecimal(e.target.value),
              })
            }
          />
        </div>
      )}
      {typed > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          {unit === "baht" && typedRate <= 0
            ? "Enter the exchange rate."
            : `Takes ${formatKyat(worked)} off the voucher.`}
        </p>
      )}
    </Field>
  );
}
