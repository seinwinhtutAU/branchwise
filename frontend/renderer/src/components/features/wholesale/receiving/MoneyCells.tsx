import React, { useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { cleanDecimal, numberOfText } from "@renderer/lib/decimalText";
import { Td } from "@renderer/components/ui/Table";
import {
  CellInput,
  FloatingLayer,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  DEFAULT_CURRENCY,
  FOREIGN_CURRENCIES,
  isForeignCurrency,
  previewKyatAmount,
} from "@renderer/components/features/wholesale/shared/currency";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { CELL, CELL_TD } from "./cellStyles";

export interface MoneyFields {
  /** Always the Kyat amount. */
  amount: number;
  currency_code?: string;
  original_amount?: number | null;
  exchange_rate?: number | null;
}

/** The three money cells of a payment or cost row: Amount (Baht), Rate, Amount (Ks).
 *  A row is in Baht when an amount is typed in the first cell; its Kyat figure is then
 *  worked out from the rate. Without a Baht amount, the Kyat cell is typed directly. */
export function MoneyCells({
  value,
  label,
  todayRate,
  onChange,
  hint,
}: {
  value: MoneyFields;
  label: string;
  /** Today's Baht rate from Settings, offered when a Baht amount is first typed. */
  todayRate: number;
  onChange: (patch: MoneyFields) => void;
  /** A suggested Kyat amount, offered in a small popup while the Kyat cell is being typed in. */
  hint?: { title: string; note: string; price: number };
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const kyatCell = useRef<HTMLDivElement>(null);
  const foreign =
    !!value.currency_code && isForeignCurrency(value.currency_code);
  const foreignCode = FOREIGN_CURRENCIES[0];

  function setBaht(text: string): void {
    const digits = cleanDecimal(text);
    if (digits === "") {
      onChange({
        amount: value.amount,
        currency_code: DEFAULT_CURRENCY,
        original_amount: null,
        exchange_rate: null,
      });
      return;
    }
    const original = Number(digits) || 0;
    const rate = value.exchange_rate ?? todayRate;
    onChange({
      currency_code: foreignCode,
      original_amount: original,
      exchange_rate: rate,
      amount: previewKyatAmount(original, rate),
    });
  }

  function setRate(text: string): void {
    const rate = numberOfText(cleanDecimal(text));
    onChange({
      currency_code: foreignCode,
      original_amount: value.original_amount ?? 0,
      exchange_rate: rate,
      amount: previewKyatAmount(value.original_amount ?? 0, rate),
    });
  }

  return (
    <>
      <Td className={CELL_TD}>
        <CellInput
          label={`${label} amount in Baht`}
          placeholder=""
          suffix="฿"
          decimal
          maxDecimals={2}
          value={foreign ? String(value.original_amount ?? "") : ""}
          onChange={setBaht}
          className={cn(CELL, "text-right font-mono")}
        />
      </Td>
      {foreign ? (
        <Td className={CELL_TD}>
          <CellInput
            label={`${label} exchange rate`}
            placeholder="Rate"
            decimal
            value={value.exchange_rate ? String(value.exchange_rate) : ""}
            onChange={setRate}
            className={cn(CELL, "text-right font-mono")}
          />
        </Td>
      ) : (
        <Td className="text-right text-[13px] text-text-muted">—</Td>
      )}
      {foreign ? (
        <Td className="text-right font-mono text-[13px] font-semibold text-text-primary">
          {formatKyat(value.amount)}
        </Td>
      ) : (
        <Td className={CELL_TD}>
          <div
            ref={kyatCell}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={() => setFocused(false)}
          >
            <CellInput
              label={`${label} amount in Kyat`}
              placeholder="0"
              decimal
              maxDecimals={2}
              suffix="Ks"
              value={String(value.amount || "")}
              onChange={(next) =>
                onChange({
                  amount: Number(next) || 0,
                  currency_code: DEFAULT_CURRENCY,
                  original_amount: null,
                  exchange_rate: null,
                })
              }
              className={cn(CELL, "text-right font-mono")}
            />
          </div>
          {focused && hint && value.amount !== hint.price && (
            <FloatingLayer
              anchorRef={kyatCell}
              align="right"
              className="w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-bg-base p-3 text-left shadow-xl animate-fade-in"
            >
              {/* mouse down would take the focus off the price and close this before the click lands */}
              <div onMouseDown={(event) => event.preventDefault()}>
                <div className="text-[13px] font-semibold text-text-primary">
                  {hint.title}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{hint.note}</p>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      amount: hint.price,
                      currency_code: DEFAULT_CURRENCY,
                      original_amount: null,
                      exchange_rate: null,
                    })
                  }
                  className="mt-2 text-xs font-semibold text-brand hover:underline"
                >
                  Use this price
                </button>
              </div>
            </FloatingLayer>
          )}
        </Td>
      )}
    </>
  );
}
