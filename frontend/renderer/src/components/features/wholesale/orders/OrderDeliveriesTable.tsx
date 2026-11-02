import React from "react";
import { cn } from "@renderer/lib/utils";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { TrashIcon } from "@renderer/components/ui/icons";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { PAIRS_PER } from "@renderer/components/features/wholesale/shared/units";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import {
  colorPairsForText,
  serializeColorPairs,
  type StockMovement,
} from "../inventory/stock";
import { formatOrderUnitQuantity, type CustomerOrder } from "./customerOrders";

export interface OrderDeliveriesTableProps {
  order: CustomerOrder;
  deliveries: StockMovement[];
  /** Pairs that could be delivered right now, to word the empty message. */
  readyToDeliver: number;
  /** The "Total delivered" figure, already written in the order's own units. */
  deliveredUnitTotals: string;
  flashIds: ReadonlySet<string>;
  isPending: (movementId: string) => boolean;
  onDelete: (movementId: string) => void;
}

/** What has already gone out to the customer on this order. */
export function OrderDeliveriesTable({
  order,
  deliveries: orderDeliveries,
  readyToDeliver,
  deliveredUnitTotals,
  flashIds: flashDeliveryIds,
  isPending,
  onDelete,
}: OrderDeliveriesTableProps): React.JSX.Element {
  return orderDeliveries.length === 0 ? (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-text-muted">
      {readyToDeliver > 0 ? "Nothing delivered yet." : "No deliveries yet."}
    </div>
  ) : (
    <TableContainer className="rounded-none border-x border-b border-border shadow-none">
      <Thead>
        <Tr>
          <Th className="w-10 !py-1 text-center">#</Th>
          <Th className="w-32 !py-1">Date</Th>
          <Th className="min-w-[13rem] !py-1">Product</Th>
          <Th className="min-w-[10rem] !py-1">From</Th>
          <Th className="min-w-[10rem] !py-1">To</Th>
          <Th className="min-w-[13rem] !py-1">Colors</Th>
          <Th className="w-32 !py-1 text-right">Delivered</Th>
          <Th className="min-w-[10rem] !py-1">Note</Th>
          <Th className="w-10 !py-1" aria-label="Actions" />
        </Tr>
      </Thead>
      <Tbody>
        {orderDeliveries.map((deliv, index) => {
          const leaving = isPending(deliv.movement_id);
          const deliveryLine = order.lines.find(
            (line) => line.stock_code === deliv.stock_code,
          );

          return (
            <Tr
              key={deliv.movement_id}
              className={cn(
                flashDeliveryIds.has(deliv.movement_id) && "animate-row-flash",
                leaving && "animate-row-leave",
              )}
            >
              <Td className="!py-1 text-center font-mono text-[13px] text-text-muted">
                {index + 1}
              </Td>
              <Td className="!py-1 whitespace-nowrap font-mono text-[13px]">
                {formatDate(deliv.moved_on)}
              </Td>
              <Td className="!py-1 text-[13px]">
                <span className="font-semibold">{deliv.stock_code}</span>{" "}
                <span className="text-text-muted">
                  · {GROUP_LABELS[deliv.product_group]}
                </span>
                <span className="block break-words">{deliv.description}</span>
              </Td>
              <Td className="!py-1 text-[13px] text-text-secondary">
                {deliv.location}
              </Td>
              <Td className="!py-1 text-[13px] text-text-secondary">
                {deliv.delivery_address || order.customer_address || "—"}
              </Td>
              <Td className="!py-1">
                <ChipsWithTotal
                  breakdown={serializeColorPairs(
                    colorPairsForText(
                      deliv.color_breakdown,
                      deliveryLine?.unit ?? "set",
                      deliveryLine?.unit_conversions,
                    ),
                    deliveryLine?.unit_conversions?.set ?? PAIRS_PER.set,
                  )}
                  unit={deliveryLine?.unit ?? "set"}
                />
              </Td>
              <Td className="!py-1 whitespace-nowrap text-right font-mono text-[13px] font-medium text-success">
                {formatOrderUnitQuantity(deliveryLine, deliv.quantity_pairs)}
              </Td>
              <Td className="!py-1 text-[13px] text-text-muted">
                {deliv.note && !deliv.note.startsWith("seed:")
                  ? deliv.note
                  : "—"}
              </Td>
              <Td className="!p-0 text-center align-middle">
                <button
                  type="button"
                  onClick={() => onDelete(deliv.movement_id)}
                  className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                  title="Delete delivery"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </Td>
            </Tr>
          );
        })}
        <Tr className="bg-bg-subtle font-semibold">
          <Td className="!py-1 text-[13px]" colSpan={6}>
            Total delivered
          </Td>
          <Td className="!py-1 text-right font-mono text-[13px] text-success">
            {deliveredUnitTotals}
          </Td>
          <Td className="!py-1" colSpan={2} />
        </Tr>
      </Tbody>
    </TableContainer>
  );
}
