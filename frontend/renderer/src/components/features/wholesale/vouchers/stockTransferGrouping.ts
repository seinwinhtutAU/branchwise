import {
  colorPairsForText,
  serializeColorPairs,
  type ColorPairs,
} from "../inventory/stock";
import { PAIRS_PER } from "../shared/units";
import { type StockTransfer } from "./stockTransfersApi";

type TransferLine = StockTransfer["lines"][number];

export interface TransferGroup {
  key: string;
  transfers: StockTransfer[];
}

export interface CombinedTransferLine {
  stock_code: string;
  description: string;
  product_group: TransferLine["product_group"];
  color_breakdown: string;
  quantity_pairs: number;
  unit_conversions?: TransferLine["unit_conversions"];
  parts: { transfer: StockTransfer; line: TransferLine }[];
}

/** Transfers to the same place from the same gate on the same day are one arrival to count. */
export function groupTransfersToCount(
  transfers: StockTransfer[],
): TransferGroup[] {
  const groups = new Map<string, TransferGroup>();
  for (const transfer of transfers) {
    const key = [
      transfer.from_location.trim().toLowerCase(),
      transfer.to_location.trim().toLowerCase(),
      transfer.moved_on,
    ].join("\u0000");
    const group = groups.get(key);
    if (group) group.transfers.push(transfer);
    else groups.set(key, { key, transfers: [transfer] });
  }
  return [...groups.values()];
}

/** Product lines are combined so staff counts the arrival once, not one transfer at a time. */
export function combineTransferLines(
  transfers: StockTransfer[],
): CombinedTransferLine[] {
  const byCode = new Map<string, CombinedTransferLine>();
  const colorsByCode = new Map<string, ColorPairs>();
  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      const key = line.stock_code.trim().toLowerCase();
      let combined = byCode.get(key);
      if (!combined) {
        combined = {
          stock_code: line.stock_code,
          description: line.description,
          product_group: line.product_group,
          color_breakdown: "",
          quantity_pairs: 0,
          unit_conversions: line.unit_conversions,
          parts: [],
        };
        byCode.set(key, combined);
        colorsByCode.set(key, {});
      }
      combined.quantity_pairs += line.quantity_pairs;
      combined.parts.push({ transfer, line });
      const colors = colorsByCode.get(key)!;
      for (const [color, pairs] of Object.entries(
        colorPairsForText(
          line.color_breakdown,
          line.unit,
          line.unit_conversions,
        ),
      )) {
        colors[color] = (colors[color] ?? 0) + pairs;
      }
    }
  }
  return [...byCode.entries()].map(([key, line]) => ({
    ...line,
    color_breakdown: serializeColorPairs(
      colorsByCode.get(key)!,
      line.unit_conversions?.set ?? PAIRS_PER.set,
    ),
  }));
}

/** Splits one combined count back across its original transfers for the API audit trail. */
export function countPayloadsForTransferGroup(
  transfers: StockTransfer[],
  lines: CombinedTransferLine[],
  counts: Record<string, string>,
): {
  transfer: StockTransfer;
  lines: { stock_code: string; color_breakdown: string; unit: "set" }[];
}[] {
  const counted = new Map<string, ColorPairs>();
  for (const line of lines) {
    const remaining = colorPairsForText(
      counts[line.stock_code] ?? "",
      "set",
      line.unit_conversions,
    );
    for (const { transfer, line: part } of line.parts) {
      const key = `${transfer.transfer_id}\u0000${part.stock_code}`;
      const allocation: ColorPairs = {};
      let capacity = part.quantity_pairs;
      for (const color of Object.keys(remaining)) {
        const amount = remaining[color] ?? 0;
        const added = Math.min(amount, capacity);
        if (added > 0) {
          allocation[color] = added;
          remaining[color] = amount - added;
          capacity -= added;
        }
      }
      // A receiver may count more than was sent; retain that difference on the final transfer.
      if (capacity === 0 && line.parts.at(-1)?.line === part) {
        for (const [color, amount] of Object.entries(remaining)) {
          if (amount > 0) allocation[color] = (allocation[color] ?? 0) + amount;
        }
      }
      counted.set(key, allocation);
    }
  }
  return transfers.map((transfer) => ({
    transfer,
    lines: transfer.lines.map((line) => ({
      stock_code: line.stock_code,
      color_breakdown: serializeColorPairs(
        counted.get(`${transfer.transfer_id}\u0000${line.stock_code}`) ?? {},
        line.unit_conversions?.set ?? PAIRS_PER.set,
      ),
      unit: "set" as const,
    })),
  }));
}
