import React from "react";
import { Input } from "@renderer/components/ui/Input";
import { Modal } from "@renderer/components/ui/Modal";

export interface ContactFormCopy {
  /** "customer" or "supplier", used in the title and the Save button. */
  noun: string;
  nameLabel: string;
  phoneLabel: string;
  namePlaceholder: string;
  phonePlaceholder: string;
  addressPlaceholder: string;
}

/** Add or edit a customer or supplier: name, phone and address. */
export function ContactFormModal({
  copy,
  isEdit,
  name,
  setName,
  phone,
  setPhone,
  address,
  setAddress,
  saving,
  onSave,
  onClose,
}: {
  copy: ContactFormCopy;
  isEdit: boolean;
  name: string;
  setName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  saving: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const label =
    "block font-semibold text-text-muted uppercase tracking-wider mb-1";
  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${copy.noun}` : `New ${copy.noun}`}
      size="sm"
      primaryAction={{
        label: isEdit ? "Save" : `Save ${copy.noun}`,
        onClick: onSave,
        loading: saving,
        disabled: saving || !name.trim(),
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: onClose,
        disabled: saving,
      }}
    >
      <div className="space-y-3 text-xs">
        <div>
          <label className={label}>{copy.nameLabel}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.namePlaceholder}
          />
        </div>
        <div>
          <label className={label}>{copy.phoneLabel}</label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={copy.phonePlaceholder}
          />
        </div>
        <div>
          <label className={label}>Address</label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={copy.addressPlaceholder}
          />
        </div>
      </div>
    </Modal>
  );
}
