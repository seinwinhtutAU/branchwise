import {
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import {} from "@renderer/components/features/wholesale/shared/shared";
import {
  colorPairsForText,
  type ColorPairs,
  type StockLine,
} from "@renderer/components/features/wholesale/inventory/stock";

/** Maps common shoe / clothing color names to a Tailwind visual dot color */
export function colorDotClass(colorName: string): string {
  const c = colorName.toLowerCase().trim();
  if (c.includes("black")) return "bg-zinc-900 border-zinc-700";
  if (c.includes("white")) return "bg-white border-zinc-300";
  if (c.includes("navy")) return "bg-blue-950 border-blue-900";
  if (c.includes("blue")) return "bg-blue-600 border-blue-500";
  if (c.includes("brown")) return "bg-amber-900 border-amber-950";
  if (c.includes("tan")) return "bg-amber-700 border-amber-600";
  if (c.includes("beige")) return "bg-amber-200 border-amber-300";
  if (c.includes("grey") || c.includes("gray"))
    return "bg-zinc-400 border-zinc-500";
  if (c.includes("red")) return "bg-red-600 border-red-700";
  if (c.includes("pink")) return "bg-pink-400 border-pink-500";
  if (c.includes("green") || c.includes("olive"))
    return "bg-emerald-700 border-emerald-800";
  if (c.includes("yellow")) return "bg-yellow-400 border-yellow-500";
  if (c.includes("purple") || c.includes("violet"))
    return "bg-purple-600 border-purple-700";
  if (c.includes("orange")) return "bg-orange-500 border-orange-600";
  return "bg-brand border-brand-strong";
}

function mergeColorPairs(target: ColorPairs, source: ColorPairs): ColorPairs {
  for (const [color, pairs] of Object.entries(source)) {
    target[color] = (target[color] ?? 0) + pairs;
  }
  return target;
}

export function subtractColorPairs(
  colors: ColorPairs,
  reserved: ColorPairs,
): ColorPairs {
  return Object.fromEntries(
    Object.entries(colors).map(([color, pairs]) => [
      color,
      Math.max(0, pairs - (reserved[color] ?? 0)),
    ]),
  );
}

export function availableStockColors(
  stockCode: string,
  inventoryLines: StockLine[],
): ColorPairs {
  return inventoryLines
    .filter((line) => line.stock_code === stockCode)
    .reduce(
      (colors, line) => mergeColorPairs(colors, line.color_quantities_pairs),
      {},
    );
}

export function allocationsFromOtherOrders(
  orders: CustomerOrder[],
  stockCode: string,
  orderId: string,
): ColorPairs {
  return orders
    .filter(
      (order) =>
        order.order_id !== orderId && order.order_status !== "cancelled",
    )
    .reduce(
      (colors, order) =>
        order.lines
          .filter((line) => line.stock_code === stockCode)
          .reduce(
            (result, line) =>
              mergeColorPairs(
                result,
                // That line's own conversion, not the default six: a product whose set
                // is twelve pairs would otherwise read as half the stock it really
                // holds back, and this order would be free to take what is spoken for.
                colorPairsForText(
                  line.allocated_color_breakdown ?? "",
                  line.unit,
                  line.unit_conversions,
                ),
              ),
            colors,
          ),
      {},
    );
}

/** What is still owed of each colour on one line: what was ordered less what has already
 *  gone out. The per-colour ceiling for a delivery — the line total alone would let one
 *  colour be over-delivered while another stayed short. */
export function stillOwedColors(line: CustomerOrderLine): ColorPairs {
  const ordered = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );
  const delivered = colorPairsForText(
    line.delivered_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  return subtractColorPairs(ordered, delivered);
}

export function deliveryLocationsForLine(
  line: CustomerOrderLine,
  inventoryLines: StockLine[],
): string[] {
  return [
    ...new Set(
      inventoryLines
        .filter((stockLine) => stockLine.stock_code === line.stock_code)
        .map((stockLine) => stockLine.location)
        .filter(Boolean),
    ),
  ];
}

export function availableDeliveryColors(
  line: CustomerOrderLine,
  order: CustomerOrder,
  orders: CustomerOrder[],
  inventoryLines: StockLine[],
  location: string,
): ColorPairs {
  const stockColors = inventoryLines
    .filter(
      (stockLine) =>
        stockLine.stock_code === line.stock_code &&
        stockLine.location === location,
    )
    .reduce(
      (colors, stockLine) =>
        mergeColorPairs(colors, stockLine.color_quantities_pairs),
      {},
    );
  return subtractColorPairs(
    stockColors,
    allocationsFromOtherOrders(orders, line.stock_code, order.order_id),
  );
}

/** The quantity of each colour that has been set aside and is ready to deliver now:
 *  allocated minus delivered, clamped to what the customer is still owed. */
export function readyToDeliverColors(line: CustomerOrderLine): ColorPairs {
  const allocated = colorPairsForText(
    line.allocated_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  const delivered = colorPairsForText(
    line.delivered_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  const ordered = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );
  const result: ColorPairs = {};
  for (const [color, wanted] of Object.entries(ordered)) {
    const del = delivered[color] ?? 0;
    const alloc = allocated[color] ?? 0;
    const ready = Math.max(0, Math.min(alloc - del, wanted - del));
    if (ready > 0) result[color] = ready;
  }
  return result;
}

export function readyToDeliverPairs(line: CustomerOrderLine): number {
  return Object.values(readyToDeliverColors(line)).reduce(
    (sum, p) => sum + p,
    0,
  );
}

export function orderReadyToDeliverPairs(order: CustomerOrder): number {
  return order.lines.reduce((sum, line) => sum + readyToDeliverPairs(line), 0);
}

/** Unallocated stock in warehouse available for this line, net of all other orders. */
export function freeWarehousePairsForLine(
  line: CustomerOrderLine,
  order: CustomerOrder,
  orders: CustomerOrder[],
  inventoryLines: StockLine[],
): number {
  const stockColors = availableStockColors(line.stock_code, inventoryLines);
  const reservedByOthers = allocationsFromOtherOrders(
    orders,
    line.stock_code,
    order.order_id,
  );
  const ownColors = colorPairsForText(
    line.allocated_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  const freeStock = subtractColorPairs(
    subtractColorPairs(stockColors, reservedByOthers),
    ownColors,
  );
  const owed = stillOwedColors(line);
  const ready = readyToDeliverColors(line);
  const stillNeeded = subtractColorPairs(owed, ready);
  return Object.entries(stillNeeded).reduce(
    (sum, [color, needed]) => sum + Math.min(needed, freeStock[color] ?? 0),
    0,
  );
}
