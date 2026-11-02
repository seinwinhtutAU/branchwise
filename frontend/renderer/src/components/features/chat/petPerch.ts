// Where the pet goes when Explain mode is on: it shrinks and sits on the Explain switch in the
// header, then walks back to where the person left it when the mode goes off.

/** The pet's own box (4.75rem) and how far it shrinks to sit on the switch. */
export const PET_BOX = 76;
export const PERCH_SCALE = 0.42;

export interface PerchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The pet's top-left corner so that its box, scaled about its centre, is centred on `slot`. */
export function perchPosition(slot: PerchRect): { left: number; top: number } {
  return {
    left: slot.left + slot.width / 2 - PET_BOX / 2,
    top: slot.top + slot.height / 2 - PET_BOX / 2,
  };
}
