import { formatSets } from "../shared/units";
import { type SupplierVoucher, type VoucherStage } from "./supplierVouchers";

/** The one line of figures under a voucher row's stage badge. It says the one thing the stage is
 *  about: packages while the goods travel, sets counted at the gate while they are being
 *  counted, sets counted at the warehouse while they are moved. Once they are moved only the
 *  sets are written. */
export interface VoucherProgress {
  /** The figures, e.g. "Counted 20 sets of 52 sets". */
  text: string;
  /** "3 sets short" or "2 sets extra", shown in red; empty when the numbers agree. */
  problem: string;
}

export function voucherProgress({
  stage,
  voucher,
  arrivedPackages,
  totalPackages,
  lostPackages,
  countFinal,
}: {
  stage: VoucherStage;
  voucher: SupplierVoucher;
  arrivedPackages: number;
  totalPackages: number;
  lostPackages: number;
  /** Every package of every receiving has been opened, so a difference is a real one. */
  countFinal: boolean;
}): VoucherProgress {
  const total = voucher.total_quantity_pairs;
  const counted = voucher.received_quantity_pairs;
  const lost = voucher.lost_quantity_pairs ?? 0;
  const difference = counted + lost - total;
  const short = countFinal && difference < 0 ? -difference : 0;
  const extra = countFinal && difference > 0 ? difference : 0;
  const problem = short
    ? `${formatSets(short)} short`
    : extra
      ? `${formatSets(extra)} extra`
      : "";

  if (stage === "On the way") {
    return {
      text:
        totalPackages > 0
          ? `${arrivedPackages.toLocaleString()} of ${totalPackages.toLocaleString()} packages arrived${
              lostPackages > 0 ? ` (${lostPackages.toLocaleString()} lost)` : ""
            }`
          : `No package count yet · ${formatSets(total)} ordered`,
      problem: "",
    };
  }

  if (stage === "At receiving gate") {
    return {
      text: `Counted ${formatSets(counted)} of ${formatSets(total)}${
        lost > 0 ? ` · ${formatSets(lost)} lost` : ""
      }`,
      problem,
    };
  }

  if (stage === "Counted at receiving" || stage === "Partly moved to warehouse") {
    const waiting =
      (voucher.to_move_pairs ?? 0) + (voucher.to_count_pairs ?? 0);
    const done = Math.max(0, counted - waiting);
    return {
      text: `Counted at warehouse ${formatSets(done)} of ${formatSets(counted)}`,
      problem,
    };
  }

  return { text: formatSets(counted || total), problem };
}
