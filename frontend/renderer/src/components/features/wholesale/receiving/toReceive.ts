import { gateStops, type Shipment } from "../delivery/shipments";
import { receivingStatus, type Receiving } from "./receivings";

/** The places on shipments' routes that still have something to receive: a gate (or any
 *  place that already started a count) whose count is not finished. Shared by Today's
 *  Receive card and a voucher's "At receiving gate" tab, so both say the same thing. */
export function stopsToReceive(
  shipments: Shipment[],
  receivings: Receiving[],
): {
  shipment: Shipment;
  stop: Shipment["stops"][number];
  receiving: Receiving | undefined;
}[] {
  return shipments.flatMap((shipment) => {
    const gates = gateStops(shipment);
    return shipment.stops.flatMap((stop) => {
      const receiving = receivings.find(
        (rec) =>
          rec.shipment_id === shipment.shipment_id &&
          (rec.stop_id
            ? rec.stop_id === stop.stop_id
            : stop.is_gate && gates.length === 1),
      );
      if (!stop.is_gate && !receiving) return [];
      if (receiving) {
        const status = receivingStatus(receiving, receiving.total_packages);
        if (status === "checked" || status === "issue") return [];
      }
      return [{ shipment, stop, receiving }];
    });
  });
}
