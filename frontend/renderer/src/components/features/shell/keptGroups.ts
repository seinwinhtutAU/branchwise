// Which pages stay mounted (hidden) once visited, so a filter, a search, a tab or a page number is
// still there when you come back. Several nav sections can show one component: Import, History and
// Import Overview are one ImportHubPage, and Data's Overview, Sales, Inventory and Purchase are one
// DataOverviewTable, so they share a group (and a scroll position).
export type KeptGroup =
  | "dashboard"
  | "businessAlerts"
  | "importHub"
  | "dataOverview"
  | "purchasing"
  | "warnings"
  | "customers"
  | "suppliers"
  | "products"
  | "monitoring";

const GROUP_OF_SECTION: Record<string, KeptGroup> = {
  // Retail
  dashboard: "dashboard",
  businessAlerts: "businessAlerts",
  import: "importHub",
  history: "importHub",
  importOverview: "importHub",
  overview: "dataOverview",
  sales: "dataOverview",
  inventory: "dataOverview",
  purchase: "dataOverview",
  purchasing: "purchasing",
  warnings: "warnings",
  // Wholesale
  customers: "customers",
  suppliers: "suppliers",
  products: "products",
  monitoring: "monitoring",
};

/** The group a section belongs to, or null for a page that is rebuilt each time (Settings, ...). */
export function keptGroupFor(section: string): KeptGroup | null {
  return GROUP_OF_SECTION[section] ?? null;
}
