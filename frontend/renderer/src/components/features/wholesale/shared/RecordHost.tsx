import React from "react";
import { type Session } from "@renderer/lib/auth";
import { SalePage } from "../orders/SalePage";
import { PurchasePage } from "../vouchers/PurchasePage";
import { NewSalePage, type NewSalePrefill } from "../orders/NewSalePage";
import { WhatToBuyPage } from "../vouchers/WhatToBuyPage";
import { useHydrateMasterData } from "../masterData/masterData";
import {
  NewPurchasePage,
  type NewPurchasePrefill,
} from "../vouchers/NewPurchasePage";

export type RecordKind =
  | "newSale"
  | "newPurchase"
  | "whatToBuy"
  | "splitShipment"
  | "money"
  | "order"
  | "voucher"
  | "shipment"
  | "receiving"
  | "customer"
  | "supplier"
  | "product";

interface RecordPrefill {
  customer?: string;
  supplier?: string;
  stockCode?: string;
  quantity?: number;
  lines?: unknown[];
}

export interface ActiveRecord {
  kind: RecordKind;
  prefill?: RecordPrefill;
  id?: string | null;
  referenceNo?: string | null;
  /** For a voucher: which of its shipments to show first. */
  shipmentId?: string | null;
  /** For a voucher: which place on that shipment's route to show the count of first. */
  stopId?: string | null;
  focus?:
    | "items"
    | "payments"
    | "recordPayment"
    | "deliveries"
    | "allocate"
    | "deliver"
    | "ordered"
    | "shipped"
    | "arrived"
    | "paid"
    | "stockIn"
    | "stockCount";
}

export function RecordHost({
  session,
  activeRecord,
  onClose,
  onOpenRecord,
  onUnsavedChange,
}: {
  session: Session;
  activeRecord: ActiveRecord | null;
  onClose: () => void;
  onOpenRecord?: (record: ActiveRecord) => void;
  /** Whether the open order or voucher has edits that are not saved yet. */
  onUnsavedChange?: (dirty: boolean) => void;
}): React.JSX.Element | null {
  // Record pages can add a master-data product inline. Keep the shared product
  // catalog (and its authenticated session) ready even when the user has not
  // visited Today first.
  useHydrateMasterData(session);

  if (!activeRecord) return null;

  if (activeRecord.kind === "newSale") {
    return (
      <NewSalePage
        session={session}
        prefill={activeRecord.prefill as NewSalePrefill | undefined}
        onBack={onClose}
      />
    );
  }

  if (activeRecord.kind === "whatToBuy") {
    return (
      <WhatToBuyPage
        session={session}
        supplier={activeRecord.prefill?.supplier}
        onBack={onClose}
        onCreateVoucher={(prefill) =>
          onOpenRecord?.({ kind: "newPurchase", prefill })
        }
        onOpenOrder={(orderId) =>
          onOpenRecord?.({ kind: "order", id: orderId })
        }
      />
    );
  }

  if (activeRecord.kind === "newPurchase") {
    return (
      <NewPurchasePage
        session={session}
        prefill={activeRecord.prefill as NewPurchasePrefill | undefined}
        onBack={onClose}
      />
    );
  }

  if (activeRecord.kind === "order") {
    const isFulfill =
      activeRecord.focus === "allocate" || activeRecord.focus === "deliver";
    return (
      <SalePage
        key={`order-${activeRecord.id ?? activeRecord.referenceNo}`}
        session={session}
        orderId={activeRecord.id}
        orderNo={activeRecord.referenceNo}
        initialTab={
          isFulfill
            ? "deliveries"
            : activeRecord.focus === "payments" ||
                activeRecord.focus === "recordPayment"
              ? "payments"
              : activeRecord.focus === "deliveries"
                ? "deliveries"
                : "items"
        }
        initialFulfillSubTab={
          activeRecord.focus === "allocate"
            ? "allocate"
            : activeRecord.focus === "deliver"
              ? "deliver"
              : undefined
        }
        initialPaymentOpen={activeRecord.focus === "recordPayment"}
        onClose={onClose}
        onUnsavedChange={onUnsavedChange}
        onOpenRecord={(target) =>
          onOpenRecord?.({
            kind: target.kind,
            id: target.id,
            referenceNo: target.referenceNo,
            focus: target.focus,
          })
        }
      />
    );
  }

  if (
    activeRecord.kind === "voucher" ||
    activeRecord.kind === "shipment" ||
    activeRecord.kind === "receiving"
  ) {
    const initialTab =
      activeRecord.kind === "shipment" || activeRecord.focus === "shipped"
        ? "shipped"
        : activeRecord.kind === "receiving" || activeRecord.focus === "arrived"
          ? "arrived"
          : activeRecord.focus === "stockIn" ||
              activeRecord.focus === "stockCount"
            ? "moved"
            : activeRecord.focus === "paid"
              ? "paid"
              : "ordered";

    return (
      <PurchasePage
        key={`voucher-${activeRecord.id ?? activeRecord.referenceNo}`}
        session={session}
        voucherId={activeRecord.id}
        voucherNo={activeRecord.referenceNo}
        initialTab={initialTab}
        initialMoveView={
          activeRecord.focus === "stockCount" ? "to_count" : undefined
        }
        initialShipmentId={activeRecord.shipmentId}
        initialStopId={activeRecord.stopId}
        onClose={onClose}
        onUnsavedChange={onUnsavedChange}
        onOpenRecord={(target) =>
          onOpenRecord?.({
            kind: target.kind,
            id: target.id,
            referenceNo: target.referenceNo,
          })
        }
      />
    );
  }

  return null;
}
