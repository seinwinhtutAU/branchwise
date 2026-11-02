import { apiBaseUrl } from "@renderer/lib/auth";
import {
  getConnectionStatus,
  reportRequestFailure,
  reportRequestRetry,
  reportRequestSuccess,
  watchBrowserOfflineEvent,
} from "@renderer/lib/connection";
import { readOfflineRead, saveOfflineRead } from "@renderer/lib/offlineReadCache";
import { isTransportFailure } from "@renderer/lib/networkFailure";

/** Add timeouts, safe retries, and connection reporting to app API requests. */

// Normal reads should fail fast enough to show cached data after a lost connection.
const READ_TIMEOUT_MS = 15_000;
// Writes and imports can take longer because the server processes the full file.
const WRITE_TIMEOUT_MS = 5 * 60_000;
// Cold dashboard and warning reads are slower, then cached by the server.
const HEAVY_READ_TIMEOUT_MS = 90_000;

// Retry short connection drops before falling back to cached data.
const RETRY_DELAYS_MS = [750, 2_000];

// Check whether the API and database are reachable while offline.
const PROBE_INTERVAL_MS = 5000;

function isImportConfirm(url: string): boolean {
  return /\/api\/imports\/(sales|inventory|purchase)\/confirm(?:\?|$)/.test(url);
}

// Wholesale exports are slow reads and remain safe to retry.
function isWholesaleExport(url: string): boolean {
  return /\/api\/wholesale\/export(?:\?|$)/.test(url);
}

// These reads can build several dashboard aggregates from a cold database/cache, so
// the ordinary 15-second limit can fail on the first visit even though a retry works.
function isHeavyRead(url: string): boolean {
  return /\/api\/(dashboard\/overview|warnings|wholesale\/(monitoring|dashboard))(?:\/|\?|$)/.test(
    url,
  );
}

function addIdempotencyKey(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  shouldAdd: boolean,
): RequestInit | undefined {
  if (!shouldAdd) return init;
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
  return { ...init, headers };
}

/** A timeout may still mean the server completed a write, so it is not retried blindly. */
export class RequestTimeoutError extends Error {
  constructor(url: string) {
    super(`The server did not answer in time: ${url}`);
    this.name = "RequestTimeoutError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Combine the caller's abort signal with a timeout and expose cleanup. */
function withTimeout(
  external: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = (): void => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort);
  }

  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function methodOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

export function installNetworkResilience(): () => void {
  const original = window.fetch;
  const stopOfflineWatch = watchBrowserOfflineEvent();
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  // Do not start another probe while the current one is still connecting.
  let probeInFlight = false;

  // Keep checking until both the API and database are back.
  function startProbing(): void {
    if (probeTimer) return;
    probeTimer = setInterval(() => {
      if (getConnectionStatus() !== "offline") {
        stopProbing();
        return;
      }
      if (probeInFlight) return;
      probeInFlight = true;
      const startedAt = Date.now();
      original(`${apiBaseUrl}/api/health/db`)
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as {
            database?: string;
          } | null;
          // The app is still offline when the API cannot reach the database.
          if (response.ok && body?.database === "ok") {
             
            // Report a successful probe so the connection state can recover.
            console.log(`[connection] probe succeeded after ${Date.now() - startedAt}ms — reconnected`);
            reportRequestSuccess(Date.now() - startedAt);
            stopProbing();
          } else {
             
            console.debug(`[connection] probe answered but database is not ok:`, body);
          }
        })
        .catch((error) => {
          // Keep the offline banner; the next probe will try again.
           
          console.debug(`[connection] probe still failing: ${(error as Error)?.message ?? error}`);
        })
        .finally(() => {
          probeInFlight = false;
        });
    }, PROBE_INTERVAL_MS);
  }

  function stopProbing(): void {
    if (!probeTimer) return;
    clearInterval(probeTimer);
    probeTimer = null;
  }

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.startsWith(apiBaseUrl)) return original(input, init);

    const method = methodOf(input, init);
    // Retry only reads. Other writes might already have been saved.
    const isRead = method === "GET" || method === "HEAD";
    // Confirming an import is safe to retry when it has an idempotency key.
    const requestInit = addIdempotencyKey(input, init, method === "POST" && isImportConfirm(url));
    const canRetry = isRead || isImportConfirm(url);
    // Imports are safe to retry but still need the longer write timeout.
    const timeoutMs = isImportConfirm(url) || isWholesaleExport(url)
      ? WRITE_TIMEOUT_MS
      : isRead
        ? isHeavyRead(url)
          ? HEAVY_READ_TIMEOUT_MS
          : READ_TIMEOUT_MS
        : WRITE_TIMEOUT_MS;
    const callerSignal =
      requestInit?.signal ?? (input instanceof Request ? input.signal : null);

    const attempts = canRetry ? RETRY_DELAYS_MS.length + 1 : 1;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const startedAt = Date.now();
      const timeout = withTimeout(callerSignal, timeoutMs);
      try {
        const response = await original(input, {
          ...requestInit,
          signal: timeout.signal,
        });
        // An HTTP response confirms the connection worked, even when it is an error.
        reportRequestSuccess(Date.now() - startedAt);
        if (isRead) void saveOfflineRead(url, response.clone());
        return response;
      } catch (error) {
        // The caller cancelled this request, so do not retry it.
        if (callerSignal?.aborted) throw error;
        // Errors from another wrapper do not prove the network is offline.
        if (!isTransportFailure(error, timeout.timedOut())) throw error;
        lastError = timeout.timedOut() ? new RequestTimeoutError(url) : error;
        const isLastAttempt = attempt === attempts - 1;
        if (!isLastAttempt) reportRequestRetry();
         
        // connection" reports: exactly which request failed, how, and after how long.
        console.warn(
          `[connection] ${method} ${url} failed on attempt ${attempt + 1}/${attempts} after ${
            Date.now() - startedAt
          }ms (${timeout.timedOut() ? "timed out" : (error as Error)?.name || "network error"}: ${
            (error as Error)?.message ?? error
          })${isLastAttempt ? " — giving up" : `, retrying in ${RETRY_DELAYS_MS[attempt]}ms`}`,
        );
        if (isLastAttempt) break;
        await delay(RETRY_DELAYS_MS[attempt]);
      } finally {
        timeout.done();
      }
    }

    reportRequestFailure();
    startProbing();
    if (isRead) {
      const cached = await readOfflineRead(url);
      if (cached) {
         
        console.info(`[connection] serving cached response while offline: ${url}`);
        return cached;
      }
    }
    throw lastError;
  };

  return () => {
    window.fetch = original;
    stopOfflineWatch();
    stopProbing();
  };
}
