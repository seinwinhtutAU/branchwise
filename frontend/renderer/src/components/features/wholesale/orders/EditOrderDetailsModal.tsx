import React from "react";
import { Input } from "@renderer/components/ui/Input";
import { Modal } from "@renderer/components/ui/Modal";

export interface EditOrderDetailsModalProps {
  orderNo: string;
  name: string;
  setName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  orderDate: string;
  setOrderDate: (value: string) => void;
  saving: boolean;
  onSave: (event?: React.FormEvent) => Promise<void>;
  onClose: () => void;
}

/** Change the customer and date an order was made for. */
export function EditOrderDetailsModal({
  orderNo,
  name,
  setName,
  phone,
  setPhone,
  address,
  setAddress,
  orderDate,
  setOrderDate,
  saving,
  onSave,
  onClose,
}: EditOrderDetailsModalProps): React.JSX.Element {
  return (
    <Modal
      open
      onClose={() => onClose()}
      title="Edit order details"
      subtitle={orderNo}
      size="sm"
      primaryAction={{
        label: "Save",
        onClick: () => void onSave(),
        loading: saving,
        disabled: saving || !name.trim(),
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: () => onClose(),
        disabled: saving,
      }}
    >
      <form onSubmit={onSave} className="space-y-3.5 text-xs">
        <div>
          <label className="text-text-muted block font-semibold mb-1">
            Customer Name *
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daw Aye Aye"
            required
          />
        </div>

        <div>
          <label className="text-text-muted block font-semibold mb-1">
            Phone number
          </label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0912345678"
          />
        </div>

        <div>
          <label className="text-text-muted block font-semibold mb-1">
            Address
          </label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Bayintnaung Gate 3, Mandalay"
          />
        </div>

        <div>
          <label className="text-text-muted block font-semibold mb-1">
            Order Date *
          </label>
          <Input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            required
          />
        </div>
      </form>
    </Modal>
  );
}
