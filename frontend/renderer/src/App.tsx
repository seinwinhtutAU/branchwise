import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@renderer/lib/auth";
import {
  clearQueryCache,
  useImportedDataWatch,
  useUrlQueries,
} from "@renderer/lib/queryClient";
import {
  dashboardUrl,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import {
  apiBaseUrl,
  installAuthRetry,
  loadStoredSession,
  signIn,
  signOut,
  startSessionRefresh,
} from "@renderer/lib/auth";
import {
  clearLastKnown,
  forgetLastKnown,
  readLastKnown,
  writeLastKnown,
} from "@renderer/lib/lastKnown";
import { installNetworkResilience } from "@renderer/lib/network";
import { useToast } from "@renderer/lib/useToast";
import { AuthScreen } from "@renderer/components/features/shell/AuthScreen";
import {
  AppShell,
  WHOLESALE_BRANCH_VALUE,
  type NavItem,
} from "@renderer/components/features/shell/AppShell";
import type {
  DataTableColumn,
  DataTableFilter,
} from "@renderer/components/features/SimpleDataTable";
import type {
  PendingImport,
  Profile,
} from "@renderer/components/features/types";
import type { InventorySubTab } from "@renderer/components/features/retail/InventoryPage";
import type { DataOverviewSubTab } from "@renderer/components/features/retail/DataOverviewTable";
import { useBranches, useRetailBranchOptions } from "@renderer/lib/useBranches";
import { formatBuyingPriceSource } from "@renderer/lib/buyingPriceSource";
import { useAppSettings } from "@renderer/lib/appSettings";
import {
  formatRetailDate,
  formatRetailTime,
} from "@renderer/lib/retailDateTime";
import { Spinner } from "@renderer/components/ui/Spinner";
import { AppProviders } from "@renderer/components/features/shell/AppProviders";
import { LeaveConfirm } from "@renderer/components/features/wholesale/shared/LeaveConfirm";
import { type WholesaleDashboardDrilldown } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";
import { ErrorBoundary } from "@renderer/components/ui/ErrorBoundary";
import { ChatLauncher } from "@renderer/components/features/chat/ChatLauncher";
import KeptPage from "@renderer/components/features/shell/KeptPage";
import { keptGroupFor } from "@renderer/components/features/shell/keptGroups";
import {
  UploadIcon,
  HistoryIcon,
  OverviewIcon,
  HeartPulseIcon,
  DashboardIcon,
  CalendarIcon,
  InventoryIcon,
  ClipboardIcon,
  TruckIcon,
  DataQualityIcon,
  UsersIcon,
} from "@renderer/components/ui/icons";

// Lazy-loaded so a given account's bundle only pays for the sections it can actually
// reach — e.g. a wholesale-only account never downloads the retail import/history/
// overview/warnings code, and vice versa (see the Wholesale doc section in CLAUDE.md).
// Rendered inside the <Suspense> boundary below.
const ImportReviewPage = lazy(
  () => import("@renderer/components/features/retail/ImportReviewPage"),
);
const ImportHubPage = lazy(
  () => import("@renderer/components/features/retail/ImportHubPage"),
);
const ImportHistoryDetailPage = lazy(
  () => import("@renderer/components/features/retail/ImportHistoryDetailPage"),
);
const DataOverviewTable = lazy(
  () => import("@renderer/components/features/retail/DataOverviewTable"),
);
const CustomerPage = lazy(() =>
  import("@renderer/components/features/wholesale/customers/CustomerPage").then(
    (module) => ({ default: module.CustomerPage }),
  ),
);
const SupplierPage = lazy(() =>
  import("@renderer/components/features/wholesale/suppliers/SupplierPage").then(
    (module) => ({ default: module.SupplierPage }),
  ),
);
const ProductPage = lazy(() =>
  import("@renderer/components/features/wholesale/products/ProductPage").then(
    (module) => ({ default: module.ProductPage }),
  ),
);
const WholesaleMonitoringPage = lazy(
  () =>
    import("@renderer/components/features/wholesale/monitoring/MonitoringDashboardPage"),
);
const WholesaleTodayDashboard = lazy(() =>
  import("@renderer/components/features/wholesale/today/WholesaleTodayDashboard").then(
    (module) => ({ default: module.WholesaleTodayDashboard }),
  ),
);
import {
  RecordHost,
  type ActiveRecord,
} from "@renderer/components/features/wholesale/shared/RecordHost";
import { WholesaleSearchModal } from "@renderer/components/features/wholesale/shared/WholesaleSearchModal";
const WarningsPage = lazy(
  () => import("@renderer/components/features/retail/WarningsPage"),
);
const DashboardPage = lazy(
  () => import("@renderer/components/features/retail/DashboardPage"),
);
const BusinessAlertsPage = lazy(
  () => import("@renderer/components/features/retail/BusinessAlertsPage"),
);
const PurchasingPage = lazy(
  () => import("@renderer/components/features/retail/PurchasingPage"),
);
const SettingsPage = lazy(
  () => import("@renderer/components/features/settings/SettingsPage"),
);
const UserManagementPage = lazy(
  () => import("@renderer/components/features/settings/UserManagementPage"),
);
const KnowledgePage = lazy(
  () => import("@renderer/components/features/knowledge/KnowledgePage"),
);

type Section =
  | "dashboard"
  | "businessAlerts"
  | "import"
  | "history"
  | "checking"
  | "importOverview"
  | "overview"
  | "sales"
  | "inventory"
  | "purchasing"
  | "purchase"
  | "warnings"
  | "today"
  | "customers"
  | "suppliers"
  | "products"
  | "monitoring"
  | "orders"
  | "vouchers"
  | "delivery"
  | "receiving"
  | "stock"
  | "finance"
  | "masterData"
  | "wholesale"
  | "settings"
  | "userManagement"
  | "knowledge";

// Retail and Wholesale are two functionally separate products glued together for a
// development account's convenience (see the "Wholesale" doc section in CLAUDE.md) — it switches between
// them via the workspace tabs in AppShell rather than seeing one merged nav list, so each
// workspace's item count can keep growing without bloating the other's.
type Workspace = "retail" | "wholesale";

const RETAIL_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  // Sits next to Dashboard rather than next to Warning, even though both are "things
  // that are wrong": this one is about the business, Warning is about the imported data
  // being wrong, and they are read by different people for different reasons.
  {
    id: "businessAlerts",
    label: "Business Alerts",
    shortLabel: "Alerts",
    icon: <HeartPulseIcon />,
  },
  { id: "import", label: "Import", icon: <UploadIcon /> },
  {
    id: "overview",
    label: "Data Overview",
    shortLabel: "Data",
    icon: <OverviewIcon />,
  },
  {
    id: "purchasing",
    label: "Reorder Items",
    shortLabel: "Reorder",
    icon: <ClipboardIcon />,
  },
  {
    id: "warnings",
    label: "Data Quality",
    shortLabel: "Quality",
    icon: <DataQualityIcon />,
  },
];

