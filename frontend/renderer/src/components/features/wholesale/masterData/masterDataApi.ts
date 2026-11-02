// The Master Data screen's writes: wholesale products, suppliers, customers, and the
// small "just a name" entities (cargo companies, carriers, destinations, receiving gates).

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import { type Product } from "../shared/products";
import { type Unit, type UnitConversions } from "../shared/units";

export interface WholesaleProductWire {
  product_id: string;
  stock_code: string;
  description: string;
  product_group: Product["product_group"];
  default_unit: Unit;
  default_unit_conversions: UnitConversions;
  default_selling_price: number;
  default_buying_price: number;
  active: boolean;
}

export interface WholesaleCustomerWire {
  customer_id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
}

export interface WholesaleSupplierWire {
  supplier_id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
}

export interface WholesaleNamedEntityWire {
  name: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export const WHOLESALE_PRODUCTS_URL = `${apiBaseUrl}/api/wholesale/products`;
export const SUPPLIERS_URL = `${apiBaseUrl}/api/wholesale/suppliers`;
export const CUSTOMERS_URL = `${apiBaseUrl}/api/wholesale/customers`;
export const CARRIERS_URL = `${apiBaseUrl}/api/wholesale/carriers`;
export const FEE_TYPES_URL = `${apiBaseUrl}/api/wholesale/fee-types`;

export const PLACES_URL = `${apiBaseUrl}/api/wholesale/places`;

export function productsFromWire(wires: WholesaleProductWire[]): Product[] {
  return wires
    .filter((wire) => wire.active)
    .map(
      ({
        stock_code,
        description,
        product_group,
        default_unit,
        default_unit_conversions,
        default_selling_price,
        default_buying_price,
      }) => ({
        stock_code,
        description,
        product_group,
        default_unit,
        default_unit_conversions,
        default_selling_price,
        default_buying_price,
      }),
    );
}

export interface NewWholesaleProductInput {
  stock_code: string;
  description: string;
  product_group: Product["product_group"];
  default_unit?: Unit;
  default_unit_conversions?: UnitConversions;
  default_selling_price?: number;
  default_buying_price?: number;
}

export async function createWholesaleProduct(
  session: Session,
  input: NewWholesaleProductInput,
): Promise<WholesaleProductWire> {
  return request<WholesaleProductWire>(session, "/api/wholesale/products", {
    method: "POST",
    body: input,
  });
}

export async function updateWholesaleProduct(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleProductInput> & { active?: boolean },
): Promise<WholesaleProductWire> {
  return request<WholesaleProductWire>(
    session,
    `/api/wholesale/products/${id}`,
    { method: "PATCH", body: patch },
  );
}

interface NewWholesaleSupplierInput {
  name: string;
  phone: string;
  address: string;
}
interface NewWholesaleCustomerInput {
  name: string;
  phone: string;
  address: string;
}
interface NewWholesaleNamedEntityInput {
  name: string;
  /** Places only: goods counted here are already in stock. */
  is_warehouse?: boolean;
}

export async function createWholesaleSupplier(
  session: Session,
  input: NewWholesaleSupplierInput,
): Promise<WholesaleSupplierWire> {
  return request<WholesaleSupplierWire>(
    session,
    "/api/wholesale/suppliers",
    { method: "POST", body: input },
  );
}
export async function updateWholesaleSupplier(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleSupplierInput> & { active?: boolean },
): Promise<WholesaleSupplierWire> {
  return request<WholesaleSupplierWire>(
    session,
    `/api/wholesale/suppliers/${id}`,
    { method: "PATCH", body: patch },
  );
}
export async function createWholesaleCustomer(
  session: Session,
  input: NewWholesaleCustomerInput,
): Promise<WholesaleCustomerWire> {
  return request<WholesaleCustomerWire>(session, "/api/wholesale/customers", {
    method: "POST",
    body: input,
  });
}
export async function updateWholesaleCustomer(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleCustomerInput> & { active?: boolean },
): Promise<WholesaleCustomerWire> {
  return request<WholesaleCustomerWire>(
    session,
    `/api/wholesale/customers/${id}`,
    { method: "PATCH", body: patch },
  );
}
export async function createWholesaleNamedEntity(
  session: Session,
  path: string,
  input: NewWholesaleNamedEntityInput,
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(session, `/api/wholesale/${path}`, {
    method: "POST",
    body: input,
  });
}
export async function updateWholesaleNamedEntity(
  session: Session,
  path: string,
  id: string,
  patch: Partial<NewWholesaleNamedEntityInput> & { active?: boolean },
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(
    session,
    `/api/wholesale/${path}/${id}`,
    { method: "PATCH", body: patch },
  );
}
