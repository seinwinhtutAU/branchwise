// The pages a guide tells you to open. A bold word in an answer that is exactly one of these
// becomes a button that opens it. The list is fixed here, never taken from the answer's text,
// so a model cannot make a button go anywhere else. (Only unambiguous wholesale pages: a
// retail "Dashboard" and the wholesale one share a name, so neither is listed.)
const PAGE_ROUTES: Record<string, string> = {
  Today: "today",
  Customers: "customers",
  Suppliers: "suppliers",
  Products: "products",
};

export function pageRouteFor(text: string): string | null {
  return PAGE_ROUTES[text.trim()] ?? null;
}
