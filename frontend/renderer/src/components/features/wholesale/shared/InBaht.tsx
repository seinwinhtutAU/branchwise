import { formatBaht } from "./baht";

/** A Baht figure written in brackets after a Kyat one, when what the Kyat came from was entered in
 *  Baht: "3,727 Ks (28 ฿)". Nothing is written when there was no Baht. */
export function InBaht({
  amount,
  note,
}: {
  amount: number | null | undefined;
  /** Said on hover when the Baht figure leaves something out. */
  note?: string;
}): React.JSX.Element | null {
  if (amount === null || amount === undefined) return null;
  return (
    <span className="ml-1.5 font-normal text-text-muted" title={note}>
      ({formatBaht(amount)})
    </span>
  );
}
