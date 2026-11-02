import React, { useState } from "react";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { addProduct, useStockCodes } from "../masterData/masterData";
import { type ProductGroup } from "./products";

/**
 * Shown at the bottom of a product cell's popup when the stock code typed is not in the
 * product list yet. The group and description already filled in above become the new product,
 * so adding it is one click and needs no further form.
 */
export function AddProductRow({
  code,
  group,
  description,
}: {
  code: string;
  group: ProductGroup;
  description: string;
}): React.JSX.Element | null {
  const showToast = useToast();
  const codes = useStockCodes();
  const [busy, setBusy] = useState(false);
  const wanted = code.trim().toUpperCase();
  if (!wanted || codes.some((known) => known.toUpperCase() === wanted))
    return null;

  async function add(): Promise<void> {
    setBusy(true);
    try {
      await addProduct({
        stock_code: wanted,
        description: description.trim(),
        product_group: group,
        default_unit: "set",
      });
      showToast("success", `${wanted} added to the product list.`);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not add the product.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-bg-subtle px-2.5 py-1.5 text-xs text-text-secondary">
      <span>
        <span className="font-semibold text-text-primary">{wanted}</span> is not
        in the product list yet.
      </span>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={busy || !description.trim()}
        onClick={() => void add()}
        title={
          description.trim()
            ? undefined
            : "Fill in the description first, it is saved with the product."
        }
      >
        Add to product list
      </Button>
    </div>
  );
}
