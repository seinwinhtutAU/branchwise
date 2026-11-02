// Which actions Import History offers on a row. Every import type can be reimported or removed
// while it is still active, a General file included; a retail account loses that after a day
// (`locked`), and a removed or replaced import has nothing left to manage.
export function canManageImport(
  row: { import_type: string; status: string },
  locked: boolean,
): boolean {
  return row.status === "completed" && !locked;
}
