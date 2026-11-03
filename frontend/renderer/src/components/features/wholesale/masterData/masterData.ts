import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchJson,
  queryClient,
  useLoadErrorToast,
} from "@renderer/lib/queryClient";
import { type Session } from "@renderer/lib/auth";
import { invalidateWholesale } from "../shared/queryKeys";
import {
  CARRIERS_URL,
  FEE_TYPES_URL,
  CUSTOMERS_URL,
  PLACES_URL,
  productsFromWire,
  SUPPLIERS_URL,
  WHOLESALE_PRODUCTS_URL,
  type WholesaleCustomerWire,
  type WholesaleNamedEntityWire,
  type WholesaleProductWire,
} from "../shared/api";
import {
  createWholesaleCustomer,
  createWholesaleNamedEntity,
  createWholesaleProduct,
  updateWholesaleNamedEntity,
  type NewWholesaleProductInput,
} from "./masterDataApi";
import { type Product } from "../shared/products";

interface MasterDataCustomer {
  name: string;
  phone: string;
  address: string;
}

const initialProducts: Product[] = [
  {
    stock_code: "A1001",
    description: "Men's leather sandal",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "A1002",
    description: "Men's slipper",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "A1003",
    description: "Men's sport sandal",
    product_group: "man",
    default_unit: "set",
  },
  {
    stock_code: "B2001",
    description: "Ladies' flat sandal",
    product_group: "lady",
    default_unit: "set",
  },
  {
    stock_code: "B2002",
    description: "Ladies' heel sandal",
    product_group: "lady",
    default_unit: "set",
  },
  {
    stock_code: "C3001",
    description: "Kids' school shoe",
    product_group: "child",
    default_unit: "set",
  },
  {
    stock_code: "C3002",
    description: "Kids' sandal",
    product_group: "child",
    default_unit: "set",
  },
  {
    stock_code: "D4001",
    description: "Ladies' rubber slipper",
    product_group: "lady",
    default_unit: "set",
  },
];

const SEED_PRODUCTS: Product[] = [...initialProducts];
export const STOCK_CODES: string[] = initialProducts.map(
  (product) => product.stock_code,
);
export const SUPPLIER_NAMES = [
  "Goody Factory",
  "Lek",
  "Nilin",
  "Maldini",
  "Panda Shoes",
];
export const KNOWN_CUSTOMERS: MasterDataCustomer[] = [
  {
    name: "Customer Alpha",
    phone: "555-0101",
    address: "100 Commercial Avenue, Suite 24",
  },
  {
    name: "Customer Beta",
    phone: "555-0102",
    address: "112 Harbor Blvd, Metro City",
  },
  {
    name: "Customer Gamma",
    phone: "555-0103",
    address: "Central Market, West District",
  },
  {
    name: "Customer Delta",
    phone: "555-0104",
    address: "River Road, Port Town",
  },
  {
    name: "Customer Epsilon",
    phone: "555-0105",
    address: "5th District, Metro City",
  },
  { name: "Customer Zeta", phone: "555-0106", address: "78th Street, North City" },
];
/** Everyone who carries goods: a cargo company, or a driver between two towns. One list. */
const CARRIER_NAMES = [
  "Apex Logistics",
  "Metro Freight",
  "Summit Express",
  "Oceanic Haulage",
  "U Hla Myint",
  "Ko Zaw Lin",
  "Ma Khin Khin",
  "U Kyaw Thu",
];
/** What a cost was for. One list, picked from; a new kind is added where it is typed. */
const FEE_TYPE_NAMES = [
  "Carrier fee",
  "Porters",
  "Gate handling",
  "Second trip",
  "Other",
];
/** Every place goods can be: stops, receiving gates, warehouses. One list, picked from. */
export const PLACE_NAMES = [
  "Downtown Gate",
  "Market Street Gate",
  "Harbor Blvd Gate",
  "Yangon",
  "Mandalay",
  "Magway",
  "Mawlamyine",
  "Bago",
];

interface MasterDataState {
  products: Product[];
  suppliers: string[];
  customers: MasterDataCustomer[];
  carriers: string[];
  places: string[];
  warehousePlaces: string[];
  feeTypes: string[];
}

let state: MasterDataState = {
  products: SEED_PRODUCTS,
  suppliers: SUPPLIER_NAMES,
  customers: KNOWN_CUSTOMERS,
  carriers: CARRIER_NAMES,
  places: PLACE_NAMES,
  warehousePlaces: [],
  feeTypes: FEE_TYPE_NAMES,
};
const listeners = new Set<() => void>();

function replace<T>(target: T[], rows: T[]): void {
  target.splice(0, target.length, ...rows);
}

