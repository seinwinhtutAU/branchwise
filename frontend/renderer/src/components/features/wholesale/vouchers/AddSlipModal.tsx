import React, { useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Modal } from "@renderer/components/ui/Modal";
import { Input } from "@renderer/components/ui/Input";
import { newStop } from "../delivery/shipments";
import { createShipment } from "../delivery/shipmentsApi";
import { PlaceInput } from "../shared/PlaceInput";
import { NamedInput } from "../shared/NamedInput";
import { todayIso } from "../shared/shared";
import { type SupplierVoucher } from "./supplierVouchers";

/**
 * The supplier's slip has come: which cargo is carrying the goods and how many packages there
 * are. Until then a voucher has no shipment, because none of this is known when the order is
 * placed. The route (stops) is added afterwards on the route itself.
 */
export function AddSlipModal({
  session,
  voucher,
  onClose,
  onDone,
}: {
  session: Session;
  voucher: SupplierVoucher;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  const [cargo, setCargo] = useState("");
  const [packages, setPackages] = useState("");
  const [sentOn, setSentOn] = useState(todayIso());
  const [gate, setGate] = useState(voucher.receiving_gate ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(): Promise<void> {
    if (!cargo.trim()) {
      showToast("error", "Say which carrier is carrying it.");
      return;
    }
    if (!gate.trim()) {
      showToast("error", "Say where it will arrive.");
      return;
    }
    const count = parseInt(packages.replace(/\D/g, ""), 10) || 0;
    setBusy(true);
    try {
      await createShipment(session, {
        voucher_no: voucher.voucher_no,
        supplier_name: voucher.supplier_name,
        carrier_name: cargo.trim(),
        sent_on: sentOn,
        total_packages: count,
        total_quantity_pairs: voucher.total_quantity_pairs / 6,
        total_unit: "set",
        stops: [{ ...newStop(null, gate.trim(), "", true), packages_sent: count }],
      });
      showToast("success", "Shipment added.");
      onDone();
      onClose();
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not add the shipment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add the supplier's shipment"
      size="md"
      primaryAction={{
        label: "Add shipment",
        onClick: () => void handleSubmit(),
        loading: busy,
        disabled: busy,
      }}
      secondaryAction={{ label: "Cancel", onClick: onClose, disabled: busy }}
    >
      <div className="space-y-4 text-xs">
        <p className="text-text-muted">
          Write down what the supplier's shipment says. If you do not know the number of
          packages yet, leave it empty and fill it in later. Stops on the way
          can be added afterwards on the route.
        </p>
        <NamedInput
          list="carriers"
          noun="carrier"
          label="Carrier"
          placeholder="Choose or type a carrier"
          value={cargo}
          onChange={setCargo}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Packages (optional)"
            inputMode="numeric"
            value={packages}
            onChange={(event) =>
              setPackages(event.target.value.replace(/\D/g, ""))
            }
          />
          <Input
            label="Shipment date"
            type="date"
            value={sentOn}
            onChange={(event) => setSentOn(event.target.value)}
          />
        </div>
        <PlaceInput
          label="Receiving gate"
          placeholder="Choose or type a gate"
          value={gate}
          onChange={setGate}
          required
        />
      </div>
    </Modal>
  );
}
