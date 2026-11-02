import React from "react";
import { Input } from "@renderer/components/ui/Input";
import { Modal, ModalSection } from "@renderer/components/ui/Modal";
import { MoneyInput } from "@renderer/components/ui/MoneyInput";
import { type ProductGroup } from "@renderer/components/features/wholesale/shared/products";

/** Add a product, or change one's description, group and suggested prices. */
export function ProductFormModal({
  isEdit,
  stockCode,
  setStockCode,
  description,
  setDescription,
  group,
  setGroup,
  sellingPrice,
  setSellingPrice,
  buyingPrice,
  setBuyingPrice,
  saving,
  onSave,
  onClose,
}: {
  isEdit: boolean;
  stockCode: string;
  setStockCode: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  group: ProductGroup;
  setGroup: (value: ProductGroup) => void;
  sellingPrice: number;
  setSellingPrice: (value: number) => void;
  buyingPrice: number;
  setBuyingPrice: (value: number) => void;
  saving: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit product ${stockCode}` : "New product"}
      size="md"
      primaryAction={{
        label: isEdit ? "Save" : "Save product",
        onClick: onSave,
        loading: saving,
        disabled: saving || (!isEdit && !stockCode.trim()),
      }}
      secondaryAction={{
        label: "Cancel",
        onClick: onClose,
        disabled: saving,
      }}
    >
      <div className="space-y-5">
        <ModalSection
          title="Product identification"
          hint="Stock code and product details"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">
                Stock code
              </label>
              <Input
                size="sm"
                value={stockCode}
                readOnly={isEdit}
                onChange={(e) => setStockCode(e.target.value.toUpperCase())}
                placeholder="e.g. A2026"
                className="font-mono uppercase font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">
                Description
              </label>
              <Input
                size="sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Men's outdoor leather sandal"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              Product group
            </label>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value as ProductGroup)}
              className="h-8 w-full rounded-md border border-border bg-bg-base px-2.5 text-xs font-semibold text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="man">Man</option>
              <option value="lady">Lady</option>
              <option value="child">Child</option>
              <option value="other">Other</option>
            </select>
          </div>
        </ModalSection>

        <ModalSection
          title="Pricing"
          hint="Suggested prices only — pre-fill a new order or voucher line, which always keeps its own price after that"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput
              label="Default selling price"
              labelClassName="text-xs"
              size="sm"
              currency="Ks"
              value={sellingPrice}
              onChange={(value) => setSellingPrice(value)}
            />
            <MoneyInput
              label="Default buying price"
              labelClassName="text-xs"
              size="sm"
              currency="Ks"
              value={buyingPrice}
              onChange={(value) => setBuyingPrice(value)}
            />
          </div>
        </ModalSection>
      </div>
    </Modal>
  );
}
