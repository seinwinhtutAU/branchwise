import { useState } from "react";
import { NamedInput } from "../shared/NamedInput";
import { PlaceInput } from "../shared/PlaceInput";
import { PlaceKindPicker } from "./PlaceKindPicker";
import { Button } from "@renderer/components/ui/Button";
import { CheckIcon } from "@renderer/components/ui/icons";
import { Required } from "@renderer/components/features/wholesale/shared/ui";

/** The strip under the tracking table, used both for adding a destination and for
 *  renaming one. Both names can be picked from what has been used before or simply
 *  typed, since a route can go somewhere new. */
export function DestinationForm({
  title,
  initialName = "",
  initialCarrier = "",
  submitLabel,
  askCarrier = true,
  askKind = false,
  taken = [],
  onSubmit,
  onCancel,
}: {
  title: string;
  initialName?: string;
  initialCarrier?: string;
  submitLabel: string;
  /** Who carries the goods to this place. Not asked for the first place after the supplier:
   *  the goods get there with the cargo company the shipment already names. */
  askCarrier?: boolean;
  /** Whether to ask if this place is a stop on the way or a receiving gate where the road ends. */
  askKind?: boolean;
  /** Names already on the route: a place can only appear once. */
  taken?: string[];
  onSubmit: (stopName: string, carrierName: string, isGate: boolean) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [stopName, setStopName] = useState(initialName);
  const [carrierName, setCarrierName] = useState(
    initialCarrier === "—" ? "" : initialCarrier,
  );

  const [isGate, setIsGate] = useState(false);
  const isTaken = taken.some(
    (name) => name.trim().toLowerCase() === stopName.trim().toLowerCase(),
  );

  return (
    <div className="mt-3 border border-brand/40 bg-brand-subtle rounded-lg p-4">
      <p className="text-sm font-medium text-text-primary mb-3">{title}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <PlaceInput
            label={<Required>Place</Required>}
            placeholder="e.g. Yangon"
            exclude={taken}
            value={stopName}
            onChange={setStopName}
            error={isTaken ? "Already on this route." : undefined}
          />
        </div>
        {askCarrier && (
          <div className="w-full sm:w-48">
            <NamedInput
              list="carriers"
              noun="carrier"
              label="Carried here by"
              placeholder="e.g. U Hla Myint"
              value={carrierName}
              onChange={setCarrierName}
            />
          </div>
        )}
        {askKind && (
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-text-secondary">
              This place is
            </span>
            <PlaceKindPicker isGate={isGate} onChange={setIsGate} />
          </div>
        )}
        <Button
          disabled={stopName.trim() === "" || isTaken}
          onClick={() => onSubmit(stopName.trim(), carrierName.trim(), isGate)}
        >
          <CheckIcon className="w-4 h-4" />
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
