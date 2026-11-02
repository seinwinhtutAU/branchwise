import { useEffect, useState } from "react";
import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  barWidth,
  formatCost,
  formatTokens,
  type UsageReport,
  type UsageRow,
} from "@renderer/components/features/chat/usageFormat";

function Breakdown({
  title,
  rows,
  priced,
}: {
  title: string;
  rows: UsageRow[];
  priced: boolean;
}): React.JSX.Element {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-text-primary">{row.label}</span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {formatTokens(row.total_tokens)}
                  {priced && formatCost(row.cost) !== null && (
                    <span className="ml-2 font-medium text-success">
                      {formatCost(row.cost)}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${barWidth(row, rows)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayBars({
  rows,
  priced,
}: {
  rows: UsageRow[];
  priced: boolean;
}): React.JSX.Element {
  const [hovered, setHovered] = useState<UsageRow | null>(null);
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        By day
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing yet.</p>
      ) : (
        <>
          <p className="mb-1 h-4 text-xs tabular-nums text-text-secondary">
            {hovered ? (
              <>
                {hovered.label} · {hovered.total_tokens.toLocaleString()} tokens
                {priced && formatCost(hovered.cost) !== null && (
                  <span className="ml-1 font-medium text-success">
                    · {formatCost(hovered.cost)}
                  </span>
                )}{" "}
                · {hovered.calls} requests
              </>
            ) : (
              "Hover a bar to see that day."
            )}
          </p>
          <div className="flex h-20 items-end gap-0.5">
            {rows.map((row) => (
              <div
                key={row.key}
                onMouseEnter={() => setHovered(row)}
                onMouseLeave={() => setHovered(null)}
                className="min-w-0.5 max-w-6 flex-1 rounded-t-sm bg-brand opacity-80"
                style={{ height: `${barWidth(row, rows)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>{rows[0].label}</span>
            <span>{rows[rows.length - 1].label}</span>
          </div>
        </>
      )}
    </section>
  );
}

/** What the assistant costs, in tokens (and money when prices are set on the server), shown
 *  inside the chat panel. Each person sees their own; the owner sees everyone's, with who used
 *  how much. */
export function UsagePanel({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const [days, setDays] = useState("30");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/chat/usage?days=${days}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as UsageReport;
        if (current) setReport(body);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [days, session.access_token]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-text-muted">
          {report?.scope === "everyone"
            ? "What the assistant used across everyone."
            : "What your questions to the assistant have used."}
        </p>
        <Select
          label="Period"
          className="min-w-40"
          size="sm"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      {report === null ? (
        <div className="flex justify-center py-8">
          {failed ? (
            <p className="text-sm text-text-muted">
              Usage couldn&apos;t be loaded.
            </p>
          ) : (
            <Spinner className="h-4 w-4 text-text-muted" />
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-text-secondary">
            <span className="text-2xl font-bold tabular-nums text-text-primary">
              {formatTokens(report.total.total_tokens)}
            </span>{" "}
            tokens
            {report.priced && formatCost(report.total.cost) !== null && (
              <span>
                {" "}
                · about{" "}
                <span className="font-semibold text-success">
                  {formatCost(report.total.cost)}
                </span>
              </span>
            )}
            <span className="text-text-muted">
              {" "}
              · {report.total.calls.toLocaleString()} requests
            </span>
          </p>
          {report.total.cached_input_tokens > 0 && (
            <p className="-mt-3 text-xs text-text-muted">
              {Math.round(
                (report.total.cached_input_tokens /
                  Math.max(report.total.input_tokens, 1)) *
                  100,
              )}
              % of the input was served from the provider&apos;s cache, which is
              billed lower.
            </p>
          )}
          <Breakdown
            title="By function"
            rows={report.by_kind}
            priced={report.priced}
          />
          <Breakdown
            title="Retail and Wholesale"
            rows={report.by_business}
            priced={report.priced}
          />
          <DayBars rows={report.by_day} priced={report.priced} />
          {report.scope === "everyone" && (
            <Breakdown
              title="By person"
              rows={report.by_user}
              priced={report.priced}
            />
          )}
        </>
      )}
    </div>
  );
}
