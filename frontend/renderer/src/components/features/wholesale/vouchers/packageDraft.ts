import type React from "react";
import {
  emptyItem,
  type ReceivingItem,
  type ReceivingPackage,
} from "../receiving/receivings";
import {
  receivedColorProblem,
  receivedColorQuantityProblem,
  receivedStockCodeProblem,
  voucherExpectations,
} from "../receiving/voucherCheckUtils";
import { type Receiving } from "../receiving/receivings";
import { quantityFromColors } from "@renderer/components/features/wholesale/shared/shared";
import { PAIRS_PER } from "@renderer/components/features/wholesale/shared/units";
import { productOf } from "../masterData/masterData";

/** What is wrong with the packages counted so far, one plain sentence per problem. */
export function collectReceivingProblems(
  packages: ReceivingPackage[],
  expected: ReturnType<typeof voucherExpectations>,
  voucherWideReceiving: Receiving | undefined,
): string[] {
  const problems: string[] = [];
  for (const pkg of packages) {
    for (const it of pkg.items) {
      const codeProb = receivedStockCodeProblem(it.stock_code, expected);
      if (codeProb && !problems.includes(codeProb)) {
        problems.push(`${it.stock_code}: ${codeProb}`);
      }
      const colorProb = receivedColorProblem(
        it.stock_code,
        it.color_breakdown,
        expected,
      );
      if (colorProb && !problems.includes(colorProb)) {
        problems.push(`${it.stock_code}: ${colorProb}`);
      }
      const quantityProb = voucherWideReceiving
        ? receivedColorQuantityProblem(
            it.stock_code,
            voucherWideReceiving,
            expected,
          )
        : null;
      if (quantityProb) {
        const message = `${it.stock_code}: ${quantityProb}`;
        if (!problems.includes(message)) problems.push(message);
      }
    }
  }
  return problems;
}

interface PackageDraftState {
  packagesDraft: ReceivingPackage[];
  setPackagesDraft: React.Dispatch<React.SetStateAction<ReceivingPackage[]>>;
  setPackagesDirty: (dirty: boolean) => void;
  /** The date a package gets when it is opened without one. */
  receivedOn: string;
}

/**
 * Package and product editing on the local draft: pick a package, open it, add or remove
 * products, type the colour breakdown. Nothing is sent until Save changes is pressed.
 */
export function packageDraftActions({
  packagesDraft,
  setPackagesDraft,
  setPackagesDirty,
  receivedOn,
}: PackageDraftState): {
  duplicateDraftPreviousPackage: (targetIndex: number) => void;
  setDraftColorQty: (
    packageIndex: number,
    itemIndex: number,
    colorQty: string,
  ) => void;
  setDraftStockCode: (
    packageIndex: number,
    itemIndex: number,
    code: string,
  ) => void;
  addDraftItem: (packageIndex: number) => void;
  removeDraftItem: (packageIndex: number, itemIndex: number) => void;
} {
  function setDraftPackage(
    index: number,
    patch: Partial<ReceivingPackage>,
  ): void {
    setPackagesDraft((prev) =>
      prev.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );
    setPackagesDirty(true);
  }

  function duplicateDraftPreviousPackage(targetIndex: number): void {
    if (targetIndex <= 0) return;
    const prev = packagesDraft[targetIndex - 1];
    if (!prev || prev.items.length === 0) return;
    const current = packagesDraft[targetIndex];
    if (!current) return;
    const clonedItems: ReceivingItem[] = prev.items.map((item, i) => ({
      ...item,
      item_id: `cloned-${current.package_id}-${i}-${Date.now()}`,
    }));
    setDraftPackage(targetIndex, {
      opened: true,
      received_on: current.received_on || receivedOn,
      items: clonedItems,
    });
  }

  function setDraftItem(
    packageIndex: number,
    itemIndex: number,
    patch: Partial<ReceivingItem>,
  ): void {
    const entry = packagesDraft[packageIndex];
    if (!entry) return;
    setDraftPackage(packageIndex, {
      items: entry.items.map((item, position) =>
        position === itemIndex ? { ...item, ...patch } : item,
      ),
    });
  }

  function setDraftColorQty(
    packageIndex: number,
    itemIndex: number,
    colorQty: string,
  ): void {
    const item = packagesDraft[packageIndex]?.items[itemIndex];
    if (!item) return;
    const quantity = quantityFromColors(colorQty, item.unit);
    setDraftItem(packageIndex, itemIndex, {
      color_breakdown: colorQty,
      quantity: quantity.qty,
      unit: quantity.unit,
    });
  }

  function setDraftStockCode(
    packageIndex: number,
    itemIndex: number,
    code: string,
  ): void {
    const known = productOf(code);
    setDraftItem(
      packageIndex,
      itemIndex,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
            unit: "set",
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addDraftItem(packageIndex: number): void {
    const entry = packagesDraft[packageIndex];
    if (!entry) return;
    setDraftPackage(packageIndex, {
      opened: true,
      received_on: entry.received_on || receivedOn,
      items: [...entry.items, emptyItem(entry.package_id)],
    });
  }

  function removeDraftItem(packageIndex: number, itemIndex: number): void {
    const entry = packagesDraft[packageIndex];
    if (!entry) return;
    const items = entry.items.filter((_, position) => position !== itemIndex);
    // Take out the last product and the package is simply not counted yet again.
    setDraftPackage(packageIndex, {
      opened: items.some(
        (item) => item.stock_code.trim() !== "" || item.quantity > 0,
      ),
      items,
    });
  }

  return {
    duplicateDraftPreviousPackage,
    setDraftColorQty,
    setDraftStockCode,
    addDraftItem,
    removeDraftItem,
  };
}
