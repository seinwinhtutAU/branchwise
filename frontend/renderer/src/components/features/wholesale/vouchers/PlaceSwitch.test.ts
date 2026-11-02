import { describe, expect, it } from "vitest";
import { receivingGateForStop } from "./PlaceSwitch";
import type { Shipment } from "../delivery/shipments";

const shipment = {
  shipment_id: "shipment-1",
  stops: [
    { stop_id: "stop-1", stop_name: "Mandalay", is_gate: false },
    { stop_id: "gate-1", stop_name: "Yangon", is_gate: true },
  ],
} as Shipment;

describe("receivingGateForStop", () => {
  it("returns the matching shipment's receiving gate", () => {
    expect(receivingGateForStop([shipment], "stop-1")).toMatchObject({
      shipment: { shipment_id: "shipment-1" },
      stop: { stop_id: "gate-1", stop_name: "Yangon" },
    });
  });

  it("does not invent a gate for an unknown place", () => {
    expect(receivingGateForStop([shipment], "missing")).toBeUndefined();
  });
});
