// The one write helper every wholesale-domain api file (shipmentsApi.ts, receivingsApi.ts,
// customerOrdersApi.ts, ...) funnels through. A write here is never retried automatically
// — lib/network.ts only retries reads, since a write that timed out may already have been
// applied — so a timeout is reported as "reload to see whether it saved" rather than
// silently sent again.
//
// Reads go through React Query (see each page's useQuery/useQueries call), which already
// knows how to retry, and wraps the same apiBaseUrl.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { RequestTimeoutError } from "@renderer/lib/network";
import { invalidateEverything } from "@renderer/lib/queryClient";

export class WholesaleApiError extends Error {}

export function humanizeDetail(text: string): string {
  if (/^Action '.*' is not allowed/i.test(text)) {
    return "This action is not available in the current status. Please refresh the page.";
  }
  if (/The route goes round in a circle/i.test(text)) {
    return "The route cannot loop back to an earlier stop.";
  }
  if (/Two places on the route share a key/i.test(text)) {
    return "The route contains duplicate stops.";
  }
  if (/date_from must be on or before date_to/i.test(text)) {
    return "Start date cannot be after end date.";
  }
  if (/month must be YYYY-MM/i.test(text)) {
    return "Month must be in YYYY-MM format (e.g. 2026-10).";
  }
  if (/This account cannot use the retail workspace/i.test(text)) {
    return "Your account does not have access to the retail workspace.";
  }
  if (/This account cannot use retail operations/i.test(text)) {
    return "Your account does not have permission for retail operations.";
  }
  if (/This account cannot mark a day as closed/i.test(text)) {
    return "Your account does not have permission to close the day.";
  }
  if (/This account cannot use the assistant/i.test(text)) {
    return "Your account does not have access to the assistant.";
  }
  return text;
}

export function humanStatusFallback(status: number): string {
  if (status === 404) return "The requested record was not found.";
  if (status === 409) return "This record was updated by someone else. Please refresh the page to see the latest version.";
  if (status >= 500) return "The system encountered an error. Please try again or contact support.";
  return `Request could not be completed (${status}).`;
}

/** FastAPI's `detail` is a sentence for a rule the server checked itself, but a list of
 *  `{loc, msg}` objects when the request body failed validation. Turning that list into a
 *  string shows "[object Object]", so each one becomes "field: what is wrong". */
export function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return humanizeDetail(detail);
  if (Array.isArray(detail)) {
    const parts = detail
      .map((entry) => {
        if (typeof entry === "string") return humanizeDetail(entry);
        if (!entry || typeof entry !== "object") return "";
        const { loc, msg } = entry as { loc?: unknown; msg?: unknown };
        let message = typeof msg === "string" ? msg : "";
        if (message.toLowerCase() === "field required") {
          message = "is required";
        }
        const field = Array.isArray(loc)
          ? String(loc[loc.length - 1] ?? "").replace(/_/g, " ")
          : "";
        return field && message ? `${field}: ${message}` : message;
      })
      .filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length) return unique.join(". ");
  }
  return fallback;
}

/** Every write funnels through here: the Bearer header, the body, reading FastAPI's
 *  `detail` as the message on a non-2xx response, and turning a network timeout into a
 *  message that tells the truth — the write may or may not have gone through. Callers
 *  never see a raw fetch. */
export async function request<T>(
  session: Session,
  path: string,
  init: { method: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new WholesaleApiError(
        "The connection timed out. Please refresh the page to see if your changes were saved before trying again.",
      );
    }
    throw new WholesaleApiError(
      "Unable to connect to the system. Please check your internet connection and try again.",
    );
  }

  if (response.status === 204) {
    invalidateEverything();
    return undefined as T;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = humanStatusFallback(response.status);
    throw new WholesaleApiError(
      describeDetail(body?.detail, fallback),
    );
  }

  invalidateEverything();
  return body as T;
}
