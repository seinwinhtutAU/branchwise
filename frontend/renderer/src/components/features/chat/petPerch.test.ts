import { describe, expect, it } from "vitest";
import { PET_BOX, perchPosition } from "./petPerch";

describe("perchPosition", () => {
  it("centres the pet's box on the slot", () => {
    const slot = { left: 500, top: 10, width: 28, height: 28 };
    const { left, top } = perchPosition(slot);
    expect(left + PET_BOX / 2).toBe(slot.left + slot.width / 2);
    expect(top + PET_BOX / 2).toBe(slot.top + slot.height / 2);
  });
});