// Wholesale navigation simplified for single-operator workflow:
// 1. My Day (Home, money strip, quick flows, do-now queues)
// 2. Customers (Directory, orders, deliveries, payments, balance)
// 3. Suppliers (Directory, vouchers, in-transit shipments, balance)
// 4. Products (Live inventory, arriving batches, movement ledger)
// 5. Dashboard (Analytics & reporting decision support)
const WHOLESALE_NAV_ITEMS: NavItem[] = [
  { id: "monitoring", label: "Dashboard", icon: <DashboardIcon /> },
  { id: "today", label: "Today", shortLabel: "Today", icon: <CalendarIcon /> },
  { id: "customers", label: "Customers", icon: <UsersIcon /> },
  { id: "suppliers", label: "Suppliers", icon: <TruckIcon /> },
  { id: "products", label: "Products", icon: <InventoryIcon /> },
];

const WHOLESALE_SECTION_IDS = new Set(
  WHOLESALE_NAV_ITEMS.map((item) => item.id),
);

// Retail accounts are scoped strictly to data import & import history.
const RETAIL_ROLE_NAV_ITEMS: NavItem[] = [
  { id: "import", label: "Import", icon: <UploadIcon /> },
  { id: "history", label: "Import History", icon: <HistoryIcon /> },
  // Checking is implemented but intentionally hidden until the daily check workflow
  // and its verified-inventory-import handoff are ready to be released.
];

const RETAIL_ROLE_SECTION_IDS = new Set(
  RETAIL_ROLE_NAV_ITEMS.map((item) => item.id),
);

const WORKSPACE_NAV_ITEMS: Record<Workspace, NavItem[]> = {
  retail: RETAIL_NAV_ITEMS,
  wholesale: WHOLESALE_NAV_ITEMS,
};

const WORKSPACE_SECTION_IDS: Record<Workspace, Set<string>> = {
  retail: new Set(RETAIL_NAV_ITEMS.map((item) => item.id)),
  wholesale: new Set(WHOLESALE_NAV_ITEMS.map((item) => item.id)),
};

// Remembers which workspace development was last in, so it doesn't land back on Retail every
// sign-in if they actually live in Wholesale.
// The password every seeded account shares in development.
// Eight characters because Neon Auth refuses anything shorter.
const DEV_PASSWORD = import.meta.env.DEV ? "12345678" : "";

const WORKSPACE_STORAGE_KEY = "branchwise:lastWorkspace";

const SECTION_TITLES: Record<Section, string> = {
  dashboard: "Dashboard",
  businessAlerts: "Business alerts",
  import: "Import data",
  history: "Import history",
  checking: "Checking",
  importOverview: "Import overview",
  overview: "Data overview",
  sales: "Sale",
  inventory: "Inventory",
  purchasing: "Reorder items",
  purchase: "Purchase",
  warnings: "Data Quality",
  today: "Today",
  customers: "Customers",
  suppliers: "Suppliers",
  products: "Products",
  monitoring: "Dashboard",
  orders: "Customer orders",
  vouchers: "Supplier vouchers",
  delivery: "Shipment",
  receiving: "Receiving",
  stock: "Inventory",
  finance: "Finance",
  masterData: "Master data",
  wholesale: "Wholesale",
  settings: "Settings",
  userManagement: "User management",
  knowledge: "Knowledge",
};

interface SaleRow {
  Branch: string | null;
  Date: string;
  Time: string | null;
  SlipID: string;
  SlipNumber: string;
  LineNo: number;
  LineID: string;
  StockCode: string;
  Description: string;
  Selling_Price: number | null;
  Qty: number | null;
  UOM: string | null;
  Discount_Amount: number | null;
  Amount: number | null;
  Net_Amount: number | null;
  Location: string | null;
  Buying_Price: number | null;
  Buying_Price_Source: string | null;
  Profit: number | null;
  Profit_Margin_Pct: number | null;
}