function publish(patch: Partial<MasterDataState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The session of the page that loaded the lists, so a place can be added where it is typed.
let activeSession: Session | null = null;

export type NameList = "places" | "suppliers" | "carriers" | "feeTypes";

const LIST_PATHS: Record<NameList, string> = {
  places: "places",
  suppliers: "suppliers",
  carriers: "carriers",
  feeTypes: "fee-types",
};

const LIST_ARRAYS: Record<NameList, string[]> = {
  places: PLACE_NAMES,
  suppliers: SUPPLIER_NAMES,
  carriers: CARRIER_NAMES,
  feeTypes: FEE_TYPE_NAMES,
};

/** One of the lists a name is picked from, kept up to date: a name added anywhere shows in
 *  every box that uses the list. */
export function useNameList(list: NameList): string[] {
  return useSyncExternalStore(subscribe, () => state)[list];
}

/** Places currently marked as warehouses, for showing likely destinations first. */
export function useWarehousePlaces(): string[] {
  return useSyncExternalStore(subscribe, () => state).warehousePlaces;
}

/** Adds a name to a list. If it is already there (ignoring case) the existing name is used. */
export async function addToList(
  list: NameList,
  name: string,
  extra?: { is_warehouse?: boolean },
): Promise<string> {
  const wanted = name.trim();
  const target = LIST_ARRAYS[list];
  const existing = target.find(
    (entry) => entry.toLowerCase() === wanted.toLowerCase(),
  );
  if (existing) {
    if (list === "places" && extra?.is_warehouse) {
      if (
        !state.warehousePlaces.some(
          (entry) => entry.toLowerCase() === existing.toLowerCase(),
        )
      ) {
        const nextWarehouses = [...state.warehousePlaces, existing].sort((a, b) =>
          a.localeCompare(b),
        );
        replace(state.warehousePlaces, nextWarehouses);
        publish({ warehousePlaces: nextWarehouses });
      }
    }
    return existing;
  }
  if (!activeSession) throw new Error("Not signed in.");
  await createWholesaleNamedEntity(activeSession, LIST_PATHS[list], {
    name: wanted,
    is_warehouse: extra?.is_warehouse,
  });
  replace(
    target,
    [...target, wanted].sort((a, b) => a.localeCompare(b)),
  );
  const patch: Partial<MasterDataState> = { [list]: target };
  if (list === "places" && extra?.is_warehouse) {
    const nextWarehouses = [...state.warehousePlaces, wanted].sort((a, b) =>
      a.localeCompare(b),
    );
    replace(state.warehousePlaces, nextWarehouses);
    patch.warehousePlaces = nextWarehouses;
  }
  publish(patch);
  void invalidateWholesale(queryClient);
  return wanted;
}

/** Updates a place's warehouse status in the database and updates local master data state. */
export async function setPlaceWarehouse(
  name: string,
  isWarehouse: boolean,
): Promise<void> {
  if (!activeSession) throw new Error("Not signed in.");
  const wires = await fetchJson<WholesaleNamedEntityWire[]>(
    PLACES_URL,
    activeSession,
  );
  const target = wires.find(
    (wire) => wire.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!target) return;
  const id = String(target.place_id ?? target.id ?? "");
  if (!id) return;
  await updateWholesaleNamedEntity(activeSession, "places", id, {
    is_warehouse: isWarehouse,
  });
  const current = state.warehousePlaces;
  const next = isWarehouse
    ? [
        ...current.filter(
          (entry) => entry.toLowerCase() !== target.name.toLowerCase(),
        ),
        target.name,
      ].sort((a, b) => a.localeCompare(b))
    : current.filter(
        (entry) => entry.toLowerCase() !== target.name.toLowerCase(),
      );
  replace(state.warehousePlaces, next);
  publish({ warehousePlaces: next });
  void invalidateWholesale(queryClient);
}

/** The stock codes, kept up to date: a product added anywhere shows in every product box. */
export function useStockCodes(): string[] {
  useSyncExternalStore(subscribe, () => state);
  return STOCK_CODES;
}

/** The customers' names, kept up to date. */
export function useCustomerNames(): string[] {
  const { customers } = useSyncExternalStore(subscribe, () => state);
  return customers.map((customer) => customer.name);
}

/** Adds a product to the catalog and to every product box. */
export async function addProduct(
  input: NewWholesaleProductInput,
): Promise<Product> {
  if (!activeSession) throw new Error("Not signed in.");
  const wire = await createWholesaleProduct(activeSession, input);
  const [product] = productsFromWire([wire]);
  replace(SEED_PRODUCTS, [...SEED_PRODUCTS, product]);
  replace(STOCK_CODES, [...STOCK_CODES, product.stock_code]);
  publish({ products: SEED_PRODUCTS });
  return product;
}

/** Adds a customer (name, and phone and address if they are known) to the list. */
export async function addCustomer(input: {
  name: string;
  phone: string;
  address: string;
}): Promise<MasterDataCustomer> {
  if (!activeSession) throw new Error("Not signed in.");
  const wire = await createWholesaleCustomer(activeSession, input);
  const customer = {
    name: wire.name,
    phone: wire.phone,
    address: wire.address,
  };
  replace(KNOWN_CUSTOMERS, [...KNOWN_CUSTOMERS, customer]);
  publish({ customers: KNOWN_CUSTOMERS });
  return customer;
}

function useMasterData(): MasterDataState {
  return useSyncExternalStore(subscribe, () => state);
}

export function productOf(stockCode: string): Product | undefined {
  const code = stockCode.trim().toUpperCase();
  return SEED_PRODUCTS.find((product) => product.stock_code === code);
}

function hydrateProducts(wires: WholesaleProductWire[]): void {
  const products = productsFromWire(wires);
  replace(SEED_PRODUCTS, products);
  replace(
    STOCK_CODES,
    products.map((product) => product.stock_code),
  );
  publish({ products: SEED_PRODUCTS });
}

function hydrateNames(
  target: string[],
  wires: WholesaleNamedEntityWire[],
  key: keyof MasterDataState,
): void {
  const names = wires.map((wire) => wire.name);
  replace(target, names);
  publish({ [key]: target } as Partial<MasterDataState>);
}

function hydrateSuppliers(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(SUPPLIER_NAMES, wires, "suppliers");
}
function hydrateCarriers(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(CARRIER_NAMES, wires, "carriers");
}
function hydrateFeeTypes(wires: WholesaleNamedEntityWire[]): void {
  hydrateNames(FEE_TYPE_NAMES, wires, "feeTypes");
}
function hydratePlaces(wires: WholesaleNamedEntityWire[]): void {
  const names = wires.map((wire) => wire.name);
  replace(PLACE_NAMES, names);
  publish({
    places: PLACE_NAMES,
    warehousePlaces: wires
      .filter((wire) => wire.is_warehouse === true)
      .map((wire) => wire.name),
  });
}

function hydrateCustomers(wires: WholesaleCustomerWire[]): void {
  const customers = wires.map(({ name, phone, address }) => ({
    name,
    phone,
    address,
  }));
  replace(KNOWN_CUSTOMERS, customers);
  publish({ customers: KNOWN_CUSTOMERS });
}

/** Fetches all reference data once for whichever wholesale page is open. */
export function useHydrateMasterData(session: Session): void {
  const products = useQuery({
    queryKey: ["wholesale", "master-data", "products"],
    queryFn: () =>
      fetchJson<WholesaleProductWire[]>(WHOLESALE_PRODUCTS_URL, session),
  });
  const suppliers = useQuery({
    queryKey: ["wholesale", "master-data", "suppliers"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(SUPPLIERS_URL, session),
  });
  const customers = useQuery({
    queryKey: ["wholesale", "master-data", "customers"],
    queryFn: () => fetchJson<WholesaleCustomerWire[]>(CUSTOMERS_URL, session),
  });
  const carriers = useQuery({
    queryKey: ["wholesale", "master-data", "carriers"],
    queryFn: () => fetchJson<WholesaleNamedEntityWire[]>(CARRIERS_URL, session),
  });
  const places = useQuery({
    queryKey: ["wholesale", "master-data", "places"],
    queryFn: () => fetchJson<WholesaleNamedEntityWire[]>(PLACES_URL, session),
  });
  const feeTypes = useQuery({
    queryKey: ["wholesale", "master-data", "fee-types"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(FEE_TYPES_URL, session),
  });
  activeSession = session;

  useMasterData();
  useLoadErrorToast(
    products.isError ||
      suppliers.isError ||
      customers.isError ||
      carriers.isError ||
      feeTypes.isError ||
      places.isError,
    "wholesale master data",
  );
  useEffect(() => {
    if (Array.isArray(products.data)) hydrateProducts(products.data);
  }, [products.data]);
  useEffect(() => {
    if (Array.isArray(suppliers.data)) hydrateSuppliers(suppliers.data);
  }, [suppliers.data]);
  useEffect(() => {
    if (Array.isArray(customers.data)) hydrateCustomers(customers.data);
  }, [customers.data]);
  useEffect(() => {
    if (Array.isArray(carriers.data)) hydrateCarriers(carriers.data);
  }, [carriers.data]);
  useEffect(() => {
    if (Array.isArray(places.data)) hydratePlaces(places.data);
  }, [places.data]);
  useEffect(() => {
    if (Array.isArray(feeTypes.data)) hydrateFeeTypes(feeTypes.data);
  }, [feeTypes.data]);
}
