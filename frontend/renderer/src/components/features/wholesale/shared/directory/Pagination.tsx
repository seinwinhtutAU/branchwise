import React from "react";

const BUTTON =
  "rounded-lg px-3 py-1.5 font-medium text-brand transition-colors hover:bg-brand-subtle disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent";

/** "Page 2 of 5" with Previous and Next. Shows nothing when there is only one page. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}): React.JSX.Element | null {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-3 flex items-center justify-between text-xs">
      <span className="text-text-muted">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={BUTTON}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className={BUTTON}
        >
          Next
        </button>
      </div>
    </div>
  );
}