const SALE_COLUMNS: DataTableColumn<SaleRow>[] = [
  { key: "Branch", label: "Branch" },
  {
    key: "Date",
    label: "Date",
    format: (value) => formatRetailDate(String(value)),
  },
  {
    key: "Time",
    label: "Time",
    format: (value) => formatRetailTime(value as string | null),
  },
  { key: "SlipID", label: "Slip ID" },
  { key: "SlipNumber", label: "Slip Number" },
  { key: "LineNo", label: "Line No", align: "right" },
  { key: "LineID", label: "Line ID" },
  { key: "StockCode", label: "Stock Code", copyable: true },
  { key: "Description", label: "Description" },
  { key: "Selling_Price", label: "Selling Price", align: "right" },
  { key: "Qty", label: "Qty", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Discount_Amount", label: "Discount Amount", align: "right" },
  { key: "Amount", label: "Amount", align: "right" },
  { key: "Net_Amount", label: "Net Amount", align: "right" },
  { key: "Location", label: "Location" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  {
    key: "Buying_Price_Source",
    label: "Buying Price Source",
    format: (value) => formatBuyingPriceSource(value as string | null),
  },
  { key: "Profit", label: "Profit", align: "right" },
  {
    key: "Profit_Margin_Pct",
    label: "Profit Margin %",
    align: "right",
    format: (value) =>
      value === null || value === undefined
        ? "—"
        : `${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
  },
];

interface PurchaseRow {
  Branch: string | null;
  PurchaseNumber: string | null;
  Date: string;
  StockCode: string;
  Description: string;
  Quantity: number | null;
  UOM: string | null;
  Buying_Price: number | null;
  Location: string | null;
}

const PURCHASE_COLUMNS: DataTableColumn<PurchaseRow>[] = [
  { key: "PurchaseNumber", label: "Purchase Number", copyable: true },
  { key: "Branch", label: "Branch" },
  {
    key: "Date",
    label: "Date",
    format: (value) => formatRetailDate(String(value)),
  },
  { key: "StockCode", label: "Stock Code", copyable: true },
  { key: "Description", label: "Description" },
  { key: "Quantity", label: "Quantity", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  { key: "Location", label: "Location" },
];

function App(): React.JSX.Element {
  const showToast = useToast();
  // Restored synchronously rather than in an effect, so the very first render already
  // knows there is a session. Setting it a tick later meant every launch had one render
  // with `session === null`, and the profile effect below reads that as "signed out" and
  // wipes the remembered profile — which is fine online (the fetch refills it) and breaks
  // the app offline, where nothing refills it.
  const [session, setSession] = useState<Session | null>(() =>
    loadStoredSession(),
  );
  // Which Inventory sub-tab to open when the dashboard's "view all" links send the user
  // there — read once on mount by InventoryPage.
  const [inventoryTarget, setInventoryTarget] = useState<{
    tab: InventorySubTab;
    token: number;
  } | null>(null);
  // Unified route state for wholesale records and work pages.
  const [activeRecord, setActiveRecord] = useState<ActiveRecord | null>(null);
  // A note the assistant's source link asked the Knowledge page to open.
  const [knowledgeArticleId, setKnowledgeArticleId] = useState<string | null>(
    null,
  );
  // Records opened from inside another record (an order from a voucher's link icon, say):
  // Back returns to the one before instead of dropping out to the list.
  const [recordBackStack, setRecordBackStack] = useState<ActiveRecord[]>([]);
  // Whether the open order or voucher has edits that are not saved. Leaving it (opening
  // another record, going Back, switching section) asks first, since the page starts over.
  const recordUnsavedRef = useRef(false);
  const reportUnsaved = useCallback((dirty: boolean) => {
    recordUnsavedRef.current = dirty;
  }, []);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  function guardUnsaved(action: () => void): boolean {
    if (!recordUnsavedRef.current) return false;
    setPendingLeave(() => action);
    return true;
  }
  function openRecord(record: ActiveRecord): void {
    if (guardUnsaved(() => openRecord(record))) return;
    if (activeRecord) setRecordBackStack((stack) => [...stack, activeRecord]);
    else setRecordBackStack([]);
    setActiveRecord(record);
  }
  function closeRecord(): void {
    if (guardUnsaved(closeRecord)) return;
    const previous = recordBackStack[recordBackStack.length - 1];
    if (previous) {
      setRecordBackStack((stack) => stack.slice(0, -1));
      setActiveRecord(previous);
    } else {
      setActiveRecord(null);
    }
  }
  function clearRecords(): void {
    setRecordBackStack([]);
    setActiveRecord(null);
  }
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState<
    string | null
  >(null);
  const [selectedSupplierName, setSelectedSupplierName] = useState<
    string | null
  >(null);
  // Bumped each time another page asks for a specific customer/supplier, so a page that
  // stayed open in the background still jumps to it even if the name is unchanged.
  const [customerFocusToken, setCustomerFocusToken] = useState(0);
  const [supplierFocusToken, setSupplierFocusToken] = useState(0);
  const [stockFocusToken, setStockFocusToken] = useState(0);
  function focusCustomer(name: string | null): void {
    setSelectedCustomerName(name);
    setCustomerFocusToken((token) => token + 1);
  }
  function focusStock(code: string | null): void {
    setSelectedStockCode(code);
    setStockFocusToken((token) => token + 1);
  }
  function focusSupplier(name: string | null): void {
    setSelectedSupplierName(name);
    setSupplierFocusToken((token) => token + 1);
  }
  function openWholesaleDashboardDrilldown(
    target: WholesaleDashboardDrilldown,
  ): void {
    setWholesaleDashboardDrilldown((current) => ({
      target,
      token: current.token + 1,
    }));
    handleSectionChange(target.section);
  }
  function clearWholesaleDashboardDrilldown(): void {
    setWholesaleDashboardDrilldown((current) => ({
      ...current,
      target: null,
    }));
  }
  // Wholesale pages that keep their state while you are elsewhere: once visited they stay
  // mounted (hidden) instead of being rebuilt from scratch on every return.
  const [keptSections, setKeptSections] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedStockCode, setSelectedStockCode] = useState<string | null>(
    null,
  );
  // Which branch the Dashboard's Overview tab has open (null = the all-branches page).
  // Held here rather than inside the tab because switching to Revenue unmounts that tab,
  // and coming back should return to the branch you were reading, not to the branch list.
  // Only "← All branches" clears it.
  const [overviewBranchId, setOverviewBranchId] = useState<string | null>(null);
  // Asks the Wholesale Dashboard to open on a tab (a new token each time, so asking twice works).
  const [wholesaleTabRequest, setWholesaleTabRequest] = useState<{
    tab: "health" | null;
    token: number;
  }>({ tab: null, token: 0 });
  // A token makes an insight reapply even when its destination directory has stayed mounted.
  const [wholesaleDashboardDrilldown, setWholesaleDashboardDrilldown] =
    useState<{
      target: WholesaleDashboardDrilldown | null;
      token: number;
    }>({ target: null, token: 0 });
  // Which retail branch the left-nav branch switcher is set to; "" means "All branches".
  // Read by Dashboard, Business Alerts and Warnings so those pages stay in sync with the
  // one sidebar control instead of each keeping its own separate branch filter.
  const [selectedBranchId, setSelectedBranchId] = useState("");
  // Seeded from the last time the server answered, so a launch on a dead connection still
  // knows the role and branch — without which an unscoped account renders as a branch-scoped
  // retail one and every page below it loads the wrong thing (see lib/lastKnown.ts).
  const [profile, setProfile] = useState<Profile | null>(() =>
    readLastKnown<Profile>("profile"),
  );
  const [profileLoading, setProfileLoading] = useState(false);
  // Notices imports and reverts done by other accounts on other machines, so their
  // work invalidates this browser's cached pages too (see useImportedDataWatch). Wholesale has
  // no imports, and the endpoint is retail-only (403), so a wholesale account doesn't watch.
  useImportedDataWatch(profile?.role === "wholesale" ? null : session);
  const [rawSection, setSection] = useState<Section>("dashboard");
  // A question the explain bubble hands to the assistant; a new id is a new request.
  const [assistantAsk, setAssistantAsk] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return stored === "wholesale" ? "wholesale" : "retail";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A queue rather than a single value so picking several files at once (see
  // FileImportCard) reviews them one after another instead of only ever the first.
  // `pendingImportQueueTotal` is the size the queue started at, kept separately since the
  // queue itself shrinks as each file is confirmed or skipped — it's what lets
  // ImportReviewPage show "File 2 of 5" instead of just "File 2".
  const [pendingImportQueue, setPendingImportQueue] = useState<PendingImport[]>(
    [],
  );
  const [pendingImportQueueTotal, setPendingImportQueueTotal] = useState(0);
  const pendingImport = pendingImportQueue[0] ?? null;
  const [viewingBatchId, setViewingBatchId] = useState<string | null>(null);
  const [highlightBatchId, setHighlightBatchId] = useState<string | null>(null);
  const [importInitialTab, setImportInitialTab] = useState<
    "import" | "history" | "health"
  >("import");
  const [dataOverviewTab, setDataOverviewTab] =
    useState<DataOverviewSubTab>("overview");
  // Business-wide (app_settings table) — same values for every account and device.
  // `settings` is null until the fetch resolves, so every read below falls back to the
  // backend's own DEFAULT_SETTINGS value for that key.
  const { settings, updateSettings } = useAppSettings(session);
  // An alert on the Business Alerts page counts a longer stretch of days than the Warning
  // page's own setting, so its "see the records" link opens the Warning page on the
  // alert's days instead — otherwise the alert says there is a problem the page can't
  // show. Cleared again whenever the section changes.
  const [warningsTab, setWarningsTab] = useState<
    "Inventory" | "Sale" | "Purchase" | "Zero selling" | "Salary" | null
  >(null);
  const [warningWindowOverride, setWarningWindowOverride] = useState<
    number | null
  >(null);
  const saleWindowDays =
    warningWindowOverride ?? settings?.sale_warning_window_days ?? 1;
  const purchaseWindowDays =
    warningWindowOverride ?? settings?.purchase_warning_window_days ?? 1;
  const saleListWindowDays = settings?.sale_list_window_days ?? 90;
  const purchaseListWindowDays = settings?.purchase_list_window_days ?? 90;
  const showBuyingPriceSource = settings?.show_buying_price_source ?? true;

  const saleColumns = useMemo(
    () =>
      showBuyingPriceSource
        ? SALE_COLUMNS
        : SALE_COLUMNS.filter((col) => col.key !== "Buying_Price_Source"),
    [showBuyingPriceSource],
  );

  // Restore the stored session on launch, then keep its access token fresh: a Neon Auth
  // JWT lasts 15 minutes, so without this the app would start failing requests while
  // someone was still looking at it. A refresh that fails means the session itself is
  // gone, which is the only case that returns to the sign-in screen.
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    const stopRetry = installAuthRetry(
      () => sessionRef.current,
      (next) => setSession(next),
    );
    // Installed *after* the auth patch on purpose, so the wrappers nest as
    // network → auth → real fetch: a read retried after a dropout still passes through
    // the token-refresh layer on its way out.
    const stopNetwork = installNetworkResilience();
    const stopRefresh = startSessionRefresh(
      () => sessionRef.current,
      (next) => setSession(next),
    );
    return () => {
      stopRefresh();
      stopNetwork();
      stopRetry();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    // Only block the app on the *first* profile load. Supabase refreshes the access
    // token whenever the window regains focus, which fires onAuthStateChange, which
    // re-runs this effect — and showing the full-screen spinner then unmounts every page
    // below, throwing away which tab you were on, which branch you had open, and every
    // filter you had set. Switching to another app and back should not reset the app.
    if (profile === null) setProfileLoading(true);
    fetch(`${apiBaseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (r) => (r.ok ? ((await r.json()) as Profile) : null))
      .then((fetched) => {
        setProfile(fetched);
        // The server answered: whatever it said is now the truth to remember, including
        // "this account has no profile".
        if (fetched) writeLastKnown("profile", fetched);
        else forgetLastKnown("profile");
      })
      .catch(() => {
        // Couldn't reach the server. Keep whatever we last knew rather than deciding the
        // account has no role — that decision is what breaks the app while offline.
      })
      .finally(() => setProfileLoading(false));
    // `profile` is read to decide whether this is the first load; adding it to the deps
    // would re-fetch every time the fetch itself sets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Cross-branch roles see every branch's data, so their filter
  // dropdowns should offer every real branch — not just ones with rows currently loaded.
  // Branch-scoped accounts never see other branches' data at all, so we skip the fetch
  // for them; SimpleDataTable/ImportHistoryTable/DataOverviewTable fall back to deriving
  // options from loaded rows, which naturally hides a pointless single-branch filter.
  const isDevelopment = profile !== null && profile.role === "development";
  const isAdmin = profile !== null && profile.role === "admin";
  // Wholesale runs on a completely separate workflow than retail (its own product codes,
  // customer orders, factory vouchers) — none of the import/sale/inventory/purchase/
  // history/overview screens apply to it, so a wholesale account only sees the wholesale
  // nav. Development sees both workspaces; admin is limited to its retail dashboard views.
  const isWholesale = profile !== null && profile.role === "wholesale";
  const isRetailUser = profile !== null && profile.role === "retail";
  const isRetailManagement =
    profile !== null && profile.role === "retail_management";
  const canManageRetail = isDevelopment || isAdmin || isRetailManagement;
  // A retail account with no branch of its own picks one in the sidebar, as admin does.
  const isBranchlessRetail = isRetailUser && profile.branch_id === null;
  const canPickBranch = canManageRetail || isBranchlessRetail;
  const canAccessAllWorkspaces = isDevelopment || isAdmin;
  // A role scoped to a single workspace is always in that workspace — only development or admin (who sees
  // both) actually uses the switcher state below.
  const effectiveWorkspace: Workspace = isWholesale
    ? "wholesale"
    : !canAccessAllWorkspaces
      ? "retail"
      : workspace;
  // If the current section doesn't belong to the active workspace (first render before the
  // workspace is known, or right after switching workspaces), fall back to that workspace's
  // first item. Derived at render time (not corrected after the fact via an effect) so
  // there's no frame where the wrong workspace's UI briefly renders before a correction
  // catches up.
  const section: Section =
    (rawSection === "settings" ||
      rawSection === "userManagement" ||
      rawSection === "knowledge") &&
    (isAdmin || isDevelopment)
      ? rawSection
      : isRetailUser
        ? RETAIL_ROLE_SECTION_IDS.has(rawSection)
          ? rawSection
          : "import"
        : isWholesale
          ? WHOLESALE_SECTION_IDS.has(rawSection)
            ? rawSection
            : "monitoring"
          : WORKSPACE_SECTION_IDS[effectiveWorkspace].has(rawSection)
            ? rawSection
            : (WORKSPACE_NAV_ITEMS[effectiveWorkspace][0].id as Section);
  const branchOptions = useBranches(canPickBranch ? session : null);
  const retailBranchOptions = useRetailBranchOptions(
    canPickBranch ? session : null,
  );
  // Warnings filters by branch name, not id (see WarningsPage) — resolved once here
  // rather than in that page so it stays a plain prop.
  const selectedBranchName =
    retailBranchOptions.find((branch) => branch.id === selectedBranchId)
      ?.name ?? "";

  // The Business Alerts badge, counted from the same per-branch overview payloads the
  // Dashboard and the Business Alerts page read — so this costs one set of requests that
  // then makes both of those pages open instantly, rather than a separate count endpoint
  // whose work would be thrown away.
  const businessAlertUrls = useMemo(() => {
    if (isWholesale || isRetailUser) return [];
    const branchIds = canManageRetail
      ? retailBranchOptions.map((branch) => branch.id)
      : profile?.branch_id
        ? [profile.branch_id]
        : [];
    // The default window both pages open on, so the badge and the page agree.
    return branchIds.map((id) =>
      dashboardUrl("overview", id, { period: "30d", dateFrom: "", dateTo: "" }),
    );
  }, [
    canManageRetail,
    isWholesale,
    isRetailUser,
    profile?.branch_id,
    retailBranchOptions,
  ]);

  // Alerts depend on the clock as well as on imports (a missing-file alert only appears
  // after the daily cutoff), and the long default cache never notices the clock — so the
  // badge re-asks every ten minutes, the same span the backend caches the answer for.
  const { data: branchHealth } = useUrlQueries<OverviewData>(
    businessAlertUrls,
    session,
    "business alerts",
    { everyMs: 10 * 60 * 1000 },
  );
  // Every alert the Business Alerts page lists — its headline count — so the badge and
  // that page always show the same number. It follows the left-nav branch switcher the
  // way that page does: one branch chosen counts only that branch, "All branches" counts
  // them all.
  const businessAlertCount = useMemo(
    () =>
      Object.values(branchHealth)
        .filter(
          (branch) =>
            !selectedBranchId || branch.branch_id === selectedBranchId,
        )
        .reduce((total, branch) => total + branch.alerts.length, 0),
    [branchHealth, selectedBranchId],
  );

  const navItems = useMemo(() => {
    if (isRetailUser) {
      return RETAIL_ROLE_NAV_ITEMS;
    }
    if (isWholesale) return WHOLESALE_NAV_ITEMS;
    const items = WORKSPACE_NAV_ITEMS[effectiveWorkspace].map((item) => {
      if (item.id === "businessAlerts")
        return { ...item, badgeCount: businessAlertCount };
      return item;
    });
    return canAccessAllWorkspaces
      ? [
          ...items,
          {
            id: "userManagement",
            label: "User Management",
            shortLabel: "Users",
            icon: <UsersIcon />,
          },
        ]
      : items;
  }, [
    canAccessAllWorkspaces,
    isRetailUser,
    isWholesale,
    effectiveWorkspace,
    businessAlertCount,
  ]);

  useEffect(() => {
    // A page that has been visited stays built (hidden) so its filters, search and tab are still
    // there when you come back; see features/shell/KeptPage.tsx.
    const group = keptGroupFor(section);
    if (!group) return;
    const isWholesaleGroup = [
      "customers",
      "suppliers",
      "products",
      "monitoring",
    ].includes(group);
    if ((workspace === "wholesale") !== isWholesaleGroup) return;
    setKeptSections((prev) =>
      prev.has(group) ? prev : new Set(prev).add(group),
    );
  }, [workspace, section]);

  // Opens the page behind an assistant source. A wholesale page belongs to the other
  // workspace for an account that can use both, so switch to it first.
  function handleAssistantNavigate(route: string): void {
    // "knowledge:<article id>" opens that note; any other route is a section id.
    const [id, articleId] = route.split(":");
    if (id === "knowledge" && articleId) setKnowledgeArticleId(articleId);
    const target: Workspace =
      WORKSPACE_SECTION_IDS.wholesale.has(id) &&
      !WORKSPACE_SECTION_IDS.retail.has(id)
        ? "wholesale"
        : "retail";
    // Knowledge belongs to neither workspace (like Settings), so it opens where the reader is.
    if (
      id !== "knowledge" &&
      id !== "settings" &&
      canAccessAllWorkspaces &&
      target !== effectiveWorkspace
    ) {
      handleWorkspaceChange(target);
    }
    handleSectionChange(id);
  }

  function handleWorkspaceChange(id: string): void {
    const next = id as Workspace;
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(null);
    clearRecords();
    setSelectedCustomerName(null);
    setSelectedSupplierName(null);
    setKeptSections(new Set());
    setSelectedStockCode(null);
    setWorkspace(next);
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
    // Wholesale opens on its Dashboard, the same place picking a retail branch lands.
    setSection(
      next === "wholesale"
        ? "monitoring"
        : (WORKSPACE_NAV_ITEMS[next][0].id as Section),
    );
  }

  // Opens Wholesale's Health tab — the Wholesale card among the branches' health cards leads here.
  function openWholesaleHealth(): void {
    handleWorkspaceChange("wholesale");
    setWholesaleTabRequest((current) => ({
      tab: "health",
      token: current.token + 1,
    }));
  }

  // Wholesale is a branch too, picked from the same selector as the retail branches. Choosing it
  // switches to Wholesale's Dashboard; choosing a retail branch (or all of them) from there
  // switches back to Retail.
  function handleBranchSelect(value: string): void {
    if (value === WHOLESALE_BRANCH_VALUE) {
      if (effectiveWorkspace !== "wholesale")
        handleWorkspaceChange("wholesale");
      return;
    }
    if (effectiveWorkspace === "wholesale") handleWorkspaceChange("retail");
    setSelectedBranchId(value);
  }

  // Desktop Global Shortcuts (Cmd on Mac, Ctrl on Windows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isModifier = e.metaKey || e.ctrlKey;

      // Global search shortcut: Cmd+K or Ctrl+K (in Wholesale workspace)
      if (isModifier && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (effectiveWorkspace === "wholesale") {
          setSearchOpen(true);
        }
        return;
      }

      // Settings shortcut: Cmd+, or Ctrl+,
      if (isModifier && e.key === ",") {
        e.preventDefault();
        setSection("settings");
        return;
      }

      // Sidebar toggle shortcut: Cmd+B or Ctrl+B
      if (isModifier && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("branchwise:toggle-sidebar"));
        return;
      }

      // Workspace toggle shortcut: Cmd+1 / Ctrl+1 (Retail), Cmd+2 / Ctrl+2 (Wholesale)
      if (canAccessAllWorkspaces && isModifier && e.key === "1") {
        e.preventDefault();
        handleWorkspaceChange("retail");
        return;
      }

      if (canAccessAllWorkspaces && isModifier && e.key === "2") {
        e.preventDefault();
        handleWorkspaceChange("wholesale");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canAccessAllWorkspaces, effectiveWorkspace]);

  // Listen to native app menu commands
  useEffect(() => {
    const cleanup = window.api?.onMenuAction((action) => {
      if (action === "open-settings") {
        setSection("settings");
      }
    });
    return () => cleanup?.();
  }, []);

  // Sync titleBarOverlay on Windows
  useEffect(() => {
    if (!window.api?.isWindows) return;

    const isDark =
      settings?.theme === "dark" ||
      (settings?.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    // Retail and wholesale share one colour now, so the overlay no longer branches on
    // effectiveWorkspace — only light/dark still changes it.
    const bgHex = isDark ? "#17191f" : "#ffffff";
    const symbolHex = isDark ? "#ecebf0" : "#111827";

    window.api.updateTitleBarOverlay({
      color: bgHex,
      symbolColor: symbolHex,
    });
  }, [settings?.theme]);

  const saleFilters: DataTableFilter<SaleRow>[] = useMemo(
    () => [
      {
        type: "search",
        keys: ["StockCode", "Description"],
        placeholder: "Stock code or description",
        serverParam: "search",
      },
      {
        type: "dateRange",
        key: "Date",
        label: "Date",
        serverParam: { from: "date_from", to: "date_to" },
      },
    ],
    [],
  );

  const purchaseFilters: DataTableFilter<PurchaseRow>[] = useMemo(
    () => [
      {
        type: "search",
        keys: ["StockCode", "Description"],
        placeholder: "Stock code or description",
        serverParam: "search",
      },
      {
        type: "dateRange",
        key: "Date",
        label: "Date",
        serverParam: { from: "date_from", to: "date_to" },
      },
    ],
    [],
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      setSession(await signIn(email, password));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Sign-in failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDemoLogin(demoEmail: string): Promise<void> {
    if (!import.meta.env.DEV || !DEV_PASSWORD) return;
    try {
      setSession(await signIn(demoEmail, DEV_PASSWORD));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Sign-in failed",
      );
    }
  }

  async function handleSignOut(): Promise<void> {
    await signOut(session);
    setSession(null);
    // Drop every cached page: the next account may be scoped to a different branch, and
    // serving it this one's numbers would be both wrong and a disclosure.
    clearQueryCache();
    clearLastKnown();
    setProfile(null);
    setOverviewBranchId(null);
  }

  function handleSectionChange(id: string): void {
    if (guardUnsaved(() => handleSectionChange(id))) return;
    setWarningWindowOverride(null);
    setWarningsTab(null);
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(null);
    if (id === "import") {
      setImportInitialTab("import");
      setSection("import");
      return;
    }
    if (id === "history") {
      setImportInitialTab("history");
      setSection("import");
      return;
    }
    if (id === "importOverview") {
      setImportInitialTab("health");
      setSection("import");
      return;
    }
    if (id === "sales") {
      setDataOverviewTab("sale");
      setSection("overview");
      return;
    }
    if (id === "inventory") {
      setDataOverviewTab("inventory");
      setSection("overview");
      return;
    }
    if (id === "purchase") {
      setDataOverviewTab("purchase");
      setSection("overview");
      return;
    }
    if (id === "overview") {
      setDataOverviewTab("overview");
      setSection("overview");
      return;
    }
    clearRecords();
    setSection(id as Section);
  }

  // The single-file flows (Import History's "Reimport", Warning page's "Import to fix")
  // — always exactly one file replacing one specific batch, so no queue indicator.
  function handleFileReady(pending: PendingImport): void {
    setPendingImportQueue([pending]);
    setPendingImportQueueTotal(0);
  }

  // The main Import grid's FileImportCard, which can hand back several files from one
  // pick — each still gets its own review/confirm step, one after another.
  function handleFilesReady(pendings: PendingImport[]): void {
    setPendingImportQueue(pendings);
    setPendingImportQueueTotal(pendings.length);
  }

  // Jumps from a Warning row's "Source Import" link to that exact batch's row in Import
  // History — the list, not the read-only detail view, since Revert lives on the row
  // itself. Highlighting it saves hunting through the list for the right one to revert.
  function handleViewImportBatch(batchId: string): void {
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(batchId);
    setImportInitialTab("history");
    setSection("import");
  }

  function handleImportConfirmed(summary: Record<string, unknown>): void {
    const justConfirmed = pendingImportQueue[0];
    showToast(
      "success",
      justConfirmed?.revertBatchId
        ? `${justConfirmed.importLabel} reimported successfully`
        : `${justConfirmed?.importLabel} imported successfully`,
    );
    // Advances to the next queued file rather than clearing outright — an empty queue
    // naturally falls back to the Import grid since `pendingImport` derives from it.
    const isSinglePurchase =
      pendingImportQueue.length === 1 &&
      justConfirmed?.endpoint === "/api/imports/purchase";
    setPendingImportQueue((queue) => queue.slice(1));
    if (isSinglePurchase && typeof summary.batch_id === "string") {
      setViewingBatchId(summary.batch_id);
      setImportInitialTab("history");
      setSection("import");
    }
  }

  if (!session) {
    return (
      <AuthScreen
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
        submitting={submitting}
        onDemoLogin={handleDemoLogin}
        showDemoLogins={import.meta.env.DEV}
      />
    );
  }

  // Which nav/section a signed-in account sees depends on its role (retail vs. wholesale vs.
  // admin, or development), known only once /api/me resolves. Rendering the shell before that would default
  // to the retail nav/section for every role — including wholesale — producing a visible
  // flash of retail UI right after sign-in. Waiting here instead means the shell only ever
  // renders once with the correct role-specific nav.
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center">
        <Spinner className="w-6 h-6 text-text-muted" />
      </div>
    );
  }

  // Import and History share one rendered ImportHubPage, so only those two need to
  // derive their sidebar selection from its active tab. Checking and Settings are
  // independent pages and must keep their own section identity.
  // The import review and a batch's detail page sit on top of the sections, which stay built.
  const overlayOpen = Boolean(pendingImport || viewingBatchId);
  const activeNavSection =
    isRetailUser && (section === "import" || section === "history")
      ? importInitialTab === "history"
        ? "history"
        : "import"
      : section;

  return (
    <AppProviders
      density={workspace === "wholesale" ? "compact" : "default"}
      session={session}
      page={rawSection}
      canExplain={isAdmin || isDevelopment}
      onAskAssistant={(text) => setAssistantAsk({ id: Date.now(), text })}
    >
      <AppShell
        navItems={navItems}
        activeSection={activeNavSection}
        onSectionChange={handleSectionChange}
        activeWorkspace={effectiveWorkspace}
        retailBranches={canPickBranch ? retailBranchOptions : []}
        showWholesaleOption={canAccessAllWorkspaces}
        selectedBranchId={
          canAccessAllWorkspaces && effectiveWorkspace === "wholesale"
            ? WHOLESALE_BRANCH_VALUE
            : selectedBranchId
        }
        onBranchChange={handleBranchSelect}
        email={session.user.email}
        profile={profile}
        onSignOut={handleSignOut}
      >
        {/* One section throwing must not take the window down with it: without this a
          render error unmounts everything and leaves a blank white screen, which is
          neither readable nor debuggable. Keyed on the section so navigating away
          clears it. */}
        <ErrorBoundary resetKey={section} label={SECTION_TITLES[section]}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-24">
                <Spinner className="w-6 h-6 text-text-muted" />
              </div>
            }
          >
            {pendingImport ? (
              <ImportReviewPage
                // Forces a full remount on every distinct file (see PendingImport.id) — the
                // previewed rows, branch pick, and purchase date are all local state that
                // must not carry over from whichever file was just confirmed or skipped.
                key={pendingImport.id}
                session={session}
                profile={profile}
                pending={pendingImport}
                selectedBranchId={selectedBranchId}
                queuePosition={
                  pendingImportQueueTotal > 1
                    ? {
                        index:
                          pendingImportQueueTotal -
                          pendingImportQueue.length +
                          1,
                        total: pendingImportQueueTotal,
                      }
                    : undefined
                }
                onBack={() => setPendingImportQueue((queue) => queue.slice(1))}
                onConfirmed={handleImportConfirmed}
              />
            ) : viewingBatchId ? (
              <ImportHistoryDetailPage
                session={session}
                batchId={viewingBatchId}
                onBack={() => setViewingBatchId(null)}
                profile={profile}
              />
            ) : null}
            {/* The import review and a batch's detail page sit on top of the sections instead of
              replacing them, so Back returns to the list with its search and filters intact. */}
            <div className={overlayOpen ? "hidden" : "contents"}>
              <>
                <KeptPage
                  scrollKey="dashboard"
                  visited={keptSections.has("dashboard")}
                  active={!overlayOpen && section === "dashboard"}
                >
                  <DashboardPage
                    session={session}
                    profile={profile}
                    branchOptions={retailBranchOptions}
                    selectedBranchId={selectedBranchId}
                    onBranchChange={setSelectedBranchId}
                    onViewWarnings={() => handleSectionChange("warnings")}
                    onViewBusinessAlerts={() =>
                      handleSectionChange("businessAlerts")
                    }
                    onViewInventoryList={(tab) => {
                      // InventoryPage reads this once, on mount — same pattern as
                      // dashboardTarget just above.
                      setInventoryTarget((current) => ({
                        tab,
                        token: (current?.token ?? 0) + 1,
                      }));
                      handleSectionChange("inventory");
                    }}
                    overviewBranchId={overviewBranchId}
                    onOverviewBranchChange={setOverviewBranchId}
                    onOpenWholesaleHealth={
                      canAccessAllWorkspaces ? openWholesaleHealth : undefined
                    }
                    showAdvancedTabs
                    onViewChecking={() => {
                      handleSectionChange("warnings");
                    }}
                    onViewImport={() => handleSectionChange("import")}
                  />
                </KeptPage>
                <KeptPage
                  scrollKey="businessAlerts"
                  visited={keptSections.has("businessAlerts")}
                  active={!overlayOpen && section === "businessAlerts"}
                >
                  <BusinessAlertsPage
                    session={session}
                    profile={profile}
                    branchOptions={retailBranchOptions}
                    branchFilter={selectedBranchId}
                    onFileReady={handleFileReady}
                    onOpenDataQuality={(tab, branchId) => {
                      handleSectionChange("warnings");
                      setSelectedBranchId(branchId);
                      setWarningsTab(tab);
                    }}
                  />
                </KeptPage>

                <KeptPage
                  scrollKey="importHub"
                  visited={keptSections.has("importHub")}
                  active={
                    !overlayOpen &&
                    (section === "import" ||
                      section === "history" ||
                      section === "importOverview")
                  }
                >
                  <ImportHubPage
                    session={session}
                    profile={profile}
                    branchOptions={branchOptions}
                    retailBranchOptions={retailBranchOptions}
                    selectedBranchId={selectedBranchId}
                    onFilesReady={handleFilesReady}
                    onFileReady={handleFileReady}
                    onViewBatch={setViewingBatchId}
                    highlightBatchId={highlightBatchId}
                    initialTab={importInitialTab}
                    onTabChange={setImportInitialTab}
                  />
                </KeptPage>
                <KeptPage
                  scrollKey="dataOverview"
                  visited={keptSections.has("dataOverview")}
                  active={
                    !overlayOpen &&
                    (section === "overview" ||
                      section === "sales" ||
                      section === "inventory" ||
                      section === "purchase")
                  }
                >
                  <DataOverviewTable
                    session={session}
                    branchOptions={branchOptions}
                    branchFilter={selectedBranchName}
                    showBuyingPriceSource={showBuyingPriceSource}
                    saleColumns={saleColumns}
                    saleFilters={saleFilters}
                    purchaseColumns={PURCHASE_COLUMNS}
                    purchaseFilters={purchaseFilters}
                    saleListWindowDays={saleListWindowDays}
                    purchaseListWindowDays={purchaseListWindowDays}
                    initialTab={
                      section === "sales"
                        ? "sale"
                        : section === "inventory"
                          ? "inventory"
                          : section === "purchase"
                            ? "purchase"
                            : dataOverviewTab
                    }
                    onTabChange={setDataOverviewTab}
                    inventoryTarget={inventoryTarget}
                  />
                </KeptPage>
                <KeptPage
                  scrollKey="purchasing"
                  visited={keptSections.has("purchasing")}
                  active={!overlayOpen && section === "purchasing"}
                >
                  <PurchasingPage
                    session={session}
                    profile={profile}
                    branchOptions={retailBranchOptions}
                    selectedBranchId={selectedBranchId}
                  />
                </KeptPage>
                <KeptPage
                  scrollKey="warnings"
                  visited={keptSections.has("warnings")}
                  active={!overlayOpen && section === "warnings"}
                >
                  <WarningsPage
                    session={session}
                    profile={profile}
                    saleWindowDays={saleWindowDays}
                    purchaseWindowDays={purchaseWindowDays}
                    branchFilter={selectedBranchName}
                    onViewImportBatch={handleViewImportBatch}
                    onFileReady={handleFileReady}
                    initialTab={warningsTab ?? undefined}
                  />
                </KeptPage>
                {effectiveWorkspace === "wholesale" && activeRecord ? (
                  <RecordHost
                    session={session}
                    activeRecord={activeRecord}
                    onClose={closeRecord}
                    onOpenRecord={openRecord}
                    onUnsavedChange={reportUnsaved}
                  />
                ) : (
                  <>
                    {section === "today" && (
                      <WholesaleTodayDashboard
                        session={session}
                        onOpenRecord={(target) => {
                          if (target.kind === "customer") {
                            focusCustomer(
                              target.referenceNo || target.id || null,
                            );
                            handleSectionChange("customers");
                          } else if (target.kind === "supplier") {
                            focusSupplier(
                              target.referenceNo || target.id || null,
                            );
                            handleSectionChange("suppliers");
                          } else if (target.kind === "product") {
                            focusStock(target.referenceNo || target.id || null);
                            handleSectionChange("products");
                          } else {
                            openRecord(target as ActiveRecord);
                          }
                        }}
                      />
                    )}
                    {section === "settings" && (
                      <SettingsPage
                        session={session}
                        profile={profile}
                        canManageAdvancedSettings={canAccessAllWorkspaces}
                        settings={settings}
                        onUpdateSettings={updateSettings}
                      />
                    )}
                    {section === "knowledge" && (isAdmin || isDevelopment) && (
                      <KnowledgePage
                        session={session}
                        openArticleId={knowledgeArticleId}
                        onOpenArticleHandled={() => setKnowledgeArticleId(null)}
                      />
                    )}
                    {section === "userManagement" &&
                      (isAdmin || isDevelopment) && (
                        <UserManagementPage
                          session={session}
                          profile={profile}
                        />
                      )}
                  </>
                )}
                {effectiveWorkspace === "wholesale" && (
                  <KeptPage
                    scrollKey="customers"
                    visited={keptSections.has("customers")}
                    active={section === "customers" && !activeRecord}
                  >
                    <CustomerPage
                      session={session}
                      initialCustomerName={selectedCustomerName}
                      focusToken={customerFocusToken}
                      dashboardFilter={
                        wholesaleDashboardDrilldown.target?.section ===
                        "customers"
                          ? {
                              filter: wholesaleDashboardDrilldown.target.filter,
                              customerName:
                                wholesaleDashboardDrilldown.target.customerName,
                              token: wholesaleDashboardDrilldown.token,
                            }
                          : undefined
                      }
                      onClearDashboardFilter={clearWholesaleDashboardDrilldown}
                      onOpenOrder={(orderId, tab) => {
                        openRecord({
                          kind: "order",
                          id: orderId,
                          focus: tab,
                        });
                      }}
                      onDeliverOrder={(orderId) => {
                        openRecord({
                          kind: "order",
                          id: orderId,
                          focus: "deliver",
                        });
                      }}
                      onOrderAction={(orderId, action) => {
                        openRecord({
                          kind: "order",
                          id: orderId,
                          focus:
                            action === "payment" ? "recordPayment" : action,
                        });
                      }}
                      onNewSale={(customer) => {
                        openRecord({
                          kind: "newSale",
                          prefill: { customer },
                        });
                      }}
                    />
                  </KeptPage>
                )}
                {effectiveWorkspace === "wholesale" && (
                  <KeptPage
                    scrollKey="suppliers"
                    visited={keptSections.has("suppliers")}
                    active={section === "suppliers" && !activeRecord}
                  >
                    <SupplierPage
                      session={session}
                      initialSupplierName={selectedSupplierName}
                      focusToken={supplierFocusToken}
                      dashboardFilter={
                        wholesaleDashboardDrilldown.target?.section ===
                        "suppliers"
                          ? {
                              filter: wholesaleDashboardDrilldown.target.filter,
                              supplierName:
                                wholesaleDashboardDrilldown.target.supplierName,
                              token: wholesaleDashboardDrilldown.token,
                            }
                          : undefined
                      }
                      onClearDashboardFilter={clearWholesaleDashboardDrilldown}
                      onNewPurchase={(supplier) => {
                        openRecord({
                          kind: "newPurchase",
                          prefill: { supplier },
                        });
                      }}
                      onWhatToBuy={(supplier) => {
                        openRecord({
                          kind: "whatToBuy",
                          prefill: { supplier },
                        });
                      }}
                      onOpenVoucher={(voucherId) => {
                        openRecord({ kind: "voucher", id: voucherId });
                      }}
                      onVoucherAction={(voucherId, focus) => {
                        openRecord({ kind: "voucher", id: voucherId, focus });
                      }}
                    />
                  </KeptPage>
                )}
                {effectiveWorkspace === "wholesale" && (
                  <KeptPage
                    scrollKey="products"
                    visited={keptSections.has("products")}
                    active={section === "products" && !activeRecord}
                  >
                    <ProductPage
                      session={session}
                      initialStockCode={selectedStockCode}
                      focusToken={stockFocusToken}
                      dashboardFilter={
                        wholesaleDashboardDrilldown.target?.section ===
                        "products"
                          ? {
                              filter: wholesaleDashboardDrilldown.target.filter,
                              token: wholesaleDashboardDrilldown.token,
                            }
                          : undefined
                      }
                      onClearDashboardFilter={clearWholesaleDashboardDrilldown}
                      onOpenOrder={(orderId) => {
                        openRecord({ kind: "order", id: orderId });
                      }}
                      onOpenVoucher={(voucherId) => {
                        openRecord({ kind: "voucher", id: voucherId });
                      }}
                      onNewSale={(stockCode, quantity) => {
                        openRecord({
                          kind: "newSale",
                          prefill: { stockCode, quantity },
                        });
                      }}
                      onNewPurchase={(prefill) => {
                        openRecord({ kind: "newPurchase", prefill });
                      }}
                    />
                  </KeptPage>
                )}
                {effectiveWorkspace === "wholesale" && (
                  <KeptPage
                    scrollKey="monitoring"
                    visited={keptSections.has("monitoring")}
                    active={section === "monitoring" && !activeRecord}
                  >
                    <WholesaleMonitoringPage
                      session={session}
                      openTab={wholesaleTabRequest}
                      onOpenCustomer={(name) => {
                        focusCustomer(name);
                        handleSectionChange("customers");
                      }}
                      onOpenDrilldown={openWholesaleDashboardDrilldown}
                    />
                  </KeptPage>
                )}
              </>
            </div>
          </Suspense>
        </ErrorBoundary>

        {effectiveWorkspace === "wholesale" && (
          <WholesaleSearchModal
            session={session}
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelect={(target) => {
              if (target.kind === "customer") {
                focusCustomer(target.referenceNo || target.id || null);
                handleSectionChange("customers");
              } else if (target.kind === "supplier") {
                focusSupplier(target.referenceNo || target.id || null);
                handleSectionChange("suppliers");
              } else if (target.kind === "product") {
                focusStock(target.referenceNo || target.id || null);
                handleSectionChange("products");
              } else {
                openRecord({
                  kind: target.kind,
                  id: target.id,
                  referenceNo: target.referenceNo,
                });
              }
            }}
          />
        )}
        <LeaveConfirm
          open={pendingLeave !== null}
          onStay={() => setPendingLeave(null)}
          onLeave={() => {
            const action = pendingLeave;
            setPendingLeave(null);
            recordUnsavedRef.current = false;
            action?.();
          }}
        />
        <ChatLauncher
          session={session}
          profile={profile}
          contextPage={rawSection}
          currentBranchId={selectedBranchId || profile?.branch_id || null}
          onNavigate={handleAssistantNavigate}
          onOpenKnowledge={
            isAdmin || isDevelopment
              ? () => handleAssistantNavigate("knowledge")
              : undefined
          }
          askRequest={assistantAsk}
        />
      </AppShell>
    </AppProviders>
  );
}

export default App;
