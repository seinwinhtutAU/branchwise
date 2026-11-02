import React from "react";
import {
  EDITABLE_COLUMN_HINT,
  EditMark,
} from "@renderer/components/features/wholesale/shared/ui";
import { Button } from "@renderer/components/ui/Button";
import { PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { CellInput } from "@renderer/components/features/wholesale/shared/ui";
import {
  emptyCost,
  totalCost,
  type Receiving,
  type ReceivingCost,
} from "@renderer/components/features/wholesale/receiving/receivings";
import { formatKyat } from "@renderer/components/features/wholesale/shared/shared";
import { splitBaht } from "../shared/baht";
import { InBaht } from "../shared/InBaht";
import { CELL, CELL_TD, CELL_TD_WRAP, CELL_WRAP } from "./cellStyles";
import { MoneyCells } from "./MoneyCells";
import { NamedInput } from "../shared/NamedInput";

/** Transportation costs of one receiving, one row per charge. */
export function ReceivingCostsTable({
  receiving,
  costs,
  carriers,
  todayRate,
  onChange,
  dirty = false,
  saving = false,
  onSave,
}: {
  receiving: Receiving;
  costs: ReceivingCost[];
  carriers: string[];
  /** Today's Baht rate, offered when a Baht amount is first typed. */
  todayRate: number;
  onChange: (costs: ReceivingCost[]) => void;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
}): React.JSX.Element {
  function setCost(index: number, patch: Partial<ReceivingCost>): void {
    onChange(
      costs.map((cost, position) =>
        position === index ? { ...cost, ...patch } : cost,
      ),
    );
  }

  function addCost(): void {
    onChange([
      ...costs,
      emptyCost(receiving.receiving_id, receiving.gate, receiving.received_on),
    ]);
  }

  const total = totalCost({ ...receiving, costs });
  const bahtCosts = splitBaht(costs);
  const bahtNote =
    bahtCosts.kyatOnly > 0
      ? `${formatKyat(bahtCosts.kyatOnly)} was paid in Ks only and is not counted here.`
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-base">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-subtle/20 px-4 py-2 sm:px-5">
        <p className="flex flex-wrap items-center gap-y-1 text-[13px] text-text-muted">
          <span>
            Total transportation cost:{" "}
            <b className="font-mono text-brand">{formatKyat(total)}</b>
            <InBaht
              amount={bahtCosts.baht > 0 ? bahtCosts.baht : null}
              note={bahtNote}
            />
          </span>
        </p>
        <div className="flex items-center gap-2">
          {onSave && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onSave}
              loading={saving}
              disabled={!dirty || saving}
              className="h-7 px-2.5 text-[13px]"
            >
              Save transportation costs
            </Button>
          )}
          <Button
            size="sm"
            onClick={addCost}
            className="h-7 gap-1 px-2.5 text-[13px]"
          >
            <PlusIcon className="h-3 w-3" />
            Add transportation cost
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pt-3 sm:px-4">
        <TableContainer className="rounded-none border-x border-b border-border shadow-none">
          <Thead>
            <Tr>
              <Th className="w-10 !py-1 text-center">#</Th>
              <Th className="w-40 !py-1" title={EDITABLE_COLUMN_HINT}>
                Date <EditMark />
              </Th>
              <Th className="min-w-[10rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Place <EditMark />
              </Th>
              <Th className="min-w-[10rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Paid to <EditMark />
              </Th>
              <Th className="min-w-[10rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Fee type <EditMark />
              </Th>
              <Th
                className="w-32 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Amount (Baht) <EditMark />
              </Th>
              <Th
                className="w-24 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Rate <EditMark />
              </Th>
              <Th
                className="w-36 !py-1 text-right"
                title={EDITABLE_COLUMN_HINT}
              >
                Amount (Ks) <EditMark />
              </Th>
              <Th className="min-w-[12rem] !py-1" title={EDITABLE_COLUMN_HINT}>
                Note <EditMark />
              </Th>
              <Th className="w-10 !py-1" aria-label="Remove" />
            </Tr>
          </Thead>
          <Tbody>
            {costs.map((cost, index) => {
              return (
                <Tr key={cost.cost_id}>
                  <Td className="!py-0 text-center font-mono text-[13px] text-text-muted">
                    {index + 1}
                  </Td>
                  <Td className={CELL_TD}>
                    <CellInput
                      label={`Transportation cost date ${index + 1}`}
                      placeholder="YYYY-MM-DD"
                      type="date"
                      value={cost.cost_date}
                      onChange={(cost_date) => setCost(index, { cost_date })}
                      className={CELL}
                    />
                  </Td>
                  <Td className={CELL_TD}>
                    <NamedInput
                      list="places"
                      noun="place"
                      label={`Where transportation cost ${index + 1} was spent`}
                      placeholder="Place"
                      value={cost.stage}
                      onChange={(next) => setCost(index, { stage: next })}
                      bare
                      className={CELL}
                    />
                  </Td>
                  <Td className={CELL_TD}>
                    <NamedInput
                      list="carriers"
                      noun="carrier"
                      alsoSuggest={carriers}
                      label={`Who was paid for transportation cost ${index + 1}`}
                      placeholder="Carrier / driver / porter"
                      value={cost.carrier}
                      onChange={(next) => setCost(index, { carrier: next })}
                      bare
                      className={CELL}
                    />
                  </Td>
                  <Td className={CELL_TD}>
                    <NamedInput
                      list="feeTypes"
                      noun="fee type"
                      label={`What transportation cost ${index + 1} was for`}
                      placeholder="Fee type"
                      value={cost.kind}
                      onChange={(next) => setCost(index, { kind: next })}
                      bare
                      className={CELL}
                    />
                  </Td>
                  <MoneyCells
                    label={`Transportation cost ${index + 1}`}
                    value={cost}
                    todayRate={todayRate}
                    onChange={(patch) => setCost(index, patch)}
                  />
                  <Td className={CELL_TD_WRAP}>
                    <CellInput
                      label={`Transportation cost note ${index + 1}`}
                      placeholder="Note"
                      value={cost.note}
                      multiline
                      onChange={(next) => setCost(index, { note: next })}
                      className={CELL_WRAP}
                    />
                  </Td>
                  <Td className="!p-0 text-center align-middle">
                    <button
                      type="button"
                      onClick={() =>
                        onChange(costs.filter((_, at) => at !== index))
                      }
                      className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-subtle hover:text-error"
                      title="Remove transportation cost"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Td>
                </Tr>
              );
            })}
            {costs.length === 0 && (
              <Tr>
                <Td
                  colSpan={10}
                  className="py-8 text-center text-[13px] text-text-muted"
                >
                  No transportation costs yet. Press Add transportation cost.
                </Td>
              </Tr>
            )}
            <Tr className="bg-bg-subtle font-semibold">
              <Td className="!py-1" />
              <Td className="!py-1 text-[13px]" colSpan={4}>
                Total transportation cost
              </Td>
              <Td className="!py-1" />
              <Td className="!py-1" />
              <Td className="!py-1 text-right font-mono text-[13px] text-brand whitespace-nowrap">
                {formatKyat(total)}
                <InBaht
                  amount={bahtCosts.baht > 0 ? bahtCosts.baht : null}
                  note={bahtNote}
                />
              </Td>
              <Td className="!py-1" />
              <Td className="!py-1" />
            </Tr>
          </Tbody>
        </TableContainer>
      </div>
    </div>
  );
}
