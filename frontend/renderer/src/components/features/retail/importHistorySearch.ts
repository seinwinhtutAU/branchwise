// Searching Import History: what a row is searched on, and whether it matches. Every word typed
// must appear somewhere in the row (any order, any case), so "westmall sales" finds the Sales
// imports of WestMall.

export interface SearchableImport {
  filename: string | null;
  typeLabel: string;
  branchName: string | null;
  uploadedBy: string | null;
  statusLabel: string;
  // YYYY-MM-DD of the import, so "2026-09-23" or "2026-09" finds a day or a month.
  date: string;
}

function searchText(row: SearchableImport): string {
  return [
    row.filename,
    row.typeLabel,
    row.branchName,
    row.uploadedBy,
    row.statusLabel,
    row.date,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(row: SearchableImport, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(row);
  return words.every((word) => text.includes(word));
}
