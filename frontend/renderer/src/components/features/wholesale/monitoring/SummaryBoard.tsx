import type { ReactNode } from "react";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { cn } from "@renderer/lib/utils";

/** One line of a column's short list: a name, its figure, and (optionally) a small line under it. */
interface BoardRow {
  key: string;
  name: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}

export interface BoardColumn {
  /** Optional category heading above the main KPI. */
  title?: string;
  /** Where the title leads (the tab with the detail). */
  onTitle?: () => void;
  /** The one figure the column is about. */
  big: { label: string; value: string; note?: string; warn?: boolean };
  /** How much of the whole is done, as a bar with a caption ("25% received"). */
  bar?: { fraction: number; caption: string; color: string };
  /** The other numbers, a label and a value each. */
  facts: { label: string; value: string }[];
  /** Opens the operational list behind this summary figure with its filter already applied. */
  action?: { label: string; onClick: () => void };
  list?: {
    title: string;
    rows: BoardRow[];
    empty: string;
    footer?: { label: string; value: string; warn?: boolean };
  };
}

/** A compact KPI board. It can be one joined strip, or standalone cards when each KPI needs its
 *  own visual boundary. */
export function Board({
  columns,
  footer,
  separateCards = false,
}: {
  columns: BoardColumn[];
  footer?: ReactNode;
  separateCards?: boolean;
}): React.JSX.Element {
  const grid = columns.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <section className="flex flex-col gap-2.5">
      {separateCards ? (
        <div className={cn("grid grid-cols-1 gap-2.5", grid)}>
          {columns.map((column) => (
            <Card key={column.title ?? column.big.label} className="p-0">
              <Tile column={column} />
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          <div
            className={cn(
              "grid grid-cols-1 divide-y divide-border lg:divide-y-0 lg:divide-x",
              grid,
            )}
          >
            {columns.map((column) => (
              <Tile key={column.title ?? column.big.label} column={column} />
            ))}
          </div>
        </Card>
      )}
      <div className={cn("grid grid-cols-1 gap-2.5", grid)}>
        {columns.map(
          (column) =>
            column.list && (
              <ListCard
                key={column.title ?? column.big.label}
                list={column.list}
              />
            ),
        )}
      </div>
      {footer && <Card className="px-3 py-2">{footer}</Card>}
    </section>
  );
}

function Tile({ column }: { column: BoardColumn }): React.JSX.Element {
  const { big, bar, facts } = column;
  return (
    <div className="flex flex-col gap-1 px-3.5 py-3">
      {(column.title || column.onTitle) && (
        <div className="flex items-center justify-between gap-2">
          {column.title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              {column.title}
            </h2>
          )}
          {column.onTitle && (
            <button
              type="button"
              onClick={column.onTitle}
              className="ml-auto text-xs font-medium text-brand hover:underline"
            >
              Details →
            </button>
          )}
        </div>
      )}
      <div className="text-xs text-text-secondary">{big.label}</div>
      <div
        className={cn(
          "text-2xl font-bold leading-none tracking-tight tabular-nums",
          big.warn ? "text-warning" : "text-text-primary",
        )}
      >
        {big.value}
      </div>
      {big.note && <div className="text-xs text-text-muted">{big.note}</div>}
      {bar && (
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, bar.fraction * 100))}%`,
                background: bar.color,
              }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-text-muted">
            {bar.caption}
          </span>
        </div>
      )}
      <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline gap-1.5">
            <dt className="text-text-muted">{fact.label}</dt>
            <dd className="font-semibold tabular-nums text-text-primary">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {column.action && (
        <button
          type="button"
          onClick={column.action.onClick}
          className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover"
        >
          {column.action.label} <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}

function ListCard({
  list,
}: {
  list: NonNullable<BoardColumn["list"]>;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col p-3">
      <CardHeader className="mb-1" title={list.title} />
      {list.rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-text-muted">{list.empty}</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {list.rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                disabled={!row.onClick}
                onClick={row.onClick}
                className="flex w-full items-center gap-3 rounded px-1 py-1.5 text-left text-sm enabled:cursor-pointer enabled:hover:bg-bg-subtle"
              >
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {row.name}
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums text-text-primary">
                    {row.value}
                  </span>
                  {row.sub && (
                    <span className="block text-[11px] tabular-nums text-text-muted">
                      {row.sub}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.footer && (
        <div className="mt-auto flex items-center justify-between border-t border-border px-1 pt-1.5 text-xs">
          <span className="text-text-muted">{list.footer.label}</span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              list.footer.warn ? "text-warning" : "text-text-secondary",
            )}
          >
            {list.footer.value}
          </span>
        </div>
      )}
    </Card>
  );
}
