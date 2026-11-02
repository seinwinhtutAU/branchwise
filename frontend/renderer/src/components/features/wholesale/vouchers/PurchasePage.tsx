import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import React, { useEffect, useMemo, useState } from "react";
import { LeaveConfirm } from "../shared/LeaveConfirm";
import { UnsavedReporter } from "../shared/UnsavedReporter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { useAppSettings } from "@renderer/lib/appSettings";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { SaveButton } from "@renderer/components/ui/SaveButton";
import { Input } from "@renderer/components/ui/Input";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  ChevronLeftIcon,
  ClipboardIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  CUSTOMER_ORDERS_URL,
  RECEIVINGS_URL,
  SHIPMENTS_URL,
  SUPPLIER_VOUCHERS_URL,
  addSupplierVoucherPayment,
  deleteReceiving,
  createReceiving,
  deleteShipment,
  deleteSupplierVoucher,
  ordersFromWire,
  receivingsFromWire,
  removeSupplierVoucherPayment,
  updateSupplierVoucherPayment,
  setVoucherLineOrderLinks,
  shipmentsFromWire,
  replaceReceivingCosts,
  updateReceiving,
  updateReceivingPackage,
  updateShipment,
  updateSupplierVoucher,
  vouchersFromWire,
  stockRecordsFromWire,
  WHOLESALE_STOCK_URL,
  type CustomerOrderWire,
  type ReceivingWire,
  type ShipmentWire,
  type StockRecordWire,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  WHOLESALE_QUERY_KEYS,
  invalidateWholesale,
} from "@renderer/components/features/wholesale/shared/queryKeys";
import {
  paymentStatus,
  voucherAmount,
  voucherMovePlaces,
  voucherStage,
  type DiscountKind,
  type DiscountSetting,
  type SupplierVoucher,
  type SupplierVoucherLine,
} from "./supplierVouchers";
import {
  formatDate,
  formatKyat,
  paymentBalance,
  todayIso,
  type SaveControl,
  combineSaves,
} from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  finalRemaining,
  gateStops,
  type Shipment,
  type ShipmentStop,
} from "../delivery/shipments";
import { sentInTotal } from "../delivery/shipmentMapLayout";
import { ShipmentDetail } from "../delivery/ShipmentDetail";
import { FloatingLayer } from "../shared/ui";
import { useDismissableMenu } from "../shared/useDismissableMenu";
import {
  packageHasProducts,
  packagePairs,
  type Receiving,
  type ReceivingPackage,
} from "../receiving/receivings";
import { voucherExpectations } from "../receiving/voucherCheckUtils";
import { ReceivingPackagesTable } from "../receiving/ReceivingPackagesTable";
import { ReceivingCostsTable } from "../receiving/ReceivingCostsTable";
import { type ReceivingCost } from "../receiving/receivings";
import { collectReceivingProblems, packageDraftActions } from "./packageDraft";
import { VoucherLinesTable } from "./VoucherLinesTable";
import { PaymentsTab } from "../shared/PaymentsTab";
import { usePaymentDrafts } from "../shared/usePaymentDrafts";
import { VoucherPaymentDrawer } from "./VoucherPaymentDrawer";
import { VoucherInfoDrawer } from "./VoucherInfoDrawer";
import { StockInPage } from "./StockInPage";
import { PlaceSelect, PlaceSwitch } from "./PlaceSwitch";
import { stopsToReceive } from "../receiving/toReceive";
import { type MapDelivery } from "../delivery/ShipmentMap";
import { voucherTransfersUrl, type StockTransfer } from "./stockTransfersApi";
import { AddSlipModal } from "./AddSlipModal";
import { QuickSupplierPaymentModal } from "./QuickSupplierPaymentModal";
import {
  CreateIssueModal,
  IssueHistoryBadge,
  IssueHistoryModal,
} from "../shared/IssueModal";
import { listIssueRecords, formatIssueType } from "../shared/issuesApi";
import { splitBaht, voucherBaht } from "../shared/baht";
import { useDelayedDelete } from "../shared/useDelayedDelete";
import { PaymentBadge, VoucherStageBadge } from "./VoucherBadges";
import { PLACE_NAMES } from "../masterData/masterData";
import { PlaceInput } from "../shared/PlaceInput";
import { EmptyStage } from "./EmptyStage";
import { RelatedRecordsButton } from "../shared/RelatedRecords";
import {
  ordersForVoucherLine,
  type OpenRelated,
} from "../shared/relatedLookup";

export interface PurchasePageProps {
  session: Session;
  voucherId?: string | null;
  voucherNo?: string | null;
  initialTab?: "ordered" | "shipped" | "arrived" | "moved" | "paid" | "costs";
  /** Which part of the Move to warehouse tab to open on (the Today page's Count button). */
  initialMoveView?: "to_move" | "to_count";
  /** Which of the voucher's shipments to show first (from the Today page). */
  initialShipmentId?: string | null;
  /** Which place on that shipment's route to show the count of first. */
  initialStopId?: string | null;
  onClose: () => void;
  /** Reports whether the page has edits that are not saved yet. */
  onUnsavedChange?: (dirty: boolean) => void;
  /** Open another order from the list on a product line. */
  onOpenRecord?: OpenRelated;
}

