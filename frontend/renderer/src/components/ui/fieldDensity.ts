import { createContext, useContext } from "react";

/**
 * How big the form fields (Input, Select, DateInput, MoneyInput, Textarea) are drawn.
 * "compact" is the wholesale standard: 32px high, 10px side padding, 13px text. Everything
 * outside the wholesale workspace stays "default".
 */
export type FieldDensity = "default" | "compact";

const FieldDensityContext = createContext<FieldDensity>("default");

export const FieldDensityProvider = FieldDensityContext.Provider;

export function useFieldDensity(): FieldDensity {
  return useContext(FieldDensityContext);
}

/** The same as the "sm" size, with 13px text, used for every field in a compact workspace. */
export const COMPACT_FIELD = "h-8 px-2.5 text-[13px]";
