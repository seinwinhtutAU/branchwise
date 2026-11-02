import React from "react";
import { useToast } from "@renderer/lib/useToast";
import {
  addToList,
  useNameList,
  type NameList,
} from "../masterData/masterData";
import { SuggestInput } from "./formFields";

/** Keeps only the names explicitly allowed, without changing their saved spelling or order. */
export function limitSuggestions(
  names: readonly string[],
  include?: readonly string[],
): string[] {
  if (!include) return [...names];
  const allowed = new Set(include.map((name) => name.toLowerCase()));
  return names.filter((name) => allowed.has(name.toLowerCase()));
}

/** Places prioritized names first without dropping the rest. */
export function orderSuggestions(
  names: readonly string[],
  prioritize?: readonly string[],
): string[] {
  if (!prioritize || prioritize.length === 0) return [...names];
  const prioSet = new Set(prioritize.map((name) => name.toLowerCase()));
  return [
    ...names.filter((name) => prioSet.has(name.toLowerCase())),
    ...names.filter((name) => !prioSet.has(name.toLowerCase())),
  ];
}

/**
 * A box for a name taken from one of the lists (places, suppliers,
 * carriers). The name is picked from the list; one that is not in it can be added right here
 * with one click, so a name is never spelled two ways.
 */
export function NamedInput({
  list,
  noun,
  exclude,
  alsoSuggest,
  include,
  prioritize,
  addExtra,
  allowNew = true,
  addLabel,
  onAddNew,
  ...rest
}: Omit<
  React.ComponentProps<typeof SuggestInput>,
  "suggestions" | "onAddNew" | "addLabel"
> & {
  list: NameList;
  /** What the list holds, for the add row: "place", "supplier", "carrier". */
  noun: string;
  /** Names left out of the choices, such as the place the goods are leaving. */
  exclude?: string[];
  /** Other names worth offering that are not in the list itself. */
  alsoSuggest?: string[];
  /** Restrict the list to these saved names, such as warehouses in a destination picker. */
  include?: string[];
  /** Shows these names first in the suggestions dropdown before other names. */
  prioritize?: readonly string[];
  /** Extra fields for creating a new named entity (e.g. is_warehouse for places). */
  addExtra?: { is_warehouse?: boolean };
  /** False when this picker must choose an existing name only. */
  allowNew?: boolean;
  /** Overrides the action copy for a newly typed value. */
  addLabel?: string;
  /** Handles a newly typed value without using the usual master-data list action. */
  onAddNew?: (name: string) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const names = useNameList(list);
  const listed = exclude
    ? names.filter((name) => !exclude.includes(name))
    : names;
  const ordered = orderSuggestions(listed, prioritize);
  const choices = limitSuggestions(
    alsoSuggest
      ? [
          ...ordered,
          ...alsoSuggest.filter(
            (name) =>
              !ordered.some(
                (entry) => entry.toLowerCase() === name.toLowerCase(),
              ),
          ),
        ]
      : ordered,
    include,
  );
  return (
    <SuggestInput
      {...rest}
      suggestions={choices}
      addLabel={addLabel ?? `Add new ${noun}`}
      onAddNew={
        allowNew
          ? (onAddNew ??
            (async (name) => {
              try {
                const added = await addToList(list, name, addExtra);
                rest.onChange(added);
                showToast(
                  "success",
                  `${noun.charAt(0).toUpperCase() + noun.slice(1)} “${added}” added.`,
                );
                return added;
              } catch (err: unknown) {
                showToast(
                  "error",
                  err instanceof Error
                    ? err.message
                    : `Could not add the ${noun}.`,
                );
                throw err;
              }
            }))
          : undefined
      }
    />
  );
}