export function PurchasePage({
  session,
  voucherId,
  voucherNo,
  initialTab = "ordered",
  initialMoveView,
  initialShipmentId = null,
  initialStopId = null,
  onClose,
  onOpenRecord,
  onUnsavedChange,
}: PurchasePageProps): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { settings } = useAppSettings(session);
  const todayRate = Number(settings?.today_exchange_rates?.THB) || 0;
  const delayedDelete = useDelayedDelete();
  const shipmentMenu = useDismissableMenu();
  const receivingMenu = useDismissableMenu();

  const [activeStep, setActiveStep] = useState<
    "ordered" | "shipped" | "arrived" | "moved" | "paid" | "costs"
  >(initialTab);
  const [moveSave, setMoveSave] = useState<SaveControl | null>(null);

  // Modals & sub-drawers state
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false);
  // Opening Move to warehouse (its own page) drops the tabs' unsaved edits, so it asks first.
  const [leaveThen, setLeaveThen] = useState<(() => void) | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [startingStage, setStartingStage] = useState(false);
  const [quickPayOpen, setQuickPayOpen] = useState(false);
  // Packages leaving a place another way, and packages counted at a stop (chosen on the route).
  const [slipOpen, setSlipOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [shipmentIssueOpen, setShipmentIssueOpen] = useState(false);
  const [shipmentCreateIssueOpen, setShipmentCreateIssueOpen] = useState(false);
  const [targetLineForIssue, setTargetLineForIssue] = useState<string | null>(
    null,
  );
  const [voucherMenuOpen, setVoucherMenuOpen] = useState(false);

  // In-place Shipment edit state

  // In-place Receiving edit state
  const [recGate, setRecGate] = useState("");
  const [recDate, setRecDate] = useState("");
  const [recPackages, setRecPackages] = useState(1);
  const [changingPackages, setChangingPackages] = useState(false);

  const vouchersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.vouchers,
    queryFn: () =>
      fetchJson<SupplierVoucherWire[]>(
        `${SUPPLIER_VOUCHERS_URL}?page_size=2000`,
        session,
      ),
    select: vouchersFromWire,
  });

  const relatedOrdersQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.orders,
    queryFn: () =>
      fetchJson<CustomerOrderWire[]>(
        `${CUSTOMER_ORDERS_URL}?page_size=2000`,
        session,
      ),
    select: ordersFromWire,
  });

  const shipmentsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.shipments,
    queryFn: () =>
      fetchJson<ShipmentWire[]>(`${SHIPMENTS_URL}?page_size=2000`, session),
    select: shipmentsFromWire,
  });

  const receivingsQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.receivings,
    queryFn: () =>
      fetchJson<ReceivingWire[]>(`${RECEIVINGS_URL}?page_size=2000`, session),
    select: receivingsFromWire,
  });

  const voucher: SupplierVoucher | undefined = useMemo(() => {
    if (!vouchersQuery.data) return undefined;
    if (voucherId) {
      return vouchersQuery.data.find((v) => v.voucher_id === voucherId);
    }
    if (voucherNo) {
      return vouchersQuery.data.find((v) => v.voucher_no === voucherNo);
    }
    return undefined;
  }, [vouchersQuery.data, voucherId, voucherNo]);

  const voucherIssuesQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.writeOffs, voucher?.voucher_no],
    queryFn: () =>
      voucher ? listIssueRecords(session, voucher.voucher_no) : [],
    enabled: Boolean(voucher),
  });
  const voucherIssues = useMemo(
    () =>
      (voucherIssuesQuery.data ?? []).filter(
        (record) =>
          record.reference === voucher?.voucher_no &&
          record.record_type !== "quantity_change",
      ),
    [voucherIssuesQuery.data, voucher?.voucher_no],
  );

  // Takes part in explain mode; the reference tells the assistant which voucher to look up.
  useExplainScreen({
    tab: voucher ? `voucher ${voucher.voucher_no}` : null,
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });

  const paymentDrafts = usePaymentDrafts(voucher?.payment.payments ?? [], {
    update: (paymentId, edit) =>
      updateSupplierVoucherPayment(
        session,
        voucher?.voucher_id ?? "",
        paymentId,
        edit,
      ),
    add: (payment) =>
      addSupplierVoucherPayment(session, voucher?.voucher_id ?? "", payment),
    onSaved: () => invalidateWholesale(queryClient),
  });
  const { paymentRows, readyNewPayments } = paymentDrafts;
  const paymentsChanged = paymentDrafts.changed;

  // What has been moved on from this voucher's places to a warehouse. The same query the Move
  // to warehouse page reads, so it is shared.
  const transfersQuery = useQuery({
    queryKey: [
      ...WHOLESALE_QUERY_KEYS.stock,
      "transfers",
      voucher?.voucher_id ?? "",
    ],
    queryFn: () =>
      fetchJson<StockTransfer[]>(
        voucherTransfersUrl(voucher?.voucher_id ?? ""),
        session,
      ),
    enabled: !!voucher?.voucher_id,
    staleTime: 0,
    refetchOnMount: "always",
  });
  // What is where, to say how much of this voucher's products is at a gate or warehouse.
  const stockQuery = useQuery({
    queryKey: WHOLESALE_QUERY_KEYS.stock,
    queryFn: () =>
      fetchJson<StockRecordWire[]>(
        `${WHOLESALE_STOCK_URL}?page_size=2000`,
        session,
      ),
    select: stockRecordsFromWire,
  });
  const voucherCodes = new Set(
    (voucher?.lines ?? []).map((line) => line.stock_code.trim().toLowerCase()),
  );
  const mapDelivery: MapDelivery = {
    here: (place) =>
      (stockQuery.data ?? [])
        .filter((record) =>
          voucherCodes.has(record.stock_code.trim().toLowerCase()),
        )
        .reduce(
          (sum, record) =>
            sum +
            record.locations
              .filter(
                (loc) =>
                  loc.location.trim().toLowerCase() ===
                  place.trim().toLowerCase(),
              )
              .reduce((inner, loc) => inner + loc.on_hand_pairs, 0),
          0,
        ),
  };

  // Find linked shipment and receiving
  // A voucher can go out in several shipments (the packages split over different routes or
  // days). The tabs show one at a time; the switch above them picks which.
  const voucherShipments: Shipment[] = useMemo(() => {
    if (!voucher || !shipmentsQuery.data) return [];
    return shipmentsQuery.data
      .filter((s) => s.voucher_no === voucher.voucher_no)
      .sort(
        (a, b) =>
          a.sent_on.localeCompare(b.sent_on) ||
          a.shipment_no.localeCompare(b.shipment_no),
      );
  }, [voucher, shipmentsQuery.data]);
  const [shipmentChoice, setShipmentChoice] = useState<string | null>(
    initialShipmentId,
  );
  const linkedShipment: Shipment | undefined =
    voucherShipments.find((s) => s.shipment_id === shipmentChoice) ??
    voucherShipments[0];

  // The place on the route whose count the At receiving gate and Cost tabs show: any place can
  // be counted, a gate normally is. Left unchosen, it is the shipment's first gate.
  const [stopChoice, setStopChoice] = useState<string | null>(initialStopId);
  const linkedStop: ShipmentStop | undefined = linkedShipment
    ? (linkedShipment.stops.find((stop) => stop.stop_id === stopChoice) ??
      gateStops(linkedShipment)[0] ??
      linkedShipment.stops[0])
    : undefined;

  const linkedReceiving: Receiving | undefined = useMemo(() => {
    if (!linkedShipment || !linkedStop || !receivingsQuery.data)
      return undefined;
    return receivingsQuery.data.find(
      (r) =>
        r.shipment_id === linkedShipment.shipment_id &&
        (r.stop_id
          ? r.stop_id === linkedStop.stop_id
          : linkedStop.is_gate && gateStops(linkedShipment).length === 1),
    );
  }, [linkedShipment, linkedStop, receivingsQuery.data]);

  // Packages and their products are edited locally (same as the old Receiving screen)
  // and saved explicitly, rather than round-tripping the server on every keystroke.
  // Re-seeded whenever a different receiving comes into view, not on every background
  // refetch, so mid-count typing survives an unrelated invalidation elsewhere.
  const [packagesDraft, setPackagesDraft] = useState<ReceivingPackage[]>(
    () => linkedReceiving?.packages ?? [],
  );
  const [packagesDirty, setPackagesDirty] = useState(false);
  const [savingPackages, setSavingPackages] = useState(false);
  const [packageSearch, setPackageSearch] = useState("");
  // Costs are edited locally like packages, and saved with the same button.
  const [costsDraft, setCostsDraft] = useState<ReceivingCost[]>(
    () => linkedReceiving?.costs ?? [],
  );
  const [savingCosts, setSavingCosts] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
  // The Ordered Items and On the way tabs keep their own drafts; they report them here.
  const [linesSave, setLinesSave] = useState<SaveControl | null>(null);
  const [shipmentSave, setShipmentSave] = useState<SaveControl | null>(null);
  // The shipment as it is on screen while it has edits that are not saved yet.
  const [shipmentDraft, setShipmentDraft] = useState<Shipment | null>(null);
  // The product rows as they are on screen while they have unsaved edits.
  const [linesDraft, setLinesDraft] = useState<SupplierVoucherLine[] | null>(
    null,
  );
  const paidView = activeStep === "costs" ? "costs" : "payments";
  const costsDirty =
    !!linkedReceiving &&
    JSON.stringify(costsDraft) !== JSON.stringify(linkedReceiving.costs);
  const receivingDetailsDirty = Boolean(
    linkedReceiving &&
    (recGate !== linkedReceiving.gate ||
      recDate !== linkedReceiving.received_on ||
      recPackages !== linkedReceiving.total_packages),
  );

  // Switching shipment or place drops edits that are not saved, so it asks first.
  function selectPlace(shipmentId: string, stopId: string | null): void {
    if (
      shipmentId === linkedShipment?.shipment_id &&
      (stopId === null || stopId === linkedStop?.stop_id)
    )
      return;
    const dirty =
      shipmentSave?.dirty ||
      packagesDirty ||
      receivingDetailsDirty ||
      costsDirty;
    const change = (): void => {
      setShipmentChoice(shipmentId);
      setStopChoice(stopId);
    };
    if (dirty) setLeaveThen(() => change);
    else change();
  }
  function selectShipment(shipmentId: string): void {
    selectPlace(shipmentId, null);
  }

  useEffect(() => {
    if (linkedReceiving) {
      setPackagesDraft(linkedReceiving.packages);
      setCostsDraft(linkedReceiving.costs);
      setPackagesDirty(false);
      setRecGate(linkedReceiving.gate ?? "");
      setRecDate(linkedReceiving.received_on);
      setRecPackages(linkedReceiving.total_packages);
    }
  }, [
    linkedReceiving?.receiving_id,
    linkedReceiving?.gate,
    linkedReceiving?.received_on,
    linkedReceiving?.total_packages,
  ]);

  if (vouchersQuery.isLoading) {
    return (
      <div className="flex h-96 w-full items-center justify-center">
        <Spinner className="w-8 h-8 text-brand" />
      </div>
    );
  }

  if (!voucher) {
    return (
      <div className="mx-auto flex h-96 w-full max-w-md flex-col items-center justify-center text-center">
        <h3 className="text-lg font-bold text-text-primary">
          Voucher not found
        </h3>
        <p className="mt-2 text-sm text-text-muted">
          The requested voucher could not be loaded.
        </p>
        <Button variant="primary" onClick={onClose} className="mt-4">
          Back
        </Button>
      </div>
    );
  }

  // Everything the header and the tab strip show follows what is typed on screen, before
  // Save changes: the shipment's fields, the product rows, the payments and the count.
  const liveShipments = voucherShipments.map((shipment) =>
    shipmentDraft?.shipment_id === shipment.shipment_id
      ? shipmentDraft
      : shipment,
  );
  // A small dot on a tab when something on it is waiting for someone: no shipment yet, packages
  // that arrived and are not counted, or moves that the warehouse has not counted.
  const needsAction: Record<string, boolean> = {
    shipped: voucher.lines.length > 0 && liveShipments.length === 0,
    arrived: stopsToReceive(liveShipments, receivingsQuery.data ?? []).some(
      (row) => row.receiving || row.stop.packages_received > 0,
    ),
    moved: (transfersQuery.data ?? []).some((transfer) =>
      transfer.lines.some((line) => line.counted_quantity_pairs === null),
    ),
  };
  const packagesSent = liveShipments.reduce(
    (sum, s) => sum + s.total_packages,
    0,
  );
  // Cargo and packages come from the slips (the shipments), not from the voucher itself.
  const cargoNames = [
    ...new Set(liveShipments.map((s) => s.carrier_name.trim()).filter(Boolean)),
  ].join(", ");
  // What each counted place has counted so far, for the diagram.
  const placeCounts = Object.fromEntries(
    (receivingsQuery.data ?? [])
      .filter(
        (rec) =>
          rec.stop_id &&
          liveShipments.some((s) => s.shipment_id === rec.shipment_id),
      )
      .map((rec) => {
        const shipment = liveShipments.find(
          (entry) => entry.shipment_id === rec.shipment_id,
        );
        const stop = shipment?.stops.find(
          (entry) => entry.stop_id === rec.stop_id,
        );
        return [
          rec.stop_id as string,
          {
            counted: rec.packages.filter((p) => p.opened).length,
            total: stop ? sentInTotal(stop) : rec.packages.length,
          },
        ];
      }),
  );
  const livePaid =
    paymentRows.reduce((sum, p) => sum + p.amount, 0) +
    readyNewPayments.reduce((sum, p) => sum + p.amount, 0);

  // Derived for the package/product workbench in "At the gate" (see below).
  const expected = voucherExpectations(voucher);
  const receivingForView: Receiving | undefined = linkedReceiving
    ? { ...linkedReceiving, packages: packagesDraft }
    : undefined;
  // The voucher's colours are checked against everything counted for it, in every place its
  // shipments were counted, not just the one on screen.
  const voucherWideReceiving: Receiving | undefined = receivingForView && {
    ...receivingForView,
    packages: [
      ...receivingForView.packages,
      ...(receivingsQuery.data ?? [])
        .filter(
          (r) =>
            r.receiving_id !== receivingForView.receiving_id &&
            voucherShipments.some((s) => s.shipment_id === r.shipment_id),
        )
        .flatMap((r) => r.packages),
    ],
  };
  // A package with something written in it is a package that arrived and was counted.
  const countedQtyPairs = packagesDraft.reduce(
    (sum, p) => (packageHasProducts(p) ? sum + packagePairs(p) : sum),
    0,
  );
  // The voucher as it reads with everything typed so far.
  const savedCounted = (linkedReceiving?.packages ?? []).reduce(
    (sum, p) => (packageHasProducts(p) ? sum + packagePairs(p) : sum),
    0,
  );
  const liveVoucher: SupplierVoucher = {
    ...voucher,
    lines: linesDraft ?? voucher.lines,
    total_quantity_pairs: linesDraft
      ? linesDraft.reduce((sum, line) => sum + line.quantity_pairs, 0)
      : voucher.total_quantity_pairs,
    received_quantity_pairs:
      (voucher.received_quantity_pairs ?? 0) +
      (linkedReceiving ? countedQtyPairs - savedCounted : 0),
    payment: {
      ...voucher.payment,
      payments: [
        ...paymentRows,
        ...readyNewPayments.map((p) => ({ ...p, payment_id: p.draft_id })),
      ],
    },
  };
  const total = voucherAmount(liveVoucher);
  const liveBalance = paymentBalance(total, livePaid);
  // The same in Baht: what the supplier is owed, and what has been paid in Baht.
  const owedBaht = voucherBaht(liveVoucher.lines, {
    kind: liveVoucher.discount_kind,
    value: liveVoucher.discount_value ?? 0,
  });
  const paidBaht = splitBaht([...paymentRows, ...readyNewPayments]);
  const filteredPackagesWithIndex = packagesDraft
    .map((pkg, originalIndex) => ({ pkg, originalIndex }))
    .filter(({ pkg }) => {
      const q = packageSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(pkg.package_no).toLowerCase().includes(q) ||
        pkg.items.some((it) => it.stock_code.toLowerCase().includes(q))
      );
    });
  const allProblems = collectReceivingProblems(
    packagesDraft,
    expected,
    voucherWideReceiving,
  );

  // Deletable: draft or ordered with no received goods
  const isDeletable =
    (voucher.received_quantity_pairs ?? 0) === 0 &&
    voucher.payment.payments.length === 0;

  // Handlers
  // Link or unlink this voucher line to the customers it was bought for.
  async function changeSupplyLinks(
    voucherLineId: string,
    change: (
      existing: { order_line_id: string; quantity_pairs: number }[],
    ) => { order_line_id: string; quantity_pairs: number }[],
  ): Promise<void> {
    const line = voucher?.lines.find(
      (entry) => entry.voucher_line_id === voucherLineId,
    );
    if (!line) return;
    setLinkBusy(true);
    try {
      await setVoucherLineOrderLinks(
        session,
        voucherLineId,
        change(
          (line.for_orders ?? []).map((entry) => ({
            order_line_id: entry.order_line_id,
            quantity_pairs: entry.quantity_pairs,
          })),
        ),
      );
      await invalidateWholesale(queryClient);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not change the link.",
      );
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleSaveLines(
    lines: SupplierVoucherLine[],
  ): Promise<boolean> {
    if (!voucher) return false;
    setSavingLines(true);
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        lines,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Products saved.");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save products.",
      );
      return false;
    } finally {
      setSavingLines(false);
    }
  }

  function handleRemoveLine(lineId: string): void {
    if (!voucher) return;
    const line = voucher.lines.find((l) => l.voucher_line_id === lineId);
    if (!line) return;
    if ((line.received_quantity_pairs ?? 0) > 0) {
      showToast(
        "error",
        "Products have already arrived for this line. Cannot remove.",
      );
      return;
    }
    if ((line.lost_quantity_pairs ?? 0) > 0) {
      showToast(
        "error",
        "This product has a short quantity recorded. Cannot remove.",
      );
      return;
    }
    if (voucher.lines.length <= 1) {
      showToast(
        "error",
        "A voucher needs at least one product. Delete the voucher instead.",
      );
      return;
    }
    delayedDelete.scheduleDelete({
      id: lineId,
      item: lineId,
      label: `Product ${line.stock_code}`,
      verb: "removed",
      onDelete: async () => {
        await updateSupplierVoucher(session, voucher.voucher_id, {
          supplier_name: voucher.supplier_name,
          voucher_date: voucher.voucher_date,
          lines: voucher.lines.filter((l) => l.voucher_line_id !== lineId),
        });
        await invalidateWholesale(queryClient);
      },
    });
  }

  async function handleSaveDiscount(next: DiscountSetting): Promise<void> {
    if (!voucher) return;
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        supplier_name: voucher.supplier_name,
        voucher_date: voucher.voucher_date,
        discount_kind: next.kind,
        discount_value: next.value,
        discount_exchange_rate: next.rate ?? null,
        lines: voucher.lines,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Supplier discount saved.");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save the discount.",
      );
    }
  }

  async function handleSaveInfo(patch: {
    supplier_name: string;
    voucher_date: string;
    receiving_gate: string;
    discount_kind: DiscountKind;
    discount_value: number;
    discount_exchange_rate: number | null;
  }): Promise<void> {
    if (!voucher) return;
    try {
      await updateSupplierVoucher(session, voucher.voucher_id, {
        ...patch,
        lines: voucher.lines,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Voucher details updated.");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update voucher.",
      );
    }
  }

  async function handleAddPayment(payment: {
    paid_on: string;
    amount: number;
    note?: string;
  }): Promise<void> {
    if (!voucher) return;
    try {
      await addSupplierVoucherPayment(session, voucher.voucher_id, {
        paid_on: payment.paid_on,
        amount: payment.amount,
        note: payment.note ?? "",
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Payment added.");
      setPaymentDrawerOpen(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not record payment.",
      );
    }
  }

  function handleDeletePaymentWithUndo(
    paymentId: string,
    paymentAmount: number,
  ): void {
    if (!voucher) return;
    delayedDelete.scheduleDelete({
      id: paymentId,
      item: { voucherId: voucher.voucher_id, paymentId },
      label: `Payment of ${formatKyat(paymentAmount)}`,
      verb: "removed",
      onDelete: async ({ voucherId, paymentId }) => {
        await removeSupplierVoucherPayment(session, voucherId, paymentId);
        await invalidateWholesale(queryClient);
      },
    });
  }

  function handleDeleteVoucherWithUndo(): void {
    if (!voucher) return;
    delayedDelete.scheduleDelete({
      id: voucher.voucher_id,
      item: voucher.voucher_id,
      label: `Voucher ${voucher.voucher_no}`,
      onDelete: async (id) => {
        await deleteSupplierVoucher(session, id);
        await invalidateWholesale(queryClient);
        onClose();
      },
    });
    setVoucherMenuOpen(false);
  }

  // Shipment handlers
  async function handleSaveShipment(
    updated: Shipment,
  ): Promise<Shipment | void> {
    if (!linkedShipment) return;
    try {
      const saved = await updateShipment(session, linkedShipment.shipment_id, {
        carrier_name: updated.carrier_name,
        sent_on: updated.sent_on,
        total_packages: updated.total_packages,
        total_quantity_pairs: updated.total_quantity_pairs,
        total_unit: updated.total_unit,
        stops: updated.stops,
      });
      await invalidateWholesale(queryClient);
      showToast("success", "Shipment updated.");
      return saved;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update shipment.",
      );
      throw err;
    }
  }

  function handleDeleteShipmentWithUndo(): void {
    if (!linkedShipment) return;
    delayedDelete.scheduleDelete({
      id: linkedShipment.shipment_id,
      item: linkedShipment.shipment_id,
      label: `Shipment ${linkedShipment.shipment_no}`,
      onDelete: async (id) => {
        await deleteShipment(session, id);
        await invalidateWholesale(queryClient);
      },
    });
  }

  // Package and receiving details are local drafts until Save changes is pressed.
  const {
    duplicateDraftPreviousPackage,
    setDraftColorQty,
    setDraftStockCode,
    addDraftItem,
    removeDraftItem,
  } = packageDraftActions({
    packagesDraft,
    setPackagesDraft,
    setPackagesDirty,
    receivedOn: linkedReceiving?.received_on ?? "",
  });

  // One Save button in the header: it saves every tab that has changes, not only the open one, in
  // the order the goods travel (products, shipment, count, move to a warehouse, payments, costs).
  const headerSave: SaveControl = combineSaves([
    linesSave,
    linkedShipment ? shipmentSave : null,
    linkedReceiving
      ? {
          dirty: packagesDirty || receivingDetailsDirty,
          saving: savingPackages,
          save: () => handleSavePackages(),
        }
      : null,
    moveSave,
    {
      dirty: paymentsChanged,
      canSave: liveBalance >= 0,
      saving: paymentDrafts.saving,
      save: () => paymentDrafts.save(total),
    },
    linkedReceiving
      ? {
          dirty: costsDirty,
          saving: savingCosts,
          save: () => handleSaveCosts(),
        }
      : null,
  ]);

  // The supplier's slip comes after the order, so a voucher starts with no shipment.

  async function handleStartReceiving(): Promise<void> {
    if (!voucher || !linkedShipment || !linkedStop) return;
    setStartingStage(true);
    try {
      // The packages due here are all boxes sent to this place, including any route that
      // rejoins it. This remains correct after boxes were split or combined on the way.
      const due = sentInTotal(linkedStop) || linkedShipment.total_packages;
      const share =
        linkedShipment.total_packages > 0
          ? Math.min(1, due / linkedShipment.total_packages)
          : 1;
      await createReceiving(session, {
        shipment_id: linkedShipment.shipment_id,
        stop_id: linkedStop.stop_id,
        gate: linkedStop.stop_name || PLACE_NAMES[0] || "Main Gate / Warehouse",
        received_on: todayIso(),
        total_packages: Math.max(1, due),
        total_quantity_pairs: Math.round(
          (voucher.total_quantity_pairs / 6) * share,
        ),
        total_unit: "set",
        costs: [],
      });
      await invalidateWholesale(queryClient);
      showToast(
        "success",
        "Receiving started. Open each package as it is counted.",
      );
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not start receiving.",
      );
    } finally {
      setStartingStage(false);
    }
  }

  async function handleSavePackages(): Promise<boolean> {
    if (!linkedReceiving) return true;
    setSavingPackages(true);
    try {
      if (packagesDirty) {
        for (const draft of packagesDraft) {
          const items = draft.items.filter(
            (item) => item.stock_code.trim() !== "" || item.quantity > 0,
          );
          await updateReceivingPackage(session, linkedReceiving.receiving_id, {
            ...draft,
            items,
            opened: items.length > 0,
          });
        }
      }
      if (receivingDetailsDirty) {
        const saved = await updateReceiving(
          session,
          linkedReceiving.receiving_id,
          {
            gate: recGate,
            received_on: recDate,
            total_packages: recPackages,
            total_quantity_pairs: linkedReceiving.total_quantity_pairs,
            total_unit: linkedReceiving.total_unit,
          },
        );
        // Show what the server kept (it may tidy the gate or date), so the fields do not
        // keep reading as unsaved.
        setRecGate(saved.gate ?? recGate);
        setRecDate(saved.received_on || recDate);
        setRecPackages(saved.total_packages ?? recPackages);
      }
      await invalidateWholesale(queryClient);
      setPackagesDirty(false);
      showToast("success", "Receiving changes saved.");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not save packages.",
      );
      return false;
    } finally {
      setSavingPackages(false);
    }
  }

  // Packages are added and taken away at once, not held back until Save changes: the server
  // makes (or drops) the empty package, and what has been typed in the others stays as it is.
  async function changePackageCount(
    total: number,
  ): Promise<Receiving | undefined> {
    if (!linkedReceiving) return undefined;
    setChangingPackages(true);
    try {
      const saved = await updateReceiving(
        session,
        linkedReceiving.receiving_id,
        {
          gate: linkedReceiving.gate,
          received_on: linkedReceiving.received_on,
          total_packages: total,
          total_quantity_pairs: linkedReceiving.total_quantity_pairs,
          total_unit: linkedReceiving.total_unit,
        },
      );
      await invalidateWholesale(queryClient);
      setRecPackages(saved.total_packages ?? total);
      return saved;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not change the packages.",
      );
      return undefined;
    } finally {
      setChangingPackages(false);
    }
  }

  async function handleAddPackage(): Promise<string | undefined> {
    if (!linkedReceiving) return undefined;
    const saved = await changePackageCount(linkedReceiving.total_packages + 1);
    if (!saved) return undefined;
    setPackagesDraft((current) => [
      ...current,
      ...saved.packages.filter(
        (pkg) => !current.some((entry) => entry.package_id === pkg.package_id),
      ),
    ]);
    return [...saved.packages]
      .sort((a, b) => a.package_no - b.package_no)
      .at(-1)?.package_id;
  }

  async function handleRemoveLastPackage(): Promise<void> {
    if (!linkedReceiving) return;
    const saved = await changePackageCount(linkedReceiving.total_packages - 1);
    if (!saved) return;
    setPackagesDraft((current) =>
      current.filter((entry) =>
        saved.packages.some((pkg) => pkg.package_id === entry.package_id),
      ),
    );
  }

  async function handleSaveCosts(): Promise<boolean> {
    if (!linkedReceiving) return true;
    setSavingCosts(true);
    try {
      const saved = await replaceReceivingCosts(
        session,
        linkedReceiving.receiving_id,
        costsDraft,
      );
      await invalidateWholesale(queryClient);
      // The server gives the costs their own ids; show the saved copy so the draft does not
      // keep reading as different from it.
      if (saved?.costs) setCostsDraft(saved.costs);
      showToast("success", "Transportation costs saved.");
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error
          ? err.message
          : "Could not save transportation costs.",
      );
      return false;
    } finally {
      setSavingCosts(false);
    }
  }

  function handleDeleteReceivingWithUndo(): void {
    if (!linkedReceiving) return;
    delayedDelete.scheduleDelete({
      id: linkedReceiving.receiving_id,
      item: linkedReceiving.receiving_id,
      label: `Receiving ${linkedReceiving.receiving_no}`,
      onDelete: async (id) => {
        await deleteReceiving(session, id);
        await invalidateWholesale(queryClient);
      },
    });
  }

  return (
    <div className="-mx-3.5 sm:-mx-4.5 -my-3 sm:-my-3.5 flex flex-1 flex-col bg-bg-base overflow-hidden text-text-primary">
      {/* Top Header */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-bg-raised/70 px-6 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary gap-1.5 -ml-2"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-lg font-bold text-text-primary font-mono">
                {voucher.voucher_no}
              </h2>
              <VoucherStageBadge
                stage={voucherStage(
                  liveVoucher,
                  liveShipments,
                  transfersQuery.data ?? [],
                )}
                places={voucherMovePlaces(
                  liveVoucher.voucher_id,
                  transfersQuery.data ?? [],
                )}
              />
              <PaymentBadge status={paymentStatus(liveVoucher)} />
              <IssueHistoryBadge
                session={session}
                reference={voucher.voucher_no}
                onOpen={() => setIssueOpen(true)}
              />
            </div>
            <div className="flex flex-wrap items-center text-xs text-text-secondary">
              <span className="py-0.5 pr-2">
                Date:{" "}
                <span className="font-mono">
                  {formatDate(voucher.voucher_date)}
                </span>
              </span>
              <span className="border-l border-border px-2">
                Supplier:{" "}
                <span className="font-semibold text-text-primary">
                  {voucher.supplier_name}
                </span>
              </span>
              <span className="border-l border-border px-2">
                Quantity: {formatSets(liveVoucher.total_quantity_pairs)}
              </span>
              <span className="border-l border-border px-2">
                Packages:{" "}
                {packagesSent > 0
                  ? `${packagesSent} package${packagesSent === 1 ? "" : "s"}`
                  : "—"}
              </span>
              <span className="border-l border-border pl-2">
                Carrier: {cargoNames || "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SaveButton
            dirty={headerSave.dirty}
            saving={headerSave.saving}
            canSave={headerSave.canSave !== false}
            onSave={() => headerSave.save()}
            title={
              headerSave.canSave === false
                ? Math.round(liveBalance) < 0
                  ? "Payments cannot exceed the total amount."
                  : "A row in one of the tabs is not filled in yet."
                : undefined
            }
          />
          {/* "..." Action Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setVoucherMenuOpen((prev) => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-base text-text-muted hover:bg-bg-subtle hover:text-text-primary"
              title="Voucher actions"
            >
              •••
            </button>
            {voucherMenuOpen && (
              <div
                onMouseLeave={() => setVoucherMenuOpen(false)}
                className="absolute right-0 z-30 mt-1 w-48 rounded-xl border border-border bg-bg-base p-1.5 shadow-xl text-xs"
              >
                <button
                  type="button"
                  onClick={() => {
                    setVoucherMenuOpen(false);
                    setInfoDrawerOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                >
                  <PencilIcon className="h-3.5 w-3.5 text-text-muted" />
                  Edit voucher details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVoucherMenuOpen(false);
                    setCreateIssueOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                >
                  <PlusIcon className="h-3.5 w-3.5 text-text-muted" />
                  Create issue
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVoucherMenuOpen(false);
                    setIssueOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-bg-raised text-text-primary"
                >
                  <ClipboardIcon className="h-3.5 w-3.5 text-text-muted" />
                  Issue history
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  disabled={!isDeletable}
                  onClick={handleDeleteVoucherWithUndo}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-error hover:bg-error-subtle disabled:cursor-not-allowed disabled:bg-bg-base disabled:text-text-muted disabled:opacity-100 disabled:hover:bg-bg-base"
                  title={
                    !isDeletable
                      ? "Cannot delete voucher once products are received or payments recorded"
                      : "Delete voucher"
                  }
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Delete voucher
                </button>
                {!isDeletable && (
                  <p className="px-3 py-1 text-[10px] text-text-muted">
                    Locked: products received or payments made.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <UnsavedReporter
        dirty={Boolean(
          linesSave?.dirty ||
          shipmentSave?.dirty ||
          packagesDirty ||
          receivingDetailsDirty ||
          costsDirty ||
          paymentsChanged ||
          moveSave?.dirty,
        )}
        onChange={onUnsavedChange}
      />
      <LeaveConfirm
        open={leaveThen !== null}
        onStay={() => setLeaveThen(null)}
        onLeave={() => {
          const next = leaveThen;
          setLeaveThen(null);
          next?.();
        }}
      />

      {/* Tab strip */}
      <div
        role="tablist"
        className="flex gap-5 border-b border-border bg-bg-base px-6 pt-2"
      >
        {(
          [
            { id: "ordered" as const, label: "Ordered Items" },
            { id: "shipped" as const, label: "On the way" },
            { id: "arrived" as const, label: "At receiving gate" },
            { id: "moved" as const, label: "Move to warehouse" },
            { id: "paid" as const, label: "Payments" },
            { id: "costs" as const, label: "Transportation cost" },
          ] as const
        ).map((tab) => {
          const isActive = activeStep === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveStep(tab.id)}
              className={cn(
                "border-b-2 px-1 pb-3 pt-2.5 text-sm font-semibold transition-colors",
                isActive
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:border-brand hover:text-brand",
              )}
            >
              {tab.label}
              {tab.id === "arrived" && allProblems.length > 0 ? (
                <span
                  role="img"
                  aria-label="Does not match the voucher"
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-error align-middle"
                />
              ) : (
                needsAction[tab.id] && (
                  <span
                    role="img"
                    aria-label="Needs attention"
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle"
                  />
                )
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content Body */}
      <div
        className={cn(
          "flex-1 overflow-y-auto p-6",
          activeStep === "arrived" ? "flex min-h-0 flex-col" : "",
        )}
      >
        {/* STEP 1: ORDERED */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col",
            activeStep !== "ordered" && "hidden",
          )}
        >
          <VoucherLinesTable
            lines={voucher.lines}
            todayRate={todayRate}
            discount={{
              kind: voucher.discount_kind ?? "none",
              value: voucher.discount_value ?? 0,
              rate: voucher.discount_exchange_rate,
            }}
            onDiscountChange={handleSaveDiscount}
            saving={savingLines}
            isPending={(lineId) => delayedDelete.isPending(lineId)}
            onSave={handleSaveLines}
            onSaveControl={setLinesSave}
            onDraftLines={setLinesDraft}
            onRemoveLine={handleRemoveLine}
            renderRelated={(line) => (
              <RelatedRecordsButton
                related={ordersForVoucherLine(
                  line,
                  relatedOrdersQuery.data ?? [],
                )}
                linkedHeading="Bought for these customers"
                linkedNote="for them"
                candidateHeading="Same product, not linked"
                candidateNote="would be covered"
                onOpen={onOpenRecord}
                busy={linkBusy}
                onLink={(item) =>
                  void changeSupplyLinks(line.voucher_line_id, (existing) => [
                    ...existing,
                    { order_line_id: item.lineId, quantity_pairs: item.pairs },
                  ])
                }
                onUnlink={(item) =>
                  void changeSupplyLinks(line.voucher_line_id, (existing) =>
                    existing.filter(
                      (entry) => entry.order_line_id !== item.lineId,
                    ),
                  )
                }
              />
            )}
            renderIssueAction={(line) => {
              const lineIssues = voucherIssues.filter(
                (issue) =>
                  issue.subject_id === line.voucher_line_id ||
                  (issue.stock_code && issue.stock_code === line.stock_code),
              );
              const count = lineIssues.length;
              const hasOpen = lineIssues.some(
                (issue) => issue.status !== "resolved",
              );
              const latest = lineIssues[0];

              if (count > 0) {
                return (
                  <button
                    type="button"
                    onClick={() => setIssueOpen(true)}
                    title={
                      latest
                        ? `Issue: ${formatIssueType(latest.issue_type || latest.reason || "")} - ${latest.note}`
                        : "View line issues"
                    }
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs transition-colors",
                      hasOpen
                        ? "text-warning hover:bg-warning/10 font-semibold"
                        : "text-text-muted hover:bg-bg-subtle hover:text-text-primary",
                    )}
                  >
                    <ClipboardIcon className="h-4 w-4" />
                    <span className="font-mono text-[10px] font-bold">
                      {count}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  type="button"
                  onClick={() => {
                    setTargetLineForIssue(line.voucher_line_id);
                    setCreateIssueOpen(true);
                  }}
                  title="Record reason / issue for this product"
                  className="rounded p-1.5 text-text-muted/40 hover:text-text-primary hover:bg-bg-subtle transition-colors"
                >
                  <ClipboardIcon className="h-4 w-4" />
                </button>
              );
            }}
          />
        </section>

        {/* STEP 2: ON THE WAY (SHIPMENT) */}
        <section
          className={cn(
            "-mt-3 space-y-3",
            activeStep !== "shipped" && "hidden",
          )}
        >
          {(!linkedShipment || finalRemaining(linkedShipment) > 0) && (
            <p className="text-xs text-text-muted">
              {!linkedShipment
                ? "Where the packages are between the supplier and your gate"
                : `${finalRemaining(linkedShipment)} of ${linkedShipment.total_packages} packages ${finalRemaining(linkedShipment) === 1 ? "is" : "are"} still on the way. They are counted when they reach the gate.`}
            </p>
          )}

          {linkedShipment &&
          !delayedDelete.isPending(linkedShipment.shipment_id) ? (
            <ShipmentDetail
              actions={
                <div className="flex items-center gap-2">
                  <IssueHistoryBadge
                    session={session}
                    reference={linkedShipment.shipment_no}
                    onOpen={() => setShipmentIssueOpen(true)}
                  />
                  <div className="relative" ref={shipmentMenu.ref}>
                    <button
                      type="button"
                      onClick={shipmentMenu.toggle}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-base text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                      title="Shipment actions"
                    >
                      •••
                    </button>
                    {shipmentMenu.open && (
                      <FloatingLayer
                        anchorRef={shipmentMenu.ref}
                        align="right"
                        className="w-48 rounded-xl border border-border bg-bg-base p-1.5 text-xs shadow-xl"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            shipmentMenu.setOpen(false);
                            setShipmentCreateIssueOpen(true);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-text-primary hover:bg-bg-raised"
                        >
                          <PlusIcon className="h-3.5 w-3.5 text-text-muted" />
                          Create issue
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            shipmentMenu.setOpen(false);
                            setShipmentIssueOpen(true);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-text-primary hover:bg-bg-raised"
                        >
                          <ClipboardIcon className="h-3.5 w-3.5 text-text-muted" />
                          Issue history
                        </button>
                        <div className="my-1 border-t border-border" />
                        <button
                          type="button"
                          onClick={() => {
                            shipmentMenu.setOpen(false);
                            handleDeleteShipmentWithUndo();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-error hover:bg-error-subtle"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Delete shipment
                        </button>
                      </FloatingLayer>
                    )}
                  </div>
                </div>
              }
              shipment={linkedShipment}
              onSave={handleSaveShipment}
              onSaveControl={setShipmentSave}
              onDraftChange={setShipmentDraft}
              siblings={liveShipments}
              onSelectShipment={selectShipment}
              onOpenCount={(stopId) => {
                if (linkedShipment)
                  selectPlace(linkedShipment.shipment_id, stopId);
                setActiveStep("arrived");
              }}
              counts={placeCounts}
              delivery={mapDelivery}
            />
          ) : (
            <EmptyStage
              steps={[
                { label: "Ordered", state: "done" },
                { label: "On the way", state: "current" },
                { label: "At receiving gate", state: "todo" },
              ]}
              title="Nothing is on the way yet"
              description="Your voucher is made. When the supplier's shipment comes, add it here: which carrier is carrying it and how many packages. Then you can follow it to your gate."
              actionLabel="Add the shipment"
              actionIcon={<TruckIcon className="h-4 w-4" />}
              onAction={() => setSlipOpen(true)}
              note="If you do not know the number of packages yet, leave it empty and fill it in later."
            />
          )}
        </section>

        {/* STEP 3: AT THE GATE (RECEIVING) */}
        <section
          className={cn(
            "-mt-3 flex min-h-0 flex-1 flex-col gap-2",
            activeStep !== "arrived" && "hidden",
          )}
        >
          <PlaceSwitch
            shipments={liveShipments}
            activeStopId={linkedStop?.stop_id}
            receivings={receivingsQuery.data ?? []}
            onSelect={selectPlace}
            showOthers={false}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <PlaceSelect
                shipments={liveShipments}
                activeStopId={linkedStop?.stop_id}
                receivings={receivingsQuery.data ?? []}
                onSelect={selectPlace}
              />
              {linkedReceiving &&
              !delayedDelete.isPending(linkedReceiving.receiving_id) ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-2 border-r border-border/80 pr-4 last:border-r-0 last:pr-0">
                    <label className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
                      Receiving gate <span className="text-error">*</span>
                    </label>
                    <PlaceInput
                      label="Receiving gate"
                      bare
                      size="sm"
                      className="w-52"
                      value={recGate}
                      onChange={setRecGate}
                      placeholder="Choose or type a gate"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
                      Arrived date <span className="text-error">*</span>
                    </label>
                    <Input
                      type="date"
                      size="sm"
                      value={recDate}
                      onChange={(event) => setRecDate(event.target.value)}
                      className="w-36 text-xs"
                      required
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {linkedReceiving &&
                !delayedDelete.isPending(linkedReceiving.receiving_id) && (
                  <div className="relative" ref={receivingMenu.ref}>
                    <button
                      type="button"
                      onClick={receivingMenu.toggle}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-base text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                      title="Receiving actions"
                    >
                      •••
                    </button>
                    {receivingMenu.open && (
                      <FloatingLayer
                        anchorRef={receivingMenu.ref}
                        align="right"
                        className="w-48 rounded-xl border border-border bg-bg-base p-1.5 text-xs shadow-xl"
                      >
                        {linkedReceiving &&
                          !delayedDelete.isPending(
                            linkedReceiving.receiving_id,
                          ) && (
                            <button
                              type="button"
                              onClick={() => {
                                receivingMenu.setOpen(false);
                                handleDeleteReceivingWithUndo();
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-error hover:bg-error-subtle"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                              Delete receiving
                            </button>
                          )}
                      </FloatingLayer>
                    )}
                  </div>
                )}
            </div>
          </div>

          {linkedReceiving &&
          !delayedDelete.isPending(linkedReceiving.receiving_id) ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ReceivingPackagesTable
                receiving={receivingForView as Receiving}
                checkedReceiving={voucherWideReceiving as Receiving}
                expected={expected}
                expectedPairs={liveVoucher.total_quantity_pairs}
                allProblems={allProblems}
                packageSearch={packageSearch}
                setPackageSearch={setPackageSearch}
                filteredPackagesWithIndex={filteredPackagesWithIndex}
                counted={countedQtyPairs}
                duplicatePreviousPackage={duplicateDraftPreviousPackage}
                addItem={addDraftItem}
                removeItem={removeDraftItem}
                setStockCode={setDraftStockCode}
                setColorQty={setDraftColorQty}
                onAddPackage={handleAddPackage}
                onRemoveLastPackage={handleRemoveLastPackage}
                packageBusy={changingPackages}
                products={voucher.lines.map((line) => ({
                  stock_code: line.stock_code,
                  description: line.description,
                  product_group: line.product_group,
                }))}
              />
            </div>
          ) : (
            <EmptyStage
              steps={[
                { label: "Ordered", state: "done" },
                {
                  label: "On the way",
                  state: linkedShipment ? "done" : "current",
                },
                {
                  label: "At receiving gate",
                  state: linkedShipment ? "current" : "todo",
                },
              ]}
              title={
                linkedShipment
                  ? "Nothing counted at the gate yet"
                  : "Products reach the gate after they are shipped"
              }
              description={
                linkedShipment
                  ? "When the packages reach your gate, start receiving, then open each package and count what is inside."
                  : "Add the shipment first, then come back here when the packages arrive."
              }
              actionLabel={
                linkedShipment ? "Start receiving" : "Go to On the way"
              }
              actionIcon={
                linkedShipment ? (
                  <WarehouseIcon className="h-4 w-4" />
                ) : undefined
              }
              onAction={() =>
                linkedShipment
                  ? void handleStartReceiving()
                  : setActiveStep("shipped")
              }
              loading={startingStage}
              note={
                linkedShipment
                  ? "We fill in the gate, packages and quantity from the shipment. You can change them after."
                  : undefined
              }
            />
          )}
        </section>

        {/* STEP 3b: MOVE TO WAREHOUSE */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col",
            activeStep !== "moved" && "hidden",
          )}
        >
          <StockInPage
            embedded
            session={session}
            voucher={voucher}
            onClose={() => setActiveStep("arrived")}
            onCountAtGate={() => setActiveStep("arrived")}
            onSaveControl={setMoveSave}
            initialView={initialMoveView}
          />
        </section>

        {/* STEP 4: PAYMENTS and STEP 5: TRANSPORTATION COST — each has its own tab. */}
        <section
          className={cn(
            "-m-6 flex min-h-0 flex-1 flex-col",
            activeStep !== "paid" && activeStep !== "costs" && "hidden",
          )}
        >
          {paidView === "payments" ? (
            <PaymentsTab
              baht={{
                total: owedBaht.baht,
                paid: paidBaht.baht,
                balance:
                  Math.round((owedBaht.baht - paidBaht.baht) * 100) / 100,
                paidKyatOnly: paidBaht.kyatOnly,
              }}
              total={total}
              paid={livePaid}
              balance={liveBalance}
              paidLabel="Paid"
              balanceLabel="Left to pay"
              todayRate={todayRate}
              savedPayments={voucher.payment.payments}
              newPayments={paymentDrafts.newPayments}
              setNewPayments={paymentDrafts.setNewPayments}
              paymentEdits={paymentDrafts.paymentEdits}
              setPaymentEdits={paymentDrafts.setPaymentEdits}
              hidePendingRows
              multilineNote
              isPending={(id) => delayedDelete.isPending(id)}
              onDeletePayment={handleDeletePaymentWithUndo}
            />
          ) : linkedReceiving &&
            !delayedDelete.isPending(linkedReceiving.receiving_id) ? (
            <ReceivingCostsTable
              receiving={linkedReceiving}
              costs={costsDraft}
              todayRate={todayRate}
              carriers={[
                ...(linkedShipment ? [linkedShipment.carrier_name] : []),
                ...(linkedShipment
                  ? linkedShipment.stops.map((stop) => stop.carrier_name)
                  : []),
              ].filter((name) => name.trim() !== "" && name !== "—")}
              onChange={setCostsDraft}
              dirty={costsDirty}
              saving={savingCosts}
            />
          ) : (
            <div className="m-6 rounded-xl border border-dashed border-border p-6 text-center text-xs text-text-muted">
              Transportation costs can be recorded once the products reach the
              receiving gate.
            </div>
          )}
        </section>
      </div>

      {/* Sub Modals */}
      <VoucherInfoDrawer
        open={infoDrawerOpen}
        voucher={voucher}
        todayRate={todayRate}
        onClose={() => setInfoDrawerOpen(false)}
        onSave={handleSaveInfo}
      />

      <VoucherPaymentDrawer
        open={paymentDrawerOpen}
        voucher={voucher}
        onClose={() => setPaymentDrawerOpen(false)}
        onAddPayment={handleAddPayment}
      />

      <QuickSupplierPaymentModal
        session={session}
        voucher={voucher}
        open={quickPayOpen}
        onClose={() => setQuickPayOpen(false)}
        onSuccess={() => invalidateWholesale(queryClient)}
      />

      {createIssueOpen && (
        <CreateIssueModal
          session={session}
          referenceType="voucher"
          referenceId={voucher.voucher_id}
          referenceNumber={voucher.voucher_no}
          subtitle={`Voucher ${voucher.voucher_no} · ${voucher.supplier_name}`}
          context="voucher"
          initialLineId={targetLineForIssue || undefined}
          lines={voucher.lines.map((line) => ({
            id: line.voucher_line_id,
            stock_code: line.stock_code,
            description: line.description,
            unit: line.unit,
            color_breakdown: line.color_breakdown,
          }))}
          onClose={() => {
            setCreateIssueOpen(false);
            setTargetLineForIssue(null);
          }}
        />
      )}

      {issueOpen && (
        <IssueHistoryModal
          session={session}
          referenceNumber={voucher.voucher_no}
          subtitle={`Voucher ${voucher.voucher_no} · ${voucher.supplier_name}`}
          onClose={() => setIssueOpen(false)}
          onOpenCreate={() => {
            setIssueOpen(false);
            setCreateIssueOpen(true);
          }}
        />
      )}

      {slipOpen && (
        <AddSlipModal
          session={session}
          voucher={voucher}
          onClose={() => setSlipOpen(false)}
          onDone={() => void invalidateWholesale(queryClient)}
        />
      )}

      {linkedShipment && shipmentCreateIssueOpen && (
        <CreateIssueModal
          session={session}
          referenceType="shipment"
          referenceId={linkedShipment.shipment_id}
          referenceNumber={linkedShipment.shipment_no}
          subtitle={`Shipment ${linkedShipment.shipment_no} (${linkedShipment.carrier_name})`}
          context="shipment"
          defaultUnit="packages"
          onClose={() => setShipmentCreateIssueOpen(false)}
        />
      )}

      {linkedShipment && shipmentIssueOpen && (
        <IssueHistoryModal
          session={session}
          referenceNumber={linkedShipment.shipment_no}
          subtitle={`Shipment ${linkedShipment.shipment_no} (${linkedShipment.carrier_name})`}
          onClose={() => setShipmentIssueOpen(false)}
          onOpenCreate={() => {
            setShipmentIssueOpen(false);
            setShipmentCreateIssueOpen(true);
          }}
        />
      )}
    </div>
  );
}
