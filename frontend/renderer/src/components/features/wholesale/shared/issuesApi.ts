// What the Issue dialog reads and writes: manually created anomaly records kept
// against a voucher, order, or shipment.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { fetchJson } from "@renderer/lib/queryClient";
import { request } from "./apiClient";

export interface IssueInput {
  reference_type: "voucher" | "order" | "shipment";
  reference_id: string;
  issue_type: string;
  subject_type?: "product" | "package" | "delivery" | "general";
  subject_id?: string;
  color_breakdown?: string;
  affected_quantity?: number;
  note: string;
}

export interface IssueRecord {
  id: string;
  issue_id: string;
  write_off_id: string;
  branch_id: string | null;
  reference_type?: "voucher" | "order" | "shipment" | null;
  reference_id?: string | null;
  reference: string;
  issue_type: string;
  subject_type: string;
  subject_id: string;
  affected_quantity?: number | null;
  quantity: number;
  unit: string;
  unit_conversions?: Record<string, number>;
  color_breakdown?: string;
  description: string;
  stock_code: string;
  record_type?: string;
  status: "open" | "resolved";
  resolved_at?: string | null;
  resolved_by_user_id?: string | null;
  reason?: string;
  note: string;
  recorded_by_user_id: string;
  created_at: string;
}

export interface IssueTypeOption {
  value: string;
  label: string;
}

export function getIssueTypeOptions(
  context: "voucher" | "shipment" | "order" | "delivery",
): IssueTypeOption[] {
  if (context === "shipment") {
    return [
      { value: "lost_in_transit", label: "Lost in transit" },
      { value: "damaged_in_transit", label: "Damaged in transit" },
      { value: "carrier_problem", label: "Carrier problem" },
      { value: "other", label: "Other" },
    ];
  }
  if (context === "delivery") {
    return [
      { value: "delivery_failed", label: "Could not deliver" },
      { value: "partial_delivery", label: "Partial delivery" },
      { value: "customer_refused", label: "Customer refused" },
      { value: "wrong_address", label: "Wrong address" },
      { value: "damaged", label: "Damaged" },
      { value: "shortfall", label: "Shortfall" },
      { value: "other", label: "Other" },
    ];
  }
  if (context === "voucher") {
    return [
      { value: "shortfall", label: "Supplier sent less" },
      { value: "damaged", label: "Damaged" },
      { value: "wrong_items", label: "Wrong item" },
      { value: "other", label: "Other" },
    ];
  }
  // context === "order"
  return [
    { value: "customer_changed", label: "Customer changed quantity" },
    { value: "customer_returned", label: "Customer return" },
    { value: "out_of_stock", label: "Out of stock" },
    { value: "lost", label: "Lost / Missing" },
    { value: "damaged", label: "Damaged" },
    { value: "other", label: "Other" },
  ];
}

export function formatIssueType(type: string): string {
  const map: Record<string, string> = {
    customer_changed: "Customer changed",
    customer_returned: "Customer return",
    lost: "Lost / Missing",
    out_of_stock: "Out of stock",
    delivery_failed: "Could not deliver",
    partial_delivery: "Partial delivery",
    customer_refused: "Customer refused",
    wrong_address: "Wrong address",
    lost_in_transit: "Lost in transit",
    damaged_in_transit: "Damaged in transit",
    carrier_problem: "Carrier problem",
    shortfall: "Supplier sent less",
    short_shipped: "Supplier sent less",
    damaged: "Damaged",
    wrong_items: "Wrong items",
    other: "Other",
  };
  return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Create a manual issue against a document. */
export async function createIssue(
  session: Session,
  input: IssueInput,
): Promise<IssueRecord> {
  return request<IssueRecord>(session, "/api/wholesale/issues", {
    method: "POST",
    body: input,
  });
}

/** Every issue on one voucher, order or shipment (found by its reference number). */
export async function listIssueRecords(
  session: Session,
  reference: string,
): Promise<IssueRecord[]> {
  const query = new URLSearchParams({ reference, page_size: "2000" });
  return fetchJson<IssueRecord[]>(
    `${apiBaseUrl}/api/wholesale/issues?${query.toString()}`,
    session,
  );
}

/** Mark an issue as resolved. */
export async function resolveIssueRecord(
  session: Session,
  id: string,
): Promise<IssueRecord> {
  return request<IssueRecord>(session, `/api/wholesale/issues/${id}/resolve`, {
    method: "POST",
  });
}

export async function updateIssueRecord(
  session: Session,
  id: string,
  patch: {
    status?: "open" | "resolved";
    note?: string;
    issue_type?: string;
    affected_quantity?: number;
    quantity?: number;
    color_breakdown?: string;
  },
): Promise<IssueRecord> {
  return request<IssueRecord>(session, `/api/wholesale/issues/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deleteIssueRecord(
  session: Session,
  id: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/issues/${id}`, {
    method: "DELETE",
  });
}
