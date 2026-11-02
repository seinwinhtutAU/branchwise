import { useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Modal, ModalSection } from "@renderer/components/ui/Modal";
import {
  voucherSubtotal,
  type DiscountKind,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { DiscountInput } from "./DiscountInput";
import { NamedInput } from "../shared/NamedInput";
import { PlaceInput } from "../shared/PlaceInput";

/** The details known when the order is placed. Cargo and packages come with the supplier's
 *  slip and live on the shipment, not here. */
export function VoucherInfoDialog({
  open,
  voucher,
  todayRate,
  onClose,
  onSave,
}: {
  open: boolean;
  voucher: SupplierVoucher;
  /** Today's Baht rate from Settings, offered when a discount in Baht is first chosen. */
  todayRate: number;
  onClose: () => void;
  onSave: (patch: {
    supplier_name: string;
    voucher_date: string;
    receiving_gate: string;
    discount_kind: DiscountKind;
    discount_value: number;
    discount_exchange_rate: number | null;
  }) => void;
}): React.JSX.Element | null {
  const [supplierName, setSupplierName] = useState(voucher.supplier_name);
  const [voucherDate, setVoucherDate] = useState(voucher.voucher_date);
  const [gate, setGate] = useState(voucher.receiving_gate ?? "");
  // A discount saved as a percentage (no longer offered) is shown as the Kyat it came to.
  const wasPercent = voucher.discount_kind === "percent";
  const [discountKind, setDiscountKind] = useState<DiscountKind>(
    wasPercent ? "amount" : (voucher.discount_kind ?? "none"),
  );
  const [discountValue, setDiscountValue] = useState(
    wasPercent
      ? String(voucher.discount_amount ?? "")
      : voucher.discount_value
        ? String(voucher.discount_value)
        : "",
  );
  const [discountRate, setDiscountRate] = useState(
    voucher.discount_exchange_rate
      ? String(voucher.discount_exchange_rate)
      : "",
  );

  useEffect(() => {
    if (!open) return;
    setSupplierName(voucher.supplier_name);
    setVoucherDate(voucher.voucher_date);
    setGate(voucher.receiving_gate ?? "");
    setDiscountKind(wasPercent ? "amount" : (voucher.discount_kind ?? "none"));
    setDiscountValue(
      wasPercent
        ? String(voucher.discount_amount ?? "")
        : voucher.discount_value
          ? String(voucher.discount_value)
          : "",
    );
    setDiscountRate(
      voucher.discount_exchange_rate
        ? String(voucher.discount_exchange_rate)
        : "",
    );
  }, [open, voucher, wasPercent]);

  if (!open) return null;

  function handleSubmit(): void {
    if (!supplierName.trim() || !voucherDate) return;
    onSave({
      supplier_name: supplierName.trim(),
      voucher_date: voucherDate,
      receiving_gate: gate.trim(),
      discount_kind: Number(discountValue) > 0 ? discountKind : "none",
      discount_value: Number(discountValue) || 0,
      discount_exchange_rate:
        Number(discountValue) > 0 && discountKind === "baht"
          ? Number(discountRate) || null
          : null,
    });
    onClose();
  }

  const discountNeedsRate =
    discountKind === "baht" &&
    Number(discountValue) > 0 &&
    !(Number(discountRate) > 0);
  const canSave =
    supplierName.trim().length > 0 &&
    voucherDate.length > 0 &&
    !discountNeedsRate;

  return (
    <Modal
      title="Edit voucher information"
      subtitle={voucher.voucher_no}
      size="md"
      onClose={onClose}
      onSubmit={handleSubmit}
      actions={
        <>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSave}>
            Save
          </Button>
        </>
      }
    >
      <ModalSection
        title="Supplier"
        hint="Who the voucher is made with and where it should arrive"
      >
        <div className="flex flex-col gap-3">
          <NamedInput
            list="suppliers"
            noun="supplier"
            label="Supplier"
            placeholder="e.g. Goody Supplier"
            value={supplierName}
            onChange={setSupplierName}
            required
          />
          <PlaceInput
            label="Receiving gate"
            placeholder="Choose or type a gate"
            value={gate}
            onChange={setGate}
          />
        </div>
      </ModalSection>

      <ModalSection
        title="Discount"
        hint="What the supplier takes off the whole voucher"
      >
        <DiscountInput
          kind={discountKind}
          value={discountValue}
          rate={discountRate}
          todayRate={todayRate}
          subtotal={voucherSubtotal(voucher)}
          onChange={(next) => {
            setDiscountKind(next.kind);
            setDiscountValue(next.value);
            setDiscountRate(next.rate);
          }}
        />
      </ModalSection>

      <ModalSection title="Voucher date" hint="The day the voucher was made">
        <Input
          label="Voucher date"
          id="voucher-date-input"
          type="date"
          required
          value={voucherDate}
          onChange={(e) => setVoucherDate(e.target.value)}
        />
      </ModalSection>
    </Modal>
  );
}

// Backwards compatibility alias
export const VoucherInfoDrawer = VoucherInfoDialog;
